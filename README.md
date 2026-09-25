# Common Workspace MCP

MCP สำหรับให้ AI อ่าน ค้นหา แก้โค้ด รัน task และทำงานกับ Git ใน **หนึ่งโปรเจกต์ที่กำหนด** โดยไม่ต้องนำโค้ด MCP ไปวางในโปรเจกต์นั้น

## 🧭 ภาพรวม

```text
AI client ── HTTPS ── ngrok ── localhost:3003 ── MCP server
                                      │
                                      └── MCP_PROJECT_ROOT → โปรเจกต์ที่ให้ AI ทำงาน
```

- MCP endpoint: `https://your-domain.ngrok.app/mcp`
- Static file URL: `https://your-domain.ngrok.app/files/<path>?expires=...&v=...&sig=...`
- `/files/` อ้างอิงจาก `MCP_PROJECT_ROOT` ไม่ได้บังคับให้มีโฟลเดอร์ชื่อ `files` ในโปรเจกต์
- MCP หนึ่ง process ดูแลหนึ่ง project root หากต้องเปิดหลายโปรเจกต์พร้อมกัน ให้แยก process, port และ ngrok tunnel

## 🧰 Tools ของโหมดทั่วไป

| Tool | ทำอะไรได้ | ข้อควรรู้ |
| --- | --- | --- |
| `project_info` | ดู project root, ขนาดไฟล์สูงสุด และ task ที่รันได้ | อ่านอย่างเดียว |
| `file_list` | แสดงไฟล์ในโปรเจกต์หรือ path ที่ระบุ | ข้ามไฟล์ที่ป้องกันไว้และ symlink |
| `file_read` | อ่านไฟล์ UTF-8 ทั้งไฟล์หรือช่วงบรรทัด พร้อม SHA-256 | เลือกแสดงเลขบรรทัดได้; ค่าเริ่มต้นจำกัด 2 MB |
| `file_search` | ค้นหาข้อความในไฟล์ พร้อม path และเลขบรรทัด | ค้นหาแบบข้อความตรงตัว; กรองนามสกุลและขอบรรทัดข้างเคียงได้ |
| `file_write` | สร้างหรือเขียนทับไฟล์ข้อความ | สร้างใหม่ใช้ `createOnly`; เขียนทับใช้ `expectedSha256` |
| `file_replace` | แทนที่ข้อความหนึ่งตำแหน่งในไฟล์ | ข้อความเดิมต้องพบครั้งเดียว และต้องใช้ `expectedSha256` |
| `file_delete` | ลบไฟล์หนึ่งไฟล์ | ต้องใช้ `expectedSha256`; ไม่ลบโฟลเดอร์ |
| `task_run` | รัน task ที่กำหนดใน `mcp.config.json` | รับชื่อ task เท่านั้น ไม่รับ shell command อิสระ |
| `git_status` | ดูสถานะ working tree | Project root ต้องเป็น Git repository root |
| `git_diff` | ดู diff ของไฟล์ที่ระบุ รวมถึง staged diff | ดูได้ทีละไฟล์ |
| `git_publish` | `git add -A` → commit ด้วย `message` → push | รวมทุกการเปลี่ยนแปลงที่ Git เห็น; ต้องมี branch และ upstream |
| `document_reader` | ส่ง signed URL แบบเต็มสำหรับ PDF, Word, Excel, PowerPoint, TXT, Markdown และ CSV | ใช้ได้ใน HTTP mode; ส่งไฟล์ ไม่ได้แปลงเอกสารเป็นข้อความ |
| `image_reader` | ส่ง signed URL แบบเต็มสำหรับ PNG, JPEG, GIF, WebP และ SVG | ใช้ได้ใน HTTP mode |

**การแก้ไฟล์:** เรียก `file_read` ก่อน แล้วนำค่า `sha256` ไปใส่ใน `expectedSha256` เมื่อแก้หรือลบไฟล์ หากไฟล์เปลี่ยนไประหว่างนั้น tool จะปฏิเสธการทำงาน

**การ push:** ตรวจ `git_status` และ `git_diff` ก่อนเรียก `git_publish` เพราะ `git add -A` จะรวมการเปลี่ยนแปลงในโปรเจกต์ทั้งหมด แม้ไม่ได้ทำผ่าน MCP หาก push ไม่สำเร็จ commit จะยังอยู่บนเครื่อง

## ⚙️ Environment variables

สร้าง `.env` ในโฟลเดอร์ MCP นี้จาก [.env.example](.env.example) โดย Bun จะอ่าน `.env` อัตโนมัติเมื่อรันจากโฟลเดอร์นี้

| ตัวแปร | ใช้ทำอะไร | ค่าเริ่มต้น / ควรตั้งอย่างไร |
| --- | --- | --- |
| `MCP_PROFILE` | เลือกชุดเครื่องมือ | `common`; `garmin` สำหรับชุดเครื่องมือเดิม |
| `MCP_PROJECT_ROOT` | โฟลเดอร์โปรเจกต์ที่ MCP เข้าถึงได้ | ถ้าไม่ตั้ง ใช้ working directory; **ควรใส่ absolute path** |
| `MCP_TRANSPORT` | วิธีเชื่อมต่อ MCP | `stdio`; ตั้ง `http` เมื่อใช้ ngrok หรือ static URL |
| `MCP_HOST` | IP ที่ HTTP server bind | `127.0.0.1` สำหรับ ngrok บนเครื่องเดียวกัน |
| `MCP_PORT` | พอร์ต HTTP ของ MCP | `3003` |
| `MCP_BASE_URL` | public origin ที่ใช้สร้าง static URL และรับ Host ผ่าน proxy | เมื่อใช้ ngrok ตั้งเป็น `https://your-domain.ngrok.app` |
| `MCP_TOKEN` | Bearer token สำหรับ `/mcp` | **ต้องตั้ง** เมื่อใช้ public `MCP_BASE_URL` หรือ bind นอก loopback |
| `MCP_FILE_URL_TTL_SECONDS` | อายุ signed static URL | `900` วินาที; ตั้งได้ 60–3600 วินาที |

`MCP_TOKEN` เป็น token ของ MCP server และเป็นคนละตัวกับ ngrok authtoken อย่านำ token จริงใส่ใน `.env.example` หรือ commit ลง Git

## 🚀 ห่อโปรเจกต์ใหม่บนเครื่องด้วย ngrok

สมมติโปรเจกต์เป้าหมายอยู่ที่ `/Users/me/projects/new-app` และ MCP repository นี้อยู่แยกต่างหาก

### 1. เตรียม MCP และโปรเจกต์เป้าหมาย

ติดตั้ง dependency ใน MCP repository **ครั้งเดียว**:

```bash
bun install
```

ถ้าต้องการให้ AI รัน test/build ให้สร้าง `mcp.config.json` **ในโปรเจกต์เป้าหมาย** โดยดูรูปแบบจาก [mcp.config.example.json](mcp.config.example.json) เช่น:

```json
{
  "tasks": {
    "test": { "command": "bun", "args": ["test"] },
    "typecheck": { "command": "bun", "args": ["run", "typecheck"] }
  }
}
```

ไฟล์นี้ไม่จำเป็นสำหรับการอ่านและแก้ไฟล์ แต่จำเป็นเมื่อจะใช้ `task_run` แต่ละ task ระบุ executable และ arguments ไว้ล่วงหน้า

หากยังไม่ได้ตั้ง Git repository หรือ upstream ของ branch เครื่องมือไฟล์ยังใช้ได้ แต่ `git_status`, `git_diff` และ `git_publish` จะยังใช้ไม่ได้

### 2. เปิด ngrok tunnel

```bash
ngrok http 3003
```

นำ HTTPS URL ที่ ngrok แสดง เช่น `https://abc.ngrok.app` มาใช้ในขั้นถัดไป ngrok จะส่ง request มาที่พอร์ต `3003` บนเครื่อง ([คู่มือ ngrok](https://ngrok.com/use-cases/share-localhost))

### 3. ตั้ง `.env` ใน MCP repository

```dotenv
MCP_PROFILE=common
MCP_TRANSPORT=http
MCP_PROJECT_ROOT=/Users/me/projects/new-app
MCP_HOST=127.0.0.1
MCP_PORT=3003
MCP_BASE_URL=https://abc.ngrok.app
MCP_TOKEN=ใส่-token-ที่ยาวและสุ่ม
MCP_FILE_URL_TTL_SECONDS=900
```

จากนั้นรันจากโฟลเดอร์ MCP:

```bash
bun run start
```

### 4. เชื่อม AI client

ตั้ง MCP URL เป็น `https://abc.ngrok.app/mcp` และส่ง header:

```text
Authorization: Bearer <ค่า MCP_TOKEN>
```

ตัวอย่าง config กลาง ๆ; รูปแบบจริงขึ้นกับ AI client ที่ใช้:

```json
{
  "url": "https://abc.ngrok.app/mcp",
  "headers": { "Authorization": "Bearer <MCP_TOKEN>" }
}
```

หาก URL ของ ngrok เปลี่ยน ให้แก้ `MCP_BASE_URL` แล้ว restart MCP หาก AI client ส่ง `Origin` จากโดเมนอื่นหรือไม่รองรับ custom header อาจต้องปรับวิธีเชื่อมต่อให้ตรงกับ client นั้น

## 📎 Static URL และขอบเขตไฟล์

สมมติ `MCP_PROJECT_ROOT=/Users/me/projects/new-app`:

```text
/files/docs/report.pdf   → /Users/me/projects/new-app/docs/report.pdf
/files/assets/logo.png   → /Users/me/projects/new-app/assets/logo.png
```

`document_reader` และ `image_reader` คืน URL เต็ม เช่น:

```text
https://abc.ngrok.app/files/docs/report.pdf?expires=...&v=...&sig=...
```

ลิงก์นี้เปิดด้วย GET/HEAD ได้โดยไม่ต้องส่ง `MCP_TOKEN` เพราะลายเซ็นใน URL เป็นสิทธิ์เข้าถึงชั่วคราว ลิงก์หมดอายุหลัง 15 นาทีตามค่าเริ่มต้น และใช้ไม่ได้เมื่อไฟล์เปลี่ยน จึงควรระวังเมื่อส่งต่อ URL

MCP ปฏิเสธ path ที่ออกนอก project root, symlink, ไฟล์ลับ เช่น `.env`, `mcp.config.json` และโฟลเดอร์อย่าง `.git`/`node_modules` Static URL รองรับเฉพาะชนิดไฟล์ที่ระบุในตาราง tool และไฟล์ไม่เกิน 50 MB ส่วน `file_read` ใช้กับข้อความ UTF-8 เท่านั้น ใน `stdio` mode เครื่องมือ URL จะตอบ error เพราะไม่มี HTTP file server

## ตรวจสอบโปรเจกต์ MCP

```bash
bun run typecheck
bun test
```

ชุดเครื่องมือ Garmin เดิมยังเปิดได้ด้วย `MCP_PROFILE=garmin` โดยแยกจากโหมดทั่วไป
