import type { IncomingMessage, ServerResponse } from 'node:http';

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

function sendJson(res: ServerResponse & { status?: (code: number) => unknown; json?: (data: unknown) => void }, statusCode: number, data: unknown): void {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    (res.status(statusCode) as { json: (d: unknown) => void }).json(data);
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.startsWith('169.254.') ||
    lower.startsWith('10.') ||
    lower.startsWith('192.168.')
  );
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Dozwolona jest wyłącznie metoda POST.' });
    return;
  }

  const startedAt = Date.now();

  try {
    const body = await readJsonBody(req);
    const webhookUrl = String(body.webhookUrl || '').trim();
    const simulate = Boolean(body.simulate) || !webhookUrl;
    const payload = body.payload ?? {};

    if (simulate) {
      sendJson(res, 200, {
        ok: true,
        simulated: true,
        status: 200,
        echoId: `mk_sim_${Math.random().toString(36).slice(2, 10)}`,
        receivedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt + 42,
        responseText: 'Accepted (Symulacja scenariusza Make.com / n8n Webhook)',
        payloadSizeBytes: JSON.stringify(payload).length,
      });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch {
      sendJson(res, 400, { error: 'Nieprawidłowy format adresu URL webhooka.' });
      return;
    }

    if ((parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') || isBlockedHost(parsedUrl.hostname)) {
      sendJson(res, 400, { error: 'Dozwolone są wyłącznie publiczne adresy webhooków http(s).' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const upstream = await fetch(parsedUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BizOps-AI-Studio-Webhook-Bridge/1.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const responseText = await upstream.text();
    sendJson(res, 200, {
      ok: upstream.ok,
      simulated: false,
      status: upstream.status,
      receivedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      responseText: responseText.slice(0, 500) || `HTTP ${upstream.status}`,
      payloadSizeBytes: JSON.stringify(payload).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Błąd połączenia z webhookiem.';
    sendJson(res, 500, { ok: false, error: message, latencyMs: Date.now() - startedAt });
  }
}
