import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./src/config.ts";
import { createServer } from "./src/server.ts";

if (process.env.MCP_PROFILE === "garmin") {
  await import("./garmin.ts");
} else {
  const config = await loadConfig();
  if (process.env.MCP_TRANSPORT === "http") {
    const host = process.env.MCP_HOST || "127.0.0.1";
    const port = Number(process.env.MCP_PORT || 3003);
    const token = process.env.MCP_TOKEN;
    const loopback = host.startsWith("127.") || host === "::1" || host === "localhost";
    if (!loopback && !token) {
      throw new Error("MCP_TOKEN is required when HTTP binds outside loopback.");
    }
    const handler = createMcpHandler(() => createServer(config));
    Bun.serve({ hostname: host, port, fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/mcp") return new Response("Not Found", { status: 404 });
      const requestHost = request.headers.get("host")?.split(":")[0];
      if (loopback && requestHost && ![host, "localhost", "127.0.0.1", "[::1]"].includes(requestHost)) {
        return new Response("Forbidden", { status: 403 });
      }
      const origin = request.headers.get("origin");
      if (origin) {
        try {
          if (![host, "localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) {
            return new Response("Forbidden", { status: 403 });
          }
        } catch { return new Response("Forbidden", { status: 403 }); }
      }
      if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      return handler.fetch(request);
    } });
    console.error(`Common MCP listening on http://${host}:${port}/mcp`);
  } else if (!process.env.MCP_TRANSPORT || process.env.MCP_TRANSPORT === "stdio") {
    await serveStdio(() => createServer(config));
  } else {
    throw new Error("MCP_TRANSPORT must be stdio or http.");
  }
}
