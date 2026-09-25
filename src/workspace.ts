import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectConfig } from "./config.ts";

const DEFAULT_DENY_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache", ".ssh", ".aws", ".gnupg"]);
const DEFAULT_DENY_FILES = new Set([".env", ".npmrc", ".pypirc", "developer_key", "id_rsa", "id_ed25519", "mcp.config.json"]);
const decoder = new TextDecoder("utf-8", { fatal: true });

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export class Workspace {
  private readonly root: string;
  private readonly denyDirs: Set<string>;
  private readonly denyFiles: Set<string>;

  constructor(readonly config: ProjectConfig) {
    this.root = path.resolve(config.root);
    this.denyDirs = new Set([...DEFAULT_DENY_DIRS, ...config.denyDirs]);
    this.denyFiles = new Set([...DEFAULT_DENY_FILES, ...config.denyFiles]);
  }

  private forbidden(name: string, directory: boolean): boolean {
    const lower = name.toLowerCase();
    if (directory) return this.denyDirs.has(name) || (lower.startsWith(".env") && lower !== ".env.example");
    return this.denyFiles.has(name) || (lower.startsWith(".env") && lower !== ".env.example") || /\.(pem|p12|pfx|key)$/.test(lower);
  }

  private parts(input: string, allowRoot = false): string[] {
    if (input.includes("\0")) throw new Error("NUL byte in path.");
    const full = path.resolve(this.root, input);
    const rel = path.relative(this.root, full);
    if (rel === "" && !allowRoot) throw new Error("Project root is not a file target.");
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error("Path escapes project root.");
    }
    const parts = rel ? rel.split(path.sep) : [];
    for (let i = 0; i < parts.length; i++) {
      if (this.denyDirs.has(parts[i]!) || this.forbidden(parts[i]!, i < parts.length - 1)) throw new Error("Path is protected.");
    }
    return parts;
  }

  private async checked(input: string, options: { allowRoot?: boolean; mayCreate?: boolean } = {}): Promise<string> {
    const parts = this.parts(input, options.allowRoot);
    const rootStat = await fs.lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Project root must be a real directory.");
    let current = this.root;
    let missing = false;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]!);
      if (missing) continue;
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) throw new Error("Symbolic links are not allowed in project paths.");
        if (i < parts.length - 1 && !stat.isDirectory()) throw new Error("Parent path is not a directory.");
      } catch (error: any) {
        if (error?.code !== "ENOENT" || !options.mayCreate) throw error;
        missing = true;
      }
    }
    return current;
  }

  async resolve(input: string, options: { allowRoot?: boolean; mayCreate?: boolean } = {}): Promise<string> {
    return this.checked(input, options);
  }

  relative(full: string): string {
    return path.relative(this.root, full).split(path.sep).join("/") || ".";
  }

  async list(input = ".", maxResults = this.config.maxResults): Promise<{ paths: string[]; truncated: boolean }> {
    const target = await this.checked(input, { allowRoot: true });
    const result: string[] = [];
    let truncated = false;
    const visit = async (current: string): Promise<void> => {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) return;
      if (stat.isFile()) {
        if (result.length >= maxResults) truncated = true;
        else result.push(this.relative(current));
        return;
      }
      if (!stat.isDirectory()) return;
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (result.length >= maxResults) { truncated = true; break; }
        if (entry.isSymbolicLink() || this.forbidden(entry.name, entry.isDirectory())) continue;
        await visit(path.join(current, entry.name));
      }
    };
    await visit(target);
    return { paths: result, truncated };
  }

  async read(input: string): Promise<{ content: string; sha256: string; bytes: number }> {
    const target = await this.checked(input);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error("Target is not a file.");
    if (stat.size > this.config.maxTextBytes) throw new Error(`File exceeds ${this.config.maxTextBytes} bytes.`);
    const bytes = await fs.readFile(target);
    let content: string;
    try { content = decoder.decode(bytes); } catch { throw new Error("File is not UTF-8 text."); }
    if (content.includes("\0")) throw new Error("File appears to be binary.");
    return { content, sha256: sha256(bytes), bytes: bytes.length };
  }

  async write(input: string, content: string, expectedSha256?: string, createOnly = false): Promise<{ sha256: string; bytes: number }> {
    const target = await this.checked(input, { mayCreate: true });
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > this.config.maxTextBytes) throw new Error(`Content exceeds ${this.config.maxTextBytes} bytes.`);
    let exists = false;
    try { await fs.lstat(target); exists = true; } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
    if (createOnly && exists) throw new Error("File already exists.");
    if (expectedSha256) {
      if (!exists) throw new Error("PATCH_CONFLICT: file no longer exists.");
      const current = await this.read(input);
      if (current.sha256 !== expectedSha256.toLowerCase()) throw new Error(`PATCH_CONFLICT: expected ${expectedSha256}, actual ${current.sha256}.`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await this.checked(input, { mayCreate: true });
    const temp = path.join(path.dirname(target), `.mcp-write-${randomUUID()}`);
    try {
      await fs.writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
      if (createOnly) await fs.link(temp, target);
      else await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
    return { sha256: sha256(bytes), bytes: bytes.length };
  }

  async remove(input: string, expectedSha256: string): Promise<void> {
    const target = await this.checked(input);
    const stat = await fs.lstat(target);
    if (!stat.isFile()) throw new Error("Only regular files can be deleted.");
    const actual = (await this.read(input)).sha256;
    if (actual !== expectedSha256.toLowerCase()) throw new Error(`PATCH_CONFLICT: expected ${expectedSha256}, actual ${actual}.`);
    await fs.unlink(target);
  }
}
