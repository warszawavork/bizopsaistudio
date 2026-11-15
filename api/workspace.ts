import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';

const FALLBACK_NEON_URL =
  'postgresql://neondb_owner:npg_IhW6l5JcHfgS@ep-green-art-zaw9ljx1-pooler.c-2.eu-west-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

function getDb() {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.STORAGE_POSTGRES_URL ||
    process.env.STORAGE_DATABASE_URL ||
    process.env.STORAGE_URL ||
    FALLBACK_NEON_URL;

  return neon(connectionString);
}

type DbSql = ReturnType<typeof getDb>;

async function ensureWorkspaceTable(sql: DbSql) {
  await sql`
    CREATE TABLE IF NOT EXISTS bizops_workspace_state (
      id TEXT PRIMARY KEY,
      preset_id TEXT NOT NULL,
      data_key TEXT NOT NULL,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      author_name TEXT DEFAULT 'Zespół'
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bizops_workspace_preset
    ON bizops_workspace_state (preset_id, data_key);
  `;
}

async function readJsonBody(req: IncomingMessage & { body?: unknown }): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}') as Record<string, unknown>;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(data));
}

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string>; body?: unknown },
  res: ServerResponse
) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    const sql = getDb();
    await ensureWorkspaceTable(sql);

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const presetId = String(url.searchParams.get('presetId') || 'modular-homes');

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT data_key as "dataKey", payload, updated_at as "updatedAt", author_name as "authorName"
        FROM bizops_workspace_state
        WHERE preset_id = ${presetId};
      `;

      const state: Record<string, unknown> = {};
      for (const row of rows) {
        const key = String(row.dataKey || '');
        if (key) {
          state[key] = row.payload;
        }
      }

      sendJson(res, 200, {
        success: true,
        presetId,
        state,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const targetPreset = String(body.presetId || presetId);
      const dataKey = String(body.dataKey || '').trim();
      const authorName = String(body.authorName || 'Zespół');

      if (!dataKey || !['deals', 'quick_links', 'objections', 'reply_history'].includes(dataKey)) {
        sendJson(res, 400, { error: 'Nieprawidłowy dataKey workspace (wymagane: deals | quick_links | objections | reply_history).' });
        return;
      }

      const payload = body.payload ?? [];
      const rowId = `${targetPreset}:${dataKey}`;

      await sql`
        INSERT INTO bizops_workspace_state (id, preset_id, data_key, payload, updated_at, author_name)
        VALUES (${rowId}, ${targetPreset}, ${dataKey}, ${JSON.stringify(payload)}::jsonb, NOW(), ${authorName})
        ON CONFLICT (id) DO UPDATE SET
          payload = EXCLUDED.payload,
          updated_at = NOW(),
          author_name = EXCLUDED.author_name;
      `;

      sendJson(res, 200, {
        success: true,
        presetId: targetPreset,
        dataKey,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    sendJson(res, 405, { error: 'Method Not Allowed' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('API /api/workspace error:', msg);
    sendJson(res, 500, { success: false, error: msg });
  }
}
