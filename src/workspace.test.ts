import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "./workspace.ts";
import type { ProjectConfig } from "./config.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-workspace-"));
  roots.push(root);
  const config: ProjectConfig = { root, tasks: {}, denyDirs: [], denyFiles: [], maxTextBytes: 2_000_000, maxResults: 1000 };
  return { root, workspace: new Workspace(config) };
}

test("create, read, replace, and delete with hash checks", async () => {
  const { workspace } = await setup();
  const created = await workspace.write("src/a.ts", "hello\n", undefined, true);
  expect((await workspace.read("src/a.ts")).sha256).toBe(created.sha256);
  await expect(workspace.write("src/a.ts", "bad", undefined, true)).rejects.toThrow("already exists");
  await expect(workspace.write("src/a.ts", "bad", "0".repeat(64))).rejects.toThrow("PATCH_CONFLICT");
  const updated = await workspace.write("src/a.ts", "world\n", created.sha256);
  expect((await workspace.read("src/a.ts")).content).toBe("world\n");
  await expect(workspace.remove("src/a.ts", created.sha256)).rejects.toThrow("PATCH_CONFLICT");
  await workspace.remove("src/a.ts", updated.sha256);
  await expect(workspace.read("src/a.ts")).rejects.toThrow();
});

test("rejects traversal, protected paths, and symlinks", async () => {
  const { root, workspace } = await setup();
  await fs.writeFile(path.join(root, ".env"), "secret");
  await fs.symlink(os.tmpdir(), path.join(root, "outside"));
  await expect(workspace.read("../outside.txt")).rejects.toThrow("escapes");
  await expect(workspace.read(".env")).rejects.toThrow("protected");
  await expect(workspace.list(".git")).rejects.toThrow("protected");
  await expect(workspace.write("outside/hijack.txt", "bad", undefined, true)).rejects.toThrow("Symbolic links");
  expect((await workspace.list()).paths).toEqual([]);
});

test("rejects binary content and lists nested files", async () => {
  const { root, workspace } = await setup();
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "binary.bin"), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(root, "src", "text.py"), "print('ok')\n");
  expect((await workspace.list()).paths).toEqual(["src/binary.bin", "src/text.py"]);
  await expect(workspace.read("src/binary.bin")).rejects.toThrow("binary");
});
