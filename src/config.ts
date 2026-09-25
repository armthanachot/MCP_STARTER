import path from "node:path";
import { z } from "zod";

const taskSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(100).max(300_000).default(120_000),
}).strict();

const configSchema = z.object({
  tasks: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/), taskSchema).default({}),
  denyDirs: z.array(z.string()).default([]),
  denyFiles: z.array(z.string()).default([]),
  maxTextBytes: z.number().int().min(1024).max(20_000_000).default(2_000_000),
  maxResults: z.number().int().min(10).max(10_000).default(1_000),
}).strict();

export type ProjectConfig = z.infer<typeof configSchema> & { root: string };

export async function loadConfig(): Promise<ProjectConfig> {
  const root = path.resolve(process.env.MCP_PROJECT_ROOT || process.cwd());
  const file = path.join(root, "mcp.config.json");
  let raw: unknown = {};
  try {
    raw = await Bun.file(file).json();
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw new Error(`Invalid mcp.config.json: ${String(error)}`);
  }
  return { ...configSchema.parse(raw), root };
}
