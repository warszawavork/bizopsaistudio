import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TallyQuoteEvaluation, TallyQuoteInput } from '../src/types';
import { evaluateTallyQuoteFromLiveData, getLiveTallyCpqContext, getLiveTallyData } from './_tally.js';

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

interface LiveWebSource {
  title: string;
  uri: string;
  domain?: string;
  snippet?: string;
}

interface ContextStatsResult {
  totalActiveTiles: number;
  selectedTilesCount: number;
  criticalCount: number;
  omittedTilesCount: number;
  tokensSavedEstimate: number;
}

const GEMINI_MODEL = 'gemini-3-flash-preview';
const MODEL_FALLBACK_CHAIN = [
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
];
const FAST_HEALTHY_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
];
const MODEL_COOLDOWN_MS = 90_000;
const modelCooldownUntil = new Map<string, number>();
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const SEMANTIC_CLUSTERS: string[][] = [
  ['vat', 'podat', '8%', '23%', 'faktur', 'mpp', 'split', 'b2b', 'prywat', 'mieszkan', 'pkob'],
  ['fundament', 'slup', 'plyt', 'stop', 'posadow', 'grunt', 'dzialk', 'palow'],
  ['transport', 'hds', 'dzwig', 'dojazd', 'dostaw', 'montaz', 'kilometr', 'km', 'droga'],
  ['cena', 'cennik', 'koszt', 'ile', 'rabat', 'upust', 'marz', 'wycen', 'kwot', 'pln', 'netto', 'brutto'],
  ['calorocz', 'wt2021', 'izolac', 'weln', 'rekreac', 'letnisk', 'pozwol', 'zglosz', '35m', '70m', '300'],
  ['gwaranc', 'serwis', 'reklamac', 'termin', 'czas', 'tygod', 'miesiac', 'realiza', 'sla'],
  ['kredyt', 'leasing', 'finans', 'transz', 'platn', 'zalicz', 'harmonogram'],
  ['modul', 'metraz', '54', '73', '82', '84', 'biur', 'pawilon', 'ekspor', 'norweg', 'niemc', 'clo'],
];

const NEGATIVE_CONSTRAINTS_CLIENT = [
  'ŻELAZNE ZAKAZY (BEZPIECZEŃSTWO PRAWNO-HANDLOWE — ZERO HALUCYNACJI):',
  '1. ZAKAZ podawania kwoty cenowej bez wyraźnego określenia stawki VAT (np. 8% VAT lub 23% VAT), waluty, statusu (Netto / Brutto) oraz adnotacji „kalkulacja orientacyjna wymagająca finalnej weryfikacji projektowej”, chyba że cena wynika 1:1 ze sztywnego cennika w bazie.',
  '2. ZAKAZ obiecywania gwarantowanych terminów odbioru, gratisów lub rabatów przekraczających limity z Bazy Wiedzy.',
  '3. ZAKAZ ujawniania w treści dla klienta poufnych marż, limitów rabatowych Managera ani dokumentów oznaczonych jako [DOSTĘP: WEWNĘTRZNY/HANDLOWY].',
  '4. ZAKAZ wymyślania niepotwierdzonych parametrów technicznych (grubość izolacji, klasa drewna, kW przyłącza) — jeśli brak ich w Bazie Wiedzy i w wynikach z Internetu, poinformuj o konieczności doprecyzowania z działem technicznym.',
].join('\n');

const BUILDING_TYPOLOGY_DETECTION = [
  'AUTOMATYCZNA KLASYFIKACJA TYPU OBIEKTU / KONTEKSTU (jeśli zapytanie dotyczy nieruchomości, budownictwa lub wyceny):',
  '- Rozpoznaj wariant: (A) Dom całoroczny mieszkalny (PKOB 1110, wymóg WT2021; osoba fizyczna do 300 m² = potencjalnie 8% VAT; zgłoszenie do 70 m² na własne potrzeby lub pozwolenie), (B) Domek rekreacyjny / letniskowy (uproszczone wymogi, zgłoszenie rekreacji indywidualnej, uwaga na 23% VAT), lub (C) Obiekt B2B / Biuro / Wynajem komercyjny (zawsze 23% VAT + Split Payment MPP powyżej 15 000 zł brutto).',
].join('\n');

const REPLY_STRUCTURE_COMMAND = [
  'KOMENDA FORMATOWANIA UKŁADU ODPOWIEDZI (BEZWZGLĘDNY WYMÓG ESTETYKI — ZERO ŚCIANY TEKSTU):',
  '1. KAŻDY element listy (• oraz 1., 2., 3.) MUSI zaczynać się od NOWEJ LINII (\\n). SUROWY ZAKAZ umieszczania dwóch punktorów „•” w tym samym akapicie lub po kropce w tej samej linii!',
  '2. Używaj czytelnej, profesjonalnej struktury podzielonej pustą linią (\\n\\n) pomiędzy sekcjami:',
  '   [Powitanie]',
  '   (pusta linia)',
  '   [Krótkie odniesienie do zapytania — max 2 zdania]',
  '   (pusta linia)',
  '   [Nagłówek sekcji, np. Szczegóły zakresu / Specyfikacja:]',
  '   • Punkt 1: krótki konkret',
  '   • Punkt 2: krótki konkret',
  '   • Punkt 3: krótki konkret',
  '   (pusta linia)',
  '   [Sekcja Koszty / VAT / Warunki finansowe:]',
  '   • Kwota i VAT: ...',
  '   • Koszty dodatkowe: ...',
  '   (pusta linia)',
  '   [Kolejne kroki / Pytania:]',
  '   1. Pierwsze pytanie lub krok',
  '   2. Drugie pytanie lub krok',
  '   (pusta linia)',
  '   [Podpis]',
  '3. Zachowaj czystość biznesową (bez surowych znaków ### ani | tabel w treści maila).',
].join('\n');

function formatStructuredReplyText(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/\r\n/g, '\n').trim();

  // 1. Każdy śródliniowy punktor • przenieś do nowej linii
  text = text.replace(/([^\n])\s*•\s+/g, '$1\n• ');
  text = text.replace(/^[ \t]*•[ \t]*/gm, '• ');

  // 2. Oddziel pustą linią przed blokiem punktorów, jeśli poprzedza go pełne zdanie lub nagłówek z dwukropkiem
  text = text.replace(/([.:!?])\n(• )/g, '$1\n\n$2');
  // Trzymaj sąsiednie punktory blisko siebie (jeden pod drugim)
  text = text.replace(/(• [^\n]+)\n{2,}(?=• )/g, '$1\n');

  // 3. Łam śródliniowe listy numerowane (np. "prosimy o: 1. Jaki... 2. Czy...")
  text = text.replace(/([.:!?])\s+(\d{1,2}\.\s+[A-ZŻŹĆĄŚĘŁÓŃa-z])/g, '$1\n\n$2');
  for (let pass = 0; pass < 6; pass++) {
    const next = text.replace(/((?:^|\n)\d{1,2}\.\s+[^\n]+?)\s+(\d{1,2}\.\s+[A-ZŻŹĆĄŚĘŁÓŃa-z])/g, '$1\n$2');
    if (next === text) break;
    text = next;
  }

  // 4. Oddziel powitanie na początku wiadomości
  text = text.replace(
    /^((?:Dzień dobry|Szanown[ya]\s+[^.!?\n]+|Witam[^.!?\n]*|Cześć[^.!?\n]*|Hello[^.!?\n]*|Dear\s+[^.!?\n]+)[,!.]?)\s+(?=[A-ZŻŹĆĄŚĘŁÓŃ])/,
    '$1\n\n'
  );

  // 5. Oddziel charakterystyczne nagłówki sekcji do nowego akapitu
  text = text.replace(
    /([.!?])\s+((?:Zakres oferty|Szczegóły oferty|Specyfikacja techniczna|Standard wykończenia|Wycena orientacyjna|Koszty i podatek VAT|Podsumowanie kosztów|Kolejne kroki|Następne kroki|Aby przygotować|Podsumowując|W razie pytań|Zapraszam do kontaktu)[^:\n]*:)/gi,
    '$1\n\n$2'
  );

  // 6. Oddziel podpis końcowy
  text = text.replace(
    /\s+((?:Z poważaniem|Z wyrazami szacunku|Pozdrawiam|Serdecznie pozdrawiam|Łączę pozdrowienia|Best regards|Kind regards|Mit freundlichen Grüßen|Med vennlig hilsen),?)\s+/gi,
    '\n\n$1\n'
  );

  // 7. Posprzątaj nadmiar spacji i pustych linii
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/[źż]/g, 'z');
}

function extractQueryTerms(query: string): { exactTokens: string[]; stems: string[]; activeClusters: number[] } {
  const normalized = normalizeSearchText(query);
  const rawTokens = normalized.match(/[a-z0-9%]{2,}/g) || [];
  const exactTokens = Array.from(new Set(rawTokens)).slice(0, 35);
  const stems = Array.from(
    new Set(
      exactTokens
        .filter((t) => t.length >= 4)
        .map((t) => t.slice(0, Math.min(t.length, 5)))
    )
  );

  const activeClusters: number[] = [];
  SEMANTIC_CLUSTERS.forEach((cluster, idx) => {
    const matches = cluster.some((root) => normalized.includes(root));
    if (matches) activeClusters.push(idx);
  });

  return { exactTokens, stems, activeClusters };
}

function scoreTileRelevance(
  tile: KnowledgeTileInput,
  terms: { exactTokens: string[]; stems: string[]; activeClusters: number[] }
): number {
  const titleNorm = normalizeSearchText(tile.title);
  const catNorm = normalizeSearchText(tile.category);
  const contentNorm = normalizeSearchText(tile.content);

  let score = 0;

  for (const tok of terms.exactTokens) {
    if (titleNorm.includes(tok)) score += 10;
    if (catNorm.includes(tok)) score += 6;
    if (contentNorm.includes(tok)) score += 4;
  }

  for (const stem of terms.stems) {
    if (titleNorm.includes(stem)) score += 6;
    if (contentNorm.includes(stem)) score += 2.5;
  }

  for (const clusterIdx of terms.activeClusters) {
    const cluster = SEMANTIC_CLUSTERS[clusterIdx];
    const tileFull = `${titleNorm} ${catNorm} ${contentNorm}`;
    if (cluster.some((root) => tileFull.includes(root))) {
      score += 5;
    }
  }

  return score;
}

function formatSingleTile(t: KnowledgeTileInput, relevanceScore?: number): string {
  const scoreBadge =
    relevanceScore !== undefined && relevanceScore > 0 ? ` [TRAFNOŚĆ: ${Math.round(relevanceScore)}]` : '';
  return `[TILE_ID: ${t.id}] [KATEGORIA: ${t.category}] [PRIORYTET: ${
    t.priority === 'critical' ? 'KRYTYCZNY' : 'STANDARD'
  }] [DOSTĘP: ${t.visibility === 'internal' ? 'WEWNĘTRZNY/HANDLOWY' : 'PUBLICZNY'}]${scoreBadge}\nTYTUŁ: ${t.title}\nTREŚĆ:\n${t.content}`;
}

/**
 * Kompilator Kontekstu (Upgrade #4):
 * Zawsze zachowuje reguły KRYTYCZNE oraz rerankuje standardowe kafelki pod konkretne zapytanie,
 * odrzucając szum kontekstowy w większych bazach (oszczędność tokenów + wyższa precyzja i szybkość AI).
 */
function compileSmartKnowledgeContext(
  tiles: KnowledgeTileInput[],
  perspective: 'client' | 'internal',
  queryText: string,
  maxStandardTiles = 7
): { contextText: string; stats: ContextStatsResult } {
  const active = tiles.filter((t) => t.enabled && (perspective === 'internal' || t.visibility === 'public'));
  if (active.length === 0) {
    return {
      contextText: 'Brak aktywnych dokumentów w bazie wiedzy firmy.',
      stats: {
        totalActiveTiles: 0,
        selectedTilesCount: 0,
        criticalCount: 0,
        omittedTilesCount: 0,
        tokensSavedEstimate: 0,
      },
    };
  }

  const criticalTiles = active.filter((t) => t.priority === 'critical');
  const standardTiles = active.filter((t) => t.priority !== 'critical');

  if (!queryText.trim() || standardTiles.length <= 4) {
    const ordered = [...criticalTiles, ...standardTiles];
    return {
      contextText: ordered.map((t) => formatSingleTile(t)).join('\n\n---\n\n'),
      stats: {
        totalActiveTiles: active.length,
        selectedTilesCount: ordered.length,
        criticalCount: criticalTiles.length,
        omittedTilesCount: 0,
        tokensSavedEstimate: 0,
      },
    };
  }

  const terms = extractQueryTerms(queryText);
  const scored = standardTiles
    .map((tile) => ({
      tile,
      score: scoreTileRelevance(tile, terms),
    }))
    .sort((a, b) => b.score - a.score);

  const relevant = scored.filter((item) => item.score > 0).slice(0, maxStandardTiles);

  // Jeśli dopasowało się mniej niż 2 kafelki (np. ogólne pytanie), dołóż maksymalnie 2 bazowe kafelki ofertowe/techniczne
  const selectedStandard: Array<{ tile: KnowledgeTileInput; score: number }> = [...relevant];
  if (selectedStandard.length < 2) {
    const pickedIds = new Set(selectedStandard.map((s) => s.tile.id));
    for (const candidate of scored) {
      if (!pickedIds.has(candidate.tile.id)) {
        selectedStandard.push(candidate);
        pickedIds.add(candidate.tile.id);
      }
      if (selectedStandard.length >= Math.min(3, scored.length)) break;
    }
  }

  const finalTiles = [
    ...criticalTiles.map((t) => ({ tile: t, score: 999 })),
    ...selectedStandard,
  ];
  const selectedIds = new Set(finalTiles.map((f) => f.tile.id));
  const omittedChars = active
    .filter((t) => !selectedIds.has(t.id))
    .reduce((sum, t) => sum + t.title.length + t.content.length + 80, 0);

  const tokensSavedEstimate = Math.round(omittedChars / 3.8);
  const omittedCount = active.length - finalTiles.length;

  const header =
    omittedCount > 0
      ? `[COMPACT RAG CONTEXT: Wybrano ${finalTiles.length} najtrafniejszych kafelków (w tym ${criticalTiles.length} krytycznych) z ${active.length} aktywnych; pominięto ${omittedCount} niepowiązanych reguł (~${tokensSavedEstimate} tok. oszczędności)]`
      : '';

  const body = finalTiles
    .map((item) => formatSingleTile(item.tile, item.score === 999 ? undefined : item.score))
    .join('\n\n---\n\n');

  return {
    contextText: header ? `${header}\n\n${body}` : body,
    stats: {
      totalActiveTiles: active.length,
      selectedTilesCount: finalTiles.length,
      criticalCount: criticalTiles.length,
      omittedTilesCount: omittedCount,
      tokensSavedEstimate,
    },
  };
}

function extractDomainFromUrlOrTitle(uri: string, title?: string): string {
  try {
    const host = new URL(uri).hostname.replace(/^www\./i, '');
    if (host !== 'vertexaisearch.cloud.google.com') {
      return host;
    }
  } catch {
    // fallback below
  }
  if (title) {
    const domainMatch = title.match(/([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/i);
    if (domainMatch) return domainMatch[1].toLowerCase();
  }
  return 'google.com';
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

function parseGeminiJson<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Wyciągnij główny obiekt/tablicę JSON, jeśli model dodał komentarz przed lub po JSON
    const firstObj = cleaned.indexOf('{');
    const lastObj = cleaned.lastIndexOf('}');
    if (firstObj !== -1 && lastObj > firstObj) {
      return JSON.parse(cleaned.slice(firstObj, lastObj + 1)) as T;
    }
    const firstArr = cleaned.indexOf('[');
    const lastArr = cleaned.lastIndexOf(']');
    if (firstArr !== -1 && lastArr > firstArr) {
      return JSON.parse(cleaned.slice(firstArr, lastArr + 1)) as T;
    }
    throw new Error('Model AI zwrócił niekompletną odpowiedź JSON. Spróbuj ponownie lub zmniejsz rozmiar fragmentu.');
  }
}

function isTransientErrorText(status: number, msg: string): boolean {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /high demand|overloaded|unavailable|no longer available|resource_exhausted|quota|try again|timeout|abort/i.test(msg)
  );
}

function toFriendlyGeminiError(rawMsg: string): string {
  if (/high demand|overloaded|unavailable|resource_exhausted|429|503/i.test(rawMsg)) {
    return 'Wszystkie modele Google Gemini są chwilowo mocno obciążone (429/503 High Demand). System automatycznie wypróbował 7 modeli rezerwowych — odczekaj 10–20 sekund i kliknij ponownie.';
  }
  if (/413|payload|too large|request entity/i.test(rawMsg)) {
    return 'Załącznik jest zbyt duży dla pojedynczego zapytania. Wgraj mniejszy plik lub podziel dokument na części.';
  }
  if (/abort|timeout|limit czasu/i.test(rawMsg)) {
    return 'Przekroczono czas oczekiwania na odpowiedź Gemini AI przy analizie dużego załącznika. Spróbuj ponownie lub wyślij mniejszy fragment.';
  }
  return rawMsg;
}

function getOrderedModelsForCall(hasMedia: boolean, preferFast = false): string[] {
  const now = Date.now();
  const baseOrder = preferFast
    ? [...FAST_HEALTHY_MODELS, 'gemini-3.5-flash', 'gemini-3.7-flash']
    : hasMedia
      ? [
          'gemini-3-flash-preview',
          'gemini-3.5-flash-lite',
          'gemini-3.1-flash-lite',
          'gemini-flash-lite-latest',
          'gemini-3.5-flash',
          'gemini-3.7-flash',
          'gemini-3.8-flash',
        ]
      : [...MODEL_FALLBACK_CHAIN];

  const healthy: string[] = [];
  const cooling: string[] = [];
  for (const m of baseOrder) {
    const until = modelCooldownUntil.get(m) ?? 0;
    if (until > now) {
      cooling.push(m);
    } else {
      healthy.push(m);
    }
  }
  // Najpierw zdrowe modele, na końcu najdawniej schłodzone jako ostatnia deska ratunku
  cooling.sort((a, b) => (modelCooldownUntil.get(a) ?? 0) - (modelCooldownUntil.get(b) ?? 0));
  return [...healthy, ...cooling];
}

async function callGemini(
  apiKey: string,
  payload: Record<string, unknown>,
  options?: { preferFast?: boolean; maxBudgetMs?: number }
): Promise<{
  text: string;
  model: string;
  usage: { promptTokens: number; candidatesTokens: number; totalTokens: number };
}> {
  const startedCallAt = Date.now();
  const maxTotalBudgetMs = options?.maxBudgetMs ?? 46_000;
  const serialized = JSON.stringify(payload);
  const hasMedia = serialized.includes('inlineData');
  const candidateModels = getOrderedModelsForCall(hasMedia, Boolean(options?.preferFast));

  let lastError: Error = new Error('Nie udało się połączyć z modelem Gemini.');

  const tryModelOnce = async (model: string, timeoutMs: number) => {
    const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const rawBody = await response.text();
      let data: {
        error?: { message?: string; code?: number };
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      } = {};
      try {
        data = rawBody ? (JSON.parse(rawBody) as typeof data) : {};
      } catch {
        data = { error: { message: `HTTP ${response.status}: ${rawBody.slice(0, 140)}` } };
      }

      if (!response.ok) {
        const msg = data.error?.message || `Błąd Gemini API (HTTP ${response.status})`;
        if (isTransientErrorText(response.status, msg)) {
          modelCooldownUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
        }
        throw Object.assign(new Error(msg), { transient: isTransientErrorText(response.status, msg) || response.status === 404 });
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        throw Object.assign(new Error('Model Gemini zwrócił pustą odpowiedź.'), { transient: true });
      }

      modelCooldownUntil.delete(model);
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
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        (err as { transient?: boolean })?.transient === true ||
        isTransientErrorText(0, msg);
      if (transient) {
        modelCooldownUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
      }
      throw Object.assign(err instanceof Error ? err : new Error(msg), { transient });
    }
  };

  // Przebieg 1: wszystkie dostępne modele (z szybkim timeoutem, by nie zawisnąć na przeciążonym)
  for (let i = 0; i < candidateModels.length; i++) {
    const elapsed = Date.now() - startedCallAt;
    if (elapsed > maxTotalBudgetMs) break;

    const model = candidateModels[i];
    const isLite = model.includes('lite');
    const timeoutMs = hasMedia ? (isLite ? 20_000 : 12_000) : (isLite ? 12_000 : 6_000);

    try {
      return await tryModelOnce(model, Math.min(timeoutMs, maxTotalBudgetMs - elapsed));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isTransient = (err as { transient?: boolean })?.transient !== false;
      if (!isTransient) {
        throw new Error(toFriendlyGeminiError(lastError.message));
      }
      if (i < candidateModels.length - 1) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }

  // Przebieg 2 (Backoff retry): odczekaj ~1.4s po chwilowym skoku 429/503 i ponów na najszybszych modelach
  const remainingBudget = maxTotalBudgetMs - (Date.now() - startedCallAt);
  if (remainingBudget > 8_000) {
    await new Promise((r) => setTimeout(r, 1_400));
    for (const model of FAST_HEALTHY_MODELS) {
      const elapsed = Date.now() - startedCallAt;
      if (elapsed > maxTotalBudgetMs - 2_000) break;
      try {
        return await tryModelOnce(model, Math.min(18_000, maxTotalBudgetMs - elapsed));
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw new Error(toFriendlyGeminiError(lastError.message));
}

async function fetchLiveWebContext(
  apiKey: string,
  companyIndustry: string,
  clientMessage: string
): Promise<{ summary: string; sources: LiveWebSource[]; searchQueries: string[] }> {
  const webStart = Date.now();
  const maxWebBudgetMs = 7000;
  const now = Date.now();
  const webModels = [
    'gemini-3-flash-preview',
    'gemini-flash-lite-latest',
    'gemini-3.5-flash-lite',
  ].sort((a, b) => ((modelCooldownUntil.get(a) ?? 0) > now ? 1 : 0) - ((modelCooldownUntil.get(b) ?? 0) > now ? 1 : 0));

  for (let i = 0; i < webModels.length; i++) {
    const remaining = maxWebBudgetMs - (Date.now() - webStart);
    if (remaining < 1500) break;
    const model = webModels[i];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.min(4000, remaining));

    try {
      const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Branża: ${companyIndustry}. Wyszukaj w internecie aktualne fakty rynkowe, akty prawne (np. ustawa o VAT art. 41 ust. 12, Prawo budowlane art. 29, WT2021, cło/transport, prawa konsumenta) lub dane lokalne potrzebne do rzetelnej odpowiedzi na zapytanie:\n\n${clientMessage.slice(0, 1200)}\n\nWypisz zwięźle 3-5 kluczowych faktów z podaniem podstaw prawnych lub źródeł.`,
                },
              ],
            },
          ],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 520 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429 || response.status === 503) {
          modelCooldownUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
        }
        if ((response.status === 429 || response.status === 503 || response.status === 404) && i < webModels.length - 1) {
          continue;
        }
        return { summary: '', sources: [], searchQueries: [] };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          groundingMetadata?: {
            webSearchQueries?: string[];
            groundingChunks?: Array<{
              web?: { uri?: string; title?: string };
            }>;
            groundingSupports?: Array<{
              segment?: { text?: string };
              groundingChunkIndices?: number[];
            }>;
          };
        }>;
      };

      const candidate = data.candidates?.[0];
      const summary = candidate?.content?.parts?.[0]?.text?.trim() || '';
      const metadata = candidate?.groundingMetadata;
      const rawChunks = metadata?.groundingChunks || [];
      const supports = metadata?.groundingSupports || [];
      const searchQueries = (metadata?.webSearchQueries || []).filter(Boolean).slice(0, 3);

      // Zmapuj fragmenty tekstu (snippety) na konkretne źródła chunkIndex
      const snippetByChunkIndex = new Map<number, string>();
      for (const sup of supports) {
        const text = sup.segment?.text?.trim();
        const indices = sup.groundingChunkIndices || [];
        if (!text) continue;
        for (const chunkIdx of indices) {
          if (!snippetByChunkIndex.has(chunkIdx)) {
            snippetByChunkIndex.set(chunkIdx, text.slice(0, 200));
          }
        }
      }

      const seen = new Set<string>();
      const sources: LiveWebSource[] = [];
      for (let idx = 0; idx < rawChunks.length; idx++) {
        const chunk = rawChunks[idx];
        const uri = chunk.web?.uri?.trim();
        if (uri && /^https?:\/\//i.test(uri) && !seen.has(uri)) {
          seen.add(uri);
          const rawTitle = chunk.web?.title?.trim() || uri;
          sources.push({
            title: rawTitle,
            uri,
            domain: extractDomainFromUrlOrTitle(uri, rawTitle),
            snippet: snippetByChunkIndex.get(idx),
          });
        }
        if (sources.length >= 5) break;
      }

      return { summary, sources, searchQueries };
    } catch {
      clearTimeout(timeoutId);
      if (i < webModels.length - 1) continue;
    }
  }

  return { summary: '', sources: [], searchQueries: [] };
}

function quickRegexExtractTallyParams(text: string): Partial<TallyQuoteInput> {
  const lower = text.toLowerCase();
  const areaMatch = lower.match(/(\d{2,3})\s*(?:m2|m²|metr)/);
  const kmMatch = lower.match(/(\d{2,4})\s*km\b/);
  return {
    areaM2: areaMatch ? Number(areaMatch[1]) : null,
    areaIsTotalUsable: /użytkow|uzytkow|całkowit|calkowit/.test(lower),
    standard: /dewelopersk/.test(lower) ? 'deweloperski' : /norvil|pod klucz/.test(lower) ? 'norvil' : null,
    insulation: /letnisk|rekreac/.test(lower) ? 'letniskowy' : /całorocz|calorocz|mieszkaln/.test(lower) ? 'caloroczny' : null,
    floorType: /piętrow|pietrow|pełne piętro|pelne pietro/.test(lower)
      ? 'pietro'
      : /poddasz/.test(lower)
        ? 'poddasze'
        : /parter/.test(lower)
          ? 'parter'
          : null,
    foundation: /płyt|plyt/.test(lower)
      ? 'plyta'
      : /ław|law/.test(lower)
        ? 'lawy'
        : /słup|slup|geo/.test(lower)
          ? 'slupy'
          : /bez fundament/.test(lower)
            ? 'brak'
            : null,
    underfloorHeating: /podłogówk|podlogowk|ogrzewanie podłogowe/.test(lower) ? true : null,
    bathroom: /łazienk.*premium|lazienk.*premium/.test(lower)
      ? 'premium'
      : /łazienk|lazienk/.test(lower)
        ? 'podstawowy'
        : null,
    fireplace: /kominek|koza/.test(lower) ? 'koza' : null,
    kitchenPkg: /kuchni/.test(lower) && /mebl/.test(lower) ? 'kuchnia_meble' : /kuchni/.test(lower) ? 'kuchnia' : null,
    roofAngleMpzp: /mpzp|kąt dachu|kat dachu/.test(lower) ? true : null,
    deliveryKm: kmMatch ? Number(kmMatch[1]) : 0,
    vatRate: /23%/.test(lower) || /letnisk|firma|b2b/.test(lower) ? 23 : 8,
  };
}

async function extractTallyParamsFromConversation(
  apiKey: string,
  threadHistory: Array<{ role?: string; text?: string }>,
  clientMessage: string,
  advisorNotes: string,
  maxBudgetMs = 11_000
): Promise<{
  input: Partial<TallyQuoteInput>;
  usage: { promptTokens: number; candidatesTokens: number; totalTokens: number };
}> {
  const transcript = [
    ...threadHistory.map((t, i) => `${i + 1}. [${t.role === 'advisor' ? 'DORADCA' : 'KLIENT'}]: ${t.text}`),
    clientMessage ? `NAJNOWSZE [KLIENT]: ${clientMessage}` : '',
    advisorNotes ? `WYTYCZNA DORADCY: ${advisorNotes}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const prompt = [
    'Przeanalizuj poniższą rozmowę z klientem i wyciągnij wszystkie dotychczasowe ustalenia pasujące do konfiguratora domu NORVIL (Tally dWO4Oq).',
    'Jeśli klient czegoś NIE określił ani nie potwierdził w żadnej wiadomości, ustaw "unknown" (lub 0 dla liczb) — NIE ZGADUJ!',
    'UWAGA na metraż (areaM2): jeśli klient pisze np. „dom piętrowy 100m2 pow. użytkowej” ustaw areaIsTotalUsable=true; jeśli podaje powierzchnię zabudowy podstawy np. „podstawa 50m2 piętrowy” lub „parter 50m2”, ustaw areaIsTotalUsable=false.',
    'Jeśli podano miasto dostawy (np. Warszawa -> 600 km z Przemyśla, Kraków -> 240 km, Wrocław -> 510 km, Gdańsk -> 820 km, Katowice -> 320 km), wpisz przybliżoną odległość w km z Przemyśla w deliveryKm.',
    '',
    transcript,
  ].join('\n');

  try {
    const res = await callGemini(
      apiKey,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              areaM2: { type: 'NUMBER' },
              areaIsTotalUsable: { type: 'BOOLEAN' },
              standard: { type: 'STRING', enum: ['unknown', 'deweloperski', 'norvil'] },
              insulation: { type: 'STRING', enum: ['unknown', 'letniskowy', 'caloroczny'] },
              floorType: { type: 'STRING', enum: ['unknown', 'parter', 'poddasze', 'pietro'] },
              foundation: { type: 'STRING', enum: ['unknown', 'brak', 'slupy', 'lawy', 'plyta'] },
              architectPkg: {
                type: 'STRING',
                enum: ['unknown', 'none', 'letniskowy', 'mieszkalny_70', 'mieszkalny_120', 'premium'],
              },
              underfloorHeating: { type: 'STRING', enum: ['unknown', 'tak', 'nie'] },
              heatersCount: { type: 'INTEGER' },
              acCount: { type: 'INTEGER' },
              bathroom: { type: 'STRING', enum: ['unknown', 'none', 'podstawowy', 'premium'] },
              coveredTerraceM2: { type: 'NUMBER' },
              openTerraceM2: { type: 'NUMBER' },
              deliveryKm: { type: 'NUMBER' },
              deliveryModules: { type: 'INTEGER' },
              kitchenPkg: { type: 'STRING', enum: ['unknown', 'none', 'umeblowanie', 'kuchnia', 'kuchnia_meble'] },
              fireplace: { type: 'STRING', enum: ['unknown', 'none', 'przygotowanie', 'koza'] },
              roofAngleMpzp: { type: 'STRING', enum: ['unknown', 'tak', 'nie'] },
              vatRate: { type: 'INTEGER', enum: [8, 23] },
            },
            required: ['areaM2', 'standard', 'insulation', 'floorType', 'foundation'],
          },
        },
      },
      { preferFast: true, maxBudgetMs }
    );

    const raw = parseGeminiJson<Record<string, unknown>>(res.text);
    const opt = <T extends string>(val: unknown): T | null =>
      typeof val === 'string' && val !== 'unknown' ? (val as T) : null;

    const input: Partial<TallyQuoteInput> = {
      areaM2: typeof raw.areaM2 === 'number' && raw.areaM2 > 0 ? raw.areaM2 : null,
      areaIsTotalUsable: Boolean(raw.areaIsTotalUsable),
      standard: opt<'deweloperski' | 'norvil'>(raw.standard),
      insulation: opt<'letniskowy' | 'caloroczny'>(raw.insulation),
      floorType: opt<'parter' | 'poddasze' | 'pietro'>(raw.floorType),
      foundation: opt<'brak' | 'slupy' | 'lawy' | 'plyta'>(raw.foundation),
      architectPkg: opt<'none' | 'letniskowy' | 'mieszkalny_70' | 'mieszkalny_120' | 'premium'>(raw.architectPkg),
      underfloorHeating:
        raw.underfloorHeating === 'tak' ? true : raw.underfloorHeating === 'nie' ? false : null,
      heatersCount: typeof raw.heatersCount === 'number' ? raw.heatersCount : 0,
      acCount: typeof raw.acCount === 'number' ? raw.acCount : 0,
      bathroom: opt<'none' | 'podstawowy' | 'premium'>(raw.bathroom),
      coveredTerraceM2: typeof raw.coveredTerraceM2 === 'number' ? raw.coveredTerraceM2 : 0,
      openTerraceM2: typeof raw.openTerraceM2 === 'number' ? raw.openTerraceM2 : 0,
      deliveryKm: typeof raw.deliveryKm === 'number' ? raw.deliveryKm : 0,
      deliveryModules: typeof raw.deliveryModules === 'number' ? raw.deliveryModules : 0,
      kitchenPkg: opt<'none' | 'umeblowanie' | 'kuchnia' | 'kuchnia_meble'>(raw.kitchenPkg),
      fireplace: opt<'none' | 'przygotowanie' | 'koza'>(raw.fireplace),
      roofAngleMpzp: raw.roofAngleMpzp === 'tak' ? true : raw.roofAngleMpzp === 'nie' ? false : null,
      vatRate: raw.vatRate === 23 ? 23 : 8,
    };

    return { input, usage: res.usage };
  } catch {
    return {
      input: quickRegexExtractTallyParams(transcript),
      usage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 },
    };
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
      const useWebSearch = body.useWebSearch !== false;
      const tiles = (Array.isArray(body.knowledgeTiles) ? body.knowledgeTiles : []) as KnowledgeTileInput[];
      const messages = (Array.isArray(body.messages) ? body.messages : []) as ChatMessageInput[];

      const recentUserQuery = messages
        .filter((m) => m.role === 'user')
        .slice(-2)
        .map((m) => m.content)
        .join(' ');
      const { contextText: knowledgeContext, stats: contextStats } = compileSmartKnowledgeContext(
        tiles,
        perspective,
        recentUserQuery,
        7
      );

      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
      const useTallyConfig = body.useTallyConfig !== false;
      const tallyFormId = String(body.tallyFormId || 'dWO4Oq');

      const [liveWeb, liveTally] = await Promise.all([
        useWebSearch && lastUserMessage
          ? fetchLiveWebContext(apiKey, companyIndustry, lastUserMessage)
          : Promise.resolve({ summary: '', sources: [], searchQueries: [] }),
        useTallyConfig
          ? getLiveTallyCpqContext(tallyFormId)
          : Promise.resolve(null),
      ]);

      const systemText = [
        `Jesteś oficjalnym Ekspertem i Asystentem AI firmy "${companyName}" (branża: ${companyIndustry}).`,
        perspective === 'internal'
          ? 'TRYB PRACY: WEWNĘTRZNY (Dla Pracownika / Handlowca / Managera). Masz dostęp do pełnej bazy wraz z notatkami wewnętrznymi, marżami, ryzykami operacyjnymi i checklistami, do LIVE cennika Konfiguratora Tally (dWO4Oq) oraz do aktualnej wiedzy z Internetu (Google Search).'
          : 'TRYB PRACY: KLIENT ZEWNĘTRZNY. Odpowiadaj uprzejmie, profesjonalnie i sprzedażowo. Opieraj się na publicznej bazie wiedzy firmy, LIVE cenniku Konfiguratora Tally (dWO4Oq) oraz aktualnej wiedzy rynkowej z Internetu. Nie ujawniaj wewnętrznych marż ani poufnych procedur.',
        langInstruction,
        perspective === 'client' ? NEGATIVE_CONSTRAINTS_CLIENT : 'Nigdy nie wymyślaj parametrów technicznych ani liczb nieobecnych w bazie wiedzy, konfiguratorze Tally lub źródłach z sieci.',
        BUILDING_TYPOLOGY_DETECTION,
        'ZASADY GŁĘBOKIEJ SYNTEZY I FORMATOWANIA (BAZA WIEDZY + KONFIGURATOR TALLY + INTERNET):',
        '1. Śmiało korzystaj z podpiętego LIVE cennika Konfiguratora Tally (dWO4Oq) poniżej! Przy każdym pytaniu o wycenę, dom parterowy (×1.0), dom z poddaszem (×1.5), dom piętrowy (×2.0), fundamenty (słupy 350 / ławy 600 / płyta 750), pakiety architekta, ogrzewanie, łazienkę, kuchnię, tarasy, kominek czy dostawę — obliczaj konkretne kwoty krok po kroku w tabeli Markdown oraz podawaj podsumowanie NETTO + VAT (8% mieszkalny / 23% rekreacyjny lub B2B) + BRUTTO.',
        '2. Łącz twarde dane z Bazy Wiedzy Firmy i Konfiguratora Tally z aktualnymi informacjami z Internetu (przepisy prawne, VAT, prawo budowlane, normy WT2021).',
        '3. FORMATOWANIE ODPOWIEDZI (answer): Stosuj czytelny Markdown: krótkie sekcje `###`, wypunktowania, **pogrubienia kluczowych liczb** oraz przy porównaniach/kosztorysach/VAT przejrzyste tabele Markdown (`| Parametr | Wartość | Uwagi |`).',
        '4. W polu citedTileIds podaj dokładne wartości TILE_ID kafelków z bazy, z których skorzystałeś.',
        '5. W polu webFactsUsed wypisz 1-4 konkretne fakty/przepisy zaczerpnięte z Internetu (lub pustą tablicę, jeśli nie były potrzebne).',
        '6. Twoim towarzyszem w aplikacji jest Kotek Inżynier AI ("Mruczek BizOps") — wygeneruj zwięzły mascotTip (max 12 słów) i dobierz mascotMood.',
        '',
        '=== BAZA WIEDZY FIRMY ===',
        knowledgeContext,
        ...(liveTally ? ['', `=== ${liveTally.contextText}`] : []),
        ...(liveWeb.summary
          ? [
              '',
              '=== AKTUALNA WIEDZA Z INTERNETU (GOOGLE SEARCH LIVE) ===',
              liveWeb.summary,
              ...(liveWeb.sources.length > 0
                ? [
                    '',
                    'DOSTĘPNE LINKI ŹRÓDŁOWE (użytkownik zobaczy je jako klikalne karty poniżej odpowiedzi):',
                    ...liveWeb.sources.map((s) => `- ${s.title} (${s.domain || 'www'}): ${s.uri}`),
                  ]
                : []),
            ]
          : []),
      ].join('\n');

      const geminiContents = messages.slice(-12).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '') }],
      }));

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: geminiContents,
        generationConfig: {
          temperature: 0.25,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              answer: { type: 'STRING' },
              citedTileIds: { type: 'ARRAY', items: { type: 'STRING' } },
              webFactsUsed: { type: 'ARRAY', items: { type: 'STRING' } },
              confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
              suggestedFollowUps: { type: 'ARRAY', items: { type: 'STRING' } },
              mascotMood: { type: 'STRING', enum: ['happy', 'thinking', 'alert', 'curious'] },
              mascotTip: { type: 'STRING' },
            },
            required: [
              'answer',
              'citedTileIds',
              'webFactsUsed',
              'confidence',
              'suggestedFollowUps',
              'mascotMood',
              'mascotTip',
            ],
          },
        },
      });

      const parsed = parseGeminiJson<Record<string, unknown>>(result.text);
      if (typeof parsed.replyBody === 'string') {
        parsed.replyBody = formatStructuredReplyText(parsed.replyBody);
      }
      sendJson(res, 200, {
        ...parsed,
        webSources: liveWeb.sources,
        searchQueries: liveWeb.searchQueries,
        contextStats,
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

      const { contextText: knowledgeContext, stats: contextStats } = compileSmartKnowledgeContext(
        tiles,
        'internal',
        `${fileName} ${documentText.slice(0, 1500)}`,
        12
      );

      const systemText = [
        `Jesteś starszym audytorem operacyjnym i AI Automation Engine dla firmy "${companyName}" (${companyIndustry}).`,
        'Przeanalizuj przesłany dokument (kosztorys, zapytanie klienta, faktura, notatka głosowa z terenu, specyfikacja) pod kątem zgodności z wewnętrzną Bazą Wiedzy Firmy.',
        'Zidentyfikuj wszystkie kluczowe parametry, wykryj braki formalne, błędy (np. błędna stawka VAT 8%/23%, brak MPP powyżej 15 000 zł, niekompletne wymogi techniczne/logistyczne, rozjazd budżetu) i wystaw ocenę kompletności score (0-100).',
        BUILDING_TYPOLOGY_DETECTION,
        REPLY_STRUCTURE_COMMAND,
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
          maxOutputTokens: 4096,
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
      if (typeof parsed.recommendedReplyBody === 'string') {
        parsed.recommendedReplyBody = formatStructuredReplyText(parsed.recommendedReplyBody);
      }
      sendJson(res, 200, {
        ...parsed,
        contextStats,
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

      const { contextText: knowledgeContext } = compileSmartKnowledgeContext(
        tiles,
        'internal',
        `${inputTitle} ${inputText.slice(0, 1500)}`,
        10
      );

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

    if (action === 'tally_extract_and_quote') {
      const clientMessage = String(body.clientMessage || '').trim();
      const advisorNotes = String(body.advisorNotes || '').trim();
      const threadHistory = Array.isArray(body.threadHistory)
        ? (body.threadHistory as Array<{ role?: string; text?: string }>).filter((t) => t && t.text)
        : [];
      const tallyFormId = String(body.tallyFormId || 'dWO4Oq');

      if (!clientMessage && threadHistory.length === 0) {
        sendJson(res, 400, { error: 'Wklej treść wiadomości lub wybierz czat z historią rozmowy.' });
        return;
      }

      const [extraction, liveTallyData] = await Promise.all([
        extractTallyParamsFromConversation(apiKey, threadHistory, clientMessage, advisorNotes, 14_000),
        getLiveTallyData(tallyFormId, true),
      ]);
      const quote = evaluateTallyQuoteFromLiveData(extraction.input, liveTallyData);

      sendJson(res, 200, {
        success: true,
        quote,
        usage: extraction.usage,
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
      const followUpDaysSilent =
        typeof body.followUpDaysSilent === 'number' && body.followUpDaysSilent > 0
          ? body.followUpDaysSilent
          : 0;

      if (!clientMessage) {
        sendJson(res, 400, { error: 'Wklej treść wiadomości lub zapytania od klienta.' });
        return;
      }

      const useTallyConfig = body.useTallyConfig !== false;
      const tallyFormId = String(body.tallyFormId || 'dWO4Oq');
      const lockedTallyQuote =
        body.lockedTallyQuote && typeof body.lockedTallyQuote === 'object'
          ? (body.lockedTallyQuote as TallyQuoteEvaluation)
          : null;

      const { contextText: knowledgeContext, stats: contextStats } = compileSmartKnowledgeContext(
        tiles,
        'internal',
        `${clientMessage} ${advisorNotes}`,
        8
      );
      const convoForQuote = `${threadHistory.map((t) => t.text).join(' ')} ${clientMessage} ${advisorNotes}`;
      const shouldAutoRunTallyEngine =
        !lockedTallyQuote &&
        useTallyConfig &&
        includeMiniQuote &&
        /(dom|metr|m2|m²|wycen|cen|koszt|fundament|piętr|pietr|parter|poddasz|kominek|łazienk|lazienk|kuchni|taras|dewelopersk|norvil|dostaw|tally|budżet|budzet|kwot|pln|zł)/i.test(
          convoForQuote
        );

      const [liveWeb, liveTallyData, autoExtracted] = await Promise.all([
        useWebKnowledge
          ? fetchLiveWebContext(apiKey, companyIndustry, clientMessage)
          : Promise.resolve({ summary: '', sources: [], searchQueries: [] }),
        useTallyConfig ? getLiveTallyData(tallyFormId, false) : Promise.resolve(null),
        shouldAutoRunTallyEngine
          ? extractTallyParamsFromConversation(apiKey, threadHistory, clientMessage, advisorNotes, 7_500)
          : Promise.resolve(null),
      ]);

      const liveTally = liveTallyData
        ? { contextText: liveTallyData.contextText, formName: liveTallyData.formName }
        : null;

      const activeTallyQuote: TallyQuoteEvaluation | null =
        lockedTallyQuote ||
        (autoExtracted && liveTallyData
          ? evaluateTallyQuoteFromLiveData(autoExtracted.input, liveTallyData)
          : null);

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
          ? 'FORMAT KANAŁU: Wiadomość WhatsApp / SMS — zwięzła, czytelna, podzielona na krótkie akapity lub wypunktowanie (KAŻDY punktor • od NOWEJ linii \\n!), bez długich wstępów i bez formalnej stopki.'
          : 'FORMAT KANAŁU: Pełny profesjonalny e-mail biznesowy gotowy do wysłania. Stosuj przejrzysty podział na sekcje z pustą linią (\\n\\n) i punktory „•” ZAWSZE każdy w NOWEJ LINII (\\n• ).';

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
        'Twoim zadaniem jest przygotowanie kompletnej, gotowej do wysłania odpowiedzi na wklejone zapytanie klienta, eliminującej ryzyka prawne i oszczędzającej doradcy 90% czasu pracy.',
        followUpDaysSilent > 0
          ? `TRYB FOLLOW-UP PO CISZY (${followUpDaysSilent} dni od ostatniej wiadomości): Klient jeszcze nie odpowiedział na poprzednią ofertę/wiadomość z historii wątku. Napisz uprzejmy, nienachalny, konkretny follow-up: nawiąż krótko do wysłanego wcześniej zakresu/tematu, dopytaj czy pojawiły się pytania techniczne lub finansowe, wspomnij o aktualnej dostępności terminów produkcyjnych/konsultacji (bez sztucznej presji) i zaproponuj jedno proste działanie (krótka rozmowa 10 min lub odpowiedź „TAK/NIE”). Temat zacznij od „Re:” lub krótkiego przypomnienia.`
          : '',
        toneInstruction,
        channelInstruction,
        replyLangInstruction,
        NEGATIVE_CONSTRAINTS_CLIENT,
        BUILDING_TYPOLOGY_DETECTION,
        REPLY_STRUCTURE_COMMAND,
        signatureLines
          ? `PODPIS DORADCY: Zakończ treść maila (replyBody) dokładnie poniższym podpisem:\n${signatureLines}`
          : '',
        includeMiniQuote
          ? activeTallyQuote && activeTallyQuote.breakdown.length > 0
            ? [
                'OBOWIĄZKOWY JAWNY KOSZTORYS WYLICZONY PRZEZ SILNIK TALLY (dWO4Oq) — NIE UKRYWAJ CEN ANI NIE ZMIENIAJ TYCH LICZB:',
                'Została wykonana kalkulacja na żywo z oficjalnego konfiguratora Tally na bazie dotychczasowych ustaleń klienta.',
                'W treści wiadomości (replyBody) JAWNIE i CZYTELNIE wypisz w osobnych punktorach każdą pozycję z poniższej wyceny (np. `• Dom ...: 315 000 zł netto`, `• Łazienka: 14 000 zł netto`, `• Kominek: 9 500 zł netto`), podsumuj NETTO, VAT i BRUTTO, a na końcu grzecznie zapytaj o brakujące pozycje z poniższej listy Tally:',
                '',
                activeTallyQuote.formattedQuoteBlock,
                activeTallyQuote.missingQuestions.length > 0
                  ? `\nBRAKUJĄCE PYTANIA Z KONFIGURATORA TALLY (warto dopytać klienta, żeby doprecyzować kosztorys):\n${activeTallyQuote.missingQuestions.map((q) => `- ${q}`).join('\n')}`
                  : '',
              ].join('\n')
            : [
                'MINI-KALKULACJA I ŚMIAŁE WYCENIANIE Z KONFIGURATORA TALLY (dWO4Oq) — STANDARD EXECUTIVE:',
                'Jeśli klient pyta o cenę, budżet, wycenę domu (parterowy ×1.0, z poddaszem ×1.5, piętrowy ×2.0), fundamenty (słupy 350 / ławy 600 / płyta 750), standard Deweloperski vs NORVIL lub dodatki — ŚMIAŁO korzystaj z sekcji OFICJALNY LIVE CENNIK Z KONFIGURATORA TALLY poniżej i JAWNIE wypunktuj każdą pozycję osobno (dom + fundament + łazienka + kominek + transport + NETTO + VAT + BRUTTO):',
                activeTallyQuote && activeTallyQuote.missingQuestions.length > 0
                  ? `• Brakujące dane do wyceny w Tally: ${activeTallyQuote.missingQuestions.slice(0, 5).join('; ')}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n')
          : '',
        includedLinks.length > 0
          ? `LINKI DO MATERIAŁÓW: Wpleć naturalnie w treść odpowiedzi (replyBody) następujące linki dla klienta:\n${includedLinks.map((l) => `- ${l.label}: ${l.url}`).join('\n')}`
          : '',
        'ANALIZA KONTAKTU I SYGNAŁÓW ZAKUPOWYCH: Wyciągnij z wiadomości klienta e-mail (detectedRecipientEmail, lub "" jeśli brak) oraz telefon (detectedRecipientPhone, lub "" jeśli brak). Oceń temperaturę leada (buyingSignal.temperature: HOT / WARM / COLD), wykryty typ obiektu/sprawy (uwzględnij w summaryOfInquiry oraz w internalAdvisorTip — np. „Typ: Dom całoroczny WT2021 vs Rekreacyjny vs B2B”) oraz obiekcje klienta.',
        useWebKnowledge
          ? 'TRYB HYBRYDOWY (BAZA WIEDZY + LIVE KONFIGURATOR TALLY + LIVE GOOGLE SEARCH): Połącz twarde dane z Bazy Wiedzy Firmy i LIVE stawek Konfiguratora Tally (dWO4Oq) (nie ujawniając poufnych marż [WEWNĘTRZNY]) z aktualnymi wynikami Google Search.'
          : 'TRYB ŚCISŁEJ BAZY WIEDZY + LIVE TALLY: Opieraj się wyłącznie na Bazie Wiedzy Firmy oraz LIVE stawkach Konfiguratora Tally (dWO4Oq) bez poufnych notatek wewnętrznych.',
        '',
        '=== BAZA WIEDZY FIRMY ===',
        knowledgeContext,
        ...(liveTally ? ['', `=== ${liveTally.contextText}`] : []),
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
      if (typeof parsed.replyBody === 'string') {
        parsed.replyBody = formatStructuredReplyText(parsed.replyBody);
      }
      sendJson(res, 200, {
        ...parsed,
        tallyQuote: activeTallyQuote || undefined,
        webSources: liveWeb.sources,
        searchQueries: liveWeb.searchQueries,
        contextStats,
        model: result.model || GEMINI_MODEL,
        keySource: source,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    if (action === 'translate_reply') {
      const subject = String(body.subject || '').trim();
      const bodyText = String(body.body || '').trim();
      const targetLanguage = String(body.targetLanguage || 'pl').toLowerCase();

      if (!bodyText) {
        sendJson(res, 400, { error: 'Brak treści odpowiedzi do przetłumaczenia.' });
        return;
      }

      const targetDesc =
        targetLanguage === 'en'
          ? 'Business English (profesjonalny język angielski B2B)'
          : targetLanguage === 'no'
            ? 'Norwegian (język norweski Bokmål)'
            : targetLanguage === 'de'
              ? 'Business German (język niemiecki B2B)'
              : 'Polish (naturalny, profesjonalny język polski B2B)';

      const systemText = [
        `Jesteś precyzyjnym tłumaczem biznesowym B2B. Przetłumacz poniższy temat oraz treść wiadomości 1:1 na język docelowy: ${targetDesc}.`,
        'ZASADY KRYTYCZNE (ZERO ZMIAN MERYTORYCZNYCH):',
        '1. ZACHOWAJ IDENTYCZNE wszystkie liczby, ceny, stawki VAT (np. 8%, 23%), metraże, daty, adresy URL, nazwy modeli i dane kontaktowe.',
        '2. ZACHOWAJ IDENTYCZNĄ strukturę i podział na sekcje: powitanie od nowej linii, każdy punktor „•” od nowej linii, punkty numerowane „1.”, „2.” od nowej linii oraz stopka podpisu na dole.',
        '3. Nie dopisuj nowych akapitów, nie skracaj oferty i nie zmieniaj sensu biznesowego — przetłumacz wiernie i elegancko.',
      ].join('\n');

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `TEMAT:\n${subject || '(brak tematu)'}\n\nTREŚĆ WIADOMOŚCI:\n${bodyText}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 3072,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              subject: { type: 'STRING' },
              replyBody: { type: 'STRING' },
            },
            required: ['subject', 'replyBody'],
          },
        },
      });

      const parsed = parseGeminiJson<{ subject?: string; replyBody?: string }>(result.text);
      const formattedBody = formatStructuredReplyText(parsed.replyBody || bodyText);

      sendJson(res, 200, {
        success: true,
        subject: (parsed.subject || subject).trim(),
        replyBody: formattedBody,
        targetLanguage,
        model: result.model || GEMINI_MODEL,
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

      const { contextText: knowledgeContext } = compileSmartKnowledgeContext(
        tiles,
        'internal',
        `${docAText.slice(0, 1000)} ${docBText.slice(0, 1000)}`,
        10
      );

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
      // Dla audytu spójności zawsze ładujemy całą aktywną bazę (puste queryText)
      const { contextText: knowledgeContext } = compileSmartKnowledgeContext(tiles, 'internal', '', 100);

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
      const ingestMode =
        body.ingestMode === 'book' || body.ingestMode === 'scan_pages'
          ? body.ingestMode
          : 'standard';
      const chunkIndex = typeof body.chunkIndex === 'number' ? body.chunkIndex : undefined;
      const totalChunks = typeof body.totalChunks === 'number' ? body.totalChunks : undefined;
      const chapterHint = typeof body.chapterHint === 'string' ? body.chapterHint.trim() : '';
      const existingTileTitles = Array.isArray(body.existingTileTitles)
        ? body.existingTileTitles.map((x) => String(x)).filter(Boolean).slice(0, 80)
        : [];
      const pageImages = Array.isArray(body.pageImages)
        ? (body.pageImages as Array<{
            pageNum?: number;
            pageNumber?: number;
            base64?: string;
            mimeType?: string;
            dimensionsLabel?: string;
            label?: string;
          }>).filter((p) => p && typeof p.base64 === 'string' && p.base64.length > 0)
        : [];

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
            .slice(0, 24000);
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

      if (!rawText && !fileBase64 && pageImages.length === 0) {
        sendJson(res, 400, { error: 'Wklej tekst, podaj link URL lub załącz plik, z którego AI ma się nauczyć nowej wiedzy.' });
        return;
      }

      const isDeepBookMode =
        ingestMode === 'book' ||
        ingestMode === 'scan_pages' ||
        rawText.length > 9000 ||
        pageImages.length > 1;

      const chunkMeta =
        totalChunks && chunkIndex !== undefined
          ? `Fragment ${chunkIndex + 1} z ${totalChunks}${chapterHint ? ` (Sekcja/Rozdział: "${chapterHint}")` : ''}.`
          : chapterHint
            ? `Sekcja/Rozdział: "${chapterHint}".`
            : '';

      const dedupInstruction =
        existingTileTitles.length > 0
          ? `JUŻ ISTNIEJĄCE TYTUŁY KAFELKÓW (NIE powielaj identycznych tematów, wyodrębniaj tylko NOWE lub istotnie pogłębione zasady): ${existingTileTitles.join(' | ')}`
          : '';

      const systemText = [
        `Jesteś głównym architektem i redaktorem Bazy Wiedzy AI dla firmy "${companyName}".`,
        isDeepBookMode
          ? [
              'TRYB STRUKTURYZACJI KSIĄŻKI / OBSZERNEGO DOKUMENTU / RYSUNKÓW:',
              '1. Wyodrębnij z przekazanego fragmentu od 3 do 8 kompletnych, gęstych w konkrety, tematycznie uporządkowanych kafelków wiedzy (Knowledge Tiles).',
              '2. ZACHOWAJ WSZYSTKIE konkretne liczby, normy, ceny, wymiary, parametry techniczne, procedury krok po kroku, wzory i ograniczenia prawne — bez lania wody.',
              '3. Tytuł kafelka niech będzie konkretny i łatwy do wyszukania (jeśli pasuje kontekst rozdziału lub książki, uwzględnij krótki prefiks tematyczny).',
              '4. Przypisz precyzyjnie jedną z kategorii: "Książka / Podręcznik", "Technologia", "Procedury", "Sprzedaż", "Finanse & VAT", "Logistyka", "Oferta", "Wewnętrzne".',
              '5. Reguły krytyczne / twarde zakazy / wymogi prawne oznacz jako priority: "critical".',
            ].join('\n')
          : 'Przekształć dostarczony surowy materiał (notatki, PDF, regulamin, cennik, mail) w 1 do 4 czystych, konkretnych i dobrze ustrukturyzowanych kafelków wiedzy (Knowledge Tiles), które zasilą firmowego bota. Każdy kafelek powinien mieć zwięzły tytuł, dopasowaną kategorię (np. Oferta, Finanse & VAT, Technologia, Logistyka, Procedury, Sprzedaż, Książka / Podręcznik), poziom widoczności (public lub internal), priorytet (standard lub critical) oraz konkretną treść.',
        chunkMeta,
        dedupInstruction,
        langInstruction,
      ]
        .filter(Boolean)
        .join('\n\n');

      const parts: Array<Record<string, unknown>> = [];
      if (fileBase64 && fileMimeType) {
        parts.push({ inlineData: { mimeType: fileMimeType, data: fileBase64 } });
      }
      if (pageImages.length > 0) {
        for (const img of pageImages) {
          const pNum = img.pageNum ?? img.pageNumber ?? '?';
          const pDims = img.dimensionsLabel ?? img.label ?? 'niestandardowy wymiar';
          parts.push({
            text: `Strona PDF #${pNum} (${pDims}):`,
          });
          parts.push({
            inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.base64 },
          });
        }
      }
      parts.push({
        text: `Źródło: ${fileName}${chunkMeta ? ` | ${chunkMeta}` : ''}\n\n${
          rawText || 'Przeanalizuj dokładnie załączone strony dokumentu / skanu i ustrukturyzuj całą zawartą wiedzę w uporządkowane kafelki.'
        }`,
      });

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: isDeepBookMode ? 8192 : 4096,
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

    if (action === 'auto_distill') {
      const companyName = String(body.companyName || 'Firma');
      const companyIndustry = String(body.companyIndustry || 'Operacje B2B');
      const recentDialogs = (Array.isArray(body.dialogs) ? body.dialogs : []) as Array<{
        question: string;
        answer: string;
        webFactsUsed?: string[];
      }>;
      const existingTiles = (Array.isArray(body.knowledgeTiles) ? body.knowledgeTiles : []) as KnowledgeTileInput[];

      if (recentDialogs.length === 0) {
        sendJson(res, 400, { error: 'Brak zapytań do analizy i nauki.' });
        return;
      }

      const existingTopics = existingTiles.map((t) => t.title).join(', ');
      const dialogsText = recentDialogs
        .map(
          (d, idx) =>
            `[Dialog #${idx + 1}]\nPYTANIE: ${d.question}\nODPOWIEDŹ: ${d.answer}\nFAKTY Z INTERNETU: ${
              d.webFactsUsed?.join('; ') || 'brak'
            }`
        )
        .join('\n\n---\n\n');

      const systemText = [
        `Jesteś Głównym Analitykiem i Architektem Samouczącej się Bazy Wiedzy AI (Continuous Auto-Learning) dla firmy "${companyName}" (${companyIndustry}).`,
        'Twoim zadaniem jest przeanalizowanie ostatnich zapytań użytkowników i odpowiedzi.',
        'Wykryj powtarzające się pytania, nową wiedzę z Internetu (przepisy, standardy, kalkulacje, parametry) lub luki, których nie ma jeszcze w istniejącej Bazie Wiedzy firmy.',
        `Istniejące już kafelki w bazie wiedzy: [${existingTopics}]. NIE DUBLUJ ich.`,
        'Jeśli w dialogach pojawiła się wartościowa wiedza, zsyntetyzuj ją w 1-3 NOWE, konkretne kafelki wiedzy.',
        'Wszystkie nowo wyuczone kafelki przypisz do kategorii "Wyuczone przez AI".',
        langInstruction,
      ].join('\n');

      const result = await callGemini(apiKey, {
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: `PRZEANALIZUJ PONIŻSZE DIALOGI:\n\n${dialogsText}` }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              learningSummary: { type: 'STRING' },
              newTilesDiscovered: {
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
            required: ['learningSummary', 'newTilesDiscovered'],
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
