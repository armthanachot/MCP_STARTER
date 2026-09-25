export function createHttpAccess(host: string, port: number, baseUrl: string, token?: string) {
  const publicOrigin = new URL(baseUrl).origin;
  const publicHostname = new URL(baseUrl).hostname;
  const loopback = (name: string) => name === "localhost" || name === "::1" || name === "[::1]" || name.startsWith("127.");
  if ((!loopback(host) || !loopback(publicHostname)) && !token) {
    throw new Error("MCP_TOKEN is required when HTTP is reachable beyond loopback.");
  }
  const allowedHosts = new Set([host, "localhost", "127.0.0.1", "[::1]", publicHostname]);
  const allowedOrigins = new Set([
    `http://${host === "::1" ? "[::1]" : host}:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    publicOrigin,
  ]);

  return function check(request: Request, isStatic: boolean): Response | null {
    try {
      const rawHost = request.headers.get("host") || new URL(request.url).host;
      const parsedHost = new URL(`http://${rawHost}`);
      if (parsedHost.username || parsedHost.password || parsedHost.pathname !== "/" || !allowedHosts.has(parsedHost.hostname)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (isStatic) return null;
      const origin = request.headers.get("origin");
      if (origin && !allowedOrigins.has(new URL(origin).origin)) return new Response("Forbidden", { status: 403 });
      if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      return null;
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  };
}
