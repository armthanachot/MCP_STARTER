import fs from "node:fs/promises";
import type { ProjectConfig } from "./config.ts";
import { runCommand } from "./process.ts";
import type { Workspace } from "./workspace.ts";

type CommandResult = Awaited<ReturnType<typeof runCommand>>;

async function git(config: ProjectConfig, args: string[], label: string, timeoutMs = 15_000): Promise<CommandResult> {
  const result = await runCommand(config, "git", args, timeoutMs);
  if (result.timedOut) throw new Error(`${label} timed out.`);
  if (result.truncated) throw new Error(`${label} output exceeded the 100 KB limit.`);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result;
}

export async function assertGitRoot(config: ProjectConfig): Promise<void> {
  const result = await runCommand(config, "git", ["rev-parse", "--show-toplevel"], 10_000);
  if (result.exitCode !== 0 || await fs.realpath(result.stdout.trim()) !== await fs.realpath(config.root)) {
    throw new Error("Project root must be the Git repository root for Git tools.");
  }
}

function changedPaths(porcelain: string): string[] {
  const records = porcelain.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") throw new Error("Unable to parse Git status safely.");
    paths.push(record.slice(3));
    if (/[RC]/.test(record.slice(0, 2))) {
      const oldPath = records[++i];
      if (!oldPath) throw new Error("Unable to parse renamed Git path safely.");
      paths.push(oldPath);
    }
  }
  return paths;
}

let publishing = false;

export async function publishGit(config: ProjectConfig, workspace: Workspace, message: string) {
  if (publishing) throw new Error("Another git_publish call is already running.");
  publishing = true;
  try {
    await assertGitRoot(config);
    const branch = (await git(config, ["symbolic-ref", "--quiet", "--short", "HEAD"], "Find current branch")).stdout.trim();
    const upstream = (await git(config, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], "Find upstream branch")).stdout.trim();
    const remote = (await git(config, ["config", "--get", `branch.${branch}.remote`], "Find upstream remote")).stdout.trim();
    const mergeRef = (await git(config, ["config", "--get", `branch.${branch}.merge`], "Find upstream ref")).stdout.trim();
    if (!remote || !mergeRef.startsWith("refs/heads/")) throw new Error("Current branch needs a remote branch upstream.");
    const status = await git(config, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], "Check changes");
    const paths = changedPaths(status.stdout);
    if (paths.length === 0) throw new Error("No changes to commit.");
    for (const file of paths) {
      try { await workspace.resolve(file, { mayCreate: true }); }
      catch (error) { throw new Error(`Cannot publish protected or unsafe path '${file}': ${error instanceof Error ? error.message : String(error)}`); }
    }

    await git(config, ["add", "-A"], "Stage changes");
    await git(config, ["commit", `--message=${message}`], "Commit changes", 120_000);
    const commit = (await git(config, ["rev-parse", "HEAD"], "Read commit")).stdout.trim();
    try {
      const pushed = await git(config, ["push", "--porcelain", remote, `HEAD:${mergeRef}`], "Push commit", 120_000);
      return { branch, upstream, commit, stagedPaths: [...new Set(paths)], push: pushed.stderr.trim() || pushed.stdout.trim() };
    } catch (error) {
      throw new Error(`Commit ${commit} was created, but push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    publishing = false;
  }
}
