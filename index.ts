import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./src/config.ts";
import { createServer } from "./src/server.ts";
import { createStaticFiles } from "./src/static-files.ts";
import { createHttpAccess } from "./src/http-access.ts";

if (process.env.MCP_PROFILE === "garmin") {
  await import("./garmin.ts");
} else {
  const config = await loadConfig();
  if (process.env.MCP_TRANSPORT === "http") {
    const host = process.env.MCP_HOST || "127.0.0.1";
    const port = Number(process.env.MCP_PORT || 3003);
    const token = process.env.MCP_TOKEN;
    const baseUrl = process.env.MCP_BASE_URL || `http://${host === "::1" ? "[::1]" : host}:${port}`;
    const staticFiles = createStaticFiles(config, baseUrl, Number(process.env.MCP_FILE_URL_TTL_SECONDS || 900));
    const checkAccess = createHttpAccess(host, port, baseUrl, token);
    const handler = createMcpHandler(() => createServer(config, staticFiles));
    Bun.serve({ hostname: host, port, fetch(request) {
      const url = new URL(request.url);
      const isStatic = url.pathname.startsWith("/files/");
      if (!isStatic && url.pathname !== "/mcp") return new Response("Not Found", { status: 404 });
      const denial = checkAccess(request, isStatic);
      if (denial) return denial;
      if (isStatic) return staticFiles.handle(request);
      return handler.fetch(request);
    } });
    console.error(`Common MCP listening on http://${host}:${port}/mcp`);
  } else if (!process.env.MCP_TRANSPORT || process.env.MCP_TRANSPORT === "stdio") {
    await serveStdio(() => createServer(config));
  } else {
    throw new Error("MCP_TRANSPORT must be stdio or http.");
  }
}
