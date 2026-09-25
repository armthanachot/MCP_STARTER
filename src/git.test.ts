import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectConfig } from "./config.ts";
import { publishGit } from "./git.ts";
import { Workspace } from "./workspace.ts";

async function command(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${stderr}`);
  return stdout.trim();
}

test("git_publish stages all changes, commits, and pushes to upstream", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-git-"));
  const root = path.join(temp, "project");
  const remote = path.join(temp, "remote.git");
  await fs.mkdir(root);
  try {
    await command(temp, "init", "--bare", "-b", "main", remote);
    await command(root, "init", "-b", "main");
    await command(root, "config", "user.name", "MCP Test");
    await command(root, "config", "user.email", "mcp@example.test");
    await command(root, "remote", "add", "origin", remote);
    await fs.writeFile(path.join(root, "README.md"), "first\n");
    await command(root, "add", "-A");
    await command(root, "commit", "-m", "initial");
    await command(root, "push", "-u", "origin", "main");

    const config: ProjectConfig = { root, tasks: {}, denyDirs: [], denyFiles: [], maxTextBytes: 2_000_000, maxResults: 1000 };
    const workspace = new Workspace(config);
    await fs.writeFile(path.join(root, "README.md"), "second\n");
    await fs.writeFile(path.join(root, "new.ts"), "export const n = 1;\n");
    const result = await publishGit(config, workspace, "publish changes");
    expect(result.branch).toBe("main");
    expect(result.stagedPaths).toContain("new.ts");
    expect(await command(root, "rev-parse", "HEAD")).toBe(await command(remote, "rev-parse", "refs/heads/main"));
    expect(await command(root, "log", "-1", "--format=%s")).toBe("publish changes");

    await fs.writeFile(path.join(root, ".env"), "TOKEN=secret\n");
    await expect(publishGit(config, workspace, "must reject")).rejects.toThrow("protected or unsafe path '.env'");
    expect(await command(root, "status", "--short")).toContain(".env");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
