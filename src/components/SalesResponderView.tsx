import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Check,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Flame,
  Globe,
  HelpCircle,
  History,
  Inbox,
  Lightbulb,
  Link2,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MicOff,
  PanelLeftOpen,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import type {
  AppLanguage,
  ClientChatMessage,
  ClientChatThread,
  CrmDeal,
  InboxFeedItem,
  IndustryPreset,
  KnowledgeTile,
  ObjectionPlaybookItem,
  QuickLinkItem,
  ReplyHistoryItem,
  SalesReplyResult,
  TallyQuoteEvaluation,
  WebSource,
} from '../types';
import {
  deleteCloudInboxItem,
  extractAndEvaluateTallyQuote,
  fetchCloudInbox,
  fetchCloudWorkspace,
  generateSalesReply,
  getStoredAdvisorSignature,
  getStoredIntegrationsConfig,
  ingestCloudInboxItem,
  markCloudInboxHandled,
  saveCloudWorkspaceKey,
  sendGmailBridge,
  sendWhatsAppMessage,
  translateSalesReply,
} from '../utils/apiClient';
import { copyRichEmailToClipboard, formatStructuredReplyText } from '../utils/emailExport';
import { idbGetWorkspaceItem, idbSaveWorkspaceItem } from '../utils/offlineDb';
import { exportSalesReplyToPdf, printCleanReportHtml } from '../utils/pdfExport';
import { formatPureTallyQuoteText, stitchReplyAndTallyQuote } from '../utils/tallyQuoteFormat';
import { ClientChatsSidebar } from './ClientChatsSidebar';
import { TallyConfiguratorModal } from './TallyConfiguratorModal';
import { WebSourcesPanel } from './WebSourcesPanel';

interface SalesResponderViewProps {
  preset: IndustryPreset;
  tiles: KnowledgeTile[];
  language: AppLanguage;
  latestReply: SalesReplyResult | null;
  authorName?: string;
  incomingMessage?: string | null;
  onClearIncomingMessage?: () => void;
  onReplyComplete: (reply: SalesReplyResult) => void;
  onOpenKnowledge: () => void;
  onCreateCrmDeal?: (deal: Omit<CrmDeal, 'id' | 'createdAt'>) => void;
  onSendWebhookPayload?: (payload: Record<string, unknown>, label: string) => Promise<void>;
  onQuickAddTile?: (tile: { title: string; category: string; content: string }) => void;
  onLogAiCall: (entry: {
    action: 'responder';
    latencyMs: number;
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    status: 'success' | 'error';
    summary: string;
  }) => void;
}

const REPLY_HISTORY_KEY = 'bizops_reply_history_v1';
const CHAT_THREADS_KEY = 'bizops_chat_threads_v1';
const ACTIVE_CHAT_KEY = 'bizops_active_chat_v1';
const QUICK_LINKS_KEY = 'bizops_quick_links_v1';
const OBJECTIONS_KEY = 'bizops_objections_playbook_v1';
const INBOX_FEED_KEY = 'bizops_unified_inbox_v1';

const DEFAULT_QUICK_LINKS: QuickLinkItem[] = [];

function formatInboxTime(raw: string): string {
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return raw;
  return new Date(ts).toLocaleString('pl-PL', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const DEFAULT_OBJECTIONS: ObjectionPlaybookItem[] = [
  {
    id: 'obj_price',
    label: 'Za drogo / Konkurencja ma taniej',
    category: 'Cena',
    script:
      'Podkreśl pełny standard wykonania (izolacja, certyfikowane materiały, brak ukrytych dopłat), policz koszt w przeliczeniu na lata użytkowania i zaproponuj wariant etapowy lub płatność w transzach.',
  },
  {
    id: 'obj_time',
    label: 'Zbyt długi termin realizacji',
    category: 'Termin',
    script:
      'Wyjaśnij, że produkcja halowa gwarantuje jakość niezależną od pogody i stałą cenę z umowy, oraz podaj najbliższe wolne okno montażowe z gwarancją terminu w kontrakcie.',
  },
  {
    id: 'obj_permit',
    label: 'Czy potrzebne pozwolenie / zgłoszenie?',
    category: 'Formalności',
    script:
      'Wytłumacz prosto procedurę dla powierzchni do 70 m² (zgłoszenie / uproszczona ścieżka) oraz zaznacz, że dostarczamy gotową dokumentację techniczną do urzędu.',
  },
  {
    id: 'obj_transport',
    label: 'Obawa o dojazd i montaż HDS',
    category: 'Logistyka',
    script:
      'Uspokój klienta: przed wysyłką robimy bezpłatną weryfikację dojazdu na bazie zdjęć/pinu Google Maps, a nasi operatorzy HDS mają doświadczenie na wąskich działkach.',
  },
  {
    id: 'obj_warranty',
    label: 'Gwarancja, serwis i trwałość zimą',
    category: 'Jakość',
    script:
      'Wskaż konkretną długość gwarancji na konstrukcję i podzespoły, standard izolacyjności WT2021 oraz szybki serwis posprzedażowy na terenie całego kraju.',
  },
  {
    id: 'obj_think',
    label: '„Muszę się jeszcze zastanowić”',
    category: 'Decyzja',
    script:
      'Zaproponuj bezpłatną rezerwację terminu produkcji na 7 dni bez zobowiązań lub krótką 10-minutową rozmowę z technologiem, aby rozwiać ostatnie pytania.',
  },
];

type DraftLangCode = 'pl' | 'en' | 'no' | 'de';

function detectDraftLangCode(raw?: string): DraftLangCode {
  const s = (raw || '').toLowerCase();
  if (s.includes('eng') || s.includes('ang') || s === 'en') return 'en';
  if (s.includes('nor') || s === 'no' || s === 'nb') return 'no';
  if (s.includes('ger') || s.includes('niem') || s === 'de') return 'de';
  return 'pl';
}

export const SalesResponderView: React.FC<SalesResponderViewProps> = ({
  preset,
  tiles,
  language,
  latestReply,
  authorName,
  incomingMessage,
  onClearIncomingMessage,
  onReplyComplete,
  onOpenKnowledge,
  onCreateCrmDeal,
  onSendWebhookPayload,
  onQuickAddTile,
  onLogAiCall,
}) => {
  const [sendingWebhook, setSendingWebhook] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [sendingGmail, setSendingGmail] = useState(false);
  const [channelStatus, setChannelStatus] = useState<string | null>(null);
  const [savedGapToKb, setSavedGapToKb] = useState(false);

  // Etap 5-7+ Pro Features
  const [includeMiniQuote, setIncludeMiniQuote] = useState<boolean>(true);
  const [listeningVoice, setListeningVoice] = useState<boolean>(false);
  const [threadHistory, setThreadHistory] = useState<Array<{ role: 'client' | 'advisor'; text: string }>>([]);

  const [quickLinks, setQuickLinks] = useState<QuickLinkItem[]>(() => {
    try {
      const raw = localStorage.getItem(`${QUICK_LINKS_KEY}_${preset.id}`) || localStorage.getItem(QUICK_LINKS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as QuickLinkItem[];
        if (Array.isArray(parsed)) {
          return parsed.filter((l) => !l.url.includes('twojafirma.pl') && !l.url.includes('cal.com/twojafirma'));
        }
      }
      return DEFAULT_QUICK_LINKS;
    } catch {
      return DEFAULT_QUICK_LINKS;
    }
  });
  const [selectedLinkIds, setSelectedLinkIds] = useState<string[]>([]);
  const [showQuickLinks, setShowQuickLinks] = useState<boolean>(false);
  const [showTallyModal, setShowTallyModal] = useState<boolean>(false);
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editLinkLabel, setEditLinkLabel] = useState('');
  const [editLinkUrl, setEditLinkUrl] = useState('');

  const [objections, setObjections] = useState<ObjectionPlaybookItem[]>(() => {
    try {
      const raw = localStorage.getItem(`${OBJECTIONS_KEY}_${preset.id}`) || localStorage.getItem(OBJECTIONS_KEY);
      return raw ? (JSON.parse(raw) as ObjectionPlaybookItem[]) : DEFAULT_OBJECTIONS;
    } catch {
      return DEFAULT_OBJECTIONS;
    }
  });
  const [showObjections, setShowObjections] = useState<boolean>(false);
  const [objectionFilter, setObjectionFilter] = useState<string>('Wszystkie');
  const [newObjLabel, setNewObjLabel] = useState('');
  const [newObjScript, setNewObjScript] = useState('');

  const [inboxItems, setInboxItems] = useState<InboxFeedItem[]>(() => {
    try {
      const raw = localStorage.getItem(INBOX_FEED_KEY);
      return raw ? (JSON.parse(raw) as InboxFeedItem[]) : [];
    } catch {
      return [];
    }
  });
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<'pending' | 'all'>('pending');
  const [showInbox, setShowInbox] = useState<boolean>(false);
  const [clientMessage, setClientMessage] = useState<string>('');
  const [advisorNotes, setAdvisorNotes] = useState<string>('');
  const [tone, setTone] = useState<'sales' | 'concise' | 'formal'>('sales');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [replyLanguage, setReplyLanguage] = useState<'auto' | 'pl' | 'en' | 'no' | 'de'>('auto');
  const [useWebKnowledge, setUseWebKnowledge] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [editableSubject, setEditableSubject] = useState<string>('');
  const [editableBody, setEditableBody] = useState<string>('');
  const [baseReplyBody, setBaseReplyBody] = useState<string>('');
  const [replyOutputMode, setReplyOutputMode] = useState<'combined' | 'quote_only' | 'reply_only'>('reply_only');
  const [hideItemizedPrices, setHideItemizedPrices] = useState<boolean>(false);
  const [includeWarsawRef, setIncludeWarsawRef] = useState<boolean>(true);
  const [activeDraftLang, setActiveDraftLang] = useState<DraftLangCode>('pl');
  const [draftCache, setDraftCache] = useState<Partial<Record<DraftLangCode, { subject: string; body: string }>>>({});
  const [draftDirtyLang, setDraftDirtyLang] = useState<DraftLangCode | null>(null);
  const [translatingLang, setTranslatingLang] = useState<DraftLangCode | null>(null);
  const [copiedMode, setCopiedMode] = useState<'all' | 'body' | 'rich' | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [replyHistory, setReplyHistory] = useState<ReplyHistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(`${REPLY_HISTORY_KEY}_${preset.id}`) || localStorage.getItem(REPLY_HISTORY_KEY);
      return raw ? (JSON.parse(raw) as ReplyHistoryItem[]) : [];
    } catch {
      return [];
    }
  });
  const [chatThreads, setChatThreads] = useState<ClientChatThread[]>(() => {
    try {
      const raw = localStorage.getItem(`${CHAT_THREADS_KEY}_${preset.id}`);
      return raw ? (JSON.parse(raw) as ClientChatThread[]) : [];
    } catch {
      return [];
    }
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`${ACTIVE_CHAT_KEY}_${preset.id}`);
    } catch {
      return null;
    }
  });
  const [showChatsSidebar, setShowChatsSidebar] = useState<boolean>(true);
  const [savingChatsCloud, setSavingChatsCloud] = useState<boolean>(false);
  const [integratedTallyQuote, setIntegratedTallyQuote] = useState<TallyQuoteEvaluation | null>(null);
  const [integratingTally, setIntegratingTally] = useState<boolean>(false);
  const deletedChatIdsRef = useRef<Set<string>>(new Set());

  const activeChat = chatThreads.find((c) => c.id === activeChatId) ?? null;

  const compactThreadMessages = (msgs: ClientChatMessage[]): ClientChatMessage[] => {
    const trimmed = msgs.slice(-30);
    return trimmed.map((m, idx) =>
      idx >= trimmed.length - 2 ? m : { ...m, reply: undefined }
    );
  };

  const pruneThreadsForStorage = (list: ClientChatThread[]): ClientChatThread[] => {
    // Gwiazdkowane czaty sa chronione na stale; starsze niegwiazdkowane trzymamy do 45 sztuk
    const compacted = list.map((t) => ({
      ...t,
      messages: compactThreadMessages(t.messages),
    }));
    const starred = compacted.filter((t) => t.starred);
    const unstarred = [...compacted.filter((t) => !t.starred)]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 45);
    return [...starred, ...unstarred];
  };

  const mergeThreadsSafely = (
    cloudList: ClientChatThread[],
    localList: ClientChatThread[]
  ): ClientChatThread[] => {
    const byId = new Map<string, ClientChatThread>();
    for (const c of cloudList) {
      if (!deletedChatIdsRef.current.has(c.id)) {
        byId.set(c.id, c);
      }
    }
    for (const l of localList) {
      if (deletedChatIdsRef.current.has(l.id)) continue;
      const existing = byId.get(l.id);
      if (!existing) {
        byId.set(l.id, l);
      } else {
        const lTime = Date.parse(l.updatedAt) || 0;
        const cTime = Date.parse(existing.updatedAt) || 0;
        if (lTime >= cTime) {
          byId.set(l.id, { ...l, starred: l.starred || existing.starred });
        }
      }
    }
    return pruneThreadsForStorage(Array.from(byId.values()));
  };

  const persistChatThreads = (nextRaw: ClientChatThread[]) => {
    const next = pruneThreadsForStorage(nextRaw);
    setChatThreads(next);
    try {
      localStorage.setItem(`${CHAT_THREADS_KEY}_${preset.id}`, JSON.stringify(next));
    } catch {
      // Fallback gdyby localStorage byl pelny: zachowaj tylko ostatnia pelna odpowiedz w watku
      try {
        const compact = next.map((c) => ({
          ...c,
          messages: c.messages.map((m, idx) =>
            idx >= c.messages.length - 2 ? m : { ...m, reply: undefined }
          ),
        }));
        localStorage.setItem(`${CHAT_THREADS_KEY}_${preset.id}`, JSON.stringify(compact));
      } catch {
        // ignore
      }
    }
    void idbSaveWorkspaceItem(preset.id, 'chat_threads', next);
    setSavingChatsCloud(true);
    void saveCloudWorkspaceKey(preset.id, 'chat_threads', next, authorName).finally(() => {
      setSavingChatsCloud(false);
    });
  };

  const selectActiveChatId = (nextId: string | null) => {
    setActiveChatId(nextId);
    try {
      if (nextId) {
        localStorage.setItem(`${ACTIVE_CHAT_KEY}_${preset.id}`, nextId);
      } else {
        localStorage.removeItem(`${ACTIVE_CHAT_KEY}_${preset.id}`);
      }
    } catch {
      // ignore
    }
  };

  const refreshCloudInbox = async () => {
    setInboxLoading(true);
    try {
      const res = await fetchCloudInbox();
      if (res.success && Array.isArray(res.items)) {
        setInboxItems(res.items);
        try {
          localStorage.setItem(INBOX_FEED_KEY, JSON.stringify(res.items));
        } catch {
          // ignore
        }
      }
    } catch {
      // Offline / cloud fallback stays with local items
    } finally {
      setInboxLoading(false);
    }
  };

  useEffect(() => {
    void refreshCloudInbox();
  }, []);

  useEffect(() => {
    let cancelled = false;
    deletedChatIdsRef.current.clear();
    setIntegratedTallyQuote(null);
    setError(null);
    setChannelStatus(null);
    const hydrateWorkspace = async () => {
      try {
        const localRaw = localStorage.getItem(`${CHAT_THREADS_KEY}_${preset.id}`);
        setChatThreads(localRaw ? (JSON.parse(localRaw) as ClientChatThread[]) : []);
        const savedActive = localStorage.getItem(`${ACTIVE_CHAT_KEY}_${preset.id}`);
        setActiveChatId(savedActive || null);
      } catch {
        setChatThreads([]);
        setActiveChatId(null);
      }

      const [idbLinks, idbObjs, idbHist, idbChats] = await Promise.all([
        idbGetWorkspaceItem<QuickLinkItem[]>(preset.id, 'quick_links'),
        idbGetWorkspaceItem<ObjectionPlaybookItem[]>(preset.id, 'objections'),
        idbGetWorkspaceItem<ReplyHistoryItem[]>(preset.id, 'reply_history'),
        idbGetWorkspaceItem<ClientChatThread[]>(preset.id, 'chat_threads'),
      ]);
      if (cancelled) return;
      if (idbLinks?.payload) setQuickLinks(idbLinks.payload);
      if (idbObjs?.payload?.length) setObjections(idbObjs.payload);
      if (idbHist?.payload) setReplyHistory(idbHist.payload);
      if (Array.isArray(idbChats?.payload) && idbChats.payload.length > 0) {
        setChatThreads((prev) => mergeThreadsSafely(idbChats.payload, prev));
      }

      try {
        const cloud = await fetchCloudWorkspace(preset.id);
        if (cancelled || !cloud.success || !cloud.state) return;
        if (Array.isArray(cloud.state.quick_links)) {
          const clean = (cloud.state.quick_links as QuickLinkItem[]).filter(
            (l) => !l.url.includes('twojafirma.pl') && !l.url.includes('cal.com/twojafirma')
          );
          setQuickLinks(clean);
          localStorage.setItem(`${QUICK_LINKS_KEY}_${preset.id}`, JSON.stringify(clean));
        }
        if (Array.isArray(cloud.state.objections) && cloud.state.objections.length > 0) {
          const objs = cloud.state.objections as ObjectionPlaybookItem[];
          setObjections(objs);
          localStorage.setItem(`${OBJECTIONS_KEY}_${preset.id}`, JSON.stringify(objs));
        }
        if (Array.isArray(cloud.state.reply_history)) {
          const hist = cloud.state.reply_history as ReplyHistoryItem[];
          setReplyHistory(hist);
          localStorage.setItem(`${REPLY_HISTORY_KEY}_${preset.id}`, JSON.stringify(hist));
        }
        if (Array.isArray(cloud.state.chat_threads)) {
          const cloudChats = cloud.state.chat_threads as ClientChatThread[];
          setChatThreads((prev) => {
            const merged = mergeThreadsSafely(cloudChats, prev);
            try {
              localStorage.setItem(`${CHAT_THREADS_KEY}_${preset.id}`, JSON.stringify(merged));
            } catch {
              // ignore
            }
            void idbSaveWorkspaceItem(preset.id, 'chat_threads', merged);
            return merged;
          });
        }
      } catch {
        // Offline gracefully uses IDB / localStorage
      }
    };
    void hydrateWorkspace();
    return () => {
      cancelled = true;
    };
  }, [preset.id]);

  const persistQuickLinks = (next: QuickLinkItem[]) => {
    setQuickLinks(next);
    try {
      localStorage.setItem(`${QUICK_LINKS_KEY}_${preset.id}`, JSON.stringify(next));
    } catch {
      // ignore
    }
    void saveCloudWorkspaceKey(preset.id, 'quick_links', next, authorName);
  };

  const persistObjections = (next: ObjectionPlaybookItem[]) => {
    setObjections(next);
    try {
      localStorage.setItem(`${OBJECTIONS_KEY}_${preset.id}`, JSON.stringify(next));
    } catch {
      // ignore
    }
    void saveCloudWorkspaceKey(preset.id, 'objections', next, authorName);
  };

  useEffect(() => {
    if (incomingMessage && incomingMessage.trim()) {
      setClientMessage(incomingMessage);
      setAdvisorNotes('');
      onClearIncomingMessage?.();
    }
  }, [incomingMessage, onClearIncomingMessage]);

  useEffect(() => {
    if (!channelStatus) return;
    const timer = window.setTimeout(() => setChannelStatus(null), 3500);
    return () => window.clearTimeout(timer);
  }, [channelStatus]);

  useEffect(() => {
    if (latestReply) {
      const formattedBase = formatStructuredReplyText(latestReply.replyBody);
      const baseLang = detectDraftLangCode(latestReply.detectedLanguage);
      const quote =
        latestReply.tallyQuote && latestReply.tallyQuote.breakdown.length > 0
          ? latestReply.tallyQuote
          : null;
      const defaultMode: 'combined' | 'quote_only' | 'reply_only' = quote ? 'combined' : 'reply_only';
      const initialBody =
        defaultMode === 'combined' && quote
          ? stitchReplyAndTallyQuote(formattedBase, quote, baseLang, {
              hideItemizedPrices,
              includeWarsawRef,
            })
          : formattedBase;

      setBaseReplyBody(formattedBase);
      setIntegratedTallyQuote(quote);
      setReplyOutputMode(defaultMode);
      setEditableSubject(latestReply.subject);
      setEditableBody(initialBody);
      setActiveDraftLang(baseLang);
      setDraftCache({ [baseLang]: { subject: latestReply.subject, body: initialBody } });
      setDraftDirtyLang(null);
      setSavedGapToKb(false);
    }
  }, [latestReply]);

  const handleSwitchDraftLanguage = async (targetLang: DraftLangCode) => {
    if (translatingLang || loading || !editableBody.trim()) return;
    if (targetLang === activeDraftLang && draftDirtyLang !== targetLang) return;

    const currentSaved = { subject: editableSubject, body: editableBody };

    // Jeśli doradca nie edytował obecnej wersji, a wersja docelowa jest już w pamięci -> 0 ms przełączenie!
    const existingTarget = draftCache[targetLang];
    if (!draftDirtyLang && existingTarget) {
      setDraftCache((prev) => ({ ...prev, [activeDraftLang]: currentSaved }));
      setEditableSubject(existingTarget.subject);
      setEditableBody(existingTarget.body);
      setActiveDraftLang(targetLang);
      setChannelStatus(
        targetLang === 'pl'
          ? 'Przełączono podgląd do czytania po polsku (PL) — 0 ms.'
          : `Przełączono na wersję gotową do wysyłki (${targetLang.toUpperCase()}) — 0 ms.`
      );
      return;
    }

    setTranslatingLang(targetLang);
    setError(null);
    try {
      const res = await translateSalesReply({
        subject: editableSubject,
        body: editableBody,
        targetLanguage: targetLang,
      });
      const translated = { subject: res.subject, body: formatStructuredReplyText(res.replyBody) };
      setDraftCache((prev) => ({
        ...prev,
        [activeDraftLang]: currentSaved,
        [targetLang]: translated,
      }));
      setEditableSubject(translated.subject);
      setEditableBody(translated.body);
      setActiveDraftLang(targetLang);
      setDraftDirtyLang(null);
      setChannelStatus(
        targetLang === 'pl'
          ? `Przetłumaczono wiernie 1:1 na polski (PL) w ${res.latencyMs} ms — zachowano wszystkie liczby i formatowanie.`
          : `Przełączono i przetłumaczono wiernie na ${targetLang.toUpperCase()} w ${res.latencyMs} ms — gotowe do wysyłki!`
      );
      onLogAiCall({
        action: 'responder',
        latencyMs: res.latencyMs,
        promptTokens: res.usage.promptTokens,
        candidatesTokens: res.usage.candidatesTokens,
        totalTokens: res.usage.totalTokens,
        status: 'success',
        summary: `Tłumaczenie 1:1 odpowiedzi na ${targetLang.toUpperCase()}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się przetłumaczyć odpowiedzi.');
    } finally {
      setTranslatingLang(null);
    }
  };

  const activeTilesCount = tiles.filter((t) => t.enabled).length;

  const lastChatClientMsg = activeChat
    ? [...activeChat.messages].reverse().find((m) => m.role === 'client')?.text || ''
    : '';

  const handleGenerate = async (
    overrideMessage?: string,
    overrideNote?: string,
    overrideLang?: 'auto' | 'pl' | 'en' | 'no' | 'de',
    overrideTone?: 'sales' | 'concise' | 'formal',
    overrideChannel?: 'email' | 'sms',
    followUpDaysSilent?: number
  ) => {
    const rawMsgInput = (overrideMessage ?? clientMessage).trim();
    const usedFallbackFromChat = !rawMsgInput && Boolean(lastChatClientMsg);
    const msgToUse = rawMsgInput || lastChatClientMsg;
    const noteToUse = overrideNote ?? advisorNotes;
    const langToUse = overrideLang ?? replyLanguage;
    const toneToUse = overrideTone ?? tone;
    const channelToUse = overrideChannel ?? channel;

    if (!msgToUse.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const advisorSignature = getStoredAdvisorSignature();
      const includedLinks = quickLinks
        .filter((l) => selectedLinkIds.includes(l.id))
        .map((l) => ({ label: l.label, url: l.url }));

      const baseThread: Array<{ role: 'client' | 'advisor'; text: string }> = activeChat
        ? activeChat.messages.map((m) => ({ role: m.role, text: m.text }))
        : threadHistory;

      const effectiveThread =
        followUpDaysSilent && followUpDaysSilent > 0 && editableBody.trim() && baseThread.length === 0
          ? [
              { role: 'client' as const, text: msgToUse },
              { role: 'advisor' as const, text: editableBody.trim() },
            ]
          : baseThread;

      const result = await generateSalesReply({
        companyName: preset.name,
        companyIndustry: preset.industry,
        language,
        knowledgeTiles: tiles,
        clientMessage: msgToUse,
        advisorNotes: noteToUse,
        tone: toneToUse,
        channel: channelToUse,
        replyLanguage: langToUse,
        useWebKnowledge,
        useTallyConfig: includeMiniQuote,
        autoCalculateTally: false,
        includeMiniQuote,
        includedLinks,
        threadHistory: effectiveThread,
        advisorSignature,
        followUpDaysSilent,
      });

      const rawFormatted = formatStructuredReplyText(result.replyBody);
      const formattedBody =
        result.tallyQuote && result.tallyQuote.breakdown.length > 0
          ? stitchReplyAndTallyQuote(
              rawFormatted,
              result.tallyQuote,
              detectDraftLangCode(result.detectedLanguage)
            )
          : rawFormatted;
      onReplyComplete(result);
      setEditableSubject(result.subject);
      setEditableBody(formattedBody);

      // Zapisz wiadomosc klienta i odpowiedz bota w aktywnym czacie (lub utworz nowy czat)
      const nowIso = new Date().toISOString();
      const ts = Date.now();
      const detectedName = (result.detectedClientName || '').trim();
      const detectedContact = result.detectedRecipientEmail || result.detectedRecipientPhone || '';
      const newMessages: ClientChatMessage[] = usedFallbackFromChat
        ? [
            {
              id: `msg_a_${ts}`,
              role: 'advisor',
              text: formattedBody,
              subject: result.subject,
              createdAt: nowIso,
              reply: result,
            },
          ]
        : [
            {
              id: `msg_c_${ts}`,
              role: 'client',
              text: msgToUse,
              createdAt: nowIso,
            },
            {
              id: `msg_a_${ts + 1}`,
              role: 'advisor',
              text: formattedBody,
              subject: result.subject,
              createdAt: nowIso,
              reply: result,
            },
          ];

      if (activeChat) {
        const isGenericName =
          !activeChat.clientName ||
          activeChat.clientName === 'Nowy klient' ||
          activeChat.clientName === 'Klient';
        const resolvedName =
          isGenericName && detectedName && detectedName !== 'Klient'
            ? detectedName
            : activeChat.clientName;
        const updatedThreads = chatThreads.map((c) =>
          c.id === activeChat.id
            ? {
                ...c,
                clientName: resolvedName || 'Klient',
                clientContact: c.clientContact || detectedContact || undefined,
                channel: channelToUse === 'sms' ? ('whatsapp' as const) : ('email' as const),
                temperature: result.buyingSignal?.temperature ?? c.temperature,
                updatedAt: nowIso,
                messages: [...c.messages, ...newMessages],
              }
            : c
        );
        persistChatThreads(updatedThreads);
        setThreadHistory([...effectiveThread, ...newMessages.map((m) => ({ role: m.role, text: m.text }))]);
      } else {
        const newChatId = `chat_${ts}`;
        const newThread: ClientChatThread = {
          id: newChatId,
          clientName: detectedName && detectedName !== 'Klient' ? detectedName : `Klient ${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`,
          clientContact: detectedContact || undefined,
          channel: channelToUse === 'sms' ? 'whatsapp' : 'email',
          starred: false,
          temperature: result.buyingSignal?.temperature,
          createdAt: nowIso,
          updatedAt: nowIso,
          messages: newMessages,
        };
        persistChatThreads([newThread, ...chatThreads]);
        selectActiveChatId(newChatId);
        setThreadHistory(newMessages.map((m) => ({ role: m.role, text: m.text })));
      }

      if (!usedFallbackFromChat && !overrideMessage) {
        setClientMessage('');
      }
      setAdvisorNotes('');

      setReplyHistory((prev) => {
        const next: ReplyHistoryItem[] = [
          {
            id: `rh_${Date.now()}`,
            client: result.detectedClientName || 'Klient',
            subject: result.subject,
            createdAt: new Date().toISOString(),
            reply: result,
          },
          ...prev.filter((item) => item.subject !== result.subject),
        ].slice(0, 8);
        try {
          localStorage.setItem(`${REPLY_HISTORY_KEY}_${preset.id}`, JSON.stringify(next));
        } catch {
          // ignore
        }
        void saveCloudWorkspaceKey(preset.id, 'reply_history', next, authorName);
        return next;
      });

      onLogAiCall({
        action: 'responder',
        latencyMs: result.latencyMs,
        promptTokens: result.usage.promptTokens,
        candidatesTokens: result.usage.candidatesTokens,
        totalTokens: result.usage.totalTokens,
        status: 'success',
        summary: followUpDaysSilent
          ? `Follow-up (${followUpDaysSilent} dni) dla: ${result.detectedClientName}`
          : `Odpowiedź dla: ${result.detectedClientName} (${result.detectedLanguage})`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nie udało się wygenerować odpowiedzi.';
      setError(msg);
      onLogAiCall({
        action: 'responder',
        latencyMs: 0,
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        status: 'error',
        summary: msg,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (mode: 'all' | 'body') => {
    const text =
      mode === 'all' ? `Temat: ${editableSubject}\n\n${editableBody}` : editableBody;
    void navigator.clipboard.writeText(text);
    setCopiedMode(mode);
    window.setTimeout(() => setCopiedMode(null), 2000);
  };

  const handleCopyRichEmail = async () => {
    const sig = getStoredAdvisorSignature();
    await copyRichEmailToClipboard({
      subject: editableSubject,
      body: editableBody,
      companyName: preset.name,
      senderName: sig.name || undefined,
      senderRole: sig.role || undefined,
      webSources: latestReply?.webSources,
    });
    setCopiedMode('rich');
    window.setTimeout(() => setCopiedMode(null), 2200);
  };

  const handleExportPdf = async () => {
    if (!latestReply || exportingPdf) return;
    setExportingPdf(true);
    try {
      const sig = getStoredAdvisorSignature();
      await exportSalesReplyToPdf({
        companyName: preset.name,
        senderName: sig.name || undefined,
        senderRole: sig.role || undefined,
        clientLabel: latestReply.detectedRecipientEmail || undefined,
        subject: editableSubject,
        body: editableBody,
        webSources: latestReply.webSources,
      });
    } finally {
      setExportingPdf(false);
    }
  };

  const handlePrintReply = () => {
    if (!latestReply) return;
    printCleanReportHtml({
      title: editableSubject || `Odpowiedź handlowa — ${preset.name}`,
      subtitle: `${preset.name}${latestReply.detectedRecipientEmail ? ` • Adresat: ${latestReply.detectedRecipientEmail}` : ''}`,
      bodyMarkdownOrHtml: editableBody,
      webSources: latestReply.webSources,
    });
  };

  const handleInsertSourceLink = (source: WebSource) => {
    const line = `\nZobacz również / źródło: ${source.title} — ${source.uri}`;
    setEditableBody((prev) => `${prev.trimEnd()}${line}`);
  };

  const handleToggleVoiceNote = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      };
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setError('Twoja przeglądarka nie obsługuje dyktowania głosowego (użyj Chrome / Edge).');
      return;
    }
    const rec = new SpeechRec();
    rec.lang = 'pl-PL';
    rec.interimResults = false;
    setListeningVoice(true);
    rec.onresult = (e) => {
      const spoken = e.results?.[0]?.[0]?.transcript || '';
      if (spoken) {
        setAdvisorNotes((prev) => (prev ? `${prev} ${spoken}` : spoken));
      }
    };
    rec.onerror = () => setListeningVoice(false);
    rec.onend = () => setListeningVoice(false);
    rec.start();
  };

  const handleSelectChat = (chatId: string) => {
    const found = chatThreads.find((c) => c.id === chatId);
    if (!found) return;
    selectActiveChatId(chatId);
    setClientMessage('');
    setAdvisorNotes('');
    setIntegratedTallyQuote(null);
    setThreadHistory(found.messages.map((m) => ({ role: m.role, text: m.text })));
    const lastReplyMsg = [...found.messages].reverse().find((m) => m.role === 'advisor' && m.reply);
    if (lastReplyMsg?.reply) {
      onReplyComplete(lastReplyMsg.reply);
    }
    setChannelStatus(
      `Otwarto czat: ${found.clientName} (${found.messages.length} wiadomości w pamięci AI).`
    );
  };

  const handleNewChat = () => {
    const nowIso = new Date().toISOString();
    const id = `chat_${Date.now()}`;
    const blank: ClientChatThread = {
      id,
      clientName: 'Nowy klient',
      starred: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      messages: [],
    };
    persistChatThreads([blank, ...chatThreads]);
    selectActiveChatId(id);
    setClientMessage('');
    setAdvisorNotes('');
    setIntegratedTallyQuote(null);
    setThreadHistory([]);
    setChannelStatus('Utworzono nowy czat klienta — wklej pierwszą wiadomość.');
  };

  const handleToggleChatStar = (chatId: string) => {
    let starredNow = false;
    const next = chatThreads.map((c) => {
      if (c.id !== chatId) return c;
      starredNow = !c.starred;
      return { ...c, starred: starredNow };
    });
    persistChatThreads(next);
    setChannelStatus(
      starredNow
        ? '★ Oznaczono czat gwiazdką — zapisano trwale na górze listy i w chmurze Neon.'
        : 'Odpięto gwiazdkę z czatu.'
    );
  };

  const handleRenameChat = (chatId: string, nextName: string) => {
    const clean = nextName.trim();
    if (!clean) return;
    const next = chatThreads.map((c) => (c.id === chatId ? { ...c, clientName: clean } : c));
    persistChatThreads(next);
  };

  const handleDeleteChat = (chatId: string) => {
    deletedChatIdsRef.current.add(chatId);
    const next = chatThreads.filter((c) => c.id !== chatId);
    persistChatThreads(next);
    if (activeChatId === chatId) {
      selectActiveChatId(null);
      setThreadHistory([]);
      setClientMessage('');
      setAdvisorNotes('');
      setIntegratedTallyQuote(null);
    }
    setChannelStatus('Usunięto wybrany czat z historii.');
  };

  const handleDeleteChatMessage = (chatId: string, msgId: string) => {
    const next = chatThreads.map((c) => {
      if (c.id !== chatId) return c;
      const filteredMsgs = c.messages.filter((m) => m.id !== msgId);
      return { ...c, messages: filteredMsgs };
    });
    persistChatThreads(next);
    if (activeChatId === chatId) {
      const updated = next.find((c) => c.id === chatId);
      setThreadHistory((updated?.messages || []).map((m) => ({ role: m.role, text: m.text })));
    }
    setChannelStatus('Usunięto wybraną wiadomość z kontekstu tego czatu.');
  };

  const rebuildFormattedBlock = (
    q: TallyQuoteEvaluation,
    nextBreakdown = q.breakdown,
    nextVatRate = q.vatRate,
    nextIllustrative = q.isIllustrativeEstimate
  ): TallyQuoteEvaluation => {
    const qty = Math.max(1, q.quantity || 1);
    const perUnitNetPln = nextBreakdown.reduce((s, b) => s + b.netPln, 0);
    const totalNetPln = perUnitNetPln * qty;
    const vatPln = Math.round((totalNetPln * nextVatRate) / 100);
    const totalGrossPln = totalNetPln + vatPln;
    const altVatGross8Pln = Math.round(totalNetPln * 1.08);
    const altVatGross23Pln = Math.round(totalNetPln * 1.23);
    const formattedQuoteBlock = [
      `KOSZTORYS WYLICZONY PRZEZ SILNIK TALLY (${q.formId}: "${q.formName}"):`,
      ...(nextIllustrative && q.assumedSummary ? [`⚠️ ${q.assumedSummary}`] : []),
      ...nextBreakdown.map((b) => `• ${b.label}: ${b.netPln.toLocaleString('pl-PL')} zł netto (${b.formula})`),
      ...(qty > 1
        ? [
            `• Razem za 1 domek NETTO: ${perUnitNetPln.toLocaleString('pl-PL')} zł`,
            `• RAZEM ZA ${qty} DOMKI NETTO: ${totalNetPln.toLocaleString('pl-PL')} zł`,
          ]
        : [`• RAZEM NETTO: ${totalNetPln.toLocaleString('pl-PL')} zł`]),
      `• Podatek VAT (${nextVatRate}%): ${vatPln.toLocaleString('pl-PL')} zł`,
      `• RAZEM BRUTTO (${nextVatRate}% VAT): ${totalGrossPln.toLocaleString('pl-PL')} zł`,
    ].join('\n');
    return {
      ...q,
      breakdown: nextBreakdown,
      perUnitNetPln,
      quantity: qty,
      totalNetPln,
      vatRate: nextVatRate,
      vatPln,
      totalGrossPln,
      altVatGross8Pln,
      altVatGross23Pln,
      isIllustrativeEstimate: nextIllustrative,
      formattedQuoteBlock,
    };
  };

  const applyReplyOutputMode = (
    mode: 'combined' | 'quote_only' | 'reply_only',
    quoteOverride: TallyQuoteEvaluation | null = integratedTallyQuote,
    baseOverride: string = baseReplyBody,
    langOverride: DraftLangCode = activeDraftLang,
    optsOverride?: { hideItemizedPrices?: boolean; includeWarsawRef?: boolean }
  ) => {
    setReplyOutputMode(mode);
    const fmtOpts = {
      hideItemizedPrices: optsOverride?.hideItemizedPrices ?? hideItemizedPrices,
      includeWarsawRef: optsOverride?.includeWarsawRef ?? includeWarsawRef,
    };
    let nextBody = baseOverride;
    if (mode === 'quote_only') {
      nextBody =
        quoteOverride && quoteOverride.breakdown.length > 0
          ? formatPureTallyQuoteText(quoteOverride, langOverride, fmtOpts)
          : '';
    } else if (mode === 'combined' && quoteOverride && quoteOverride.breakdown.length > 0) {
      nextBody = stitchReplyAndTallyQuote(baseOverride, quoteOverride, langOverride, fmtOpts);
    }
    setEditableBody(nextBody);
    setDraftDirtyLang(null);
    setDraftCache((prev) => ({
      ...prev,
      [langOverride]: { subject: editableSubject, body: nextBody },
    }));
  };

  const handleIntegrateTallyQuote = async (
    targetMode?: 'combined' | 'quote_only',
    optionOverrides?: { hideItemizedPrices?: boolean; includeWarsawRef?: boolean }
  ) => {
    const baseThread = activeChat
      ? activeChat.messages.map((m) => ({ role: m.role, text: m.text }))
      : threadHistory;
    if (!clientMessage.trim() && baseThread.length === 0) return;

    const nextHide = optionOverrides?.hideItemizedPrices ?? hideItemizedPrices;
    const nextWarsaw = optionOverrides?.includeWarsawRef ?? includeWarsawRef;
    if (optionOverrides?.hideItemizedPrices !== undefined) {
      setHideItemizedPrices(optionOverrides.hideItemizedPrices);
    }
    if (optionOverrides?.includeWarsawRef !== undefined) {
      setIncludeWarsawRef(optionOverrides.includeWarsawRef);
    }

    setIntegratingTally(true);
    setError(null);
    try {
      const res = await extractAndEvaluateTallyQuote({
        clientMessage: clientMessage.trim(),
        advisorNotes: advisorNotes.trim(),
        threadHistory: baseThread,
        tallyFormId: 'dWO4Oq',
      });
      setIntegratedTallyQuote(res.quote);
      setIncludeMiniQuote(true);
      const effectiveMode = targetMode ?? (replyOutputMode === 'reply_only' ? 'combined' : replyOutputMode);
      applyReplyOutputMode(effectiveMode, res.quote, baseReplyBody, activeDraftLang, {
        hideItemizedPrices: nextHide,
        includeWarsawRef: nextWarsaw,
      });
      onLogAiCall({
        action: 'responder',
        latencyMs: res.latencyMs,
        promptTokens: res.usage.promptTokens,
        candidatesTokens: res.usage.candidatesTokens,
        totalTokens: res.usage.totalTokens,
        status: 'success',
        summary: `Kalkulator Tally Engine (${res.quote.breakdown.length} poz., ${res.quote.totalGrossPln.toLocaleString('pl-PL')} zł brutto)`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać wyceny z silnika Tally.');
    } finally {
      setIntegratingTally(false);
    }
  };

  const handleClearIntegratedQuote = () => {
    setIntegratedTallyQuote(null);
    applyReplyOutputMode('reply_only', null, baseReplyBody, activeDraftLang);
  };

  const handleRemoveIntegratedItem = (key: string) => {
    if (!integratedTallyQuote) return;
    const filtered = integratedTallyQuote.breakdown.filter((b) => b.key !== key);
    const updated = rebuildFormattedBlock(integratedTallyQuote, filtered);
    setIntegratedTallyQuote(updated);
    if (replyOutputMode !== 'reply_only') {
      applyReplyOutputMode(replyOutputMode, updated);
    }
  };

  const handleSwitchIntegratedVat = (rate: 8 | 23) => {
    if (!integratedTallyQuote) return;
    const updated = rebuildFormattedBlock(integratedTallyQuote, integratedTallyQuote.breakdown, rate);
    setIntegratedTallyQuote(updated);
    if (replyOutputMode !== 'reply_only') {
      applyReplyOutputMode(replyOutputMode, updated);
    }
  };

  const handleToggleIllustrativeNotice = () => {
    if (!integratedTallyQuote) return;
    const nextFlag = !integratedTallyQuote.isIllustrativeEstimate;
    const updated = rebuildFormattedBlock(
      integratedTallyQuote,
      integratedTallyQuote.breakdown,
      integratedTallyQuote.vatRate,
      nextFlag
    );
    setIntegratedTallyQuote(updated);
    const targetMode = replyOutputMode === 'reply_only' ? 'combined' : replyOutputMode;
    applyReplyOutputMode(targetMode, updated);
  };

  const handleToggleHideItemizedPrices = () => {
    const nextHide = !hideItemizedPrices;
    setHideItemizedPrices(nextHide);
    if (integratedTallyQuote && integratedTallyQuote.breakdown.length > 0) {
      const targetMode = replyOutputMode === 'reply_only' ? 'combined' : replyOutputMode;
      applyReplyOutputMode(targetMode, integratedTallyQuote, baseReplyBody, activeDraftLang, {
        hideItemizedPrices: nextHide,
        includeWarsawRef,
      });
    }
  };

  const handleToggleWarsawRef = () => {
    const nextShow = !includeWarsawRef;
    setIncludeWarsawRef(nextShow);
    if (integratedTallyQuote && integratedTallyQuote.breakdown.length > 0) {
      const targetMode = replyOutputMode === 'reply_only' ? 'combined' : replyOutputMode;
      applyReplyOutputMode(targetMode, integratedTallyQuote, baseReplyBody, activeDraftLang, {
        hideItemizedPrices,
        includeWarsawRef: nextShow,
      });
    }
  };

  const handleCreateDealFromIntegratedQuote = () => {
    if (!integratedTallyQuote || !onCreateCrmDeal) return;
    const label = activeChat?.clientName || latestReply?.detectedClientName || 'Klient Tally';
    onCreateCrmDeal({
      title: integratedTallyQuote.input.areaM2
        ? `Wycena Tally ${integratedTallyQuote.input.areaM2} m² — ${label}`
        : `Wycena Tally Engine — ${label}`,
      client: label,
      valuePln: integratedTallyQuote.totalGrossPln || integratedTallyQuote.totalNetPln || 150000,
      stage: 'quote',
      riskLevel: 'LOW',
      score: 90,
      tags: ['Tally Engine dWO4Oq', integratedTallyQuote.input.floorType || 'konfiguracja'],
      notes: integratedTallyQuote.formattedQuoteBlock,
    });
    setChannelStatus('Dodano wycenę z silnika Tally bezpośrednio do Lejka CRM!');
  };

  const handleContinueThread = () => {
    const msg = clientMessage.trim();
    if (!msg) return;
    const nowIso = new Date().toISOString();
    const newEntry: ClientChatMessage = {
      id: `msg_c_${Date.now()}`,
      role: 'client',
      text: msg,
      createdAt: nowIso,
    };

    if (activeChat) {
      const updated = chatThreads.map((c) =>
        c.id === activeChat.id
          ? { ...c, updatedAt: nowIso, messages: [...c.messages, newEntry] }
          : c
      );
      persistChatThreads(updated);
      setThreadHistory([...activeChat.messages.map((m) => ({ role: m.role, text: m.text })), { role: 'client', text: msg }]);
    } else {
      const id = `chat_${Date.now()}`;
      const newChat: ClientChatThread = {
        id,
        clientName: 'Nowy klient',
        starred: false,
        createdAt: nowIso,
        updatedAt: nowIso,
        messages: [newEntry],
      };
      persistChatThreads([newChat, ...chatThreads]);
      selectActiveChatId(id);
      setThreadHistory([{ role: 'client', text: msg }]);
    }
    setClientMessage('');
    setAdvisorNotes('');
    setChannelStatus('Dodano wiadomość klienta do historii wątku — możesz wkleić kolejną.');
  };

  const handleAddQuickLink = () => {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
    const item: QuickLinkItem = {
      id: `ql_${Date.now()}`,
      label: newLinkLabel.trim(),
      url: newLinkUrl.trim(),
    };
    const next = [...quickLinks, item];
    persistQuickLinks(next);
    setSelectedLinkIds((prev) => [...prev, item.id]);
    setNewLinkLabel('');
    setNewLinkUrl('');
  };

  const handleSaveEditedLink = () => {
    if (!editingLinkId || !editLinkLabel.trim() || !editLinkUrl.trim()) return;
    const next = quickLinks.map((q) =>
      q.id === editingLinkId ? { ...q, label: editLinkLabel.trim(), url: editLinkUrl.trim() } : q
    );
    persistQuickLinks(next);
    setEditingLinkId(null);
    setEditLinkLabel('');
    setEditLinkUrl('');
  };

  const handleAddObjection = () => {
    if (!newObjLabel.trim() || !newObjScript.trim()) return;
    const item: ObjectionPlaybookItem = {
      id: `obj_${Date.now()}`,
      label: newObjLabel.trim(),
      category: 'Własne',
      script: newObjScript.trim(),
    };
    const next = [item, ...objections];
    persistObjections(next);
    setNewObjLabel('');
    setNewObjScript('');
  };

  const handleToggleInboxHandled = async (item: InboxFeedItem) => {
    const targetHandled = !item.handled;
    setInboxItems((prev) =>
      prev.map((x) =>
        x.id === item.id ? { ...x, handled: targetHandled, handledBy: targetHandled ? authorName || 'Zespół' : '' } : x
      )
    );
    try {
      await markCloudInboxHandled(item.id, targetHandled, authorName || 'Zespół');
    } catch {
      // keep optimistic update in offline mode
    }
  };

  const handleDeleteInboxItem = async (id: string) => {
    setInboxItems((prev) => prev.filter((x) => x.id !== id));
    try {
      await deleteCloudInboxItem(id);
    } catch {
      // ignore if offline
    }
  };

  const handleCreateTestInboxLead = async () => {
    setInboxLoading(true);
    try {
      await ingestCloudInboxItem({
        source: 'tally',
        senderName: 'Testowy Inwestor (Formularz WWW)',
        senderContact: 'kontakt@inwestor-test.pl',
        fullText: `Dzień dobry,\nproszę o wycenę oraz termin realizacji w zakresie oferty ${preset.name}. Interesuje mnie wariant kompleksowy oraz warunki gwarancji.\nPozdrawiam,\nJan Testowy`,
      });
      await refreshCloudInbox();
      setChannelStatus('Dodano zgłoszenie testowe do Skrzynki w chmurze Neon.');
    } catch {
      setError('Nie udało się dodać zgłoszenia testowego do chmury.');
    } finally {
      setInboxLoading(false);
    }
  };

  const pendingInboxCount = inboxItems.filter((i) => !i.handled).length;
  const visibleInboxItems =
    inboxFilter === 'pending' ? inboxItems.filter((i) => !i.handled) : inboxItems;

  return (
    <div className="space-y-4">
      {!showChatsSidebar && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white px-4 py-2 shadow-2xs">
          <button
            type="button"
            onClick={() => setShowChatsSidebar(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-600 transition"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
            Pokaż czaty klientów ({chatThreads.length})
          </button>
          {activeChat && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-slate-800">Aktywny czat: {activeChat.clientName}</span>
              <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                {activeChat.messages.length} wiad.
              </span>
            </div>
          )}
        </div>
      )}

      <div
        className={`grid gap-4 items-start ${
          showChatsSidebar
            ? 'lg:grid-cols-[215px_minmax(340px,0.9fr)_minmax(480px,1.35fr)]'
            : 'lg:grid-cols-12'
        }`}
      >
        {/* SIDEBAR COLUMN: Lista czatów klientów */}
        {showChatsSidebar && (
          <div className="min-w-0">
            <ClientChatsSidebar
              threads={chatThreads}
              activeChatId={activeChatId}
              savingCloud={savingChatsCloud}
              onSelectChat={handleSelectChat}
              onNewChat={handleNewChat}
              onToggleStar={handleToggleChatStar}
              onRenameChat={handleRenameChat}
              onDeleteChat={handleDeleteChat}
              onCollapse={() => setShowChatsSidebar(false)}
            />
          </div>
        )}

        {/* CENTER COLUMN: Czat + Wklej wiadomość od klienta */}
        <div className={`min-w-0 space-y-4 ${showChatsSidebar ? '' : 'lg:col-span-5'}`}>
        <div className="soft-card rounded-3xl border border-slate-200/80 bg-white p-5 space-y-4">
          {/* Unified Inbox Toggle Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-violet-50/60 to-emerald-50/60 px-3 py-2">
            <button
              type="button"
              onClick={() => setShowInbox((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-900 hover:text-indigo-700"
            >
              <Inbox className="h-3.5 w-3.5 text-indigo-600" />
              Skrzynka ({pendingInboxCount} nowych / {inboxItems.length})
              <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-extrabold text-indigo-600 shadow-2xs">
                {showInbox ? 'Ukryj' : 'Rozwiń'}
              </span>
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleContinueThread}
                disabled={!clientMessage.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-slate-700 shadow-2xs hover:text-indigo-700 disabled:opacity-40"
                title="Wklej wiadomość tylko do pamięci wątku (bez generowania odpowiedzi AI)"
              >
                <MessageSquarePlus className="h-3 w-3 text-indigo-600" />
                Dodaj do czatu
              </button>
            </div>
          </div>

          {showInbox && (
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setInboxFilter('pending')}
                    className={`rounded-lg px-2 py-1 text-[10px] font-bold ${
                      inboxFilter === 'pending'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    Do odpowiedzi ({pendingInboxCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setInboxFilter('all')}
                    className={`rounded-lg px-2 py-1 text-[10px] font-bold ${
                      inboxFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    Wszystkie ({inboxItems.length})
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={inboxLoading}
                    onClick={() => void handleCreateTestInboxLead()}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100"
                  >
                    + Testowy lead
                  </button>
                  <button
                    type="button"
                    disabled={inboxLoading}
                    onClick={() => void refreshCloudInbox()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
                  >
                    <RefreshCw className={`h-3 w-3 ${inboxLoading ? 'animate-spin' : ''}`} />
                    Odśwież
                  </button>
                </div>
              </div>

              {visibleInboxItems.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-[11px] text-slate-500">
                  Skrzynka w chmurze jest pusta. Podłącz Meta / WhatsApp / Make Webhook w „Połączeniach” albo kliknij „+ Testowy lead”.
                </p>
              ) : (
                <div className="max-h-60 space-y-1.5 overflow-y-auto pr-0.5">
                  {visibleInboxItems.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-start justify-between gap-2 rounded-xl border p-2.5 transition ${
                        item.handled
                          ? 'border-emerald-200/70 bg-emerald-50/40 opacity-75'
                          : 'border-slate-200/80 bg-white hover:border-indigo-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          const normalizedSender = item.senderName.trim().toLowerCase();
                          const existing = chatThreads.find(
                            (c) =>
                              (item.senderContact && c.clientContact === item.senderContact) ||
                              (normalizedSender && c.clientName.trim().toLowerCase() === normalizedSender)
                          );
                          if (existing) {
                            handleSelectChat(existing.id);
                          } else {
                            const nowIso = new Date().toISOString();
                            const newId = `chat_${Date.now()}`;
                            const created: ClientChatThread = {
                              id: newId,
                              clientName: item.senderName || 'Klient ze Skrzynki',
                              clientContact: item.senderContact || undefined,
                              channel:
                                item.source === 'whatsapp'
                                  ? 'whatsapp'
                                  : item.source === 'tally'
                                    ? 'tally'
                                    : 'email',
                              starred: false,
                              createdAt: nowIso,
                              updatedAt: nowIso,
                              messages: [],
                            };
                            persistChatThreads([created, ...chatThreads]);
                            selectActiveChatId(newId);
                            setThreadHistory([]);
                          }
                          setClientMessage(item.fullText);
                          setShowInbox(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                              item.source === 'whatsapp'
                                ? 'bg-emerald-100 text-emerald-700'
                                : item.source === 'gmail'
                                  ? 'bg-rose-100 text-rose-700'
                                  : 'bg-indigo-100 text-indigo-700'
                            }`}
                          >
                            {item.source}
                          </span>
                          <span className="truncate text-[11px] font-bold text-slate-900">
                            {item.senderName}
                          </span>
                          {item.handled && (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                              Obsłużona
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{item.preview}</p>
                        <span className="mt-0.5 block text-[10px] text-slate-400">
                          {formatInboxTime(item.receivedAt)}
                        </span>
                      </button>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => void handleToggleInboxHandled(item)}
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition ${
                            item.handled
                              ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                              : 'bg-emerald-600 text-white hover:bg-emerald-700'
                          }`}
                          title="Oznacz jako obsłużoną"
                        >
                          {item.handled ? 'Cofnij' : 'Obsłużona ✓'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteInboxItem(item.id)}
                          className="rounded p-1 text-slate-400 hover:text-rose-600"
                          title="Usuń z chmury"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Aktywny czat i historia rozmowy */}
          {activeChat && (
            <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/40 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleToggleChatStar(activeChat.id)}
                    className={`rounded-lg p-1 transition ${
                      activeChat.starred
                        ? 'bg-amber-100 text-amber-500'
                        : 'bg-white text-slate-400 hover:text-amber-500 border border-slate-200'
                    }`}
                    title={activeChat.starred ? 'Zapisany gwiazdką ★' : 'Oznacz ten czat gwiazdką ★'}
                  >
                    <Star className={`h-3.5 w-3.5 ${activeChat.starred ? 'fill-amber-400 text-amber-500' : ''}`} />
                  </button>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-extrabold text-slate-900">
                      {activeChat.clientName}
                    </p>
                    {activeChat.clientContact && (
                      <p className="truncate text-[10px] text-slate-500">{activeChat.clientContact}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-100">
                    Pamięć AI: {activeChat.messages.length} wiad.
                  </span>
                  <button
                    type="button"
                    onClick={handleNewChat}
                    className="rounded-lg bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 border border-slate-200 hover:border-indigo-300 hover:text-indigo-700"
                    title="Nowy czat"
                  >
                    + Nowy
                  </button>
                </div>
              </div>

              {activeChat.messages.length > 0 && (
                <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {activeChat.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`group relative rounded-xl border px-2.5 py-2 text-[11px] leading-snug ${
                        m.role === 'client'
                          ? 'border-slate-200 bg-white text-slate-800 mr-4'
                          : 'border-indigo-200 bg-indigo-50/90 text-indigo-950 ml-4'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-500">
                          {m.role === 'client' ? 'Klient' : 'Bot / Ty'} •{' '}
                          {new Date(m.createdAt).toLocaleTimeString('pl-PL', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <div className="flex items-center gap-1">
                          {m.role === 'advisor' && m.reply && (
                            <button
                              type="button"
                              onClick={() => onReplyComplete(m.reply!)}
                              className="rounded px-1.5 py-0.5 text-[9px] font-bold text-indigo-700 hover:bg-indigo-100"
                              title="Wczytaj tę odpowiedź do prawego podglądu"
                            >
                              Podgląd →
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteChatMessage(activeChat.id, m.id)}
                            className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                            title="Usuń tę wiadomość z historii czatu"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <p className="whitespace-pre-wrap line-clamp-3">{m.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {activeChat && activeChat.messages.length > 0
                  ? '1. Wklej kolejną wiadomość od klienta'
                  : '1. Wklej mail lub zapytanie od klienta'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {activeChat && activeChat.messages.length > 0
                  ? `Bot pamięta cały powyższy wątek (${activeChat.messages.length} wiad.) + Bazę Wiedzy (${activeTilesCount} reguł).`
                  : `AI połączy Twoją Bazę Wiedzy (${activeTilesCount} reguł) oraz informacje rynkowe z internetu.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setClientMessage('');
                setAdvisorNotes('');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              title="Wyczyść pole tekstowe"
            >
              <RotateCcw className="h-3 w-3" />
              Wyczyść pole
            </button>
          </div>

          {/* Client Email Textarea */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Treść wiadomości klienta
            </label>
            <textarea
              rows={activeChat && activeChat.messages.length > 0 ? 5 : 8}
              value={clientMessage}
              onChange={(e) => setClientMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && clientMessage.trim() && !loading) {
                  e.preventDefault();
                  void handleGenerate();
                }
              }}
              placeholder={
                activeChat && activeChat.messages.length > 0
                  ? 'Wklej kolejną odpowiedź klienta (Ctrl+Enter aby wysłać do AI) — bot uwzględni wcześniejsze wiadomości...'
                  : 'Wklej tutaj mail od klienta, zapytanie z formularza WWW albo wiadomość z WhatsApp (Ctrl+Enter aby wygenerować)...'
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />
          </div>

          {/* Optional Advisor Hint + Voice Mic */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-700">
                Krótka wytyczna handlowca <span className="font-normal text-slate-400">(opcjonalnie)</span>
              </label>
              <button
                type="button"
                onClick={handleToggleVoiceNote}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold transition ${
                  listeningVoice
                    ? 'bg-rose-600 text-white animate-pulse'
                    : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                }`}
                title="Podyktuj wytyczne głosem"
              >
                {listeningVoice ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                {listeningVoice ? 'Słucham...' : 'Dyktuj głosem'}
              </button>
            </div>
            <input
              type="text"
              value={advisorNotes}
              onChange={(e) => setAdvisorNotes(e.target.value)}
              placeholder="np. Zaproponuj model 70m², dodaj rabat 2% i zaproponuj rozmowę jutro o 11:00"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />
          </div>

          {/* Settings Row: Knowledge + Web Toggle, Tone, Language */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Język odpowiedzi dla klienta
              </label>
              <select
                value={replyLanguage}
                onChange={(e) =>
                  setReplyLanguage(e.target.value as 'auto' | 'pl' | 'en' | 'no' | 'de')
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500"
              >
                <option value="auto">Auto (rozpoznaj język klienta)</option>
                <option value="pl">Polski (PL)</option>
                <option value="en">Angielski (Business EN)</option>
                <option value="no">Norweski / Eksport (NO)</option>
                <option value="de">Niemiecki (DE)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Styl wiadomości
              </label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as 'sales' | 'concise' | 'formal')}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500"
              >
                <option value="sales">Doradczy i sprzedażowy</option>
                <option value="concise">Maksymalnie krótki i punktowy</option>
                <option value="formal">Oficjalny / Gabinetowy B2B</option>
              </select>
            </div>
          </div>

          {/* Channel Switcher: E-mail vs WhatsApp/SMS */}
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-200/80 bg-slate-100/70 p-1">
            <button
              type="button"
              onClick={() => setChannel('email')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition ${
                channel === 'email'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Mail className="h-3.5 w-3.5 text-indigo-600" />
              E-mail (Pełny + Stopka)
            </button>
            <button
              type="button"
              onClick={() => setChannel('sms')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition ${
                channel === 'sms'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
              WhatsApp / SMS (Krótki)
            </button>
          </div>

          {/* Hybrid Knowledge + Internet Switch */}
          <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/50 px-3.5 py-2.5">
            <div className="flex items-center gap-2.5">
              <Globe className="h-4 w-4 shrink-0 text-indigo-600" />
              <div>
                <p className="text-xs font-bold text-slate-900">
                  Baza Wiedzy + Live Google Search
                </p>
                <p className="text-[11px] text-slate-500">
                  Łączy cennik firmy z aktualnymi danymi z sieci i źródłami
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUseWebKnowledge((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                useWebKnowledge ? 'bg-indigo-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                  useWebKnowledge ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Pro Sales Tools Bar: Mini-Quote + Quick Links + Objections Playbook */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIncludeMiniQuote((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition ${
                includeMiniQuote
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="Bot automatycznie pobiera aktualne ceny z Tally (dWO4Oq): parter/poddasze/piętro, fundamenty, dodatki i VAT"
            >
              <Calculator className="h-3.5 w-3.5" />
              Wycena Tally Live (dWO4Oq): {includeMiniQuote ? 'WŁ' : 'WYŁ'}
            </button>

            <button
              type="button"
              onClick={() => setShowQuickLinks((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition ${
                selectedLinkIds.length > 0 || showQuickLinks
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Link2 className="h-3.5 w-3.5" />
              Linki/PDF ({selectedLinkIds.length})
            </button>

            <button
              type="button"
              onClick={() => setShowObjections((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition ${
                showObjections
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
              Obiekcje ({objections.length})
            </button>

            <button
              type="button"
              onClick={() => setShowTallyModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-gradient-to-r from-indigo-50 to-amber-50 px-2.5 py-1.5 text-[11px] font-extrabold text-indigo-900 hover:brightness-95 transition shadow-2xs"
              title="Użyj własnego konfiguratora wycen Tally (dWO4Oq) — wynik wpadnie od razu do bota, Skrzynki i CRM!"
            >
              <Calculator className="h-3.5 w-3.5 text-indigo-600" />
              Konfigurator Tally
            </button>
          </div>

          {showQuickLinks && (
            <div className="space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs">
              <p className="text-[11px] font-bold text-indigo-950">
                Zaznacz swoje linki (synchronizowane w chmurze) do wplecenia w odpowiedź:
              </p>
              {quickLinks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-indigo-200 bg-white/80 px-3 py-2 text-[11px] text-slate-500">
                  Brak zapisanych linków. Dodaj poniżej adres swojego katalogu PDF, cennika lub kalendarza spotkań.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {quickLinks.map((lnk) => {
                    const checked = selectedLinkIds.includes(lnk.id);
                    const isEditingThis = editingLinkId === lnk.id;
                    return (
                      <div key={lnk.id} className="rounded-lg bg-white px-2.5 py-1.5 border border-slate-200/70">
                        {isEditingThis ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              type="text"
                              value={editLinkLabel}
                              onChange={(e) => setEditLinkLabel(e.target.value)}
                              className="flex-1 min-w-[90px] rounded border border-indigo-300 px-2 py-0.5 text-[11px]"
                            />
                            <input
                              type="url"
                              value={editLinkUrl}
                              onChange={(e) => setEditLinkUrl(e.target.value)}
                              className="flex-1 min-w-[120px] rounded border border-indigo-300 px-2 py-0.5 text-[11px]"
                            />
                            <button
                              type="button"
                              onClick={handleSaveEditedLink}
                              className="rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white"
                            >
                              Zapisz
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingLinkId(null)}
                              className="rounded px-1.5 py-0.5 text-[10px] text-slate-500"
                            >
                              Anuluj
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-800 cursor-pointer truncate">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setSelectedLinkIds((prev) =>
                                    checked ? prev.filter((id) => id !== lnk.id) : [...prev, lnk.id]
                                  )
                                }
                                className="rounded border-slate-300 text-indigo-600"
                              />
                              <span className="truncate">{lnk.label}</span>
                              <span className="hidden sm:inline truncate text-[10px] font-normal text-slate-400">
                                ({lnk.url})
                              </span>
                            </label>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingLinkId(lnk.id);
                                  setEditLinkLabel(lnk.label);
                                  setEditLinkUrl(lnk.url);
                                }}
                                className="rounded p-1 text-slate-400 hover:text-indigo-600"
                                title="Edytuj link"
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  persistQuickLinks(quickLinks.filter((q) => q.id !== lnk.id));
                                  setSelectedLinkIds((prev) => prev.filter((id) => id !== lnk.id));
                                }}
                                className="rounded p-1 text-slate-400 hover:text-rose-600"
                                title="Usuń link"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-5 gap-1.5 pt-1">
                <input
                  type="text"
                  value={newLinkLabel}
                  onChange={(e) => setNewLinkLabel(e.target.value)}
                  placeholder="Nazwa (np. Katalog)"
                  className="col-span-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px]"
                />
                <input
                  type="url"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="col-span-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px]"
                />
                <button
                  type="button"
                  onClick={handleAddQuickLink}
                  className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-indigo-700"
                >
                  + Dodaj
                </button>
              </div>
            </div>
          )}

          {showObjections && (
            <div className="space-y-2.5 rounded-2xl border border-amber-200 bg-amber-50/50 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-[11px] font-bold text-amber-950">
                  Biblioteka Obiekcji (kliknij, aby dodać do wytycznych AI):
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {['Wszystkie', ...Array.from(new Set(objections.map((o) => o.category)))].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setObjectionFilter(cat)}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      objectionFilter === cat
                        ? 'bg-amber-600 text-white'
                        : 'bg-white text-slate-600 border border-amber-200/70'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {objections
                  .filter((o) => objectionFilter === 'Wszystkie' || o.category === objectionFilter)
                  .map((obj) => (
                    <button
                      key={obj.id}
                      type="button"
                      onClick={() =>
                        setAdvisorNotes((prev) =>
                          prev ? `${prev} | ${obj.script}` : obj.script
                        )
                      }
                      className="w-full rounded-xl border border-amber-200/80 bg-white p-2 text-left transition hover:border-amber-400 hover:bg-amber-50/60"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-900">{obj.label}</span>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                          {obj.category}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-snug text-slate-600">{obj.script}</p>
                    </button>
                  ))}
              </div>
              <div className="space-y-1.5 border-t border-amber-200/70 pt-2">
                <input
                  type="text"
                  value={newObjLabel}
                  onChange={(e) => setNewObjLabel(e.target.value)}
                  placeholder="Nowa obiekcja (np. Dlaczego brak podpiwniczenia?)"
                  className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-[11px]"
                />
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newObjScript}
                    onChange={(e) => setNewObjScript(e.target.value)}
                    placeholder="Sprawdzony argument sprzedażowy..."
                    className="flex-1 rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={handleAddObjection}
                    className="rounded-lg bg-amber-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-amber-700"
                  >
                    Zapisz
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}

          {/* Primary Action + Follow-up Po Ciszy */}
          <div className="space-y-2">
            <button
              type="button"
              disabled={loading || (!clientMessage.trim() && !lastChatClientMsg)}
              onClick={() => void handleGenerate()}
              className="shimmer-bar flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-700 px-5 py-3.5 text-xs font-bold text-white shadow-md shadow-indigo-950/15 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-600/25 disabled:translate-y-0 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
              ) : (
                <Sparkles className="h-4 w-4 text-indigo-300" />
              )}
              {loading
                ? 'Przygotowuję odpowiedź dla klienta...'
                : 'Generuj odpowiedź dla klienta'}
            </button>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/80 bg-amber-50/50 px-3 py-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-900">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
                Follow-up po ciszy:
              </span>
              <div className="flex gap-1.5">
                {[3, 7].map((days) => (
                  <button
                    key={days}
                    type="button"
                    disabled={loading || (!clientMessage.trim() && !lastChatClientMsg)}
                    onClick={() =>
                      void handleGenerate(
                        clientMessage.trim() ? clientMessage : undefined,
                        advisorNotes,
                        replyLanguage,
                        'concise',
                        channel,
                        days
                      )
                    }
                    className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                  >
                    Po {days} dniach ({channel === 'sms' ? 'SMS/WA' : 'E-mail'})
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Proponowana odpowiedź dla klienta */}
      <div className={`min-w-0 ${showChatsSidebar ? '' : 'lg:col-span-7'}`}>
        {loading ? (
          <div className="soft-card animate-enter flex h-full min-h-[480px] flex-col justify-between rounded-3xl border border-indigo-200/70 bg-white/90 p-7">
            <div className="space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
                <div>
                  <p className="text-xs font-extrabold text-slate-900">
                    AI komponuje odpowiedź dla klienta...
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Sprawdzam cennik w Bazie Wiedzy ({activeTilesCount} reguł) i dane rynkowe
                  </p>
                </div>
              </div>
              <div className="shimmer-bar h-10 w-full rounded-2xl bg-slate-100" />
              <div className="shimmer-bar h-48 w-full rounded-2xl bg-slate-100" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="shimmer-bar h-24 rounded-2xl bg-slate-100" />
                <div className="shimmer-bar h-24 rounded-2xl bg-slate-100" />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
              <span>Silnik: Gemini 3.8 Flash</span>
              <span>Tryb: Hybrydowy RAG + Web</span>
            </div>
          </div>
        ) : !latestReply ? (
          <div className="soft-card flex h-full min-h-[480px] flex-col items-center justify-center rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/70 p-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-700 text-white shadow-lg shadow-indigo-500/20">
              <Mail className="h-6 w-6" />
            </div>
            <h3 className="text-base font-extrabold tracking-tight text-slate-900">
              2. Tutaj pojawi się gotowa odpowiedź dla klienta
            </h3>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
              Wklej wiadomość po lewej stronie i kliknij{' '}
              <strong>„Generuj odpowiedź dla klienta”</strong>. AI połączy Twoją wiedzę firmową z kontekstem rynkowym.
            </p>

            {/* 3 Mini Bento Capability Cards */}
            <div className="mt-6 grid w-full max-w-lg gap-2.5 text-left sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-2xs">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <BookOpen className="h-3.5 w-3.5" />
                </span>
                <p className="mt-2 text-[11px] font-bold text-slate-800">Baza Wiedzy</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Ceny, VAT, marże i zasady firmy</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-2xs">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <Globe className="h-3.5 w-3.5" />
                </span>
                <p className="mt-2 text-[11px] font-bold text-slate-800">Kontekst z Sieci</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Eksport, przepisy i logistyka</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-2xs">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <Clock className="h-3.5 w-3.5" />
                </span>
                <p className="mt-2 text-[11px] font-bold text-slate-800">Gotowy Mail</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Edycja, Follow-up i tłumaczenie</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {replyHistory.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200/70 bg-white/80 px-3.5 py-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                  <History className="h-3.5 w-3.5 text-indigo-600" />
                  Ostatnie:
                </span>
                {replyHistory.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onReplyComplete(item.reply)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                      latestReply.subject === item.subject
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {item.client}
                  </button>
                ))}
              </div>
            )}

            {/* Main Response Card */}
            <div className="soft-card rounded-3xl border border-slate-200/80 bg-white p-6 space-y-4">
              {/* Top Bar: Client & Copy Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                      Klient: {latestReply.detectedClientName}
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      Język: {latestReply.detectedLanguage}
                    </span>
                    {latestReply.buyingSignal && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
                          latestReply.buyingSignal.temperature === 'HOT'
                            ? 'bg-rose-100 text-rose-700'
                            : latestReply.buyingSignal.temperature === 'WARM'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-sky-100 text-sky-700'
                        }`}
                        title={latestReply.buyingSignal.summary}
                      >
                        <Flame className="h-3 w-3" />
                        Lead: {latestReply.buyingSignal.temperature}
                      </span>
                    )}
                    {latestReply.detectedRecipientEmail && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-600">
                        {latestReply.detectedRecipientEmail}
                      </span>
                    )}
                    {latestReply.detectedRecipientPhone && (
                      <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-mono text-emerald-700">
                        {latestReply.detectedRecipientPhone}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                      <Clock className="h-3 w-3" />
                      Zaoszczędzono ~{latestReply.estimatedTimeSavedMinutes || 15} min
                    </span>
                    {latestReply.tallyQuote && latestReply.tallyQuote.totalNetPln > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800"
                        title={`Wyliczono bezpośrednio przez silnik Tally (${latestReply.tallyQuote.formId})`}
                      >
                        <Calculator className="h-3 w-3" />
                        Tally Engine: {latestReply.tallyQuote.totalNetPln.toLocaleString('pl-PL')} zł netto
                      </span>
                    )}
                    {latestReply.contextStats && (
                      <span
                        className="rounded-md border border-indigo-200 bg-indigo-50/70 px-2 py-0.5 text-[10px] font-semibold text-indigo-700"
                        title={`Inteligentny Kompilator Kontekstu wybrał ${latestReply.contextStats.selectedTilesCount} z ${latestReply.contextStats.totalActiveTiles} kafelków (${latestReply.contextStats.criticalCount} krytycznych, odfiltrowano ${latestReply.contextStats.omittedTilesCount}, oszczędność ok. ${latestReply.contextStats.tokensSavedEstimate} tokenów)`}
                      >
                        Kontekst: {latestReply.contextStats.selectedTilesCount}/{latestReply.contextStats.totalActiveTiles}
                        {latestReply.contextStats.tokensSavedEstimate > 0
                          ? ` (-${latestReply.contextStats.tokensSavedEstimate} tok.)`
                          : ''}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{latestReply.summaryOfInquiry}</p>
                  {latestReply.buyingSignal && (
                    <p className="mt-1 text-[11px] font-medium text-indigo-700">
                      Sygnał zakupowy: {latestReply.buyingSignal.summary}
                      {latestReply.buyingSignal.detectedObjections.length > 0 &&
                        ` • Obiekcje: ${latestReply.buyingSignal.detectedObjections.join(', ')}`}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy('body')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {copiedMode === 'body' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedMode === 'body' ? 'Skopiowano treść' : 'Kopiuj treść'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy('all')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-600"
                  >
                    {copiedMode === 'all' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedMode === 'all' ? 'Skopiowano całość!' : 'Kopiuj Temat + Treść'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const textToShare = `${editableSubject ? `*${editableSubject}*\n\n` : ''}${editableBody}`;
                      const encoded = encodeURIComponent(textToShare);
                      // Próba otwarcia protokołu natywnego WhatsApp na Windowsie, a w nowej karcie WhatsApp Web
                      window.open(`https://web.whatsapp.com/send?text=${encoded}`, '_blank');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs"
                    title="Otwórz czat WhatsApp Web lub Desktop z gotową odpowiedzią"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                    Wyślij na WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyRichEmail()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                    title="Kopiuje gotowy sformatowany HTML + linki źródłowe do wklejenia w Outlook / Gmail (Ctrl+V)"
                  >
                    {copiedMode === 'rich' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Mail className="h-3.5 w-3.5" />
                    )}
                    {copiedMode === 'rich' ? 'Skopiowano E-mail HTML!' : 'Kopiuj gotowy E-mail (HTML)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportPdf()}
                    disabled={exportingPdf}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-60"
                    title="Pobierz ofertę / odpowiedź jako sformatowany dokument PDF A4"
                  >
                    {exportingPdf ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-indigo-600" />
                    )}
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintReply}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
                    title="Drukuj lub zapisz jako PDF przez podgląd wydruku"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Drukuj
                  </button>
                  <a
                    href={`mailto:${encodeURIComponent(latestReply.detectedRecipientEmail || '')}?subject=${encodeURIComponent(editableSubject)}&body=${encodeURIComponent(editableBody)}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                    title="Otwórz gotowy szkic w domyślnym programie pocztowym"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Otwórz w poczcie
                  </a>
                  <button
                    type="button"
                    disabled={sendingWhatsApp}
                    onClick={async () => {
                      const cfg = getStoredIntegrationsConfig();
                      const targetPhone = (latestReply.detectedRecipientPhone || cfg.whatsapp.defaultRecipient || '').replace(/[^0-9]/g, '');
                      if (cfg.whatsapp.enabled && cfg.whatsapp.phoneNumberId && cfg.whatsapp.accessToken && targetPhone) {
                        setSendingWhatsApp(true);
                        setChannelStatus(null);
                        try {
                          const res = await sendWhatsAppMessage({
                            phoneNumberId: cfg.whatsapp.phoneNumberId,
                            accessToken: cfg.whatsapp.accessToken,
                            to: targetPhone,
                            text: editableBody,
                          });
                          setChannelStatus(`Wysłano przez WhatsApp API na +${res.to}`);
                        } catch (err) {
                          setChannelStatus(err instanceof Error ? err.message : 'Błąd wysyłki WhatsApp API');
                        } finally {
                          setSendingWhatsApp(false);
                        }
                      } else {
                        window.open(
                          `https://wa.me/${targetPhone}?text=${encodeURIComponent(editableBody)}`,
                          '_blank',
                          'noopener,noreferrer'
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    title="Wyślij przez WhatsApp Cloud API lub otwórz w WhatsApp Web"
                  >
                    {sendingWhatsApp ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MessageCircle className="h-3.5 w-3.5" />
                    )}
                    WhatsApp
                  </button>
                  {getStoredIntegrationsConfig().gmail.mode === 'webhook' &&
                    getStoredIntegrationsConfig().gmail.webhookUrl && (
                      <button
                        type="button"
                        disabled={sendingGmail}
                        onClick={async () => {
                          const cfg = getStoredIntegrationsConfig();
                          setSendingGmail(true);
                          setChannelStatus(null);
                          try {
                            await sendGmailBridge({
                              webhookUrl: cfg.gmail.webhookUrl,
                              senderEmail: cfg.gmail.senderEmail,
                              subject: editableSubject,
                              body: editableBody,
                              company: preset.name,
                            });
                            setChannelStatus('Przekazano szkic/wysyłkę do mostka Gmail (Make/n8n)');
                          } catch (err) {
                            setChannelStatus(err instanceof Error ? err.message : 'Błąd mostka Gmail');
                          } finally {
                            setSendingGmail(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        {sendingGmail ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Mail className="h-3.5 w-3.5" />
                        )}
                        Mostek Gmail
                      </button>
                    )}
                  {onSendWebhookPayload && latestReply && (
                    <button
                      type="button"
                      disabled={sendingWebhook}
                      onClick={async () => {
                        setSendingWebhook(true);
                        await onSendWebhookPayload(
                          {
                            event: 'bizops.sales_reply.generated',
                            company: preset.name,
                            channel,
                            language: latestReply.detectedLanguage,
                            subject: editableSubject,
                            replyBody: editableBody,
                            companyFactsUsed: latestReply.companyFactsUsed,
                            webSources: latestReply.webSources || [],
                            timestamp: new Date().toISOString(),
                          },
                          'Wysłano odpowiedź z Asystenta do Make / CRM'
                        );
                        setSendingWebhook(false);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
                      title="Wyślij odpowiedź i dane klienta do Make / n8n / CRM"
                    >
                      {sendingWebhook ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Webhook className="h-3.5 w-3.5 text-indigo-600" />
                      )}
                      Wyślij do Make
                    </button>
                  )}
                </div>
              </div>

              {channelStatus && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                  {channelStatus}
                </div>
              )}

              {/* BLOK A: Polecenia kalkulacyjne Tally (dWO4Oq) — domyślnie zwarty pasek, rozwija się po wyliczeniu */}
              {!integratedTallyQuote || integratedTallyQuote.breakdown.length === 0 ? (
                <div className="rounded-2xl border border-slate-200/90 bg-slate-50/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-white">
                      <Calculator className="h-3 w-3 text-emerald-300" />
                      Polecenia kalkulacyjne (Tally dWO4Oq)
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">
                      {integratingTally
                        ? 'Liczenie wyceny na żywo z Tally...'
                        : 'Tryb bazowy: sama odpowiedź — wybierz polecenie, aby wyliczyć i dopiąć kosztorys'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={integratingTally || loading}
                      onClick={() => void handleIntegrateTallyQuote('combined', { hideItemizedPrices: false })}
                      className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-2xs transition hover:bg-emerald-700 disabled:opacity-50"
                      title="Wylicz pozycje z Tally na bazie rozmowy i dopnij pełny kosztorys pod odpowiedzią"
                    >
                      {integratingTally ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Calculator className="h-3 w-3" />
                      )}
                      + Wylicz i dołącz kosztorys
                    </button>
                    <button
                      type="button"
                      disabled={integratingTally || loading}
                      onClick={() =>
                        void handleIntegrateTallyQuote('combined', {
                          includeWarsawRef: true,
                          hideItemizedPrices: false,
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-xl border border-emerald-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      title="Wylicz kosztorys i dopnij na dole przykład dostawy z płytą fundamentową do Warszawy"
                    >
                      <MapPin className="h-3 w-3" />
                      + Warszawa + płyta
                    </button>
                    <button
                      type="button"
                      disabled={integratingTally || loading}
                      onClick={() =>
                        void handleIntegrateTallyQuote('combined', { hideItemizedPrices: true })
                      }
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      title="Wylicz zakres z Tally, ale ukryj ceny pozycji — zostaw tylko cenę końcową"
                    >
                      <EyeOff className="h-3 w-3" />
                      Ukryj cenniki (tylko finał)
                    </button>
                    <button
                      type="button"
                      disabled={integratingTally || loading}
                      onClick={() => void handleIntegrateTallyQuote('quote_only')}
                      className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-bold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                      title="Zamień wiadomość na sam czysty kosztorys Tally"
                    >
                      Tylko sam kosztorys
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/60 via-white to-indigo-50/40 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
                        <Calculator className="h-3 w-3" />
                        Kosztorys Tally (dWO4Oq)
                      </span>
                      <span className="text-xs font-extrabold text-slate-900">
                        {integratedTallyQuote.quantity > 1 && (
                          <span className="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-extrabold text-indigo-800">
                            × {integratedTallyQuote.quantity} domki
                          </span>
                        )}
                        {integratedTallyQuote.totalNetPln.toLocaleString('pl-PL')} zł netto
                        <span className="mx-1 font-normal text-slate-400">•</span>
                        <span className="text-emerald-800">
                          {integratedTallyQuote.totalGrossPln.toLocaleString('pl-PL')} zł brutto ({integratedTallyQuote.vatRate}% VAT)
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleToggleHideItemizedPrices}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-extrabold transition ${
                          hideItemizedPrices
                            ? 'bg-slate-900 text-white shadow-2xs'
                            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                        title="Ukrywa ceny pojedynczych pozycji w wiadomości — zostawia zakres oraz wyłącznie cenę końcową"
                      >
                        {hideItemizedPrices ? <EyeOff className="h-3 w-3 text-amber-300" /> : <Eye className="h-3 w-3" />}
                        {hideItemizedPrices ? 'Cenniki ukryte (tylko finał)' : 'Ukryj cenniki'}
                      </button>
                      {integratedTallyQuote.warsawSlabReference && (
                        <button
                          type="button"
                          onClick={handleToggleWarsawRef}
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                            includeWarsawRef
                              ? 'border border-emerald-400 bg-emerald-100 text-emerald-900'
                              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                          }`}
                          title="Dodaje na samym końcu przykładowy koszt domu na płycie fundamentowej z dostawą do Warszawy (~600 km z Przemyśla)"
                        >
                          <MapPin className="h-3 w-3" />
                          Warszawa + płyta
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleToggleIllustrativeNotice}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-extrabold transition ${
                          integratedTallyQuote.isIllustrativeEstimate
                            ? 'bg-amber-500 text-slate-950 shadow-2xs ring-1 ring-amber-600/30'
                            : 'border border-amber-300 bg-white text-amber-800 hover:bg-amber-50'
                        }`}
                        title="Dodaje lub usuwa wyraźną adnotację dla klienta, że wycena ma charakter przykładowy i pomocniczy (niepotwierdzona przez klienta)"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {integratedTallyQuote.isIllustrativeEstimate
                          ? 'Kalkulacja przykładowa (pomoc dla klienta): WŁ'
                          : 'Oznacz jako przykładową'}
                      </button>
                      {([8, 23] as const).map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          onClick={() => handleSwitchIntegratedVat(rate)}
                          className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                            integratedTallyQuote.vatRate === rate
                              ? 'bg-slate-900 text-white'
                              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          VAT {rate}%
                        </button>
                      ))}
                      {onCreateCrmDeal && (
                        <button
                          type="button"
                          onClick={handleCreateDealFromIntegratedQuote}
                          className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-indigo-700"
                          title="Zapisz tę wycenę na tablicy CRM"
                        >
                          + Zapisz do CRM
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={integratingTally || loading}
                        onClick={() => void handleIntegrateTallyQuote(replyOutputMode === 'reply_only' ? 'combined' : replyOutputMode)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                        title="Pobierz aktualne ceny z tally.so/r/dWO4Oq i przelicz kosztorys na bazie całej rozmowy"
                      >
                        {integratingTally ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        Odśwież
                      </button>
                      <button
                        type="button"
                        onClick={handleClearIntegratedQuote}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                        title="Usuń kalkulację i wróć do samej odpowiedzi"
                      >
                        <X className="h-3 w-3" />
                        Zwiń
                      </button>
                    </div>
                  </div>

                  {/* Rozpisane pozycje kosztorysu Tally */}
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {integratedTallyQuote.breakdown.map((item) => (
                      <div
                        key={item.key}
                        className="flex items-start justify-between gap-2 rounded-xl border border-emerald-200/70 bg-white px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-900 leading-snug">
                            {item.label}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate" title={item.formula}>
                            {item.formula}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-[11px] font-extrabold text-emerald-800 whitespace-nowrap">
                            {hideItemizedPrices ? 'w cenie końcowej' : `${item.netPln.toLocaleString('pl-PL')} zł`}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveIntegratedItem(item.key)}
                            className="rounded p-0.5 text-slate-300 hover:text-rose-600"
                            title="Usuń tę pozycję z kosztorysu"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {integratedTallyQuote.isIllustrativeEstimate && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-950 flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
                      <span>{integratedTallyQuote.assumedSummary}</span>
                    </div>
                  )}

                  {integratedTallyQuote.missingQuestions.length > 0 && (
                    <p className="text-[10px] text-amber-900 bg-amber-50/90 border border-amber-200/70 rounded-xl px-2.5 py-1.5">
                      <strong>Brakuje w Tally ({integratedTallyQuote.missingQuestions.length}):</strong>{' '}
                      {integratedTallyQuote.missingQuestions.slice(0, 4).join(' • ')}
                    </p>
                  )}

                  {/* 3 Przyciski trybu złożenia efektu końcowego */}
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-emerald-200/70 pt-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">
                      Tryb wiadomości:
                    </span>
                    <button
                      type="button"
                      disabled={integratingTally}
                      onClick={() => applyReplyOutputMode('combined')}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition ${
                        replyOutputMode === 'combined'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700'
                      }`}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Połącz kosztorys i odpowiedź
                    </button>
                    <button
                      type="button"
                      disabled={integratingTally}
                      onClick={() => applyReplyOutputMode('quote_only')}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition ${
                        replyOutputMode === 'quote_only'
                          ? 'bg-emerald-700 text-white shadow-xs'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-emerald-400 hover:text-emerald-800'
                      }`}
                    >
                      <Calculator className="h-3.5 w-3.5" />
                      Tylko sam kosztorys
                    </button>
                    <button
                      type="button"
                      onClick={() => applyReplyOutputMode('reply_only')}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition ${
                        replyOutputMode === 'reply_only'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700'
                      }`}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Sama odpowiedź (bez cen)
                    </button>
                  </div>
                </div>
              )}

              {/* Editable Subject */}
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Temat wiadomości (możesz edytować przed wysłaniem)
                </label>
                <input
                  type="text"
                  value={editableSubject}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditableSubject(val);
                    setDraftDirtyLang(activeDraftLang);
                    setDraftCache((prev) => ({
                      ...prev,
                      [activeDraftLang]: { subject: val, body: editableBody },
                    }));
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>

              {/* Editable Body */}
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Proponowana odpowiedź dla klienta
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-100 p-0.5">
                      <button
                        type="button"
                        disabled={Boolean(translatingLang) || loading}
                        onClick={() => void handleSwitchDraftLanguage('pl')}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                          activeDraftLang === 'pl'
                            ? 'bg-white text-indigo-700 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Przetłumacz 1:1 na polski (lub przełącz w 0 ms), aby doradca mógł szybko przeczytać i sprawdzić treść"
                      >
                        {translatingLang === 'pl' && <Loader2 className="h-3 w-3 animate-spin" />}
                        🇵🇱 Czytaj PL {draftCache.pl && activeDraftLang !== 'pl' && !draftDirtyLang ? '✓' : ''}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(translatingLang) || loading}
                        onClick={() => void handleSwitchDraftLanguage('en')}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                          activeDraftLang === 'en'
                            ? 'bg-white text-indigo-700 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Przełącz lub przetłumacz wiernie na angielski (EN) gotowy do wysłania"
                      >
                        {translatingLang === 'en' && <Loader2 className="h-3 w-3 animate-spin" />}
                        🇬🇧 Wersja EN {draftCache.en && activeDraftLang !== 'en' && !draftDirtyLang ? '✓' : ''}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditableBody((prev) => formatStructuredReplyText(prev))}
                      className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-2 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 transition"
                      title="Rozdziel punktory i sekcje do czytelnego układu akapit po akapicie"
                    >
                      Uporządkuj punktację
                    </button>
                  </div>
                </div>
                <textarea
                  rows={16}
                  value={editableBody}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditableBody(val);
                    setDraftDirtyLang(activeDraftLang);
                    setDraftCache((prev) => ({
                      ...prev,
                      [activeDraftLang]: { subject: editableSubject, body: val },
                    }));
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-800 outline-none focus:border-indigo-500 focus:bg-white font-sans whitespace-pre-wrap"
                />
              </div>

              {/* Quick 1-Click Refinements */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <span className="text-[11px] font-semibold text-slate-500">
                  Szybka korekta AI 1-kliknięciem:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      void handleGenerate(
                        clientMessage,
                        'Skróć odpowiedź o połowę — same konkretne punkty i liczby.',
                        replyLanguage,
                        'concise'
                      )
                    }
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    Skróć i wypunktuj
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      void handleGenerate(
                        clientMessage,
                        'Dodaj dokładne zestawienie cenowe, transze płatności oraz zaproponuj rozmowę telefoniczną.',
                        replyLanguage,
                        'sales'
                      )
                    }
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    Rozwiń wycenę i warunki
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      void handleGenerate(
                        clientMessage,
                        advisorNotes,
                        replyLanguage,
                        'concise',
                        channel,
                        3
                      )
                    }
                    className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    Follow-up (cisza 3 dni)
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      void handleGenerate(
                        clientMessage,
                        advisorNotes,
                        replyLanguage,
                        'concise',
                        channel,
                        7
                      )
                    }
                    className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    Follow-up (cisza 7 dni)
                  </button>
                  <button
                    type="button"
                    disabled={loading || Boolean(translatingLang)}
                    onClick={() => void handleSwitchDraftLanguage('en')}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                      activeDraftLang === 'en'
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    {translatingLang === 'en' ? 'Tłumaczę na EN...' : 'Przetłumacz 1:1 na angielski (EN)'}
                  </button>
                  <button
                    type="button"
                    disabled={loading || Boolean(translatingLang)}
                    onClick={() => void handleSwitchDraftLanguage('pl')}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                      activeDraftLang === 'pl'
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    {translatingLang === 'pl' ? 'Tłumaczę na PL...' : 'Przetłumacz 1:1 na polski (PL)'}
                  </button>
                </div>
              </div>
            </div>

            {/* Sources Breakdown: Company Knowledge vs Web/Market Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="soft-card rounded-3xl border border-slate-200/80 bg-white p-5">
                <div className="mb-2.5 flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <BookOpen className="h-3.5 w-3.5 text-emerald-600" />
                    Z Bazy Wiedzy Firmy
                  </h4>
                  <button
                    type="button"
                    onClick={onOpenKnowledge}
                    className="text-[11px] font-semibold text-indigo-600 hover:underline"
                  >
                    Edytuj wiedzę →
                  </button>
                </div>
                <ul className="space-y-1.5 text-xs text-slate-600">
                  {latestReply.companyFactsUsed.map((fact, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="soft-card rounded-3xl border border-slate-200/80 bg-white p-5">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <Globe className="h-3.5 w-3.5 text-indigo-600" />
                    Informacje z Internetu i rynku
                  </h4>
                  {onQuickAddTile && latestReply.webAndMarketFactsUsed.length > 0 && (
                    <button
                      type="button"
                      disabled={savedGapToKb}
                      onClick={() => {
                        onQuickAddTile({
                          title: `Uzupełnienie wiedzy: ${editableSubject.slice(0, 45) || 'Zapytanie klienta'}`,
                          category: 'Oferta',
                          content: latestReply.webAndMarketFactsUsed.join('\n• '),
                        });
                        setSavedGapToKb(true);
                      }}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                        savedGapToKb
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      }`}
                    >
                      {savedGapToKb ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                      {savedGapToKb ? 'Dodano do Bazy' : 'Zapisz w Bazie Wiedzy'}
                    </button>
                  )}
                </div>
                {latestReply.webAndMarketFactsUsed.length === 0 &&
                (!latestReply.webSources || latestReply.webSources.length === 0) &&
                (!latestReply.searchQueries || latestReply.searchQueries.length === 0) ? (
                  <p className="text-xs text-slate-400">
                    Odpowiedź oparta w 100% na wewnętrznej Bazie Wiedzy.
                  </p>
                ) : (
                  <WebSourcesPanel
                    webFactsUsed={latestReply.webAndMarketFactsUsed}
                    webSources={latestReply.webSources}
                    searchQueries={latestReply.searchQueries}
                    onInsertSourceLink={handleInsertSourceLink}
                    title="Źródła zewnętrzne (Google Search) — kliknij, aby otworzyć lub wkleić"
                  />
                )}
              </div>
            </div>

            {/* Internal Advisor Tip & Follow-up Questions */}
            <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 p-4">
              <div className="flex items-start gap-2.5">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="space-y-2 text-xs">
                  <p className="font-bold text-amber-950">
                    Wskazówka wewnętrzna dla handlowca (niewidoczna dla klienta):
                  </p>
                  <p className="text-amber-900 leading-relaxed">{latestReply.internalAdvisorTip}</p>
                  {latestReply.followUpQuestionsToClient.length > 0 && (
                    <div className="pt-1">
                      <p className="flex items-center gap-1 font-semibold text-amber-950">
                        <HelpCircle className="h-3.5 w-3.5" />O co warto dopytać klienta w rozmowie:
                      </p>
                      <ul className="mt-1 list-disc pl-4 space-y-0.5 text-amber-900">
                        {latestReply.followUpQuestionsToClient.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <TallyConfiguratorModal
        open={showTallyModal}
        onClose={() => setShowTallyModal(false)}
        presetName={preset.name}
        onCreateDeal={onCreateCrmDeal}
        onQuoteToResponder={(summaryText) => {
          setClientMessage(summaryText);
          setAdvisorNotes('Przygotuj profesjonalną ofertę na bazie wyliczeń z naszego Konfiguratora Tally.');
          void refreshCloudInbox();
        }}
      />
      </div>
    </div>
  );
};
