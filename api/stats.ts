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

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    const sql = getDb();

    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS bizops_ai_logs (
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        action TEXT NOT NULL,
        preset_name TEXT NOT NULL,
        model TEXT NOT NULL,
        latency_ms INT DEFAULT 0,
        prompt_tokens INT DEFAULT 0,
        candidates_tokens INT DEFAULT 0,
        total_tokens INT DEFAULT 0,
        status TEXT DEFAULT 'success',
        summary TEXT,
        user_name TEXT DEFAULT 'Użytkownik'
      );
    `;

    if (req.method === 'GET') {
      const statsRows = await sql`
        SELECT 
          count(*)::int as "todayRequests",
          coalesce(sum(total_tokens), 0)::int as "todayTokens",
          coalesce(avg(latency_ms), 0)::int as "avgLatency"
        FROM bizops_ai_logs
        WHERE timestamp >= date_trunc('day', NOW());
      `;

      const recentLogs = await sql`
        SELECT 
          id,
          timestamp,
          action,
          preset_name as "presetName",
          model,
          latency_ms as "latencyMs",
          prompt_tokens as "promptTokens",
          candidates_tokens as "candidatesTokens",
          total_tokens as "totalTokens",
          status,
          summary,
          user_name as "userName"
        FROM bizops_ai_logs
        ORDER BY timestamp DESC
        LIMIT 40;
      `;

      sendJson(res, 200, {
        success: true,
        stats: statsRows[0] || { todayRequests: 0, todayTokens: 0, avgLatency: 0 },
        logs: recentLogs,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const log = (body.log || body) as Record<string, unknown>;

      const id = String(log.id || `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const action = String(log.action || 'ai_call');
      const presetName = String(log.presetName || 'Ogólne');
      const model = String(log.model || 'gemini-3.8-flash');
      const latencyMs = Number(log.latencyMs || 0);
      const promptTokens = Number(log.promptTokens || 0);
      const candidatesTokens = Number(log.candidatesTokens || 0);
      const totalTokens = Number(log.totalTokens || promptTokens + candidatesTokens || 0);
      const status = String(log.status || 'success');
      const summary = String(log.summary || 'Zapytanie AI');
      const userName = String(log.userName || log.authorName || 'Użytkownik');

      await sql`
        INSERT INTO bizops_ai_logs (
          id, timestamp, action, preset_name, model, latency_ms,
          prompt_tokens, candidates_tokens, total_tokens, status, summary, user_name
        ) VALUES (
          ${id}, NOW(), ${action}, ${presetName}, ${model}, ${latencyMs},
          ${promptTokens}, ${candidatesTokens}, ${totalTokens}, ${status}, ${summary}, ${userName}
        )
        ON CONFLICT (id) DO NOTHING;
      `;

      sendJson(res, 200, { success: true, id, message: 'Log zapisany w Neon DB' });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('API /api/stats error:', errorMsg);
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}
