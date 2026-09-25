import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import path from "node:path";
import type { ProjectConfig } from "./config.ts";
import { Workspace } from "./workspace.ts";
import { runCommand } from "./process.ts";
import { assertGitRoot, publishGit } from "./git.ts";
import type { StaticFiles } from "./static-files.ts";

const ok = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined,
});
const safe = <T>(fn: (args: T) => Promise<unknown>) => async (args: T): Promise<CallToolResult> => {
  try { return ok(await fn(args)); }
  catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] }; }
};
const hash = z.string().regex(/^[a-fA-F0-9]{64}$/);
const relPath = z.string().min(1);

async function runTask(config: ProjectConfig, name: string) {
  const task = config.tasks[name];
  if (!task) throw new Error(`Unknown task '${name}'. Configured tasks: ${Object.keys(config.tasks).join(", ") || "none"}.`);
  return { name, ...(await runCommand(config, task.command, task.args, task.timeoutMs)) };
}

export function createServer(config: ProjectConfig, staticFiles?: StaticFiles): McpServer {
  const workspace = new Workspace(config);
  const server = new McpServer({ name: "common-workspace-mcp", version: "1.0.0" }, {
    instructions: "Use project_info to discover the workspace and configured tasks. Read a file before replacing or deleting it, then pass its sha256 to guard against stale edits. Review git_status and relevant git_diff results before git_publish; it stages all eligible changes. Paths are relative to the project root.",
  });

  server.registerTool("project_info", {
    description: "Describe the project root, limits, and configured task names.",
    inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true },
  }, safe(async () => ({ root: config.root, maxTextBytes: config.maxTextBytes, tasks: Object.keys(config.tasks) })));

  server.registerTool("file_list", {
    description: "List visible project files. Protected files, dependency directories, and symlinks are omitted.",
    inputSchema: z.object({ path: relPath.default("."), maxResults: z.number().int().min(1).max(10_000).optional() }).strict(),
    annotations: { readOnlyHint: true },
  }, safe(async ({ path: target, maxResults }) => workspace.list(target, Math.min(maxResults ?? config.maxResults, config.maxResults))));

  server.registerTool("file_read", {
    description: "Read a UTF-8 file and return its sha256. Optional line range and line numbers keep responses focused.",
    inputSchema: z.object({ path: relPath, lineStart: z.number().int().min(1).optional(), lineEnd: z.number().int().min(1).optional(), includeLineNumbers: z.boolean().default(false) }).strict(),
    annotations: { readOnlyHint: true },
  }, safe(async ({ path: target, lineStart, lineEnd, includeLineNumbers }) => {
    const file = await workspace.read(target);
    const lines = file.content.split(/\r?\n/);
    const start = lineStart ?? 1;
    const end = lineEnd ?? lines.length;
    if (end < start || end > lines.length) throw new Error("Invalid line range.");
    const selected = lines.slice(start - 1, end);
    return { path: target, sha256: file.sha256, bytes: file.bytes, totalLines: lines.length, lineStart: start, lineEnd: end, content: includeLineNumbers ? selected.map((line, i) => `${start + i}: ${line}`).join("\n") : selected.join("\n") };
  }));

  server.registerTool("file_search", {
    description: "Search visible UTF-8 files for literal text, with optional extension filtering and context lines.",
    inputSchema: z.object({ query: z.string().min(1).max(500), path: relPath.default("."), extensions: z.array(z.string().min(1)).max(20).optional(), caseSensitive: z.boolean().default(false), contextLines: z.number().int().min(0).max(5).default(0), maxResults: z.number().int().min(1).max(200).default(50) }).strict(),
    annotations: { readOnlyHint: true },
  }, safe(async ({ query, path: searchPath, extensions, caseSensitive, contextLines, maxResults }) => {
    const files = await workspace.list(searchPath);
    const selectedExts = extensions?.map(ext => ext.toLowerCase().startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`);
    if (selectedExts?.some(ext => !/^\.[a-z0-9]+$/.test(ext))) throw new Error("Invalid extension filter.");
    const matches: { path: string; line: number; text: string; context?: { line: number; text: string }[] }[] = [];
    const needle = caseSensitive ? query : query.toLowerCase();
    for (const file of files.paths) {
      if (matches.length >= maxResults) break;
      if (selectedExts && !selectedExts.includes(path.extname(file).toLowerCase())) continue;
      let content: string;
      try { content = (await workspace.read(file)).content; } catch { continue; }
      const lines = content.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if ((caseSensitive ? line : line.toLowerCase()).includes(needle)) {
          const context = contextLines ? lines.slice(Math.max(0, index - contextLines), Math.min(lines.length, index + contextLines + 1))
            .map((text, offset) => ({ line: Math.max(0, index - contextLines) + offset + 1, text: text.slice(0, 500) })) : undefined;
          matches.push({ path: file, line: index + 1, text: line.slice(0, 500), ...(context ? { context } : {}) });
          if (matches.length >= maxResults) break;
        }
      }
    }
    return { matches, truncated: files.truncated || matches.length >= maxResults };
  }));

  server.registerTool("document_reader", {
    description: "Return a short-lived full static URL for a project PDF, Word, Excel, PowerPoint, or text document. Requires HTTP transport.",
    inputSchema: z.object({ path: relPath }).strict(), annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ path: target }) => {
    if (!staticFiles) throw new Error("Static URLs require MCP_TRANSPORT=http.");
    return staticFiles.urlFor(target, "document");
  }));

  server.registerTool("image_reader", {
    description: "Return a short-lived full static URL for a project PNG, JPEG, GIF, WebP, or SVG image. Requires HTTP transport.",
    inputSchema: z.object({ path: relPath }).strict(), annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ path: target }) => {
    if (!staticFiles) throw new Error("Static URLs require MCP_TRANSPORT=http.");
    return staticFiles.urlFor(target, "image");
  }));

  server.registerTool("file_write", {
    description: "Create or replace a UTF-8 file. Set createOnly for new files, or expectedSha256 when replacing an existing file.",
    inputSchema: z.object({ path: relPath, content: z.string(), createOnly: z.boolean().default(false), expectedSha256: hash.optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, safe(async ({ path: target, content, createOnly, expectedSha256 }) => {
    if (!createOnly && !expectedSha256) throw new Error("Set createOnly=true or provide expectedSha256.");
    return { path: target, ...(await workspace.write(target, content, expectedSha256, createOnly)) };
  }));

  server.registerTool("file_replace", {
    description: "Replace exactly one occurrence of oldText in a UTF-8 file. Requires the sha256 returned by file_read.",
    inputSchema: z.object({ path: relPath, oldText: z.string().min(1), newText: z.string(), expectedSha256: hash }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, safe(async ({ path: target, oldText, newText, expectedSha256 }) => {
    const file = await workspace.read(target);
    if (file.sha256 !== expectedSha256.toLowerCase()) throw new Error("PATCH_CONFLICT: file changed.");
    const first = file.content.indexOf(oldText);
    if (first < 0) throw new Error("PATCH_CONFLICT: oldText not found.");
    if (file.content.indexOf(oldText, first + oldText.length) >= 0) throw new Error("PATCH_CONFLICT: oldText is not unique.");
    const content = file.content.slice(0, first) + newText + file.content.slice(first + oldText.length);
    return { path: target, ...(await workspace.write(target, content, expectedSha256)) };
  }));

  server.registerTool("file_delete", {
    description: "Delete one regular file after checking its sha256. Directories and protected paths cannot be deleted.",
    inputSchema: z.object({ path: relPath, expectedSha256: hash }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, safe(async ({ path: target, expectedSha256 }) => {
    await workspace.remove(target, expectedSha256);
    return { deleted: target };
  }));

  server.registerTool("task_run", {
    description: "Run a named task from mcp.config.json without a shell. Commands and arguments are fixed by the project owner.",
    inputSchema: z.object({ name: z.string().min(1) }).strict(),
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, safe(async ({ name }) => runTask(config, name)));

  server.registerTool("git_status", {
    description: "Show Git working tree status for the project. Read only; requires a Git repository.",
    inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true },
  }, safe(async () => {
    await assertGitRoot(config);
    return runCommand(config, "git", ["status", "--short", "--untracked-files=normal"], 15_000);
  }));

  server.registerTool("git_diff", {
    description: "Show a bounded Git diff for one visible file. Set staged=true to inspect the index.",
    inputSchema: z.object({ path: relPath, staged: z.boolean().default(false) }).strict(),
    annotations: { readOnlyHint: true },
  }, safe(async ({ path: target, staged }) => {
    await assertGitRoot(config);
    const args = ["diff", "--no-ext-diff", "--no-color"];
    if (staged) args.push("--cached");
    await workspace.resolve(target, { mayCreate: true });
    args.push("--", target);
    return runCommand(config, "git", args, 15_000);
  }));

  server.registerTool("git_publish", {
    description: "Stage all project changes with git add -A, commit with the supplied message, then push only the current branch to its configured upstream. Rejects protected files and stops on any failed step.",
    inputSchema: z.object({ message: z.string().trim().min(1).max(500) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, safe(async ({ message }) => publishGit(config, workspace, message)));

  return server;
}
