import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

const FALLBACK_NEON_URL =
  'postgresql://neondb_owner:npg_IhW6l5JcHfgS@ep-green-art-zaw9ljx1-pooler.c-2.eu-west-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const NEON_FREE_TIER_MAX_BYTES = 512 * 1024 * 1024; // 512 MB
const RETENTION_DAYS = 30;
const STORAGE_PRUNE_THRESHOLD_RATIO = 0.80; // 80% (~409.6 MB)
const STORAGE_PRUNE_THRESHOLD_BYTES = Math.floor(NEON_FREE_TIER_MAX_BYTES * STORAGE_PRUNE_THRESHOLD_RATIO);
const MIN_LOGS_KEEP_ON_PRESSURE = 30;

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(data));
}

async function runAutoRetention(sql: NeonQueryFunction<false, false>): Promise<{
  prunedCount: number;
  dbSizeBytes: number;
  logsCount: number;
  pressureWarning: boolean;
}> {
  let prunedCount = 0;

  // 1. Automatyczne usuwanie logów starszych niż 30 dni (sam koniec historii)
  const expiredRows = await sql`
    DELETE FROM bizops_ai_logs
    WHERE timestamp < NOW() - INTERVAL '30 days'
    RETURNING id;
  `;
  prunedCount += expiredRows.length;

  // 2. Sprawdzenie aktualnego rozmiaru bazy i liczby logów
  const sizeRows = await sql`
    SELECT 
      pg_database_size(current_database())::bigint as "dbSizeBytes",
      (SELECT count(*)::int FROM bizops_ai_logs) as "logsCount";
  `;
  let dbSizeBytes = Number(sizeRows[0]?.dbSizeBytes || 7500000);
  let logsCount = Number(sizeRows[0]?.logsCount || 0);

  // 3. Jeśli pamięć >= 80% limitu Neon (409.6 MB), automatycznie utnij najstarszą część logów
  if (dbSizeBytes >= STORAGE_PRUNE_THRESHOLD_BYTES && logsCount > 5) {
    const pruneLimit =
      logsCount > MIN_LOGS_KEEP_ON_PRESSURE
        ? Math.max(10, Math.floor((logsCount - MIN_LOGS_KEEP_ON_PRESSURE) * 0.7))
        : Math.max(1, Math.floor(logsCount * 0.5));

    const pressureDeleted = await sql`
      DELETE FROM bizops_ai_logs
      WHERE id IN (
        SELECT id FROM bizops_ai_logs
        ORDER BY timestamp ASC
        LIMIT ${pruneLimit}
      )
      RETURNING id;
    `;
    prunedCount += pressureDeleted.length;

    const refreshed = await sql`
      SELECT 
        pg_database_size(current_database())::bigint as "dbSizeBytes",
        (SELECT count(*)::int FROM bizops_ai_logs) as "logsCount";
    `;
    dbSizeBytes = Number(refreshed[0]?.dbSizeBytes || dbSizeBytes);
    logsCount = Number(refreshed[0]?.logsCount || logsCount);
  }

  return {
    prunedCount,
    dbSizeBytes,
    logsCount,
    pressureWarning: dbSizeBytes >= STORAGE_PRUNE_THRESHOLD_BYTES,
  };
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    const sql = getDb();

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

    await sql`
      CREATE TABLE IF NOT EXISTS bizops_knowledge_tiles (
        id TEXT PRIMARY KEY,
        preset_id TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'public',
        priority TEXT DEFAULT 'standard',
        content TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        author_name TEXT DEFAULT 'Zespół'
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_bizops_ai_logs_timestamp ON bizops_ai_logs (timestamp DESC);
    `;

    if (req.method === 'GET') {
      const [todayStatsRows, minuteStatsRows, storageRows, recentLogs] = await Promise.all([
        sql`
          SELECT 
            count(*)::int as "todayRequests",
            coalesce(sum(total_tokens), 0)::int as "todayTokens",
            coalesce(avg(latency_ms), 0)::int as "avgLatency"
          FROM bizops_ai_logs
          WHERE timestamp >= date_trunc('day', NOW());
        `,
        sql`
          SELECT 
            count(*)::int as "minuteRequests",
            coalesce(sum(total_tokens), 0)::int as "minuteTokens"
          FROM bizops_ai_logs
          WHERE timestamp >= NOW() - INTERVAL '1 minute';
        `,
        sql`
          SELECT 
            pg_database_size(current_database())::bigint as "dbSizeBytes",
            (SELECT count(*)::int FROM bizops_knowledge_tiles) as "tilesCount",
            (SELECT count(*)::int FROM bizops_ai_logs) as "logsCount",
            EXISTS(SELECT 1 FROM bizops_ai_logs WHERE timestamp < NOW() - INTERVAL '30 days' LIMIT 1) as "hasExpiredLogs";
        `,
        sql`
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
          LIMIT 30;
        `,
      ]);

      const todayRow = todayStatsRows[0] || { todayRequests: 0, todayTokens: 0, avgLatency: 0 };
      const minuteRow = minuteStatsRows[0] || { minuteRequests: 0, minuteTokens: 0 };
      const storageRow = storageRows[0] || {
        dbSizeBytes: 7500000,
        tilesCount: 0,
        logsCount: 0,
        hasExpiredLogs: false,
      };

      let dbSizeBytes = Number(storageRow.dbSizeBytes || 7500000);
      let logsCount = Number(storageRow.logsCount || 0);
      let lastPrunedCount = 0;

      // Automatyczne czyszczenie na GET tylko gdy istnieją przeterminowane logi (>30 dni) lub przekroczono 80% pamięci
      if (Boolean(storageRow.hasExpiredLogs) || dbSizeBytes >= STORAGE_PRUNE_THRESHOLD_BYTES) {
        const retention = await runAutoRetention(sql);
        dbSizeBytes = retention.dbSizeBytes;
        logsCount = retention.logsCount;
        lastPrunedCount = retention.prunedCount;
      }

      const storageUsagePercent = Math.min(
        100,
        Math.round((dbSizeBytes / NEON_FREE_TIER_MAX_BYTES) * 100)
      );

      sendJson(res, 200, {
        success: true,
        stats: {
          todayRequests: Number(todayRow.todayRequests || 0),
          todayTokens: Number(todayRow.todayTokens || 0),
          avgLatency: Number(todayRow.avgLatency || 0),
          minuteRequests: Number(minuteRow.minuteRequests || 0),
          minuteTokens: Number(minuteRow.minuteTokens || 0),
          dbSizeBytes,
          maxStorageBytes: NEON_FREE_TIER_MAX_BYTES,
          tilesCount: Number(storageRow.tilesCount || 0),
          logsCount,
          autoRetention: {
            retentionDays: RETENTION_DAYS,
            thresholdPercent: Math.round(STORAGE_PRUNE_THRESHOLD_RATIO * 100),
            storageUsagePercent,
            pressureWarning: dbSizeBytes >= STORAGE_PRUNE_THRESHOLD_BYTES,
            lastPrunedCount,
            autoPrunedThisRequest: lastPrunedCount > 0,
          },
        },
        logs: recentLogs,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);

      if (body.action === 'clear_old_logs') {
        const deleted = await sql`
          DELETE FROM bizops_ai_logs
          WHERE timestamp < date_trunc('day', NOW())
          RETURNING id;
        `;
        sendJson(res, 200, {
          success: true,
          deletedCount: deleted.length,
          message:
            deleted.length > 0
              ? `Wyczyszczono ${deleted.length} archiwalnych logów AI sprzed dzisiejszego dnia.`
              : 'Brak archiwalnych logów sprzed dzisiejszego dnia do usunięcia.',
        });
        return;
      }

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

      // Automatyczna retencja po każdym nowym wpisie (30 dni lub 80% pamięci)
      const retention = await runAutoRetention(sql);

      sendJson(res, 200, {
        success: true,
        id,
        autoPrunedCount: retention.prunedCount,
        message: 'Log zapisany w Neon DB',
      });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('API /api/stats error:', errorMsg);
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}
