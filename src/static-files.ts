import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectConfig } from "./config.ts";
import { Workspace } from "./workspace.ts";

const MIME = new Map([
  [".pdf", "application/pdf"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xls", "application/vnd.ms-excel"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".doc", "application/msword"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);
const IMAGES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const MAX_STATIC_BYTES = 50 * 1024 * 1024;
const ROUTE = "/files/";

export type StaticKind = "image" | "document";

export function createStaticFiles(config: ProjectConfig, baseUrl: string, ttlSeconds = 900) {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || (base.pathname !== "/" && base.pathname !== "/mcp")) {
    throw new Error("MCP_BASE_URL must be an HTTP(S) origin, optionally ending in /mcp.");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
    throw new Error("MCP_FILE_URL_TTL_SECONDS must be between 60 and 3600.");
  }
  const origin = base.origin;
  const key = randomBytes(32);
  const workspace = new Workspace(config);
  const signature = (file: string, expires: string, version: string) =>
    createHmac("sha256", key).update(`${file}\n${expires}\n${version}`).digest("hex");

  async function inspect(filePath: string, kind: StaticKind) {
    const target = await workspace.resolve(filePath);
    const ext = path.extname(target).toLowerCase();
    if (!MIME.has(ext) || (kind === "image") !== IMAGES.has(ext)) {
      throw new Error(`Unsupported ${kind} file extension: ${ext || "(none)"}.`);
    }
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error("Target is not a regular file.");
    if (stat.size > MAX_STATIC_BYTES) throw new Error(`File exceeds ${MAX_STATIC_BYTES} bytes.`);
    return { target, relative: workspace.relative(target), ext, stat, version: `${stat.mtimeMs}:${stat.size}` };
  }

  async function urlFor(filePath: string, kind: StaticKind) {
    const file = await inspect(filePath, kind);
    const expires = String(Math.floor(Date.now() / 1000) + ttlSeconds);
    const url = new URL(`${ROUTE}${file.relative.split("/").map(encodeURIComponent).join("/")}`, origin);
    url.searchParams.set("expires", expires);
    url.searchParams.set("v", file.version);
    url.searchParams.set("sig", signature(file.relative, expires, file.version));
    return { url: url.toString(), path: file.relative, mimeType: MIME.get(file.ext)!, bytes: file.stat.size, expiresAt: new Date(Number(expires) * 1000).toISOString() };
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(ROUTE)) return new Response("Not Found", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
    try {
      const filePath = url.pathname.slice(ROUTE.length).split("/").map(decodeURIComponent).join("/");
      const expires = url.searchParams.get("expires") ?? "";
      const version = url.searchParams.get("v") ?? "";
      const supplied = url.searchParams.get("sig") ?? "";
      if (!/^\d+$/.test(expires) || Number(expires) < Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(supplied)) {
        return new Response("Forbidden", { status: 403 });
      }
      const expected = signature(filePath, expires, version);
      if (!timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"))) {
        return new Response("Forbidden", { status: 403 });
      }
      const file = await inspect(filePath, IMAGES.has(path.extname(filePath).toLowerCase()) ? "image" : "document");
      if (version !== file.version || file.relative !== filePath) {
        return new Response("Forbidden", { status: 403 });
      }
      const headers = new Headers({
        "Content-Type": MIME.get(file.ext)!,
        "Content-Length": String(file.stat.size),
        "Content-Disposition": `${file.ext === ".svg" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(file.target))}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      });
      return request.method === "HEAD"
        ? new Response(null, { status: 200, headers })
        : new Response(Bun.file(file.target), { status: 200, headers });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }

  return { urlFor, handle };
}

export type StaticFiles = ReturnType<typeof createStaticFiles>;
