import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectConfig } from "./config.ts";
import { createStaticFiles } from "./static-files.ts";

test("signed static URLs serve only the selected project file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-static-"));
  try {
    const config: ProjectConfig = { root, tasks: {}, denyDirs: [], denyFiles: [], maxTextBytes: 2_000_000, maxResults: 1000 };
    await fs.mkdir(path.join(root, "docs"));
    await fs.writeFile(path.join(root, "docs", "report one.pdf"), Buffer.from("%PDF-test"));
    await fs.writeFile(path.join(root, "photo.png"), Buffer.from([137, 80, 78, 71]));
    await fs.writeFile(path.join(root, ".env"), "SECRET=x");
    const files = createStaticFiles(config, "http://localhost:3003", 900);

    const document = await files.urlFor("docs/report one.pdf", "document");
    expect(document.url).toStartWith("http://localhost:3003/files/docs/report%20one.pdf?");
    const get = await files.handle(new Request(document.url));
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("application/pdf");
    expect(await get.text()).toBe("%PDF-test");
    const head = await files.handle(new Request(document.url, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const image = await files.urlFor("photo.png", "image");
    expect((await files.handle(new Request(image.url))).status).toBe(200);
    await expect(files.urlFor("photo.png", "document")).rejects.toThrow("Unsupported document");
    await expect(files.urlFor(".env", "document")).rejects.toThrow("protected");
    await expect(files.urlFor("../outside.pdf", "document")).rejects.toThrow("escapes");

    const tampered = new URL(document.url);
    tampered.searchParams.set("sig", "0".repeat(64));
    expect((await files.handle(new Request(tampered.toString()))).status).toBe(403);
    await fs.writeFile(path.join(root, "docs", "report one.pdf"), "%PDF-updated-longer");
    expect((await files.handle(new Request(document.url))).status).toBe(403);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
