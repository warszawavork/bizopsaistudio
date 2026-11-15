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

async function ensureInboxTable(sql: DbSql) {
  await sql`
    CREATE TABLE IF NOT EXISTS bizops_inbox_events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_contact TEXT DEFAULT '',
      preview TEXT NOT NULL,
      full_text TEXT NOT NULL,
      handled BOOLEAN NOT NULL DEFAULT false,
      handled_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bizops_inbox_created
    ON bizops_inbox_events (created_at DESC);
  `;
}

async function insertInboxItem(
  sql: DbSql,
  item: {
    id?: string;
    source: string;
    senderName: string;
    senderContact: string;
    fullText: string;
  }
) {
  await ensureInboxTable(sql);
  const id = item.id || `inb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const fullText = item.fullText.trim().slice(0, 8000);
  const preview = fullText.replace(/\s+/g, ' ').slice(0, 95) + (fullText.length > 95 ? '...' : '');

  await sql`
    INSERT INTO bizops_inbox_events (id, source, sender_name, sender_contact, preview, full_text, handled, created_at)
    VALUES (${id}, ${item.source}, ${item.senderName}, ${item.senderContact}, ${preview}, ${fullText}, false, NOW())
    ON CONFLICT (id) DO NOTHING;
  `;

  // Automatyczna retencja: trzymaj max 50 najnowszych wiadomości w skrzynce
  await sql`
    DELETE FROM bizops_inbox_events
    WHERE id NOT IN (
      SELECT id FROM bizops_inbox_events ORDER BY created_at DESC LIMIT 50
    );
  `;
  return id;
}

function extractMetaWebhookMessages(body: Record<string, unknown>): Array<{
  source: 'whatsapp' | 'meta';
  senderName: string;
  senderContact: string;
  fullText: string;
}> {
  const extracted: Array<{
    source: 'whatsapp' | 'meta';
    senderName: string;
    senderContact: string;
    fullText: string;
  }> = [];

  const obj = String(body.object || '');
  const entries = Array.isArray(body.entry) ? body.entry : [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    // WhatsApp Business Cloud API format
    const changes = Array.isArray(e.changes) ? e.changes : [];
    for (const ch of changes) {
      const val = (ch as { value?: Record<string, unknown> })?.value;
      if (!val) continue;
      const contacts = Array.isArray(val.contacts) ? val.contacts : [];
      const firstContact = (contacts[0] || {}) as { profile?: { name?: string }; wa_id?: string };
      const msgs = Array.isArray(val.messages) ? val.messages : [];
      for (const m of msgs) {
        const msgObj = m as { from?: string; text?: { body?: string }; button?: { text?: string }; type?: string };
        const textBody = msgObj.text?.body || msgObj.button?.text || `[Wiadomość WhatsApp typu: ${msgObj.type || 'tekst'}]`;
        const phone = msgObj.from || firstContact.wa_id || '';
        const name = firstContact.profile?.name || (phone ? `WhatsApp +${phone}` : 'Klient WhatsApp');
        extracted.push({
          source: 'whatsapp',
          senderName: name,
          senderContact: phone ? `+${phone.replace(/^\+/, '')}` : '',
          fullText: textBody,
        });
      }
    }

    // Messenger / Instagram / Page messaging format
    const messaging = Array.isArray(e.messaging) ? e.messaging : [];
    for (const m of messaging) {
      const msgEvent = m as { sender?: { id?: string }; message?: { text?: string } };
      if (msgEvent.message?.text) {
        extracted.push({
          source: 'meta',
          senderName: obj === 'instagram' ? 'Instagram DM' : 'Messenger Lead',
          senderContact: msgEvent.sender?.id || '',
          fullText: msgEvent.message.text,
        });
      }
    }
  }

  return extracted;
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

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(
  req: IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> },
  res: ServerResponse
) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.end('');
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  // Meta / WhatsApp Cloud API Webhook verification (GET) OR Cloud Inbox Listing
  if (req.method === 'GET') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const getAction = req.query?.action ?? urlObj.searchParams.get('action');

    if (getAction === 'list_inbox') {
      try {
        const sql = getDb();
        await ensureInboxTable(sql);
        const rows = await sql`
          SELECT
            id,
            source,
            sender_name as "senderName",
            sender_contact as "senderContact",
            preview,
            full_text as "fullText",
            handled,
            handled_by as "handledBy",
            created_at as "receivedAt"
          FROM bizops_inbox_events
          ORDER BY created_at DESC
          LIMIT 50;
        `;
        sendJson(res, 200, { success: true, items: rows });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Błąd pobierania skrzynki Neon.';
        sendJson(res, 500, { error: msg });
      }
      return;
    }

    const mode = req.query?.['hub.mode'] ?? urlObj.searchParams.get('hub.mode');
    const token = req.query?.['hub.verify_token'] ?? urlObj.searchParams.get('hub.verify_token');
    const challenge = req.query?.['hub.challenge'] ?? urlObj.searchParams.get('hub.challenge');
    const expectedToken = process.env.META_VERIFY_TOKEN || 'bizops-meta-verify';

    if (mode === 'subscribe' && token === expectedToken) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end(String(challenge || ''));
      return;
    }
    sendJson(res, 403, { error: 'Nieprawidłowy hub.verify_token' });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  const body = await readJsonBody(req);

  // Incoming Meta / WhatsApp Business Webhook event -> save directly to Neon Inbox
  if (body.object === 'whatsapp_business_account' || body.object === 'page' || body.object === 'instagram') {
    const parsedMsgs = extractMetaWebhookMessages(body);
    let savedCount = 0;
    try {
      const sql = getDb();
      if (parsedMsgs.length > 0) {
        for (const msg of parsedMsgs) {
          await insertInboxItem(sql, msg);
          savedCount++;
        }
      } else {
        await insertInboxItem(sql, {
          source: body.object === 'whatsapp_business_account' ? 'whatsapp' : 'meta',
          senderName: `Zdarzenie ${String(body.object)}`,
          senderContact: '',
          fullText: JSON.stringify(body).slice(0, 2000),
        });
        savedCount = 1;
      }
    } catch (err) {
      console.error('Inbox save error:', err);
    }
    sendJson(res, 200, {
      received: true,
      object: body.object,
      savedCount,
      receivedAt: new Date().toISOString(),
    });
    return;
  }

  const action = String(body.action || '');

  try {
    if (action === 'ingest_inbox' || (!action && (body.message || body.fullText || body.text))) {
      const rawText = String(body.fullText || body.message || body.text || '').trim();
      if (!rawText) {
        sendJson(res, 400, { error: 'Brak treści wiadomości do zapisania w skrzynce.' });
        return;
      }
      const sourceRaw = String(body.source || 'webhook').toLowerCase();
      const source = ['gmail', 'whatsapp', 'meta', 'tally', 'webhook'].includes(sourceRaw)
        ? sourceRaw
        : 'webhook';
      const senderName = String(body.senderName || body.fromName || 'Nowy Lead (Webhook)');
      const senderContact = String(body.senderContact || body.email || body.phone || '');

      const sql = getDb();
      const id = await insertInboxItem(sql, {
        source,
        senderName,
        senderContact,
        fullText: rawText,
      });
      sendJson(res, 200, { success: true, id });
      return;
    }

    if (action === 'mark_inbox_handled') {
      const id = String(body.id || '').trim();
      const handled = Boolean(body.handled ?? true);
      const handledBy = String(body.handledBy || 'Zespół');
      if (!id) {
        sendJson(res, 400, { error: 'Brak ID wiadomości w skrzynce.' });
        return;
      }
      const sql = getDb();
      await ensureInboxTable(sql);
      await sql`
        UPDATE bizops_inbox_events
        SET handled = ${handled}, handled_by = ${handled ? handledBy : ''}
        WHERE id = ${id};
      `;
      sendJson(res, 200, { success: true, id, handled });
      return;
    }

    if (action === 'delete_inbox') {
      const id = String(body.id || '').trim();
      if (!id) {
        sendJson(res, 400, { error: 'Brak ID wiadomości do usunięcia.' });
        return;
      }
      const sql = getDb();
      await ensureInboxTable(sql);
      await sql`DELETE FROM bizops_inbox_events WHERE id = ${id};`;
      sendJson(res, 200, { success: true, id });
      return;
    }
    if (action === 'test_whatsapp') {
      const phoneNumberId = String(body.phoneNumberId || '').trim();
      const accessToken = String(body.accessToken || '').trim();
      if (!phoneNumberId || !accessToken) {
        sendJson(res, 400, { error: 'Podaj Phone Number ID oraz Access Token z Meta Business.' });
        return;
      }

      const graphRes = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      const data = (await graphRes.json()) as Record<string, unknown>;
      if (!graphRes.ok) {
        const errMsg =
          (data.error as { message?: string } | undefined)?.message ||
          `Błąd Meta Graph API (${graphRes.status})`;
        sendJson(res, graphRes.status, { error: errMsg });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        displayPhoneNumber: data.display_phone_number || phoneNumberId,
        verifiedName: data.verified_name || 'WhatsApp Business',
      });
      return;
    }

    if (action === 'send_whatsapp') {
      const phoneNumberId = String(body.phoneNumberId || '').trim();
      const accessToken = String(body.accessToken || '').trim();
      const to = String(body.to || '').replace(/[^0-9]/g, '');
      const text = String(body.text || '').trim();

      if (!phoneNumberId || !accessToken || !to || !text) {
        sendJson(res, 400, {
          error: 'Wymagane: Phone Number ID, Access Token, numer odbiorcy (np. 48500600700) oraz treść wiadomości.',
        });
        return;
      }

      const graphRes = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body: text },
          }),
          signal: AbortSignal.timeout(10000),
        }
      );
      const data = (await graphRes.json()) as Record<string, unknown>;
      if (!graphRes.ok) {
        const errMsg =
          (data.error as { message?: string } | undefined)?.message ||
          `Błąd wysyłki WhatsApp (${graphRes.status})`;
        sendJson(res, graphRes.status, { error: errMsg });
        return;
      }

      const messages = Array.isArray(data.messages) ? data.messages : [];
      sendJson(res, 200, {
        ok: true,
        messageId: (messages[0] as { id?: string } | undefined)?.id || null,
        to,
      });
      return;
    }

    if (action === 'test_meta') {
      const pageId = String(body.pageId || 'me').trim();
      const accessToken = String(body.accessToken || '').trim();
      if (!accessToken) {
        sendJson(res, 400, { error: 'Podaj Meta Page Access Token.' });
        return;
      }

      const graphRes = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(pageId || 'me')}?fields=id,name`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      const data = (await graphRes.json()) as Record<string, unknown>;
      if (!graphRes.ok) {
        const errMsg =
          (data.error as { message?: string } | undefined)?.message ||
          `Błąd Meta Business API (${graphRes.status})`;
        sendJson(res, graphRes.status, { error: errMsg });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        id: data.id || pageId,
        name: data.name || 'Meta Business Page',
      });
      return;
    }

    if (action === 'send_gmail_bridge') {
      const webhookUrl = String(body.webhookUrl || '').trim();
      if (!webhookUrl || !/^https?:\/\//i.test(webhookUrl)) {
        sendJson(res, 400, { error: 'Podaj poprawny adres Webhook URL dla mostka Gmail (Make / n8n / Apps Script).' });
        return;
      }

      const hookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'bizops.gmail.outbound',
          senderEmail: String(body.senderEmail || ''),
          to: String(body.to || ''),
          subject: String(body.subject || ''),
          body: String(body.body || ''),
          company: String(body.company || ''),
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!hookRes.ok) {
        sendJson(res, hookRes.status, { error: `Mostek Gmail zwrócił status ${hookRes.status}.` });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        status: hookRes.status,
      });
      return;
    }

    sendJson(res, 400, { error: `Nieznana akcja integracji: ${action}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Błąd połączenia z zewnętrznym API.';
    sendJson(res, 500, { error: msg });
  }
}
