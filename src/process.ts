import type { ProjectConfig } from "./config.ts";

export async function runCommand(config: ProjectConfig, command: string, args: string[], timeoutMs: number) {
  const proc = Bun.spawn([command, ...args], {
    cwd: config.root,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, MCP_PROJECT_ROOT: config.root },
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeoutMs);
  const limit = 100_000;
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const before = total;
      if (total < limit) {
        const slice = value.subarray(0, limit - total);
        chunks.push(slice);
        total += slice.length;
      }
      if (value.length > limit - before) truncated = true;
    }
    return { text: Buffer.concat(chunks).toString("utf8"), truncated };
  };
  try {
    const [stdout, stderr, exitCode] = await Promise.all([collect(proc.stdout), collect(proc.stderr), proc.exited]);
    return { exitCode, stdout: stdout.text, stderr: stderr.text, truncated: stdout.truncated || stderr.truncated, timedOut };
  } finally { clearTimeout(timer); }
}
