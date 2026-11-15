import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';

interface KnowledgeTilePayload {
  id: string;
  title: string;
  category: string;
  visibility?: 'public' | 'internal';
  priority?: 'standard' | 'critical';
  content: string;
  enabled?: boolean;
  updatedAt?: string;
  authorName?: string;
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(data));
}

export default async function handler(req: IncomingMessage & { query?: Record<string, string>; body?: unknown }, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    const sql = getDb();

    // Auto-create table if not exists with indexes for maximum performance
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

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const presetId = url.searchParams.get('presetId') || 'modular-homes';

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT 
          id,
          preset_id as "presetId",
          title,
          category,
          visibility,
          priority,
          content,
          enabled,
          updated_at as "updatedAt",
          author_name as "authorName"
        FROM bizops_knowledge_tiles
        WHERE preset_id = ${presetId}
        ORDER BY updated_at DESC;
      `;

      sendJson(res, 200, {
        success: true,
        tiles: rows,
        count: rows.length,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const action = String(body.action || 'save');

      // Obsługa jawnego usuwania przez POST { action: 'delete', id: '...' }
      if (action === 'delete') {
        const id = String(body.id || url.searchParams.get('id') || '');
        if (!id) {
          sendJson(res, 400, { error: 'Brak ID kafelka do usunięcia' });
          return;
        }

        await sql`DELETE FROM bizops_knowledge_tiles WHERE id = ${id};`;
        sendJson(res, 200, { success: true, message: `Usunięto kafelek ${id}` });
        return;
      }

      // Synchronizacja wsadowa (batch) – równoległe zapisy w paczkach po 10 i usuwanie nieobecnych kafelków
      if (action === 'batch') {
        const tiles = (body.tiles || []) as KnowledgeTilePayload[];
        const targetPreset = String(body.presetId || presetId);
        const author = String(body.authorName || 'Zespół');

        if (tiles.length === 0) {
          await sql`DELETE FROM bizops_knowledge_tiles WHERE preset_id = ${targetPreset};`;
        } else {
          const tileIds = tiles.map((t) => t.id);
          // Usuń z bazy Neon kafelki, które zostały skasowane na urządzeniu
          await sql`
            DELETE FROM bizops_knowledge_tiles
            WHERE preset_id = ${targetPreset}
            AND id != ALL(${tileIds}::text[]);
          `;

          // Równoległe zapisy w paczkach po 10 dla minimalizacji opóźnień sieciowych
          const CHUNK_SIZE = 10;
          for (let i = 0; i < tiles.length; i += CHUNK_SIZE) {
            const chunk = tiles.slice(i, i + CHUNK_SIZE);
            await Promise.all(
              chunk.map((t) =>
                sql`
                  INSERT INTO bizops_knowledge_tiles (
                    id, preset_id, title, category, visibility, priority, content, enabled, updated_at, author_name
                  ) VALUES (
                    ${t.id}, 
                    ${targetPreset}, 
                    ${t.title}, 
                    ${t.category || 'Ogólne'}, 
                    ${t.visibility || 'public'}, 
                    ${t.priority || 'standard'}, 
                    ${t.content}, 
                    ${t.enabled ?? true}, 
                    NOW(), 
                    ${author}
                  )
                  ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    category = EXCLUDED.category,
                    visibility = EXCLUDED.visibility,
                    priority = EXCLUDED.priority,
                    content = EXCLUDED.content,
                    enabled = EXCLUDED.enabled,
                    updated_at = NOW(),
                    author_name = EXCLUDED.author_name;
                `
              )
            );
          }
        }

        sendJson(res, 200, {
          success: true,
          message: `Zsynchronizowano ${tiles.length} kafelków w chmurze Neon (w tym usunięcia)!`,
          count: tiles.length,
        });
        return;
      }

      // Pojedynczy zapis/aktualizacja
      const t = (body.tile || body) as KnowledgeTilePayload;
      if (!t.id || !t.title || !t.content) {
        sendJson(res, 400, { error: 'Wymagane pola: id, title, content' });
        return;
      }

      const targetPreset = String(body.presetId || presetId);
      const author = String(body.authorName || t.authorName || 'Użytkownik');

      await sql`
        INSERT INTO bizops_knowledge_tiles (
          id, preset_id, title, category, visibility, priority, content, enabled, updated_at, author_name
        ) VALUES (
          ${t.id}, 
          ${targetPreset}, 
          ${t.title}, 
          ${t.category || 'Ogólne'}, 
          ${t.visibility || 'public'}, 
          ${t.priority || 'standard'}, 
          ${t.content}, 
          ${t.enabled ?? true}, 
          NOW(), 
          ${author}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          visibility = EXCLUDED.visibility,
          priority = EXCLUDED.priority,
          content = EXCLUDED.content,
          enabled = EXCLUDED.enabled,
          updated_at = NOW(),
          author_name = EXCLUDED.author_name;
      `;

      sendJson(res, 200, {
        success: true,
        message: 'Kafelek zapisany w chmurze Neon!',
        tile: t,
        author,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'DELETE') {
      const body = await readJsonBody(req);
      const id = String(body.id || url.searchParams.get('id') || '');
      if (!id) {
        sendJson(res, 400, { error: 'Brak ID kafelka do usunięcia' });
        return;
      }

      await sql`DELETE FROM bizops_knowledge_tiles WHERE id = ${id};`;
      sendJson(res, 200, { success: true, message: `Usunięto kafelek ${id}` });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('API /api/tiles error:', errorMsg);
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}
