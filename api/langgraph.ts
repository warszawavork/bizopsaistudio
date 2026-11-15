import type { IncomingMessage, ServerResponse } from 'node:http';
import { StateGraph, END, START, Annotation } from '@langchain/langgraph';

const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function getApiKey(customKey?: string): { key: string; source: 'custom_key' | 'env_key' } {
  if (customKey && typeof customKey === 'string' && customKey.trim().length > 10) {
    return { key: customKey.trim(), source: 'custom_key' };
  }
  const envKey =
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY;
  if (!envKey) {
    throw new Error('Brak klucza GEMINI_API_KEY na serwerze.');
  }
  return { key: envKey.trim(), source: 'env_key' };
}

async function callGeminiRaw(apiKey: string, prompt: string, systemInstruction?: string): Promise<string> {
  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API Error: HTTP ${res.status} - ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.trim();
}

// 1. Definicja Stanu LangGraph (State Annotation)
const WorkflowStateAnnotation = Annotation.Root({
  task: Annotation<string>(),
  knowledgeContext: Annotation<string>(),
  plan: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  draft: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  critique: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  iterations: Annotation<number>({
    reducer: (curr, add) => curr + add,
    default: () => 0,
  }),
  status: Annotation<'planning' | 'drafting' | 'reviewing' | 'completed'>({
    reducer: (_, next) => next,
    default: () => 'planning',
  }),
  logs: Annotation<string[]>({
    reducer: (curr, next) => [...curr, ...next],
    default: () => [],
  }),
});

type WorkflowState = typeof WorkflowStateAnnotation.State;

// Tworzenie instancji StateGraph sterowanego przez LangGraph
export function buildLangGraphWorkflow(apiKey: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph: any = new StateGraph(WorkflowStateAnnotation)
    // Węzeł 1: Planner Agent (Analityk)
    .addNode('planner', async (state: WorkflowState) => {
      const sysPrompt = 'Jesteś Głównym Analitykiem Biznesowym. Przeanalizuj zadanie i kontekst wiedzy firmowej. Wypisz 3-4 kluczowe wytyczne dla handlowca.';
      const prompt = `ZADANIE: ${state.task}\n\nKONTEKST BAZY WIEDZY:\n${state.knowledgeContext}`;
      const plan = await callGeminiRaw(apiKey, prompt, sysPrompt);

      return {
        plan,
        status: 'drafting' as const,
        iterations: 1,
        logs: ['[LangGraph:Planner] Utworzono plan operacyjny i wytyczne merytoryczne.'],
      };
    })
    // Węzeł 2: Drafter Agent (Autor odpowiedzi)
    .addNode('drafter', async (state: WorkflowState) => {
      const sysPrompt = 'Jesteś Doświadczonym Doradcą Handlowym. Na bazie planu i bazy wiedzy napisz profesjonalną, konkretną propozycję dla klienta.';
      const feedback = state.critique ? `\nUWAGI KRYTYKA DO POPRAWY:\n${state.critique}` : '';
      const prompt = `ZADANIE: ${state.task}\n\nPLAN ANIALITYKA:\n${state.plan}\n\nBAZA WIEDZY:\n${state.knowledgeContext}${feedback}`;
      const draft = await callGeminiRaw(apiKey, prompt, sysPrompt);

      return {
        draft,
        status: 'reviewing' as const,
        logs: [`[LangGraph:Drafter] Wygenerowano wersję propozycji (iteracja ${state.iterations}).`],
      };
    })
    // Węzeł 3: Critic Agent (Audytor Spójności i Ryzyka)
    .addNode('critic', async (state: WorkflowState) => {
      const sysPrompt = `Jesteś Surowym Audytorem Zgodności Biznesowej i Prawnej.
Sprawdź, czy propozycja handlowa spełnia warunki:
1. Czy nie zmyśla cen ani terminów bez pokrycia w wiedzy?
2. Czy poprawnie podano status podatkowy VAT (8% lub 23%) i warunki wstępne?
Jeśli propozycja jest poprawna i bezpieczna, odpowiedz dokładnie jednym słowem: ZATWIERDZONE
Jeśli wykryjesz błędy lub ryzyko, wypisz krótko co poprawić.`;

      const prompt = `TREŚĆ OFERTY DO AUDYTU:\n${state.draft}\n\nBAZA WIEDZY FIRMY:\n${state.knowledgeContext}`;
      const critique = await callGeminiRaw(apiKey, prompt, sysPrompt);

      const isApproved = critique.toUpperCase().includes('ZATWIERDZONE');

      return {
        critique: isApproved ? 'Zatwierdzone bez uwag.' : critique,
        status: isApproved ? ('completed' as const) : ('drafting' as const),
        logs: [
          isApproved
            ? '[LangGraph:Critic] Propozycja spełnia żelazne zasady bezpieczeństwa (ZATWIERDZONA).'
            : `[LangGraph:Critic] Wykryto uwagi do poprawy: ${critique.slice(0, 100)}...`,
        ],
      };
    });

  // Połączenia (Edges)
  graph.addEdge(START, 'planner');
  graph.addEdge('planner', 'drafter');
  graph.addEdge('drafter', 'critic');

  // Krawędź warunkowa (Conditional Edge) - pętla korygująca
  graph.addConditionalEdges(
    'critic',
    (state: WorkflowState) => {
      // Jeśli zatwierdzone lub przekroczono max 2 iteracje, zakończ bieg
      if (state.status === 'completed' || state.iterations >= 2) {
        return 'end';
      }
      return 'refine';
    },
    {
      refine: 'drafter',
      end: END,
    }
  );

  return graph.compile();
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

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const { key } = getApiKey(typeof body.customKey === 'string' ? body.customKey : undefined);

    const task = String(body.task || 'Odpowiedź handlowa i wycena');
    const knowledgeContext = String(body.knowledgeContext || '');

    const startTime = Date.now();
    const app = buildLangGraphWorkflow(key);

    const finalState = await app.invoke({
      task,
      knowledgeContext,
      plan: '',
      draft: '',
      critique: '',
      iterations: 0,
      status: 'planning',
      logs: ['[LangGraph] Zainicjalizowano StateGraph z silnikiem Gemini 3.8 Flash.'],
    });

    const executionTimeMs = Date.now() - startTime;

    sendJson(res, 200, {
      success: true,
      framework: '@langchain/langgraph',
      version: '1.7.4',
      executionTimeMs,
      plan: finalState.plan,
      draft: finalState.draft,
      critique: finalState.critique,
      iterations: finalState.iterations,
      status: finalState.status,
      logs: finalState.logs,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('LangGraph Workflow Error:', errorMsg);
    sendJson(res, 500, { success: false, error: errorMsg });
  }
}
