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

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(
  req: IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> },
  res: ServerResponse
) {
  // Meta / WhatsApp Cloud API Webhook verification (GET)
  if (req.method === 'GET') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
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

  // Incoming Meta / WhatsApp Business Webhook event
  if (body.object === 'whatsapp_business_account' || body.object === 'page' || body.object === 'instagram') {
    sendJson(res, 200, {
      received: true,
      object: body.object,
      receivedAt: new Date().toISOString(),
    });
    return;
  }

  const action = String(body.action || '');

  try {
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
