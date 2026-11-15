import type { IncomingMessage, ServerResponse } from 'node:http';

interface KnowledgeTileInput {
  id: string;
  title: string;
  category: string;
  visibility: 'public' | 'internal';
  priority?: 'standard' | 'critical';
  content: string;
  enabled: boolean;
}

interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

const GEMINI_MODEL = 'gemini-3.8-flash';
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

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

function sendJson(
  res: ServerResponse & { status?: (code: number) => unknown; json?: (data: unknown) => void },
  statusCode: number,
  data: unknown
): void {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    (res.status(statusCode) as { json: (d: unknown) => void }).json(data);
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function resolveApiKey(req: IncomingMessage): { apiKey: string; source: 'custom_key' | 'server_env' | 'none' } {
  const customHeader = req.headers['x-custom-api-key'];
  const customKey = Array.isArray(customHeader) ? customHeader[0] : customHeader;
  if (customKey && customKey.trim().length > 8) {
    return { apiKey: customKey.trim(), source: 'custom_key' };
  }
  const envKey = process.env.GEMINI_API_KEY?.trim() || '';
  if (envKey.length > 8) {
    return { apiKey: envKey, source: 'server_env' };
  }
  return { apiKey: '', source: 'none' };
}

function formatKnowledgeContext(tiles: KnowledgeTileInput[], perspective: 'client' | 'internal'): string {
  const active = tiles.filter((t) => t.enabled && (perspective === 'internal' || t.visibility === 'public'));
  if (active.length === 0) {
    return 'Brak aktywnych dokumentów w bazie wiedzy firmy.';
  }
  return active
    .map(
      (t) =>
        `[TILE_ID: ${t.id}] [KATEGORIA: ${t.category}] [PRIORYTET: ${t.priority === 'critical' ? 'KRYTYCZNY' : 'STANDARD'}] [DOSTĘP: ${t.visibility === 'internal' ? 'WEWNĘTRZNY/HANDLOWY' : 'PUBLICZNY'}]\nTYTUŁ: ${t.title}\nTREŚĆ:\n${t.content}`
    )
    .join('\n\n---\n\n');
}

function parseGeminiJson<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned) as T;
}

async function callGemini(
  apiKey: string,
  payload: Record<string, unknown>
): Promise<{
  text: string;
  model: string;
  usage: { promptTokens: number; candidatesTokens: number; totalTokens: number };
}> {
  let lastError: Error = new Error('Nie udało się połączyć z modelem Gemini.');

  for (let i = 0; i < MODEL_FALLBACK_CHAIN.length; i++) {
    const model = MODEL_FALLBACK_CHAIN[i];
    const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 16000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = (await response.json()) as {
        error?: { message?: string; code?: number };
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      if (!response.ok) {
        const msg = data.error?.message || `Błąd Gemini API (HTTP ${response.status})`;
        const isTransientOrDeprecated =
          response.status === 429 ||
          response.status === 500 ||
          response.status === 503 ||
          response.status === 404 ||
          /high demand|overloaded|unavailable|no longer available/i.test(msg);

        lastError = new Error(msg);
        if (isTransientOrDeprecated && i < MODEL_FALLBACK_CHAIN.length - 1) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        throw lastError;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        throw new Error('Model Gemini zwrócił pustą odpowiedź.');
      }

      return {
        text,
        model,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
          candidatesTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
        },
      };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < MODEL_FALLBACK_CHAIN.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
    }
  }

  throw lastError;
}

async function fetchLiveWebContext(
  apiKey: string,
  companyIndustry: string,
  clientMessage: string
): Promise<{ summary: string; sources: Array<{ title: string; uri: string }> }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);
    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Branża: ${companyIndustry}. Wyszukaj w internecie aktualne fakty rynkowe, przepisy (np. VAT, prawo budowlane, eksport, transport/cło, prawa konsumenckie) lub informacje geograficzne potrzebne do rzetelnej odpowiedzi na to zapytanie klienta:\n\n${clientMessage.slice(0, 1200)}\n\nWypisz zwięźle 3-5 najważniejszych aktualnych faktów z sieci.`,
              },
            ],
          },
        ],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 450 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { summary: '', sources: [] };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{
            web?: { uri?: string; title?: string };
          }>;
        };
      }>;
    };

    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const rawChunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const seen = new Set<string>();
    const sources: Array<{ title: string; uri: string }> = [];
    for (const chunk of rawChunks) {
      const uri = chunk.web?.uri?.trim();
      if (uri && !seen.has(uri)) {
        seen.add(uri);
        sources.push({
          title: chunk.web?.title?.trim() || uri,
          uri,
        });
      }
      if (sources.length >= 4) break;
    }

    return { summary, sources };
  } catch {
    return { summary: '', sources: [] };
  }
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Dozwolona jest wyłącznie metoda POST.' });
    return;
  }

  const startedAt = Date.now();
  const { apiKey, source } = resolveApiKey(req);

  if (!apiKey) {
    sendJson(res, 400, {
      error: 'Brak klucza GEMINI_API_KEY. Dodaj go w pliku .env / Vercel albo w Ustawieniach aplikacji.',
      source,
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const action = String(body.action || 'chat');
    const lang = body.language === 'en' ? 'en' : 'pl';
    const langInstruction =
      lang === 'en'
        ? 'IMPORTANT: Respond entirely in English (all fields, explanations, findings, and drafts).'
        : 'WAŻNE: Odpowiadaj wyłącznie po polsku.';

    if (action === 'test') {
      const result = await callGemini(apiKey, {
        contents: [{ role: 'user', parts: [{ text: 'Odpowiedz dokładnie jednym słowem: OK' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 16 },
      });
      sendJson(res, 200, {
        ok: true,
        model: result.model || GEMINI_MODEL,
        keySource: source,
        reply: result.text.trim(),
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    if (action === 'chat') {
      const companyName = String(body.companyName || 'Firma');
      const companyIndustry = String(body.companyIndustry || 'Operacje B2B');
      const perspective = body.perspective === 'internal' ? 'internal' : 'client';
      const tiles = (Array.isArray(body.knowledgeTiles) ? body.knowledgeTiles : []) as KnowledgeTileInput[];
      const messages = (Array.isArray(body.messages) ? body.messages : []) as ChatMessageInput[];

      const knowledgeContext = formatKnowledgeContext(tiles, perspective);

      const systemText = [
        `Jesteś oficjalnym Asystentem AI firmy "${companyName}" (branża: ${companyIndustry}).`,
        perspective === 'internal'
          ? 'TRYB PRACY: WEWNĘTRZNY (Dla Pracownika / Handlowca / Managera). Masz dostęp do pełnej bazy wraz z notatkami wewnętrznymi, marżami, ryzykami operacyjnymi i checklistami.'
          : 'TRYB PRACY: KLIENT ZEWNĘTRZNY. Odpowiadaj uprzejmie, profesjonalnie i sprzedażowo. Opieraj się wyłącznie na publicznej bazie wiedzy. Nie ujawniaj wewnętrznych marż ani poufnych procedur.',
        langInstruction,
        'ZASADY:',
        '1. Bazuj przede wszystkim na poniższej Bazie Wiedzy Firmy. Jeśli czegoś nie ma w bazie, jasno zaznacz, że ta informacja wymaga doprecyzowania lub dodania w module "Naucz mnie".',
        '2. W polu citedTileIds podaj dokładne wartości TILE_ID dokumentów, z których skorzystałeś.',
        '3. Twoim towarzyszem w aplikacji jest profesjonalny Kotek Inżynier AI ("Mruczek BizOps") — wygeneruj krótki, sympatyczny komentarz mascotTip (max 12 słów) i dopasuj mascotMood.',
        '',
        '=== BAZA WIEDZY FIRMY ===',
        knowledgeContext,
      ].join('\n');

      const geminiContents = messages.slice(-12).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '') }],
      }));

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: geminiContents,
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              answer: { type: 'STRING' },
              citedTileIds: { type: 'ARRAY', items: { type: 'STRING' } },
              confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
              suggestedFollowUps: { type: 'ARRAY', items: { type: 'STRING' } },
              mascotMood: { type: 'STRING', enum: ['happy', 'thinking', 'alert', 'curious'] },
              mascotTip: { type: 'STRING' },
            },
            required: ['answer', 'citedTileIds', 'confidence', 'suggestedFollowUps', 'mascotMood', 'mascotTip'],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(result.text);
      sendJson(res, 200, {
        ...parsed,
        model: result.model || GEMINI_MODEL,
        keySource: source,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    if (action === 'audit') {
      const companyName = String(body.companyName || 'Firma');
      const companyIndustry = String(body.companyIndustry || 'Operacje B2B');
      const tiles = (Array.isArray(body.knowledgeTiles) ? body.knowledgeTiles : []) as KnowledgeTileInput[];
      const documentText = String(body.documentText || '').trim();
      const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
      const fileMimeType = typeof body.fileMimeType === 'string' ? body.fileMimeType : '';
      const fileName = String(body.fileName || 'Dokument');

      if (!documentText && !fileBase64) {
        sendJson(res, 400, { error: 'Prześlij plik PDF/obraz lub wklej treść dokumentu do audytu.' });
        return;
      }

      const knowledgeContext = formatKnowledgeContext(tiles, 'internal');

      const systemText = [
        `Jesteś starszym audytorem operacyjnym i AI Automation Engine dla firmy "${companyName}" (${companyIndustry}).`,
        'Przeanalizuj przesłany dokument (kosztorys, zapytanie klienta, faktura, notatka głosowa z terenu, specyfikacja) pod kątem zgodności z wewnętrzną Bazą Wiedzy Firmy.',
        'Zidentyfikuj wszystkie kluczowe parametry, wykryj braki formalne, błędy (np. błędna stawka VAT, brak MPP, niekompletne wymogi techniczne/logistyczne, rozjazd budżetu) i wystaw ocenę kompletności score (0-100).',
        'Wygeneruj gotowy szkic odpowiedzi e-mail do klienta/nadawcy oraz tagi do automatyzacji CRM/Make.',
        langInstruction,
        '',
        '=== BAZA WIEDZY I REGUŁY FIRMY ===',
        knowledgeContext,
      ].join('\n');

      const parts: Array<Record<string, unknown>> = [];
      if (fileBase64 && fileMimeType) {
        parts.push({
          inlineData: {
            mimeType: fileMimeType,
            data: fileBase64,
          },
        });
      }
      parts.push({
        text: `Przeprowadź pełny audyt operacyjny poniższego dokumentu (${fileName}).\n\n${documentText ? `TREŚĆ / TRANSKRYPCJA:\n${documentText}` : 'Przeanalizuj załączony plik.'}`,
      });

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              documentType: { type: 'STRING' },
              clientOrSender: { type: 'STRING' },
              summary: { type: 'STRING' },
              score: { type: 'INTEGER' },
              riskLevel: { type: 'STRING', enum: ['LOW', 'MEDIUM', 'HIGH'] },
              extractedFields: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    label: { type: 'STRING' },
                    value: { type: 'STRING' },
                    status: { type: 'STRING', enum: ['ok', 'warning', 'missing'] },
                  },
                  required: ['label', 'value', 'status'],
                },
              },
              findings: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    severity: { type: 'STRING', enum: ['ok', 'warning', 'critical'] },
                    title: { type: 'STRING' },
                    detail: { type: 'STRING' },
                    ruleRef: { type: 'STRING' },
                  },
                  required: ['severity', 'title', 'detail', 'ruleRef'],
                },
              },
              recommendedReplySubject: { type: 'STRING' },
              recommendedReplyBody: { type: 'STRING' },
              webhookSummaryTags: { type: 'ARRAY', items: { type: 'STRING' } },
              mascotMood: { type: 'STRING', enum: ['happy', 'alert', 'thinking'] },
              mascotTip: { type: 'STRING' },
            },
            required: [
              'documentType',
              'clientOrSender',
              'summary',
              'score',
              'riskLevel',
              'extractedFields',
              'findings',
              'recommendedReplySubject',
              'recommendedReplyBody',
              'webhookSummaryTags',
              'mascotMood',
              'mascotTip',
            ],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(result.text);
      sendJson(res, 200, {
        ...parsed,
        model: result.model || GEMINI_MODEL,
        keySource: source,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    if (action === 'workflow') {
      const companyName = String(body.companyName || 'Firma');
      const companyIndustry = String(body.companyIndustry || 'Operacje B2B');
      const tiles = (Array.isArray(body.knowledgeTiles) ? body.knowledgeTiles : []) as KnowledgeTileInput[];
      const inputText = String(body.inputText || '').trim();
      const inputTitle = String(body.inputTitle || 'Zgłoszenie przychodzące');

      if (!inputText) {
        sendJson(res, 400, { error: 'Wprowadź dane wejściowe dla potoku Multi-Agent Workflow.' });
        return;
      }

      const knowledgeContext = formatKnowledgeContext(tiles, 'internal');

      const systemText = [
        `Jesteś orkiestratorem 3-etapowego potoku Agentic AI (Multi-Agent Workflow) dla firmy "${companyName}" (${companyIndustry}).`,
        'Wykonaj kolejno pracę 3 wyspecjalizowanych agentów:',
        '1. AGENT KLASYFIKATOR (classifier): rozpoznaj kategorię sprawy, intencję, pilność (LOW/MEDIUM/HIGH/CRITICAL), oszacuj wartość kontraktu/sprawy w PLN (estimatedValuePln jako liczba całkowita), nazwę klienta (clientName) i wyodrębnij kluczowe encje.',
        '2. AGENT AUDYTOR BAZY WIEDZY (auditor): zweryfikuj sprawę względem Bazy Wiedzy Firmy, wylicz complianceScore (0-100), riskLevel (LOW/MEDIUM/HIGH), wskaż dopasowane reguły (matchedRules) oraz flagi polityki (policyFlags).',
        '3. AGENT EGZEKUTOR (executor): wybierz docelową kolumnę CRM (recommendedStage: lead / audited / quote / won), wygeneruj konkretną listę zadań dla zespołu (actionChecklist) oraz gotową wiadomość dla klienta (clientReplyDraft).',
        langInstruction,
        '',
        '=== BAZA WIEDZY FIRMY ===',
        knowledgeContext,
      ].join('\n');

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `TYTUŁ WEJŚCIA: ${inputTitle}\n\nTREŚĆ ZGŁOSZENIA / DOKUMENTU:\n${inputText}` }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              classifier: {
                type: 'OBJECT',
                properties: {
                  category: { type: 'STRING' },
                  intent: { type: 'STRING' },
                  urgency: { type: 'STRING', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
                  estimatedValuePln: { type: 'INTEGER' },
                  clientName: { type: 'STRING' },
                  keyEntities: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        name: { type: 'STRING' },
                        value: { type: 'STRING' },
                      },
                      required: ['name', 'value'],
                    },
                  },
                },
                required: ['category', 'intent', 'urgency', 'estimatedValuePln', 'clientName', 'keyEntities'],
              },
              auditor: {
                type: 'OBJECT',
                properties: {
                  complianceScore: { type: 'INTEGER' },
                  riskLevel: { type: 'STRING', enum: ['LOW', 'MEDIUM', 'HIGH'] },
                  matchedRules: { type: 'ARRAY', items: { type: 'STRING' } },
                  policyFlags: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        severity: { type: 'STRING', enum: ['ok', 'warning', 'critical'] },
                        message: { type: 'STRING' },
                      },
                      required: ['severity', 'message'],
                    },
                  },
                },
                required: ['complianceScore', 'riskLevel', 'matchedRules', 'policyFlags'],
              },
              executor: {
                type: 'OBJECT',
                properties: {
                  recommendedStage: { type: 'STRING', enum: ['lead', 'audited', 'quote', 'won'] },
                  actionChecklist: { type: 'ARRAY', items: { type: 'STRING' } },
                  clientReplyDraft: { type: 'STRING' },
                },
                required: ['recommendedStage', 'actionChecklist', 'clientReplyDraft'],
              },
              mascotTip: { type: 'STRING' },
            },
            required: ['classifier', 'auditor', 'executor', 'mascotTip'],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(result.text);
      sendJson(res, 200, {
        ...parsed,
        model: result.model || GEMINI_MODEL,
        keySource: source,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    if (action === 'reply_assistant') {
      const companyName = String(body.companyName || 'Firma');
      const companyIndustry = String(body.companyIndustry || 'Operacje B2B');
      const tiles = (Array.isArray(body.knowledgeTiles) ? body.knowledgeTiles : []) as KnowledgeTileInput[];
      const clientMessage = String(body.clientMessage || '').trim();
      const advisorNotes = String(body.advisorNotes || '').trim();
      const tone = String(body.tone || 'sales');
      const channel = body.channel === 'sms' ? 'sms' : 'email';
      const replyLanguage = String(body.replyLanguage || 'auto');
      const useWebKnowledge = body.useWebKnowledge !== false;
      const includeMiniQuote = body.includeMiniQuote === true;
      const includedLinks = Array.isArray(body.includedLinks)
        ? (body.includedLinks as Array<{ label?: string; url?: string }>)
            .filter((l) => l && l.label && l.url)
        : [];
      const threadHistory = Array.isArray(body.threadHistory)
        ? (body.threadHistory as Array<{ role?: string; text?: string }>)
            .filter((t) => t && t.text)
        : [];
      const advisorSignature = body.advisorSignature as
        | { enabled?: boolean; name?: string; role?: string; phone?: string; email?: string; companyLine?: string }
        | undefined;

      if (!clientMessage) {
        sendJson(res, 400, { error: 'Wklej treść wiadomości lub zapytania od klienta.' });
        return;
      }

      const knowledgeContext = formatKnowledgeContext(tiles, 'internal');
      const liveWeb = useWebKnowledge
        ? await fetchLiveWebContext(apiKey, companyIndustry, clientMessage)
        : { summary: '', sources: [] };

      const replyLangInstruction =
        replyLanguage === 'pl'
          ? 'Napisz wiadomość dla klienta (subject i replyBody) po polsku.'
          : replyLanguage === 'en'
            ? 'Napisz wiadomość dla klienta (subject i replyBody) po angielsku (Business English).'
            : replyLanguage === 'no'
              ? 'Napisz wiadomość dla klienta (subject i replyBody) po norwesku (lub profesjonalnym angielskim z norweskimi zwrotami grzecznościowymi, jeśli klient pisał po angielsku/norwesku).'
              : replyLanguage === 'de'
                ? 'Napisz wiadomość dla klienta (subject i replyBody) po niemiecku.'
                : 'Rozpoznaj język wiadomości klienta i napisz odpowiedź (subject i replyBody) w tym samym języku (jeśli klient pisze po polsku -> po polsku, jeśli po angielsku -> po angielsku). Pozostałe pola analityczne dla doradcy (summaryOfInquiry, companyFactsUsed, webAndMarketFactsUsed, internalAdvisorTip) podaj po polsku.';

      const toneInstruction =
        tone === 'concise'
          ? 'Ton odpowiedzi: maksymalnie konkretny, zwięzły, punktowy, bez zbędnych wstępów.'
          : tone === 'formal'
            ? 'Ton odpowiedzi: oficjalny, gabinetowy, ekspercki B2B.'
            : 'Ton odpowiedzi: doradczy, proaktywny sprzedażowo, budujący zaufanie i prowadzący do kolejnego kroku (rozmowa / wycena / spotkanie).';

      const channelInstruction =
        channel === 'sms'
          ? 'FORMAT KANAŁU: Wiadomość WhatsApp / SMS — maksymalnie zwięzła (4–7 krótkich zdań lub krótkie wypunktowanie), bez długich wstępów i bez formalnej stopki.'
          : 'FORMAT KANAŁU: Pełny profesjonalny e-mail biznesowy gotowy do wysyłki.';

      const signatureLines =
        advisorSignature?.enabled && channel === 'email'
          ? [
              advisorSignature.name,
              advisorSignature.role,
              advisorSignature.companyLine,
              advisorSignature.phone ? `Tel: ${advisorSignature.phone}` : '',
              advisorSignature.email ? `E-mail: ${advisorSignature.email}` : '',
            ]
              .filter(Boolean)
              .join('\n')
          : '';

      const systemText = [
        `Jesteś Starszym Doradcą Sprzedażowym i Ekspertem Ofertowania w firmie "${companyName}" (${companyIndustry}).`,
        'Twoim zadaniem jest przygotowanie kompletnej, gotowej do wysłania odpowiedzi na wklejone zapytanie lub e-mail klienta, aby zaoszczędzić doradcy 90% czasu pracy.',
        toneInstruction,
        channelInstruction,
        replyLangInstruction,
        signatureLines
          ? `PODPIS DORADCY: Zakończ treść maila (replyBody) dokładnie poniższym podpisem:\n${signatureLines}`
          : '',
        includeMiniQuote
          ? 'MINI-KALKULACJA W TREŚCI: Jeśli w Bazie Wiedzy znajdują się ceny, stawki VAT (8%/23%) lub koszty transportu pasujące do zapytania, wstaw do treści odpowiedzi (replyBody) czytelną, zwartą mini-kalkulację szacunkową (Netto + VAT + Brutto + Transport) w formie przejrzystej listy punktowanej.'
          : '',
        includedLinks.length > 0
          ? `LINKI DO MATERIAŁÓW: Wpleć naturalnie w treść odpowiedzi (replyBody) następujące linki dla klienta:\n${includedLinks.map((l) => `- ${l.label}: ${l.url}`).join('\n')}`
          : '',
        'ANALIZA KONTAKTU I SYGNAŁÓW ZAKUPOWYCH: Wyciągnij z wiadomości klienta adres e-mail (detectedRecipientEmail, lub "" jeśli brak) oraz numer telefonu (detectedRecipientPhone, lub "" jeśli brak). Oceń temperaturę leada (buyingSignal.temperature: HOT / WARM / COLD), krótkie uzasadnienie (summary) oraz wykryte obiekcje klienta (detectedObjections).',
        useWebKnowledge
          ? 'TRYB HYBRYDOWY (BAZA WIEDZY + LIVE GOOGLE SEARCH): Połącz twarde dane z poniższej Bazy Wiedzy Firmy (modele, ceny, warunki techniczne, VAT, płatności) z poniższymi aktualnymi wynikami z Google Search oraz wiedzą rynkową. Nie ujawniaj w treści maila do klienta poufnych marż wewnętrznych.'
          : 'TRYB ŚCISŁEJ BAZY WIEDZY: Opieraj się wyłącznie na poniższej Bazie Wiedzy Firmy. Nie ujawniaj poufnych notatek wewnętrznych.',
        '',
        '=== BAZA WIEDZY FIRMY ===',
        knowledgeContext,
        liveWeb.summary ? `\n=== AKTUALNE DANE Z GOOGLE SEARCH (LIVE WEB) ===\n${liveWeb.summary}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const userPrompt = [
        threadHistory.length > 0
          ? `=== DOTYCHCZASOWA HISTORIA WĄTKU Z TYM KLIENTEM (NIE POWTARZAJ TYCH SAMYCH WSTĘPÓW) ===\n${threadHistory
              .map((t, idx) => `${idx + 1}. [${t.role === 'advisor' ? 'MY / DORADCA' : 'KLIENT'}]: ${t.text}`)
              .join('\n')}\n`
          : '',
        '=== NAJNOWSZA WIADOMOŚĆ / ZAPYTANIE OD KLIENTA ===',
        clientMessage,
        advisorNotes ? `\n=== DODATKOWE WYTYCZNE DORADCY SPRZEDAŻOWEGO ===\n${advisorNotes}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.25,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              subject: { type: 'STRING' },
              replyBody: { type: 'STRING' },
              detectedClientName: { type: 'STRING' },
              detectedLanguage: { type: 'STRING' },
              summaryOfInquiry: { type: 'STRING' },
              companyFactsUsed: { type: 'ARRAY', items: { type: 'STRING' } },
              webAndMarketFactsUsed: { type: 'ARRAY', items: { type: 'STRING' } },
              citedTileIds: { type: 'ARRAY', items: { type: 'STRING' } },
              followUpQuestionsToClient: { type: 'ARRAY', items: { type: 'STRING' } },
              internalAdvisorTip: { type: 'STRING' },
              detectedRecipientEmail: { type: 'STRING' },
              detectedRecipientPhone: { type: 'STRING' },
              buyingSignal: {
                type: 'OBJECT',
                properties: {
                  temperature: { type: 'STRING', enum: ['HOT', 'WARM', 'COLD'] },
                  summary: { type: 'STRING' },
                  detectedObjections: { type: 'ARRAY', items: { type: 'STRING' } },
                },
                required: ['temperature', 'summary', 'detectedObjections'],
              },
              estimatedTimeSavedMinutes: { type: 'INTEGER' },
            },
            required: [
              'subject',
              'replyBody',
              'detectedClientName',
              'detectedLanguage',
              'summaryOfInquiry',
              'companyFactsUsed',
              'webAndMarketFactsUsed',
              'citedTileIds',
              'followUpQuestionsToClient',
              'internalAdvisorTip',
              'estimatedTimeSavedMinutes',
            ],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(result.text);
      sendJson(res, 200, {
        ...parsed,
        webSources: liveWeb.sources,
        model: result.model || GEMINI_MODEL,
        keySource: source,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    if (action === 'compare_docs') {
      const companyName = String(body.companyName || 'Firma');
      const tiles = (Array.isArray(body.knowledgeTiles) ? body.knowledgeTiles : []) as KnowledgeTileInput[];
      const docAText = String(body.docAText || '').trim();
      const docBText = String(body.docBText || '').trim();
      const docAName = String(body.docAName || 'Dokument A');
      const docBName = String(body.docBName || 'Dokument B');

      if (!docAText || !docBText) {
        sendJson(res, 400, { error: 'Wklej lub wgraj treść obu dokumentów (Dokument A oraz Dokument B).' });
        return;
      }

      const knowledgeContext = formatKnowledgeContext(tiles, 'internal');

      const systemText = [
        `Jesteś Starszym Audytorem Umów i Kosztorysów w firmie "${companyName}".`,
        'Porównaj dokładnie Dokument A (np. nasza oferta / wersja bazowa) z Dokumentem B (np. wersja klienta / rewizja v2).',
        'Wskaż wszystkie istotne różnice w cenach, metrażach, stawkach VAT, terminach, zakresie prac lub zapisach prawnych oraz ukryte ryzyka.',
        langInstruction,
        '',
        '=== BAZA WIEDZY FIRMY ===',
        knowledgeContext,
      ].join('\n');

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `=== DOKUMENT A (${docAName}) ===\n${docAText}\n\n=== DOKUMENT B (${docBName}) ===\n${docBText}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              overallVerdict: { type: 'STRING' },
              riskLevel: { type: 'STRING', enum: ['LOW', 'MEDIUM', 'HIGH'] },
              differences: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    topic: { type: 'STRING' },
                    docA: { type: 'STRING' },
                    docB: { type: 'STRING' },
                    impact: { type: 'STRING', enum: ['neutral', 'warning', 'critical'] },
                  },
                  required: ['topic', 'docA', 'docB', 'impact'],
                },
              },
              hiddenRisks: { type: 'ARRAY', items: { type: 'STRING' } },
              recommendedAction: { type: 'STRING' },
            },
            required: ['overallVerdict', 'riskLevel', 'differences', 'hiddenRisks', 'recommendedAction'],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(result.text);
      sendJson(res, 200, {
        ...parsed,
        model: result.model || GEMINI_MODEL,
        keySource: source,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    if (action === 'consistency_check') {
      const companyName = String(body.companyName || 'Firma');
      const tiles = (Array.isArray(body.knowledgeTiles) ? body.knowledgeTiles : []) as KnowledgeTileInput[];
      const knowledgeContext = formatKnowledgeContext(tiles, 'internal');

      const systemText = [
        `Jesteś Audytorem Jakości Bazy Wiedzy AI dla firmy "${companyName}".`,
        'Przeanalizuj wszystkie aktywne kafelki wiedzy poniżej i wykryj:',
        '1. Wszelkie sprzeczności lub rozjazdy (np. różne ceny, różne stawki VAT, sprzeczne rabaty lub terminy między kafelkami).',
        '2. Istotne luki operacyjne (czego brakuje, żeby doradca mógł bezbłędnie odpowiadać klientom — np. brak gwarancji, brak SLA, brak kosztów dostawy).',
        '3. Wystaw ocenę spójności score (0-100) i zwięzłe podsumowanie.',
        langInstruction,
        '',
        '=== AKTYWNA BAZA WIEDZY ===',
        knowledgeContext,
      ].join('\n');

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: 'Przeprowadź audyt spójności i kompletności tej bazy wiedzy.' }] }],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              score: { type: 'INTEGER' },
              summary: { type: 'STRING' },
              conflicts: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    severity: { type: 'STRING', enum: ['warning', 'critical'] },
                    title: { type: 'STRING' },
                    detail: { type: 'STRING' },
                    affectedTileTitles: { type: 'ARRAY', items: { type: 'STRING' } },
                  },
                  required: ['severity', 'title', 'detail', 'affectedTileTitles'],
                },
              },
              gaps: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['score', 'summary', 'conflicts', 'gaps'],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(result.text);
      sendJson(res, 200, {
        ...parsed,
        model: result.model || GEMINI_MODEL,
        keySource: source,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    if (action === 'ingest') {
      const companyName = String(body.companyName || 'Firma');
      let rawText = String(body.rawText || '').trim();
      const sourceUrl = String(body.sourceUrl || '').trim();
      const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
      const fileMimeType = typeof body.fileMimeType === 'string' ? body.fileMimeType : '';
      const fileName = String(body.fileName || (sourceUrl || 'Materiał'));

      if (sourceUrl) {
        if (!/^https?:\/\//i.test(sourceUrl)) {
          sendJson(res, 400, { error: 'Podaj poprawny adres URL zaczynający się od http:// lub https://.' });
          return;
        }
        try {
          const pageRes = await fetch(sourceUrl, {
            headers: { 'User-Agent': 'BizOpsAIStudio/1.0 (+knowledge-ingest)' },
            signal: AbortSignal.timeout(10000),
          });
          if (!pageRes.ok) {
            sendJson(res, 400, { error: `Nie udało się pobrać strony (${pageRes.status}).` });
            return;
          }
          const html = await pageRes.text();
          const cleaned = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 20000);
          if (!cleaned) {
            sendJson(res, 400, { error: 'Strona nie zawiera czytelnego tekstu do pobrania.' });
            return;
          }
          rawText = `Źródło WWW: ${sourceUrl}\n\n${cleaned}${rawText ? `\n\nDodatkowe notatki:\n${rawText}` : ''}`;
        } catch (fetchErr) {
          const msg = fetchErr instanceof Error ? fetchErr.message : 'Błąd połączenia ze stroną.';
          sendJson(res, 400, { error: `Nie udało się pobrać URL: ${msg}` });
          return;
        }
      }

      if (!rawText && !fileBase64) {
        sendJson(res, 400, { error: 'Wklej tekst, podaj link URL lub załącz plik, z którego AI ma się nauczyć nowej wiedzy.' });
        return;
      }

      const systemText = [
        `Jesteś architektem bazy wiedzy AI dla firmy "${companyName}".`,
        'Przekształć dostarczony surowy materiał (notatki, PDF, regulamin, cennik, mail) w 1 do 4 czystych, konkretnych i dobrze ustrukturyzowanych kafelków wiedzy (Knowledge Tiles), które zasilą firmowego bota.',
        'Każdy kafelek powinien mieć zwięzły tytuł, dopasowaną kategorię (np. Oferta, Finanse & VAT, Technologia, Logistyka, Procedury, Sprzedaż), poziom widoczności (public lub internal), priorytet (standard lub critical) oraz konkretną treść.',
        langInstruction,
      ].join('\n');

      const parts: Array<Record<string, unknown>> = [];
      if (fileBase64 && fileMimeType) {
        parts.push({ inlineData: { mimeType: fileMimeType, data: fileBase64 } });
      }
      parts.push({
        text: `Źródło: ${fileName}\n\n${rawText || 'Wyodrębnij kluczową wiedzę biznesową z załączonego pliku.'}`,
      });

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              summaryNote: { type: 'STRING' },
              tiles: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    title: { type: 'STRING' },
                    category: { type: 'STRING' },
                    visibility: { type: 'STRING', enum: ['public', 'internal'] },
                    priority: { type: 'STRING', enum: ['standard', 'critical'] },
                    content: { type: 'STRING' },
                  },
                  required: ['title', 'category', 'visibility', 'priority', 'content'],
                },
              },
            },
            required: ['summaryNote', 'tiles'],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(result.text);
      sendJson(res, 200, {
        ...parsed,
        model: result.model || GEMINI_MODEL,
        keySource: source,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    sendJson(res, 400, { error: `Nieznana akcja API: ${action}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Nieoczekiwany błąd serwera AI.';
    sendJson(res, 500, { error: message, latencyMs: Date.now() - startedAt });
  }
}
