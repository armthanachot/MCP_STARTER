import fs from "node:fs/promises";
import path from "node:path";
import { apiFiles, monorepoRootFiles, uiFiles } from "./scaffold-templates.ts";
import type { Workspace } from "./workspace.ts";

export type ScaffoldInput =
  | { layout: "monorepo"; projectName: string }
  | { layout: "polyrepo"; uiName: string; apiName: string };

const namePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function validName(name: string, label: string): string {
  if (name.length > 50 || !namePattern.test(name)) {
    throw new Error(`${label} must be a lowercase kebab-case name, 1–50 characters, starting with a letter.`);
  }
  return name;
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, { flag: "wx" });
  }
}

export async function scaffoldWebProject(workspace: Workspace, input: ScaffoldInput) {
  if (input.layout === "monorepo") {
    const name = validName(input.projectName, "projectName");
    const target = await workspace.resolve(name, { mayCreate: true });
    await fs.mkdir(target); // Exclusive reservation: never overwrite an existing project.
    try {
      await writeFiles(target, monorepoRootFiles(name));
      await writeFiles(path.join(target, "apps/ui"), uiFiles(`${name}-ui`));
      await writeFiles(path.join(target, "apps/api"), apiFiles(`${name}-api`));
    } catch (error) {
      await fs.rm(target, { recursive: true, force: true });
      throw error;
    }
    return {
      layout: input.layout,
      paths: { project: workspace.relative(target), ui: workspace.relative(path.join(target, "apps/ui")), api: workspace.relative(path.join(target, "apps/api")) },
      nextSteps: [`cd ${target}`, "rtk bun install", "Copy apps/api/.env.example to apps/api/.env and apps/ui/.env.example to apps/ui/.env", "For local PostgreSQL run rtk docker compose up -d db, then rtk bun run db:push", "Run rtk bun run dev:api and rtk bun run dev:ui in separate terminals"],
    };
  }

  const uiName = validName(input.uiName, "uiName");
  const apiName = validName(input.apiName, "apiName");
  if (uiName === apiName) throw new Error("uiName and apiName must differ.");
  const uiTarget = await workspace.resolve(uiName, { mayCreate: true });
  const apiTarget = await workspace.resolve(apiName, { mayCreate: true });
  const created: string[] = [];
  try {
    await fs.mkdir(uiTarget);
    created.push(uiTarget);
    await fs.mkdir(apiTarget);
    created.push(apiTarget);
    await writeFiles(uiTarget, uiFiles(uiName));
    await writeFiles(apiTarget, apiFiles(apiName, true));
  } catch (error) {
    for (const target of created) await fs.rm(target, { recursive: true, force: true });
    throw error;
  }
  return {
    layout: input.layout,
    paths: { ui: workspace.relative(uiTarget), api: workspace.relative(apiTarget) },
    nextSteps: [`cd ${apiTarget} && rtk bun install`, `cd ${uiTarget} && rtk bun install`, "Copy each .env.example to .env and set DATABASE_URL in the API .env", "In the API directory, for local PostgreSQL run rtk docker compose up -d db, then rtk bun run db:push and rtk bun run dev", "In the UI directory run rtk bun run dev"],
  };
}
