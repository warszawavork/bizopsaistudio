export type AppTheme = 'light' | 'warm' | 'dark';

export type AppTab =
  | 'responder'
  | 'audit'
  | 'knowledge'
  | 'chat'
  | 'workflow'
  | 'pipeline'
  | 'ops'
  | 'architecture';

export interface WebSource {
  title: string;
  uri: string;
  domain?: string;
  snippet?: string;
}

export interface ContextStats {
  totalActiveTiles: number;
  selectedTilesCount: number;
  criticalCount: number;
  omittedTilesCount: number;
  tokensSavedEstimate: number;
}

export interface AdvisorSignature {
  enabled: boolean;
  name: string;
  role: string;
  phone: string;
  email: string;
  companyLine: string;
}

export interface TallyQuoteInput {
  areaM2: number | null;
  areaIsTotalUsable?: boolean;
  areaEstimatedByBot?: boolean;
  floorEstimatedByBot?: boolean;
  quantity?: number;
  standard: 'deweloperski' | 'norvil' | null;
  insulation: 'letniskowy' | 'caloroczny' | null;
  floorType: 'parter' | 'poddasze' | 'pietro' | null;
  foundation: 'brak' | 'slupy' | 'lawy' | 'plyta' | null;
  architectPkg: 'none' | 'letniskowy' | 'mieszkalny_70' | 'mieszkalny_120' | 'premium' | null;
  underfloorHeating: boolean | null;
  heatersCount: number;
  acCount: number;
  bathroom: 'none' | 'podstawowy' | 'premium' | null;
  coveredTerraceM2: number;
  openTerraceM2: number;
  deliveryKm: number;
  deliveryModules: number;
  kitchenPkg: 'none' | 'umeblowanie' | 'kuchnia' | 'kuchnia_meble' | null;
  fireplace: 'none' | 'przygotowanie' | 'koza' | null;
  roofAngleMpzp: boolean | null;
  vatRate: 8 | 23;
}

export interface TallyQuoteBreakdownItem {
  key: string;
  label: string;
  formula: string;
  netPln: number;
  isDefaultAssumed?: boolean;
}

export interface TallyQuoteEvaluation {
  formId: string;
  formName: string;
  liveFetched: boolean;
  evaluatedAt: string;
  input: TallyQuoteInput;
  breakdown: TallyQuoteBreakdownItem[];
  totalNetPln: number;
  perUnitNetPln: number;
  quantity: number;
  vatRate: 8 | 23;
  vatPln: number;
  totalGrossPln: number;
  altVatGross8Pln: number;
  altVatGross23Pln: number;
  isIllustrativeEstimate: boolean;
  assumedSummary: string;
  missingQuestions: string[];
  formattedQuoteBlock: string;
}

export interface SalesReplyResult {
  subject: string;
  replyBody: string;
  detectedClientName: string;
  detectedLanguage: string;
  summaryOfInquiry: string;
  companyFactsUsed: string[];
  webAndMarketFactsUsed: string[];
  webSources?: WebSource[];
  searchQueries?: string[];
  contextStats?: ContextStats;
  citedTileIds: string[];
  followUpQuestionsToClient: string[];
  internalAdvisorTip: string;
  detectedRecipientEmail?: string;
  detectedRecipientPhone?: string;
  buyingSignal?: {
    temperature: 'HOT' | 'WARM' | 'COLD';
    summary: string;
    detectedObjections: string[];
  };
  tallyQuote?: TallyQuoteEvaluation;
  estimatedTimeSavedMinutes: number;
  latencyMs: number;
  model: string;
  usage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
}

export type AppLanguage = 'pl' | 'en';

export type ChatPerspective = 'client' | 'internal';

export type MascotMood = 'idle' | 'happy' | 'thinking' | 'alert' | 'curious';

export type CatAccessory = 'engineer' | 'hardhat' | 'executive' | 'classic';

export interface DocComparisonResult {
  overallVerdict: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  differences: Array<{
    topic: string;
    docA: string;
    docB: string;
    impact: 'neutral' | 'warning' | 'critical';
  }>;
  hiddenRisks: string[];
  recommendedAction: string;
  latencyMs: number;
  usage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
}

export interface KnowledgeConsistencyResult {
  score: number;
  summary: string;
  conflicts: Array<{
    severity: 'warning' | 'critical';
    title: string;
    detail: string;
    affectedTileTitles: string[];
  }>;
  gaps: string[];
  latencyMs: number;
  usage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
}

export interface KnowledgeTile {
  id: string;
  title: string;
  category: string;
  visibility: 'public' | 'internal';
  priority?: 'standard' | 'critical';
  content: string;
  enabled: boolean;
  updatedAt: string;
}

export interface DemoAuditScenario {
  id: string;
  label: string;
  badge: string;
  fileName: string;
  documentText: string;
}

export interface CrmDeal {
  id: string;
  title: string;
  client: string;
  valuePln: number;
  stage: 'lead' | 'audited' | 'quote' | 'won';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  score?: number;
  tags: string[];
  notes: string;
  createdAt: string;
}

export interface WorkflowRunResult {
  id: string;
  inputTitle: string;
  createdAt: string;
  latencyMs: number;
  model: string;
  usage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
  classifier: {
    category: string;
    intent: string;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    estimatedValuePln: number;
    clientName: string;
    keyEntities: Array<{ name: string; value: string }>;
  };
  auditor: {
    complianceScore: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    matchedRules: string[];
    policyFlags: Array<{ severity: 'ok' | 'warning' | 'critical'; message: string }>;
  };
  executor: {
    recommendedStage: 'lead' | 'audited' | 'quote' | 'won';
    actionChecklist: string[];
    clientReplyDraft: string;
    webhookPayload: Record<string, unknown>;
  };
  mascotTip: string;
}

export interface IndustryPreset {
  id: string;
  name: string;
  shortName: string;
  industry: string;
  description: string;
  accentLabel: string;
  suggestedQuestions: {
    client: string[];
    internal: string[];
  };
  defaultTiles: KnowledgeTile[];
  demoScenarios: DemoAuditScenario[];
  defaultDeals: CrmDeal[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  perspective: ChatPerspective;
  citedTileIds?: string[];
  webSources?: WebSource[];
  searchQueries?: string[];
  webFactsUsed?: string[];
  contextStats?: ContextStats;
  confidence?: 'high' | 'medium' | 'low';
  suggestedFollowUps?: string[];
  latencyMs?: number;
  tokens?: number;
}

export interface AuditExtractedField {
  label: string;
  value: string;
  status: 'ok' | 'warning' | 'missing';
}

export interface AuditFinding {
  severity: 'ok' | 'warning' | 'critical';
  title: string;
  detail: string;
  ruleRef: string;
}

export interface AuditResult {
  id: string;
  fileName: string;
  createdAt: string;
  documentType: string;
  clientOrSender: string;
  summary: string;
  score: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  extractedFields: AuditExtractedField[];
  findings: AuditFinding[];
  recommendedReplySubject: string;
  recommendedReplyBody: string;
  webhookSummaryTags: string[];
  mascotMood: 'happy' | 'alert' | 'thinking';
  mascotTip: string;
  latencyMs: number;
  usage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
}

export interface AiOpsLogEntry {
  id: string;
  timestamp: string;
  action: 'responder' | 'audit' | 'chat' | 'workflow' | 'ingest' | 'webhook' | 'test';
  presetName: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  status: 'success' | 'error';
  summary: string;
}

export interface WebhookConfig {
  url: string;
  autoSendOnHighRisk: boolean;
  simulateWhenEmpty: boolean;
}

export interface WebhookSendResult {
  ok: boolean;
  simulated: boolean;
  status: number;
  echoId?: string;
  receivedAt: string;
  latencyMs: number;
  responseText: string;
  payloadSizeBytes?: number;
  error?: string;
}

export interface IntegrationsConfig {
  gmail: {
    enabled: boolean;
    mode: 'mailto' | 'webhook';
    webhookUrl: string;
    senderEmail: string;
  };
  whatsapp: {
    enabled: boolean;
    phoneNumberId: string;
    accessToken: string;
    verifyToken: string;
    defaultRecipient: string;
  };
  metaBusiness: {
    enabled: boolean;
    pageId: string;
    accessToken: string;
    webhookUrl: string;
  };
}

export interface QuickLinkItem {
  id: string;
  label: string;
  url: string;
}

export interface ObjectionPlaybookItem {
  id: string;
  label: string;
  category: string;
  script: string;
}

export interface ReplyHistoryItem {
  id: string;
  client: string;
  subject: string;
  createdAt: string;
  reply: SalesReplyResult;
}

export interface ClientChatMessage {
  id: string;
  role: 'client' | 'advisor';
  text: string;
  subject?: string;
  createdAt: string;
  reply?: SalesReplyResult;
}

export interface ClientChatThread {
  id: string;
  clientName: string;
  clientContact?: string;
  channel?: 'email' | 'sms' | 'whatsapp' | 'tally';
  starred: boolean;
  temperature?: 'HOT' | 'WARM' | 'COLD';
  createdAt: string;
  updatedAt: string;
  messages: ClientChatMessage[];
}

export interface InboxFeedItem {
  id: string;
  source: 'gmail' | 'whatsapp' | 'meta' | 'tally' | 'webhook';
  senderName: string;
  senderContact: string;
  preview: string;
  fullText: string;
  receivedAt: string;
  handled?: boolean;
  handledBy?: string;
}

export type WorkspaceDataKey = 'deals' | 'quick_links' | 'objections' | 'reply_history' | 'chat_threads';
