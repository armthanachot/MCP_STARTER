type Files = Record<string, string>;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const agentsRules = `# Agent rules

- Run every shell command through RTK first (for example, \`rtk bun test\` or \`rtk proxy <command>\`).
- Do not run any Git command unless the user explicitly asks for that Git action.
- Change database structure only in the Drizzle schema (\`src/db/schema.ts\` in the API package). Never write or edit SQL migration files by hand.
- Read relevant files before editing, and run the affected typecheck or build through RTK after changes.
`;

export const gitignore = `.env*
!.env.example
node_modules/
dist/
coverage/
*.tsbuildinfo
.DS_Store
`;

export const postgresCompose = `services:
  db:
    image: postgres:17.11-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d app"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres_data:
`;

export function apiFiles(name: string, includeCompose = false): Files {
  return {
    "package.json": json({ name, private: true, type: "module", scripts: { dev: "bun --watch src/index.ts", start: "bun src/index.ts", typecheck: "tsc --noEmit", "db:push": "drizzle-kit push" }, dependencies: { "@elysia/cors": "1.4.2", "drizzle-orm": "0.45.3", dotenv: "18.0.4", elysia: "1.4.30", pg: "8.23.0" }, devDependencies: { "@types/bun": "1.4.2", "@types/pg": "8.23.1", "drizzle-kit": "0.31.11", typescript: "7.0.2" } }),
    "tsconfig.json": json({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "bundler", types: ["bun"], strict: true, skipLibCheck: true, noEmit: true } }),
    ".env.example": "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app\nAPI_PORT=3001\nCORS_ORIGIN=http://localhost:5173\n",
    ".gitignore": gitignore,
    "AGENTS.md": agentsRules,
    "README.md": `# ${name}\n\nElysia API with PostgreSQL, Drizzle, and a customer CRUD module.\n\n1. Run \`rtk bun install\`.\n2. Copy \`.env.example\` to \`.env\` and set \`DATABASE_URL\`.\n3. ${includeCompose ? 'For local PostgreSQL, run \`rtk docker compose up -d db\` from this folder, or use an existing PostgreSQL server.' : 'Start PostgreSQL (the monorepo root has \`compose.yaml\` for local development), or use an existing server.'}\n4. Run \`rtk bun run db:push\` and then \`rtk bun run dev\`.\n\nEndpoints: \`GET /health\`, \`GET /api/customers/\`, \`GET /api/customers/:id\`, \`POST /api/customers/\`, \`PATCH /api/customers/:id\`, \`DELETE /api/customers/:id\`. The database code is real; start the database before using CRUD. The Compose password is for local development only.\n`,
    ...(includeCompose ? { "compose.yaml": postgresCompose } : {}),
    "drizzle.config.ts": `import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env.');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
});
`,
    "src/db/schema.ts": `import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const customers = pgTable('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
`,
    "src/db/index.ts": `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env.');

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });
`,
    "src/modules/customer/routes.ts": `import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { customers } from '../../db/schema';

const customerBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  email: t.String({ minLength: 3, maxLength: 320 }),
});
const customerPatch = t.Partial(customerBody);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const customerRoutes = new Elysia({ prefix: '/api/customers' })
  .get('/', async () => db.select().from(customers).orderBy(customers.createdAt))
  .get('/:id', async ({ params, set }) => {
    if (!uuidPattern.test(params.id)) { set.status = 400; return { error: 'Invalid customer ID' }; }
    const [customer] = await db.select().from(customers).where(eq(customers.id, params.id)).limit(1);
    if (!customer) { set.status = 404; return { error: 'Customer not found' }; }
    return customer;
  })
  .post('/', async ({ body, set }) => {
    const [customer] = await db.insert(customers).values(body).returning();
    set.status = 201;
    return customer;
  }, { body: customerBody })
  .patch('/:id', async ({ params, body, set }) => {
    if (!uuidPattern.test(params.id)) { set.status = 400; return { error: 'Invalid customer ID' }; }
    if (Object.keys(body).length === 0) { set.status = 400; return { error: 'No fields to update' }; }
    const [customer] = await db.update(customers).set({ ...body, updatedAt: new Date() }).where(eq(customers.id, params.id)).returning();
    if (!customer) { set.status = 404; return { error: 'Customer not found' }; }
    return customer;
  }, { body: customerPatch })
  .delete('/:id', async ({ params, set }) => {
    if (!uuidPattern.test(params.id)) { set.status = 400; return { error: 'Invalid customer ID' }; }
    const [customer] = await db.delete(customers).where(eq(customers.id, params.id)).returning();
    if (!customer) { set.status = 404; return { error: 'Customer not found' }; }
    return { deleted: true, id: customer.id };
  });
`,
    "src/index.ts": `import 'dotenv/config';
import { Elysia } from 'elysia';
import { cors } from '@elysia/cors';
import { customerRoutes } from './modules/customer/routes';

const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid port.');

new Elysia()
  .use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }))
  .get('/health', () => ({ status: 'ok' }))
  .use(customerRoutes)
  .listen(port);

console.log(\`API listening on http://localhost:\${port}\`);
`,
  };
}

export function uiFiles(name: string): Files {
  return {
    "package.json": json({ name, private: true, type: "module", scripts: { dev: "vite", build: "tsc --noEmit && vite build", typecheck: "tsc --noEmit", preview: "vite preview" }, dependencies: { react: "19.3.0", "react-dom": "19.3.0" }, devDependencies: { "@types/react": "19.3.0", "@types/react-dom": "19.3.0", "@vitejs/plugin-react": "6.1.1", typescript: "7.0.2", vite: "8.3.1" } }),
    "tsconfig.json": json({ compilerOptions: { target: "ES2022", useDefineForClassFields: true, lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", skipLibCheck: true, moduleResolution: "bundler", allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: "react-jsx", strict: true, noUnusedLocals: true, noUnusedParameters: true }, include: ["src", "vite.config.ts"] }),
    ".env.example": "VITE_API_BASE_URL=http://localhost:3001\n",
    ".gitignore": gitignore,
    "AGENTS.md": agentsRules,
    "README.md": `# ${name}\n\nReact and Vite UI for customer CRUD.\n\n1. Run \`rtk bun install\`.\n2. Copy \`.env.example\` to \`.env\` and set \`VITE_API_BASE_URL\` to the API origin.\n3. Run \`rtk bun run dev\`.\n`,
    "index.html": `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Customers</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
`,
    "vite.config.ts": `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], server: { port: 5173 } });
`,
    "src/vite-env.d.ts": "/// <reference types=\"vite/client\" />\n",
    "src/api/customers.ts": `export type Customer = { id: string; name: string; email: string; createdAt: string; updatedAt: string };
export type CustomerInput = Pick<Customer, 'name' | 'email'>;

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001').replace(/\\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(\`\${baseUrl}/api/customers\${path}\`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? \`Request failed (\${response.status})\`);
  }
  return response.json() as Promise<T>;
}

export const customerApi = {
  list: () => request<Customer[]>('/'),
  get: (id: string) => request<Customer>(\`/\${encodeURIComponent(id)}\`),
  create: (data: CustomerInput) => request<Customer>('/', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<CustomerInput>) => request<Customer>(\`/\${encodeURIComponent(id)}\`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ deleted: boolean; id: string }>(\`/\${encodeURIComponent(id)}\`, { method: 'DELETE' }),
};
`,
    "src/App.tsx": `import { useEffect, useState, type FormEvent } from 'react';
import { customerApi, type Customer } from './api/customers';
import './style.css';

export default function App() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setCustomers(await customerApi.list()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  useEffect(() => { void refresh(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      if (editingId) await customerApi.update(editingId, { name, email });
      else await customerApi.create({ name, email });
      setName(''); setEmail(''); setEditingId(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try { await customerApi.remove(id); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <main>
    <header><span className="eyebrow">Customer module</span><h1>Customers</h1><p>Manage customer records through the Elysia API.</p></header>
    <section className="card"><h2>{editingId ? 'Edit customer' : 'Add customer'}</h2>
      <form onSubmit={save}>
        <label>Name<input value={name} onChange={event => setName(event.target.value)} required maxLength={200} /></label>
        <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={320} /></label>
        <div className="actions"><button disabled={busy}>{editingId ? 'Save changes' : 'Add customer'}</button>
          {editingId && <button type="button" className="secondary" onClick={() => { setEditingId(null); setName(''); setEmail(''); }}>Cancel</button>}</div>
      </form>
    </section>
    {error && <p role="alert" className="error">{error}</p>}
    <section className="card"><div className="list-heading"><h2>All customers</h2><button className="secondary" onClick={() => void refresh()}>Refresh</button></div>
      {customers.length === 0 ? <p className="empty">No customers yet.</p> : <ul>{customers.map(customer => <li key={customer.id}>
        <div><strong>{customer.name}</strong><span>{customer.email}</span></div>
        <div className="actions"><button className="secondary" onClick={() => { setEditingId(customer.id); setName(customer.name); setEmail(customer.email); }}>Edit</button><button className="danger" disabled={busy} onClick={() => void remove(customer.id)}>Delete</button></div>
      </li>)}</ul>}
    </section>
  </main>;
}
`,
    "src/main.tsx": `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
`,
    "src/style.css": `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#18242c;background:#f3f6f5}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:4rem auto;padding:0 1.25rem}header{margin-bottom:2rem}.eyebrow{color:#197c68;font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{font-size:2.6rem;letter-spacing:-.04em;margin:.35rem 0}h2{font-size:1.2rem}p{color:#5c6970}.card{background:white;border:1px solid #dce5e2;border-radius:16px;padding:1.5rem;margin:1rem 0;box-shadow:0 10px 35px #102b2310}form{display:grid;gap:1rem}label{display:grid;gap:.4rem;font-weight:600}input{padding:.8rem;border:1px solid #bac8c3;border-radius:8px;font:inherit}.actions,.list-heading{display:flex;gap:.5rem;align-items:center}.list-heading{justify-content:space-between}button{border:0;border-radius:8px;padding:.65rem 1rem;background:#087f67;color:white;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}.secondary{background:#e9f1ee;color:#21584c}.danger{background:#fff0ee;color:#ad3c2c}ul{list-style:none;padding:0;margin:0}li{display:flex;justify-content:space-between;align-items:center;gap:1rem;border-top:1px solid #e7eeeb;padding:1rem 0}li span{display:block;color:#65736e;margin-top:.2rem}.error{color:#ad3c2c}.empty{padding:1rem 0}@media(max-width:540px){li{align-items:flex-start;flex-direction:column}main{margin:2rem auto}}
`,
  };
}

export function monorepoRootFiles(name: string): Files {
  return {
    "package.json": json({ name, private: true, workspaces: ["apps/*"], scripts: { "dev:ui": "bun run --cwd apps/ui dev", "dev:api": "bun run --cwd apps/api dev", "typecheck:ui": "bun run --cwd apps/ui typecheck", "typecheck:api": "bun run --cwd apps/api typecheck", "db:push": "bun run --cwd apps/api db:push" } }),
    ".gitignore": gitignore,
    "AGENTS.md": agentsRules,
    "README.md": `# ${name}\n\nBun workspace with React/Vite UI in \`apps/ui\` and Elysia/Drizzle API in \`apps/api\`.\n\n1. Run \`rtk bun install\` from this folder.\n2. Copy both \`apps/ui/.env.example\` and \`apps/api/.env.example\` to \`.env\` in their respective folders.\n3. For local PostgreSQL, run \`rtk docker compose up -d db\` from this folder. The API example \`DATABASE_URL\` matches this database. You can use an existing PostgreSQL server instead.\n4. Run \`rtk bun run db:push\`, then \`rtk bun run dev:api\` and \`rtk bun run dev:ui\` in separate terminals.\n\nThe customer UI calls the API at \`VITE_API_BASE_URL\`. No Git repository is initialized. The Compose database uses a local development password and stores data in a named volume.\n`,
    "compose.yaml": postgresCompose,
  };
}
