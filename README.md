# Common Workspace MCP

An MCP server that lets an AI inspect and edit one project safely. The default profile works with any text-based codebase. The original Garmin Connect IQ tools remain available as a separate legacy profile.

## Start

```bash
bun install
MCP_PROJECT_ROOT=/absolute/path/to/project bun run start
```

For local configuration, copy `.env.example` to `.env` and set `MCP_PROJECT_ROOT`. Bun loads `.env` automatically.

The default transport is **stdio**, suitable for local MCP clients. The project root defaults to the process working directory. Set `MCP_PROJECT_ROOT` explicitly in client configuration so the scope is predictable.

Example client entry:

```json
{
  "command": "bun",
  "args": ["run", "/absolute/path/to/MCP_Starter/index.ts"],
  "env": { "MCP_PROJECT_ROOT": "/absolute/path/to/your/project" }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `project_info` | Show root, limits, and available tasks |
| `file_list` | List visible files with a result limit |
| `file_read` | Read UTF-8 content or a line range, optionally with line numbers, and get SHA-256 |
| `file_search` | Search literal text across visible files with extension filters and context lines |
| `file_write` | Create or replace text with a hash guard |
| `file_replace` | Replace one exact text occurrence with a hash guard |
| `file_delete` | Delete one file with a hash guard |
| `task_run` | Run a predefined task without a shell |
| `git_status` / `git_diff` | Inspect the working tree and a file's diff when the project root is the Git root |
| `git_publish` | Run `git add -A`, commit with `message`, then `git push` to the current branch's upstream |
| `document_reader` | Return a signed full URL for PDF, Office, or text documents |
| `image_reader` | Return a signed full URL for PNG, JPEG, GIF, WebP, or SVG images |

To replace or delete a file, first call `file_read`, then pass its `sha256` as `expectedSha256`. To create a new file, set `createOnly: true`. Batch deletion and arbitrary shell execution are intentionally not exposed.

`git_publish` includes every eligible Git change in the project, including changes made outside MCP. Review `git_status` and relevant diffs first. It requires a branch with an upstream, rejects protected paths before staging, and pushes only the current branch to its configured upstream. If push fails, the commit remains local and the tool returns its SHA.

## Tasks and limits

Copy `mcp.config.example.json` to `mcp.config.json` in the target project and edit its tasks. Each task fixes the executable and arguments. `task_run` accepts only the task name. No shell interpolation is performed.

The server blocks paths outside the project, symlinks, common dependency/build directories, `mcp.config.json`, and common secret files. Add project-specific names with `denyDirs` and `denyFiles`. Text reads/writes default to 2 MB. Search skips unreadable and binary files. Files created by the server have private permissions; overwrites are atomic and require the previously read hash.

## HTTP

```bash
MCP_TRANSPORT=http MCP_PROJECT_ROOT=/absolute/path/to/project bun run start
```

The endpoint is `http://127.0.0.1:3003/mcp`. Set `MCP_PORT` and `MCP_HOST` as needed. When binding beyond loopback, `MCP_TOKEN` is required and clients must send `Authorization: Bearer <token>`. Put a trusted HTTPS proxy and proper authentication in front before exposing it publicly.

`document_reader` and `image_reader` work in HTTP mode. They return full URLs under `/files/` that can be opened with GET or HEAD. Each URL is signed, expires after 15 minutes by default, and stops working if the file changes. Set `MCP_BASE_URL` to the public origin when using a proxy or binding beyond loopback; `MCP_FILE_URL_TTL_SECONDS` accepts 60–3600 seconds. The URL itself grants access until it expires, so treat it as sensitive. The static route supports PDF, Word, Excel, PowerPoint, plain text, Markdown, CSV, PNG, JPEG, GIF, WebP, and SVG. It does not extract document text; clients fetch the file from the URL. In stdio mode, these tools return an error because there is no HTTP file server.

## Garmin profile

```bash
MCP_PROFILE=garmin MCP_PROJECT_ROOT=/absolute/path/to/connectiq/project bun run start
```

This starts the original Garmin-specific HTTP server and tools, including build, simulator, and resource audit. Its transport, port, and environment variables are documented in `garmin.ts`. It is retained for compatibility and has not yet been migrated to the common core.

## Verify

```bash
bun run typecheck
bun test
```
