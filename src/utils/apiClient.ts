import type {
  AdvisorSignature,
  AppLanguage,
  AuditResult,
  ChatPerspective,
  DocComparisonResult,
  IntegrationsConfig,
  KnowledgeConsistencyResult,
  KnowledgeTile,
  SalesReplyResult,
  WebhookSendResult,
  WorkflowRunResult,
} from '../types';

export const CUSTOM_KEY_STORAGE = 'bizops_custom_gemini_key_v1';
export const SIGNATURE_STORAGE = 'bizops_advisor_signature_v1';
export const INTEGRATIONS_STORAGE = 'bizops_integrations_v1';

const DEFAULT_INTEGRATIONS: IntegrationsConfig = {
  gmail: {
    enabled: true,
    mode: 'mailto',
    webhookUrl: '',
    senderEmail: '',
  },
  whatsapp: {
    enabled: false,
    phoneNumberId: '',
    accessToken: '',
    verifyToken: 'bizops-meta-verify',
    defaultRecipient: '',
  },
  metaBusiness: {
    enabled: false,
    pageId: '',
    accessToken: '',
    webhookUrl: '',
  },
};

export function getStoredIntegrationsConfig(): IntegrationsConfig {
  try {
    const raw = localStorage.getItem(INTEGRATIONS_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<IntegrationsConfig>;
      return {
        gmail: { ...DEFAULT_INTEGRATIONS.gmail, ...(parsed.gmail || {}) },
        whatsapp: { ...DEFAULT_INTEGRATIONS.whatsapp, ...(parsed.whatsapp || {}) },
        metaBusiness: { ...DEFAULT_INTEGRATIONS.metaBusiness, ...(parsed.metaBusiness || {}) },
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_INTEGRATIONS;
}

export function setStoredIntegrationsConfig(cfg: IntegrationsConfig): void {
  try {
    localStorage.setItem(INTEGRATIONS_STORAGE, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

const DEFAULT_SIGNATURE: AdvisorSignature = {
  enabled: true,
  name: 'Bogdan Liaskevich',
  role: 'Starszy Doradca Klienta / AI Automation',
  phone: '+48 500 000 000',
  email: 'kontakt@firma.pl',
  companyLine: 'Zespół Obsługi Inwestycji B2B',
};

export function getStoredAdvisorSignature(): AdvisorSignature {
  try {
    const raw = localStorage.getItem(SIGNATURE_STORAGE);
    if (raw) return { ...DEFAULT_SIGNATURE, ...(JSON.parse(raw) as Partial<AdvisorSignature>) };
  } catch {
    // ignore
  }
  return DEFAULT_SIGNATURE;
}

export function setStoredAdvisorSignature(sig: AdvisorSignature): void {
  try {
    localStorage.setItem(SIGNATURE_STORAGE, JSON.stringify(sig));
  } catch {
    // ignore
  }
}

export function getStoredCustomKey(): string {
  try {
    return localStorage.getItem(CUSTOM_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setStoredCustomKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(CUSTOM_KEY_STORAGE, key.trim());
    } else {
      localStorage.removeItem(CUSTOM_KEY_STORAGE);
    }
  } catch {
    // ignore storage errors
  }
}

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const customKey = getStoredCustomKey();
  if (customKey) {
    headers['x-custom-api-key'] = customKey;
  }
  return headers;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Błąd serwera HTTP ${response.status}`);
  }
  return data;
}

export async function testAiConnection(): Promise<{
  ok: boolean;
  model: string;
  keySource: string;
  reply: string;
  latencyMs: number;
}> {
  return postJson('/api/ai', { action: 'test' });
}

export async function sendChatQuery(params: {
  companyName: string;
  companyIndustry: string;
  perspective: ChatPerspective;
  language?: AppLanguage;
  knowledgeTiles: KnowledgeTile[];
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{
  answer: string;
  citedTileIds: string[];
  confidence: 'high' | 'medium' | 'low';
  suggestedFollowUps: string[];
  mascotMood: 'happy' | 'thinking' | 'alert' | 'curious';
  mascotTip: string;
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; candidatesTokens: number; totalTokens: number };
}> {
  return postJson('/api/ai', { action: 'chat', ...params });
}

export async function runDocumentAudit(params: {
  companyName: string;
  companyIndustry: string;
  language?: AppLanguage;
  knowledgeTiles: KnowledgeTile[];
  fileName: string;
  documentText?: string;
  fileBase64?: string;
  fileMimeType?: string;
}): Promise<
  Omit<AuditResult, 'id' | 'fileName' | 'createdAt'> & {
    model: string;
    keySource: string;
  }
> {
  return postJson('/api/ai', { action: 'audit', ...params });
}

export async function runAgentWorkflow(params: {
  companyName: string;
  companyIndustry: string;
  language?: AppLanguage;
  knowledgeTiles: KnowledgeTile[];
  inputTitle: string;
  inputText: string;
}): Promise<Omit<WorkflowRunResult, 'id' | 'inputTitle' | 'createdAt'>> {
  return postJson('/api/ai', { action: 'workflow', ...params });
}

export async function generateSalesReply(params: {
  companyName: string;
  companyIndustry: string;
  language?: AppLanguage;
  knowledgeTiles: KnowledgeTile[];
  clientMessage: string;
  advisorNotes?: string;
  tone: 'sales' | 'concise' | 'formal';
  channel: 'email' | 'sms';
  replyLanguage: 'auto' | 'pl' | 'en' | 'no' | 'de';
  useWebKnowledge: boolean;
  includeMiniQuote?: boolean;
  includedLinks?: Array<{ label: string; url: string }>;
  threadHistory?: Array<{ role: 'client' | 'advisor'; text: string }>;
  advisorSignature?: AdvisorSignature;
}): Promise<SalesReplyResult> {
  return postJson('/api/ai', { action: 'reply_assistant', ...params });
}

export async function runDocumentComparison(params: {
  companyName: string;
  language?: AppLanguage;
  knowledgeTiles: KnowledgeTile[];
  docAName: string;
  docAText: string;
  docBName: string;
  docBText: string;
}): Promise<DocComparisonResult> {
  return postJson('/api/ai', { action: 'compare_docs', ...params });
}

export async function runKnowledgeConsistencyCheck(params: {
  companyName: string;
  language?: AppLanguage;
  knowledgeTiles: KnowledgeTile[];
}): Promise<KnowledgeConsistencyResult> {
  return postJson('/api/ai', { action: 'consistency_check', ...params });
}

export async function runSmartIngest(params: {
  companyName: string;
  language?: AppLanguage;
  fileName: string;
  rawText?: string;
  sourceUrl?: string;
  fileBase64?: string;
  fileMimeType?: string;
}): Promise<{
  summaryNote: string;
  tiles: Array<{
    title: string;
    category: string;
    visibility: 'public' | 'internal';
    priority?: 'standard' | 'critical';
    content: string;
  }>;
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; candidatesTokens: number; totalTokens: number };
}> {
  return postJson('/api/ai', { action: 'ingest', ...params });
}

export async function sendToWebhook(params: {
  webhookUrl: string;
  simulate: boolean;
  payload: Record<string, unknown>;
}): Promise<WebhookSendResult> {
  return postJson('/api/webhook', params);
}

export async function testWhatsAppConnection(params: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ ok: boolean; displayPhoneNumber: string; verifiedName: string }> {
  return postJson('/api/integrations', { action: 'test_whatsapp', ...params });
}

export async function sendWhatsAppMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
}): Promise<{ ok: boolean; messageId: string | null; to: string }> {
  return postJson('/api/integrations', { action: 'send_whatsapp', ...params });
}

export async function testMetaConnection(params: {
  pageId: string;
  accessToken: string;
}): Promise<{ ok: boolean; id: string; name: string }> {
  return postJson('/api/integrations', { action: 'test_meta', ...params });
}

export async function sendGmailBridge(params: {
  webhookUrl: string;
  senderEmail?: string;
  to?: string;
  subject: string;
  body: string;
  company?: string;
}): Promise<{ ok: boolean; status: number }> {
  return postJson('/api/integrations', { action: 'send_gmail_bridge', ...params });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Nie udało się odczytać pliku.'));
    reader.readAsDataURL(file);
  });
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3.8));
}

export async function fetchCloudTiles(presetId: string): Promise<{ success: boolean; tiles: any[]; count: number }> {
  const res = await fetch(`/api/tiles?presetId=${encodeURIComponent(presetId)}`);
  if (!res.ok) throw new Error(`Błąd pobierania kafelków z chmury: HTTP ${res.status}`);
  return res.json();
}

export async function saveCloudTile(tile: any, presetId: string, authorName?: string): Promise<{ success: boolean; tile: any }> {
  return postJson('/api/tiles', { action: 'save', tile, presetId, authorName });
}

export async function saveBatchCloudTiles(tiles: any[], presetId: string, authorName?: string): Promise<{ success: boolean; count: number }> {
  return postJson('/api/tiles', { action: 'batch', tiles, presetId, authorName });
}

export async function deleteCloudTile(id: string): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`/api/tiles?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) return res.json();
  } catch {
    // fallback do POST
  }
  return postJson('/api/tiles', { action: 'delete', id });
}

export async function fetchCloudAiStats(): Promise<{
  success: boolean;
  stats: {
    todayRequests: number;
    todayTokens: number;
    avgLatency: number;
    minuteRequests?: number;
    minuteTokens?: number;
    dbSizeBytes?: number;
    maxStorageBytes?: number;
    tilesCount?: number;
    logsCount?: number;
  };
  logs: any[];
}> {
  const res = await fetch('/api/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function recordCloudAiLog(log: any): Promise<{ success: boolean }> {
  return postJson('/api/stats', log);
}

export async function clearOldCloudAiLogs(): Promise<{ success: boolean; message?: string }> {
  return postJson('/api/stats', { action: 'clear_old_logs' });
}
