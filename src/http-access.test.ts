import { expect, test } from "bun:test";
import { createHttpAccess } from "./http-access.ts";

test("accepts configured ngrok host and requires bearer token for MCP", () => {
  expect(() => createHttpAccess("127.0.0.1", 3003, "https://example.ngrok.app")).toThrow("MCP_TOKEN");
  const check = createHttpAccess("127.0.0.1", 3003, "https://example.ngrok.app", "test-token");
  const request = (host: string, headers: Record<string, string> = {}) =>
    new Request("https://example.ngrok.app/mcp", { headers: { host, ...headers } });
  expect(check(request("example.ngrok.app", { authorization: "Bearer test-token" }), false)).toBeNull();
  expect(check(request("example.ngrok.app"), false)?.status).toBe(401);
  expect(check(request("other.example.com", { authorization: "Bearer test-token" }), false)?.status).toBe(403);
  expect(check(request("example.ngrok.app", { origin: "https://evil.example", authorization: "Bearer test-token" }), false)?.status).toBe(403);
  expect(check(request("example.ngrok.app"), true)).toBeNull();
});
