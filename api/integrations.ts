import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import { buildTilesFromTallyHtml, extractTallyFormId } from './_tally.js';

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

async function appendDealToCloudWorkspace(
  sql: DbSql,
  presetId: string,
  deal: {
    id: string;
    title: string;
    client: string;
    valuePln: number;
    stage: 'lead' | 'audited' | 'quote' | 'won';
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    score: number;
    tags: string[];
    notes: string;
    createdAt: string;
  }
) {
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
  const rowId = `${presetId}:deals`;
  const existing = await sql`
    SELECT payload FROM bizops_workspace_state WHERE id = ${rowId} LIMIT 1;
  `;
  const currentDeals = Array.isArray(existing[0]?.payload)
    ? (existing[0].payload as Array<Record<string, unknown>>)
    : [];
  const nextDeals = [deal, ...currentDeals.filter((d) => d.id !== deal.id)].slice(0, 100);

  await sql`
    INSERT INTO bizops_workspace_state (id, preset_id, data_key, payload, updated_at, author_name)
    VALUES (${rowId}, ${presetId}, 'deals', ${JSON.stringify(nextDeals)}::jsonb, NOW(), 'Tally Webhook')
    ON CONFLICT (id)
    DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = NOW(),
      author_name = 'Tally Webhook';
  `;
}

interface TallyFieldPayload {
  key?: string;
  label?: string;
  type?: string;
  value?: unknown;
  options?: Array<{ id?: string; text?: string }>;
}

function resolveTallyFieldValue(field: TallyFieldPayload): string {
  const val = field.value;
  if (val === null || val === undefined || val === '') return '';
  if (Array.isArray(val)) {
    const opts = Array.isArray(field.options) ? field.options : [];
    const mapped = val.map((item) => {
      if (typeof item === 'string') {
        const hit = opts.find((o) => o.id === item);
        return hit?.text || item;
      }
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text?: unknown }).text || '');
      }
      return String(item);
    });
    return mapped.filter(Boolean).join(', ');
  }
  if (typeof val === 'boolean') return val ? 'Tak' : 'Nie';
  return String(val).trim();
}

function parseTallyWebhookSubmission(body: Record<string, unknown>) {
  const data = (body.data || body) as {
    formId?: string;
    formName?: string;
    submissionId?: string;
    createdAt?: string;
    fields?: TallyFieldPayload[];
  };
  const fields = Array.isArray(data.fields) ? data.fields : [];
  let senderName = 'Klient Tally';
  let email = '';
  let phone = '';
  let netPln = 0;
  let grossPln = 0;
  let areaM2 = '';
  const summaryLines: string[] = [];

  for (const f of fields) {
    const label = String(f.label || f.key || 'Pole').trim();
    const resolved = resolveTallyFieldValue(f);
    if (!resolved) continue;

    const lower = label.toLowerCase();
    if (lower.includes('imię') || lower.includes('imie') || lower.includes('nazwisko') || lower === 'name') {
      senderName = resolved;
    } else if (lower.includes('mail')) {
      email = resolved;
    } else if (lower.includes('tel') || lower.includes('phone')) {
      phone = resolved;
    } else if (
      lower.includes('metraż') ||
      lower.includes('metraz') ||
      lower.includes('powierzchni') ||
      /\bm[2²]\b/i.test(label)
    ) {
      areaM2 = resolved.replace(/[^\d.,]/g, '') || resolved;
    } else if (lower.includes('brutto') || lower.includes('finalsumbrutto')) {
      const n = Number(resolved.replace(/[^\d.,]/g, '').replace(',', '.'));
      if (Number.isFinite(n) && n > 0) grossPln = Math.round(n);
    } else if (lower.includes('multiplier') || lower.includes('netto') || lower.includes('wartość')) {
      const n = Number(resolved.replace(/[^\d.,]/g, '').replace(',', '.'));
      if (Number.isFinite(n) && n > 1000 && !netPln) netPln = Math.round(n);
    }

    summaryLines.push(`• ${label}: ${resolved}`);
  }

  const formTitle = String(data.formName || `Konfigurator Tally (${data.formId || 'dWO4Oq'})`);
  const senderContact = [email, phone].filter(Boolean).join(' • ');
  const valuePln = grossPln || (netPln ? Math.round(netPln * 1.23) : 185000);
  const fullText = [
    `ZAPYTANIE Z KONFIGURATORA TALLY: ${formTitle}`,
    senderContact ? `Kontakt: ${senderContact}` : '',
    netPln ? `• Wyliczona kwota Netto: ${netPln.toLocaleString('pl-PL')} zł` : '',
    grossPln ? `• Wyliczona kwota Brutto: ${grossPln.toLocaleString('pl-PL')} zł` : '',
    '',
    'Parametry konfiguracji klienta:',
    ...summaryLines,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    formId: String(data.formId || 'dWO4Oq'),
    formTitle,
    submissionId: String(data.submissionId || `tally_${Date.now()}`),
    senderName,
    senderContact,
    areaM2,
    netPln,
    grossPln,
    valuePln,
    fullText,
  };
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

function sanitizeTelegramToken(raw: unknown): string {
  return String(raw || '').trim().replace(/^bot/i, '').replace(/\s+/g, '');
}

function isValidTelegramToken(token: string): boolean {
  return /^\d{5,16}:[A-Za-z0-9_-]{20,}$/.test(token);
}

async function dispatchTelegramMessage(
  cleanToken: string,
  rawChatId: string,
  text: string,
  parseMode?: 'HTML' | 'Markdown'
): Promise<
  | { ok: true; messageId: number | null; chatId: string; chatLabel: string }
  | { ok: false; error: string; telegramDescription: string }
> {
  const tgPost = async (mode?: string) => {
    const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: rawChatId,
        text,
        ...(mode ? { parse_mode: mode } : {}),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const tgJson = (await tgRes.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number; chat?: { id?: number; title?: string; username?: string; first_name?: string } };
    };
    return { tgRes, tgJson };
  };

  let { tgRes, tgJson } = await tgPost(parseMode);

  if (!tgRes.ok && parseMode && /parse entities/i.test(String(tgJson.description || ''))) {
    const plain = text.replace(/<[^>]+>/g, '');
    const retry = await tgPost(undefined);
    tgRes = retry.tgRes;
    tgJson = retry.tgJson;
    if (!tgRes.ok && plain !== text) {
      const retryPlain = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: rawChatId, text: plain, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10000),
      });
      tgRes = retryPlain;
      tgJson = (await retryPlain.json().catch(() => ({}))) as typeof tgJson;
    }
  }

  if (!tgRes.ok || !tgJson.ok) {
    const desc = String(tgJson.description || '');
    const lower = desc.toLowerCase();
    let friendly = `Telegram API (${tgRes.status}): ${desc || 'Nieznany błąd'}`;
    if (lower.includes('unauthorized')) {
      friendly = 'Nieprawidłowy Bot Token (Unauthorized). Sprawdź token skopiowany z @BotFather.';
    } else if (lower.includes("can't send messages to bots")) {
      friendly =
        'W polu Chat ID wpisałeś ID samego bota zamiast swojego prywatnego Chat ID! Kliknij przycisk „Wykryj moje Chat ID”.';
    } else if (
      lower.includes('chat not found') ||
      lower.includes('initiate conversation') ||
      lower.includes('blocked by the user')
    ) {
      let botUrl = '';
      try {
        const meR = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`, {
          signal: AbortSignal.timeout(4000),
        });
        const meJ = (await meR.json()) as { result?: { username?: string } };
        if (meJ.result?.username) botUrl = `https://t.me/${meJ.result.username}`;
      } catch {
        // ignore
      }
      friendly = botUrl
        ? `Telegram (${desc}): nowy bot nie może napisać pierwszy, dopóki nie otworzysz ${botUrl} i nie klikniesz START (/start).`
        : `Telegram (${desc}): otwórz swojego nowego bota w Telegramie i kliknij START (/start).`;
    }
    return { ok: false, error: friendly, telegramDescription: desc };
  }

  return {
    ok: true,
    messageId: tgJson.result?.message_id || null,
    chatId: String(tgJson.result?.chat?.id || rawChatId),
    chatLabel:
      tgJson.result?.chat?.title ||
      tgJson.result?.chat?.first_name ||
      (tgJson.result?.chat?.username ? `@${tgJson.result.chat.username}` : rawChatId),
  };
}

async function ensureTelegramScheduleTable(sql: DbSql) {
  await sql`
    CREATE TABLE IF NOT EXISTS bizops_telegram_schedules (
      id TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT false,
      bot_token TEXT NOT NULL DEFAULT '',
      chat_id TEXT NOT NULL DEFAULT '',
      send_hour INT NOT NULL DEFAULT 18,
      send_minute INT NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL DEFAULT 'Europe/Warsaw',
      last_sent_date TEXT NOT NULL DEFAULT '',
      last_sent_at TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

function getZonedClock(timeZone: string) {
  const safeTz = timeZone || 'Europe/Warsaw';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour === '24' ? '0' : parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { dateStr, timeStr, hour, minute, totalMinutes: hour * 60 + minute };
}

async function buildCloudDailyTelegramReport(sql: DbSql, dateStr: string, timeStr: string): Promise<string> {
  let todayCalls = 0;
  let todaySuccess = 0;
  let todayTokens = 0;
  let avgLatency = 0;
  let pendingInbox = 0;
  let tallyInboxToday = 0;

  try {
    const logStats = await sql`
      SELECT
        COUNT(*)::int as total_calls,
        COUNT(*) FILTER (WHERE status = 'success')::int as success_calls,
        COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
        COALESCE(ROUND(AVG(NULLIF(latency_ms, 0))), 0)::int as avg_latency
      FROM bizops_ai_logs
      WHERE (timestamp AT TIME ZONE 'Europe/Warsaw')::date = ${dateStr}::date;
    `;
    todayCalls = Number(logStats[0]?.total_calls || 0);
    todaySuccess = Number(logStats[0]?.success_calls || 0);
    todayTokens = Number(logStats[0]?.total_tokens || 0);
    avgLatency = Number(logStats[0]?.avg_latency || 0);
  } catch {
    // Table may not exist yet on fresh DB
  }

  try {
    const inboxStats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE handled = false)::int as pending_count,
        COUNT(*) FILTER (WHERE source = 'tally' AND (created_at AT TIME ZONE 'Europe/Warsaw')::date = ${dateStr}::date)::int as tally_today
      FROM bizops_inbox_events;
    `;
    pendingInbox = Number(inboxStats[0]?.pending_count || 0);
    tallyInboxToday = Number(inboxStats[0]?.tally_today || 0);
  } catch {
    // ignore
  }

  return [
    '📊 <b>RAPORT AUTOMATYCZNY • BIZOPS AI STUDIO</b>',
    `📅 Data: ${dateStr} (${timeStr} • Europe/Warsaw)`,
    '',
    `⚡ <b>Dzisiejsze wywołania AI:</b> ${todayCalls} (sukces: ${todaySuccess})`,
    `⏱️ <b>Średni czas (latency):</b> ${avgLatency} ms`,
    `🔢 <b>Tokeny dzisiaj:</b> ${todayTokens.toLocaleString('pl-PL')}`,
    `📥 <b>Oczekujące w Skrzynce:</b> ${pendingInbox} (nowe z Tally dzisiaj: ${tallyInboxToday})`,
    '💰 <b>Koszt API:</b> 0,00 zł (Darmowy limit Google)',
    '',
    '🤖 <i>Wysłano automatycznie zgodnie z harmonogramem BizOps AI Studio</i>',
  ].join('\n');
}

async function executeScheduledTelegramReport(sql: DbSql, force = false) {
  await ensureTelegramScheduleTable(sql);
  const rows = await sql`
    SELECT * FROM bizops_telegram_schedules WHERE id = 'default' LIMIT 1;
  `;
  const sched = rows[0] as
    | {
        enabled: boolean;
        bot_token: string;
        chat_id: string;
        send_hour: number;
        send_minute: number;
        timezone: string;
        last_sent_date: string;
      }
    | undefined;

  if (!sched || (!sched.enabled && !force)) {
    return { ok: true, sent: false, reason: 'Harmonogram automatyczny jest wyłączony.' };
  }
  const cleanToken = sanitizeTelegramToken(sched.bot_token);
  const cleanChatId = String(sched.chat_id || '').trim().replace(/\s+/g, '');
  if (!isValidTelegramToken(cleanToken) || !cleanChatId) {
    return { ok: true, sent: false, reason: 'Brak prawidłowego tokena lub Chat ID w harmonogramie.' };
  }

  const clock = getZonedClock(sched.timezone || 'Europe/Warsaw');
  const targetMinutes = Number(sched.send_hour) * 60 + Number(sched.send_minute);

  if (!force) {
    if (sched.last_sent_date === clock.dateStr) {
      return { ok: true, sent: false, reason: `Raport na dziś (${clock.dateStr}) został już wysłany.` };
    }
    if (clock.totalMinutes < targetMinutes) {
      return {
        ok: true,
        sent: false,
        reason: `Przed zaplanowaną godziną (${String(sched.send_hour).padStart(2, '0')}:${String(sched.send_minute).padStart(2, '0')}, teraz ${clock.timeStr}).`,
      };
    }

    // Atomowa blokada duplikatu na dzisiejszą datę
    const claimed = await sql`
      UPDATE bizops_telegram_schedules
      SET last_sent_date = ${clock.dateStr}, last_sent_at = ${`${clock.dateStr} ${clock.timeStr}`}
      WHERE id = 'default' AND last_sent_date <> ${clock.dateStr}
      RETURNING id;
    `;
    if (claimed.length === 0) {
      return { ok: true, sent: false, reason: 'Raport został właśnie wysłany przez inny proces.' };
    }
  }

  const reportHtml = await buildCloudDailyTelegramReport(sql, clock.dateStr, clock.timeStr);
  const sent = await dispatchTelegramMessage(cleanToken, cleanChatId, reportHtml, 'HTML');

  if (!sent.ok) {
    if (!force) {
      await sql`
        UPDATE bizops_telegram_schedules
        SET last_sent_date = ${sched.last_sent_date || ''}
        WHERE id = 'default';
      `;
    }
    return { ok: false, sent: false, error: sent.error };
  }

  if (force) {
    await sql`
      UPDATE bizops_telegram_schedules
      SET last_sent_date = ${clock.dateStr}, last_sent_at = ${`${clock.dateStr} ${clock.timeStr}`}
      WHERE id = 'default';
    `;
  }

  return {
    ok: true,
    sent: true,
    date: clock.dateStr,
    time: clock.timeStr,
    chatLabel: sent.chatLabel,
  };
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

    if (getAction === 'get_telegram_schedule') {
      try {
        const sql = getDb();
        await ensureTelegramScheduleTable(sql);
        const rows = await sql`
          SELECT enabled, bot_token, chat_id, send_hour, send_minute, timezone, last_sent_date, last_sent_at
          FROM bizops_telegram_schedules
          WHERE id = 'default'
          LIMIT 1;
        `;
        const row = rows[0] as
          | {
              enabled: boolean;
              bot_token: string;
              chat_id: string;
              send_hour: number;
              send_minute: number;
              timezone: string;
              last_sent_date: string;
              last_sent_at: string;
            }
          | undefined;
        const clock = getZonedClock(row?.timezone || 'Europe/Warsaw');
        sendJson(res, 200, {
          success: true,
          serverClock: clock,
          schedule: row
            ? {
                enabled: Boolean(row.enabled),
                hasToken: Boolean(row.bot_token),
                chatId: String(row.chat_id || ''),
                sendHour: Number(row.send_hour ?? 18),
                sendMinute: Number(row.send_minute ?? 0),
                timezone: row.timezone || 'Europe/Warsaw',
                lastSentDate: String(row.last_sent_date || ''),
                lastSentAt: String(row.last_sent_at || ''),
              }
            : {
                enabled: false,
                hasToken: false,
                chatId: '',
                sendHour: 18,
                sendMinute: 0,
                timezone: 'Europe/Warsaw',
                lastSentDate: '',
                lastSentAt: '',
              },
        });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : 'Błąd odczytu harmonogramu.' });
      }
      return;
    }

    if (getAction === 'run_telegram_daily_cron') {
      try {
        const sql = getDb();
        const force = (req.query?.force ?? urlObj.searchParams.get('force')) === '1';
        const outcome = await executeScheduledTelegramReport(sql, force);
        sendJson(res, outcome.ok ? 200 : 400, outcome);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : 'Błąd wykonania harmonogramu Telegram.' });
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

  // Incoming Tally Webhook event (FORM_RESPONSE) -> save to Cloud Inbox + create CRM Deal automatically
  if (
    body.eventType === 'FORM_RESPONSE' ||
    (body.data && typeof body.data === 'object' && Array.isArray((body.data as Record<string, unknown>).fields))
  ) {
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const presetId = String(req.query?.presetId ?? urlObj.searchParams.get('presetId') ?? 'norvil');
      const parsed = parseTallyWebhookSubmission(body);
      const sql = getDb();

      const inboxId = await insertInboxItem(sql, {
        id: `tally_${parsed.submissionId}`,
        source: 'tally',
        senderName: parsed.senderName,
        senderContact: parsed.senderContact,
        fullText: parsed.fullText,
      });

      await appendDealToCloudWorkspace(sql, presetId, {
        id: `deal_tally_${parsed.submissionId}`,
        title: parsed.areaM2
          ? `Wycena Tally ${parsed.areaM2} m² — ${parsed.senderName}`
          : `Konfiguracja Tally (${parsed.formId})`,
        client: parsed.senderName,
        valuePln: parsed.valuePln,
        stage: 'quote',
        riskLevel: 'LOW',
        score: 92,
        tags: ['Tally CPQ', parsed.formId, parsed.areaM2 ? `${parsed.areaM2} m²` : 'Konfigurator'],
        notes: parsed.fullText.slice(0, 1400),
        createdAt: new Date().toISOString().slice(0, 10),
      });

      sendJson(res, 200, {
        success: true,
        source: 'tally',
        inboxId,
        presetId,
        client: parsed.senderName,
        valuePln: parsed.valuePln,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd zapisu zgłoszenia Tally.';
      sendJson(res, 500, { error: msg });
    }
    return;
  }

  const action = String(body.action || '');

  try {
    if (action === 'sync_tally_knowledge') {
      const formId = extractTallyFormId(String(body.formUrl || body.formId || 'dWO4Oq'));

      const pageRes = await fetch(`https://tally.so/r/${encodeURIComponent(formId)}`, {
        headers: { 'User-Agent': 'BizOpsAIStudio/1.0 (+tally-sync)' },
        signal: AbortSignal.timeout(12000),
      });
      if (!pageRes.ok) {
        sendJson(res, 400, { error: `Nie udało się pobrać formularza Tally (${pageRes.status}).` });
        return;
      }
      const html = await pageRes.text();
      const { formName, tiles } = buildTilesFromTallyHtml(html, formId);
      sendJson(res, 200, {
        success: true,
        formId,
        formName,
        tilesCount: tiles.length,
        tiles,
      });
      return;
    }

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

    if (action === 'telegram_detect_chat') {
      const cleanToken = sanitizeTelegramToken(body.botToken || body.token);
      if (!isValidTelegramToken(cleanToken)) {
        sendJson(res, 400, {
          error: 'Nieprawidłowy format Telegram Bot Token (oczekiwano np. 7123456789:AAH... z @BotFather).',
        });
        return;
      }

      const meRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`, {
        signal: AbortSignal.timeout(8000),
      });
      const meData = (await meRes.json()) as {
        ok?: boolean;
        description?: string;
        result?: { id?: number; username?: string; first_name?: string };
      };
      if (!meRes.ok || !meData.ok || !meData.result) {
        sendJson(res, meRes.status || 400, {
          error:
            meRes.status === 401
              ? 'Nieprawidłowy Telegram Bot Token (Unauthorized) — sprawdź token w @BotFather.'
              : `Błąd Telegram getMe: ${meData.description || `HTTP ${meRes.status}`}`,
        });
        return;
      }

      const botUsername = meData.result.username || '';
      const botName = meData.result.first_name || 'Bot Telegram';

      const updRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates?limit=25`, {
        signal: AbortSignal.timeout(8000),
      });
      interface TelegramChatObj {
        id?: number;
        type?: string;
        title?: string;
        first_name?: string;
        last_name?: string;
        username?: string;
      }
      const updData = (await updRes.json()) as {
        ok?: boolean;
        description?: string;
        result?: Array<{
          message?: { chat?: TelegramChatObj };
          edited_message?: { chat?: TelegramChatObj };
          my_chat_member?: { chat?: TelegramChatObj };
          channel_post?: { chat?: TelegramChatObj };
        }>;
      };

      const chatsMap = new Map<string, { id: string; label: string; type: string }>();
      if (updRes.ok && Array.isArray(updData.result)) {
        for (const u of [...updData.result].reverse()) {
          const chat =
            u.message?.chat ||
            u.edited_message?.chat ||
            u.my_chat_member?.chat ||
            u.channel_post?.chat;
          if (!chat?.id) continue;
          const idStr = String(chat.id);
          if (chatsMap.has(idStr)) continue;
          const name =
            chat.title ||
            [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
            (chat.username ? `@${chat.username}` : `Czat ${idStr}`);
          chatsMap.set(idStr, {
            id: idStr,
            label: `${name}${chat.username && !name.includes('@') ? ` (@${chat.username})` : ''}`,
            type: chat.type || 'private',
          });
        }
      }

      sendJson(res, 200, {
        ok: true,
        botId: meData.result.id ? String(meData.result.id) : '',
        botUsername,
        botName,
        botUrl: botUsername ? `https://t.me/${botUsername}` : '',
        webhookConflict: updRes.status === 409,
        chats: Array.from(chatsMap.values()),
      });
      return;
    }

    if (action === 'telegram_send') {
      const cleanToken = sanitizeTelegramToken(body.botToken || body.token);
      const rawChatId = String(body.chatId || '').trim().replace(/\s+/g, '');
      const text = String(body.text || '').trim();
      const parseMode = body.parseMode === 'Markdown' ? 'Markdown' : body.parseMode === 'HTML' ? 'HTML' : undefined;

      if (!isValidTelegramToken(cleanToken)) {
        sendJson(res, 400, {
          error: 'Nieprawidłowy Telegram Bot Token — wklej pełny token z @BotFather (np. 7123456789:AAH...).',
        });
        return;
      }
      if (!rawChatId || !text) {
        sendJson(res, 400, { error: 'Podaj poprawne Chat ID oraz treść wiadomości na Telegram.' });
        return;
      }

      const result = await dispatchTelegramMessage(cleanToken, rawChatId, text, parseMode);
      if (!result.ok) {
        sendJson(res, 400, { error: result.error, telegramDescription: result.telegramDescription });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (action === 'save_telegram_schedule') {
      const enabled = Boolean(body.enabled);
      const cleanTokenInput = sanitizeTelegramToken(body.botToken || body.token);
      const cleanChatId = String(body.chatId || '').trim().replace(/\s+/g, '');
      const sendHour = Math.max(0, Math.min(23, Math.floor(Number(body.sendHour ?? 18))));
      const sendMinute = Math.max(0, Math.min(59, Math.floor(Number(body.sendMinute ?? 0))));
      const timezone = String(body.timezone || 'Europe/Warsaw');

      const sql = getDb();
      await ensureTelegramScheduleTable(sql);

      const existing = await sql`
        SELECT bot_token FROM bizops_telegram_schedules WHERE id = 'default' LIMIT 1;
      `;
      const effectiveToken = cleanTokenInput || String(existing[0]?.bot_token || '');

      if (enabled && (!isValidTelegramToken(effectiveToken) || !cleanChatId)) {
        sendJson(res, 400, {
          error: 'Aby włączyć automatyczny raport dzienny, uzupełnij najpierw prawidłowy Token bota i Chat ID.',
        });
        return;
      }

      await sql`
        INSERT INTO bizops_telegram_schedules (id, enabled, bot_token, chat_id, send_hour, send_minute, timezone, updated_at)
        VALUES ('default', ${enabled}, ${effectiveToken}, ${cleanChatId}, ${sendHour}, ${sendMinute}, ${timezone}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          bot_token = CASE WHEN EXCLUDED.bot_token <> '' THEN EXCLUDED.bot_token ELSE bizops_telegram_schedules.bot_token END,
          chat_id = EXCLUDED.chat_id,
          send_hour = EXCLUDED.send_hour,
          send_minute = EXCLUDED.send_minute,
          timezone = EXCLUDED.timezone,
          updated_at = NOW();
      `;

      sendJson(res, 200, {
        success: true,
        schedule: {
          enabled,
          hasToken: Boolean(effectiveToken),
          chatId: cleanChatId,
          sendHour,
          sendMinute,
          timezone,
        },
      });
      return;
    }

    if (action === 'run_telegram_daily_cron') {
      const sql = getDb();
      const force = Boolean(body.force);
      const outcome = await executeScheduledTelegramReport(sql, force);
      sendJson(res, outcome.ok ? 200 : 400, outcome);
      return;
    }

    sendJson(res, 400, { error: `Nieznana akcja integracji: ${action}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Błąd połączenia z zewnętrznym API.';
    sendJson(res, 500, { error: msg });
  }
}
