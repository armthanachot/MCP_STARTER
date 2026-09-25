import { expect, test } from "bun:test";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./server.ts";
import type { ProjectConfig } from "./config.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStaticFiles } from "./static-files.ts";

test("MCP lists and calls the generic tools", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-protocol-"));
  try {
    const config: ProjectConfig = { root, tasks: { smoke: { command: "bun", args: ["-e", "console.log('task-ok')"], timeoutMs: 10_000 } }, denyDirs: [], denyFiles: [], maxTextBytes: 2_000_000, maxResults: 1000 };
    const staticFiles = createStaticFiles(config, "http://localhost:3003");
    const handler = createMcpHandler(() => createServer(config, staticFiles));
    const call = async (id: number, method: string, params: object) => {
      const request = new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      const response = await handler.fetch(request);
      expect(response.status).toBe(200);
      const body = await response.text();
      return JSON.parse(body.slice(body.indexOf("data: ") + 6).trim());
    };
    const listed = await call(1, "tools/list", {});
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain("file_replace");
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain("git_publish");
    const written = await call(2, "tools/call", { name: "file_write", arguments: { path: "a.py", content: "print('ok')\n", createOnly: true } });
    expect(written.result.isError).toBeFalsy();
    const read = await call(3, "tools/call", { name: "file_read", arguments: { path: "a.py" } });
    expect(read.result.structuredContent.content).toBe("print('ok')\n");
    const numbered = await call(6, "tools/call", { name: "file_read", arguments: { path: "a.py", includeLineNumbers: true } });
    expect(numbered.result.structuredContent.content).toContain("1: print('ok')");
    const searched = await call(4, "tools/call", { name: "file_search", arguments: { query: "print" } });
    expect(searched.result.structuredContent.matches[0].path).toBe("a.py");
    const filtered = await call(7, "tools/call", { name: "file_search", arguments: { query: "print", extensions: ["py"], contextLines: 1 } });
    expect(filtered.result.structuredContent.matches[0].context[0].line).toBe(1);
    const wrongExt = await call(8, "tools/call", { name: "file_search", arguments: { query: "print", extensions: ["ts"] } });
    expect(wrongExt.result.structuredContent.matches).toEqual([]);
    const document = await call(9, "tools/call", { name: "document_reader", arguments: { path: "a.py" } });
    expect(document.result.isError).toBe(true);
    await fs.writeFile(path.join(root, "note.txt"), "hello");
    const textDocument = await call(10, "tools/call", { name: "document_reader", arguments: { path: "note.txt" } });
    expect(textDocument.result.structuredContent.url).toStartWith("http://localhost:3003/files/note.txt?");
    const task = await call(5, "tools/call", { name: "task_run", arguments: { name: "smoke" } });
    expect(task.result.structuredContent.exitCode).toBe(0);
    expect(task.result.structuredContent.stdout).toContain("task-ok");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
