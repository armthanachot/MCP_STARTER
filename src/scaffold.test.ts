import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectConfig } from "./config.ts";
import { scaffoldWebProject } from "./scaffold.ts";
import { Workspace } from "./workspace.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-scaffold-"));
  roots.push(root);
  const config: ProjectConfig = { root, tasks: {}, denyDirs: [], denyFiles: [], maxTextBytes: 2_000_000, maxResults: 1000 };
  return { root, workspace: new Workspace(config) };
}

async function read(root: string, file: string) {
  return fs.readFile(path.join(root, file), "utf8");
}

async function verifyTypeScript(root: string, relative: string): Promise<void> {
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) await verifyTypeScript(root, next);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const code = await read(root, next);
      const transpiler = new Bun.Transpiler({ loader: entry.name.endsWith("tsx") ? "tsx" : "ts" });
      expect(() => transpiler.transformSync(code)).not.toThrow();
    }
  }
}

test("monorepo creates runnable source and refuses to overwrite", async () => {
  const { root, workspace } = await setup();
  const result = await scaffoldWebProject(workspace, { layout: "monorepo", projectName: "sample-app" });
  expect(result.paths).toEqual({ project: "sample-app", ui: "sample-app/apps/ui", api: "sample-app/apps/api" });
  expect(JSON.parse(await read(root, "sample-app/package.json")).workspaces).toEqual(["apps/*"]);
  expect(await read(root, "sample-app/apps/api/src/db/schema.ts")).toContain("pgTable('customers'");
  expect(await read(root, "sample-app/apps/ui/src/api/customers.ts")).toContain("/api/customers");
  expect(await read(root, "sample-app/AGENTS.md")).toContain("Do not run any Git command");
  expect(await read(root, "sample-app/apps/api/.gitignore")).toContain("!.env.example");
  expect(await read(root, "sample-app/compose.yaml")).toContain("postgres:17.11-alpine");
  expect(await read(root, "sample-app/compose.yaml")).toContain('"127.0.0.1:5432:5432"');
  await expect(fs.stat(path.join(root, "sample-app/apps/api/compose.yaml"))).rejects.toThrow();
  await expect(fs.stat(path.join(root, "sample-app/apps/api/.env"))).rejects.toThrow();
  await verifyTypeScript(root, "sample-app");
  await expect(scaffoldWebProject(workspace, { layout: "monorepo", projectName: "sample-app" })).rejects.toThrow();
  expect(await read(root, "sample-app/apps/api/src/db/schema.ts")).toContain("customers");
});

test("polyrepo creates independent UI and API and validates names", async () => {
  const { root, workspace } = await setup();
  const result = await scaffoldWebProject(workspace, { layout: "polyrepo", uiName: "shop-ui", apiName: "shop-api" });
  expect(result.paths).toEqual({ ui: "shop-ui", api: "shop-api" });
  expect(JSON.parse(await read(root, "shop-ui/package.json")).name).toBe("shop-ui");
  expect(JSON.parse(await read(root, "shop-api/package.json")).name).toBe("shop-api");
  expect(await read(root, "shop-ui/.env.example")).toContain("VITE_API_BASE_URL");
  expect(await read(root, "shop-api/.env.example")).toContain("DATABASE_URL");
  expect(await read(root, "shop-api/compose.yaml")).toContain("POSTGRES_DB: app");
  await expect(fs.stat(path.join(root, "shop-ui/compose.yaml"))).rejects.toThrow();
  await verifyTypeScript(root, "shop-ui");
  await verifyTypeScript(root, "shop-api");
  await expect(scaffoldWebProject(workspace, { layout: "polyrepo", uiName: "../escape", apiName: "ok-api" })).rejects.toThrow("kebab-case");
  await expect(scaffoldWebProject(workspace, { layout: "polyrepo", uiName: "same", apiName: "same" })).rejects.toThrow("must differ");
});
