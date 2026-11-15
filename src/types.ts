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
}

export interface AdvisorSignature {
  enabled: boolean;
  name: string;
  role: string;
  phone: string;
  email: string;
  companyLine: string;
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
  webFactsUsed?: string[];
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

export interface InboxFeedItem {
  id: string;
  source: 'gmail' | 'whatsapp' | 'meta';
  senderName: string;
  senderContact: string;
  preview: string;
  fullText: string;
  receivedAt: string;
}
