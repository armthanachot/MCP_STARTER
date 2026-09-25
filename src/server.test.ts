import { expect, test } from "bun:test";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./server.ts";
import type { ProjectConfig } from "./config.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("MCP lists and calls the generic tools", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-protocol-"));
  try {
    const config: ProjectConfig = { root, tasks: { smoke: { command: "bun", args: ["-e", "console.log('task-ok')"], timeoutMs: 10_000 } }, denyDirs: [], denyFiles: [], maxTextBytes: 2_000_000, maxResults: 1000 };
    const handler = createMcpHandler(() => createServer(config));
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
    const searched = await call(4, "tools/call", { name: "file_search", arguments: { query: "print" } });
    expect(searched.result.structuredContent.matches[0].path).toBe("a.py");
    const task = await call(5, "tools/call", { name: "task_run", arguments: { name: "smoke" } });
    expect(task.result.structuredContent.exitCode).toBe(0);
    expect(task.result.structuredContent.stdout).toContain("task-ok");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
