import { useEffect, useState } from 'react';
import {
  BookOpen,
  Building2,
  FileSearch,
  Globe,
  Link2,
  MailCheck,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  SunMedium,
} from 'lucide-react';
import { INDUSTRY_PRESETS } from './data/presets';
import type {
  AiOpsLogEntry,
  AppLanguage,
  AppTab,
  AppTheme,
  AuditResult,
  ChatMessage,
  ChatPerspective,
  CrmDeal,
  IndustryPreset,
  KnowledgeTile,
  SalesReplyResult,
  WebhookConfig,
} from './types';
import { fetchCloudTiles, saveBatchCloudTiles, sendToWebhook } from './utils/apiClient';
import { UI_TEXT } from './utils/i18n';
import { SalesResponderView } from './components/SalesResponderView';
import { AuditView } from './components/AuditView';
import { KnowledgeView } from './components/KnowledgeView';
import { ChatView } from './components/ChatView';
import { SettingsModal } from './components/SettingsModal';
import { CustomProfileModal } from './components/CustomProfileModal';
import { IntegrationsModal } from './components/IntegrationsModal';
import { ToastNotification, type ToastItem } from './components/ToastNotification';
import { WelcomeModal, type UserProfile } from './components/WelcomeModal';
import { GeminiQuotaWidget } from './components/GeminiQuotaWidget';

const STORAGE_TILES_PREFIX = 'bizops_tiles_v2_';
const STORAGE_DEALS_PREFIX = 'bizops_deals_v2_';
const STORAGE_LOGS_KEY = 'bizops_ops_logs_v2';
const STORAGE_WEBHOOK_KEY = 'bizops_webhook_cfg_v2';
const STORAGE_LANG_KEY = 'bizops_lang_v2';
const STORAGE_THEME_KEY = 'bizops_theme_v2';
const STORAGE_CUSTOM_PRESETS_KEY = 'bizops_custom_presets_v1';

function loadPresetTiles(presetId: string): KnowledgeTile[] {
  const preset = INDUSTRY_PRESETS.find((p) => p.id === presetId) || INDUSTRY_PRESETS[0];
  try {
    const raw = localStorage.getItem(`${STORAGE_TILES_PREFIX}${preset.id}`);
    if (raw) {
      const parsed = JSON.parse(raw) as KnowledgeTile[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // fallback to defaults
  }
  return preset.defaultTiles;
}

function loadPresetDeals(presetId: string): CrmDeal[] {
  const preset = INDUSTRY_PRESETS.find((p) => p.id === presetId) || INDUSTRY_PRESETS[0];
  try {
    const raw = localStorage.getItem(`${STORAGE_DEALS_PREFIX}${preset.id}`);
    if (raw) {
      const parsed = JSON.parse(raw) as CrmDeal[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // fallback to defaults
  }
  return preset.defaultDeals;
}

export function App() {
  const [customPresets, setCustomPresets] = useState<IndustryPreset[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CUSTOM_PRESETS_KEY);
      return raw ? (JSON.parse(raw) as IndustryPreset[]) : [];
    } catch {
      return [];
    }
  });
  const allPresets = [...INDUSTRY_PRESETS, ...customPresets];
  const [activePresetId, setActivePresetId] = useState<string>(INDUSTRY_PRESETS[0].id);
  const [customProfileOpen, setCustomProfileOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('responder');
  const [language, setLanguage] = useState<AppLanguage>(() => {
    try {
      return localStorage.getItem(STORAGE_LANG_KEY) === 'en' ? 'en' : 'pl';
    } catch {
      return 'pl';
    }
  });
  const [appTheme, setAppTheme] = useState<AppTheme>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME_KEY);
      if (saved === 'warm' || saved === 'dark' || saved === 'light') return saved;
      return 'light';
    } catch {
      return 'light';
    }
  });

  const [tilesByPreset, setTilesByPreset] = useState<Record<string, KnowledgeTile[]>>(() => {
    const map: Record<string, KnowledgeTile[]> = {};
    for (const p of INDUSTRY_PRESETS) {
      map[p.id] = loadPresetTiles(p.id);
    }
    return map;
  });

  const [dealsByPreset, setDealsByPreset] = useState<Record<string, CrmDeal[]>>(() => {
    const map: Record<string, CrmDeal[]> = {};
    for (const p of INDUSTRY_PRESETS) {
      map[p.id] = loadPresetDeals(p.id);
    }
    return map;
  });

  const [messagesByPreset, setMessagesByPreset] = useState<Record<string, ChatMessage[]>>({});
  const [perspective, setPerspective] = useState<ChatPerspective>('client');
  const [auditByPreset, setAuditByPreset] = useState<Record<string, AuditResult | null>>({});
  const [replyByPreset, setReplyByPreset] = useState<Record<string, SalesReplyResult | null>>({});
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);
  const [handoffResponderText, setHandoffResponderText] = useState<string | null>(null);

  const [logs, setLogs] = useState<AiOpsLogEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_LOGS_KEY);
      return raw ? (JSON.parse(raw) as AiOpsLogEntry[]) : [];
    } catch {
      return [];
    }
  });

  const [webhookConfig] = useState<WebhookConfig>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_WEBHOOK_KEY);
      return raw
        ? (JSON.parse(raw) as WebhookConfig)
        : { url: '', autoSendOnHighRisk: false, simulateWhenEmpty: true };
    } catch {
      return { url: '', autoSendOnHighRisk: false, simulateWhenEmpty: true };
    }
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [floatingToasts, setFloatingToasts] = useState<ToastItem[]>([]);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'connected' | 'syncing' | 'error'>('connected');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => {
    try {
      const raw = localStorage.getItem('bizops_user_profile');
      return raw ? (JSON.parse(raw) as UserProfile) : null;
    } catch {
      return null;
    }
  });
  const [welcomeModalOpen, setWelcomeModalOpen] = useState(() => {
    return !localStorage.getItem('bizops_user_profile');
  });

  const addFloatingToast = (item: Omit<ToastItem, 'id' | 'timestamp'>) => {
    const newToast: ToastItem = {
      id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...item,
    };
    setFloatingToasts((prev) => [newToast, ...prev.slice(0, 4)]);
  };

  const dismissFloatingToast = (id: string) => {
    setFloatingToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const preset = allPresets.find((p) => p.id === activePresetId) || allPresets[0];
  const currentTiles = tilesByPreset[preset.id] || preset.defaultTiles;
  const currentDeals = dealsByPreset[preset.id] || preset.defaultDeals;
  const currentMessages = messagesByPreset[preset.id] || [];
  const currentAudit = auditByPreset[preset.id] || null;
  const currentReply = replyByPreset[preset.id] || null;
  const ui = UI_TEXT[language];

  // Neon Postgres Realtime Sync Effect
  useEffect(() => {
    let isMounted = true;

    async function syncWithCloud(isInitial = false) {
      try {
        const res = await fetchCloudTiles(preset.id);
        if (!isMounted || !res.success) return;

        // If cloud table is empty for this preset, seed current tiles to Neon!
        if (res.tiles.length === 0 && currentTiles.length > 0) {
          await saveBatchCloudTiles(currentTiles, preset.id, 'Inicjalizacja');
          if (isMounted) {
            setCloudSyncStatus('connected');
            if (isInitial) {
              addFloatingToast({
                type: 'sync',
                title: 'Neon Postgres Aktywny',
                message: `Baza w chmurze zainicjalizowana (${currentTiles.length} kafelków)`,
              });
            }
          }
          return;
        }

        const serverTiles = res.tiles;
        const localMap = new Map(currentTiles.map((t) => [t.id, t]));
        let hasNewOrUpdated = false;
        let newestTileTitle = '';
        let newestAuthor = '';

        for (const st of serverTiles) {
          const local = localMap.get(st.id);
          if (!local) {
            hasNewOrUpdated = true;
            newestTileTitle = st.title;
            newestAuthor = st.authorName || 'Zespół';
            break;
          }
          if (local.content !== st.content || local.title !== st.title || local.enabled !== st.enabled) {
            hasNewOrUpdated = true;
            newestTileTitle = st.title;
            newestAuthor = st.authorName || 'Zespół';
            break;
          }
        }

        if (hasNewOrUpdated || (isInitial && serverTiles.length !== currentTiles.length)) {
          setTilesByPreset((prev) => ({ ...prev, [preset.id]: serverTiles }));
          if (!isInitial) {
            addFloatingToast({
              type: 'updated',
              title: 'Wiedza zaktualizowana',
              message: `Nowy kafelek: "${newestTileTitle || 'Reguła biznesowa'}"`,
              authorName: newestAuthor,
            });
          }
        }

        if (isMounted) setCloudSyncStatus('connected');
      } catch (err) {
        console.warn('Błąd synchronizacji chmury Neon:', err);
        if (isMounted) setCloudSyncStatus('error');
      }
    }

    void syncWithCloud(true);

    const interval = setInterval(() => {
      void syncWithCloud(false);
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [preset.id]);

  const handleTilesChangeWithCloud = async (next: KnowledgeTile[]) => {
    setTilesByPreset((prev) => ({ ...prev, [preset.id]: next }));
    const author = userProfile?.name
      ? `${userProfile.name} (${userProfile.role.split('/')[0].trim()})`
      : 'Użytkownik';
    try {
      await saveBatchCloudTiles(next, preset.id, author);
      addFloatingToast({
        type: 'created',
        title: 'Zapisano w chmurze',
        message: 'Kafelek zsynchronizowany ze wszystkimi użytkownikami',
        authorName: author,
      });
    } catch (err) {
      console.error('Błąd zapisu kafelka do chmury:', err);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_TILES_PREFIX}${preset.id}`, JSON.stringify(currentTiles));
    } catch {
      // ignore
    }
  }, [preset.id, currentTiles]);

  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_DEALS_PREFIX}${preset.id}`, JSON.stringify(currentDeals));
    } catch {
      // ignore
    }
  }, [preset.id, currentDeals]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_LOGS_KEY, JSON.stringify(logs.slice(0, 60)));
    } catch {
      // ignore
    }
  }, [logs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_LANG_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_THEME_KEY, appTheme);
    } catch {
      // ignore
    }
  }, [appTheme]);

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), 3200);
  };

  const appendLog = (entry: Omit<AiOpsLogEntry, 'id' | 'timestamp' | 'presetName' | 'model'>) => {
    setLogs((prev) => [
      {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        presetName: preset.shortName,
        model: 'gemini-3.8-flash',
        ...entry,
      },
      ...prev,
    ]);
  };

  const handleCreateCrmDeal = (dealInput: Omit<CrmDeal, 'id' | 'createdAt'>) => {
    const newDeal: CrmDeal = {
      ...dealInput,
      id: `deal_${Date.now()}`,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setDealsByPreset((prev) => ({
      ...prev,
      [preset.id]: [newDeal, ...(prev[preset.id] || preset.defaultDeals)],
    }));
    showToast(`Zapisano sprawę: ${newDeal.client}`);
  };

  const handleSendWebhook = async (payload: Record<string, unknown>, label: string) => {
    try {
      const result = await sendToWebhook({
        webhookUrl: webhookConfig.url,
        simulate: webhookConfig.simulateWhenEmpty && !webhookConfig.url.trim(),
        payload,
      });
      appendLog({
        action: 'webhook',
        latencyMs: result.latencyMs,
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        status: result.ok ? 'success' : 'error',
        summary: `${label} (${result.simulated ? 'Symulacja HTTP 200' : `HTTP ${result.status}`})`,
      });
      showToast(
        result.simulated
          ? `Wysłano JSON (Symulacja Make/n8n HTTP 200)`
          : `Wysłano do webhooka (HTTP ${result.status})`,
        result.ok ? 'ok' : 'err'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd wysyłki webhooka';
      showToast(msg, 'err');
    }
  };

  const handleResetPreset = () => {
    setTilesByPreset((prev) => ({
      ...prev,
      [preset.id]: preset.defaultTiles,
    }));
    showToast(`Przywrócono domyślną bazę wiedzy dla: ${preset.shortName}`);
  };

  const activeTilesCount = currentTiles.filter((t) => t.enabled).length;

  return (
    <div
      className={`min-h-screen pb-16 transition-colors duration-300 ${
        appTheme === 'dark'
          ? 'theme-dark'
          : appTheme === 'warm'
            ? 'theme-warm text-slate-900'
            : 'saas-ambient text-slate-900'
      }`}
    >
      {/* SaaS Premium Sticky Header */}
      <header
        className={`sticky top-0 z-30 border-b backdrop-blur-xl transition-colors ${
          appTheme === 'dark'
            ? 'border-slate-800 bg-slate-900/85'
            : appTheme === 'warm'
              ? 'border-stone-200/80 bg-[#fbf9f5]/85'
              : 'border-slate-200/70 bg-white/80'
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          {/* Brand Identity */}
          <div className="flex items-center gap-3.5">
            <img
              src="/app-icon.jpg"
              alt="BizOps AI Studio"
              className="h-10 w-10 rounded-2xl object-cover shadow-sm ring-1 ring-slate-200/80"
            />
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-[15px] font-extrabold tracking-tight text-slate-900 sm:text-base">
                  BizOps AI Studio
                </h1>
                <span className="hidden items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/80 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 sm:inline-flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Gemini AI • {preset.shortName}
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-500">{ui.subtitle}</p>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 shadow-2xs">
              <Building2 className="h-3.5 w-3.5 text-indigo-600" />
              <span className="hidden text-[11px] font-medium text-slate-500 md:inline">
                {ui.industryLabel}
              </span>
              <select
                value={activePresetId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  const nextPreset = allPresets.find((p) => p.id === nextId);
                  setActivePresetId(nextId);
                  showToast(`Aktywny profil: ${nextPreset?.name}`);
                }}
                className="cursor-pointer bg-transparent text-xs font-bold text-slate-800 outline-none"
              >
                {allPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.shortName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCustomProfileOpen(true)}
                className="ml-1 inline-flex items-center gap-0.5 rounded-lg bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100"
                title="Dodaj własny profil firmy"
              >
                <Plus className="h-3 w-3" />
                Nowa
              </button>
            </div>

            <div
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold shadow-2xs transition ${
                cloudSyncStatus === 'connected'
                  ? 'border-emerald-200/80 bg-emerald-50 text-emerald-700'
                  : cloudSyncStatus === 'syncing'
                    ? 'border-sky-200/80 bg-sky-50 text-sky-700'
                    : 'border-amber-200/80 bg-amber-50 text-amber-700'
              }`}
              title="Status bazy Neon Postgres w chmurze"
            >
              <span className="relative flex h-2 w-2">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    cloudSyncStatus === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                ></span>
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    cloudSyncStatus === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                ></span>
              </span>
              <span className="hidden sm:inline">Neon Sync</span>
            </div>

            <GeminiQuotaWidget logs={logs} />

            <button
              type="button"
              onClick={() => setWelcomeModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs hover:border-cyan-400 hover:text-cyan-700 transition"
              title="Profil użytkownika (Kliknij, aby zmienić imię lub rolę)"
            >
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
              <span>Cześć, {userProfile?.name || 'Zaloguj się'}!</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setAppTheme((t) => (t === 'light' ? 'warm' : t === 'warm' ? 'dark' : 'light'))
              }
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-2xs transition ${
                appTheme === 'dark'
                  ? 'border-indigo-500/40 bg-indigo-950/80 text-indigo-200'
                  : appTheme === 'warm'
                    ? 'border-amber-300/80 bg-amber-50 text-amber-900'
                    : 'border-slate-200/80 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="Przełącz motyw: Jasny SaaS / Ciepły Papier / Ciemny Pro"
            >
              {appTheme === 'dark' ? (
                <Moon className="h-3.5 w-3.5 text-indigo-400" />
              ) : (
                <SunMedium className="h-3.5 w-3.5 text-amber-500" />
              )}
              <span className="hidden sm:inline">
                {appTheme === 'dark' ? 'Ciemny Pro' : appTheme === 'warm' ? 'Ciepły Papier' : 'Jasny SaaS'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setLanguage((l) => (l === 'pl' ? 'en' : 'pl'))}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200/80 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50"
              title="Przełącz język PL / EN"
            >
              <Globe className="h-3.5 w-3.5 text-indigo-600" />
              <span>{language.toUpperCase()}</span>
            </button>

            <button
              type="button"
              onClick={() => setIntegrationsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200/80 bg-indigo-50/80 px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-2xs hover:bg-indigo-100"
              title="Połącz Gmail, WhatsApp API oraz Meta Business"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Integracje</span>
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{ui.settingsButton}</span>
            </button>
          </div>
        </div>

        {/* SaaS Premium Pill Navigation */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 pb-3.5 sm:px-6">
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200/80 bg-slate-100/80 p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setActiveTab('responder')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 ${
                activeTab === 'responder'
                  ? 'bg-gradient-to-r from-slate-900 to-indigo-950 text-white shadow-md shadow-indigo-950/15'
                  : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              <MailCheck className={`h-3.5 w-3.5 ${activeTab === 'responder' ? 'text-indigo-300' : ''}`} />
              {ui.tabs.responder}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 ${
                activeTab === 'audit'
                  ? 'bg-gradient-to-r from-slate-900 to-indigo-950 text-white shadow-md shadow-indigo-950/15'
                  : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              <FileSearch className={`h-3.5 w-3.5 ${activeTab === 'audit' ? 'text-indigo-300' : ''}`} />
              {ui.tabs.audit}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('knowledge')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 ${
                activeTab === 'knowledge'
                  ? 'bg-gradient-to-r from-slate-900 to-indigo-950 text-white shadow-md shadow-indigo-950/15'
                  : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              <BookOpen className={`h-3.5 w-3.5 ${activeTab === 'knowledge' ? 'text-indigo-300' : ''}`} />
              {ui.tabs.knowledge}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  activeTab === 'knowledge'
                    ? 'bg-white/15 text-white'
                    : 'bg-indigo-50 text-indigo-700'
                }`}
              >
                {activeTilesCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 ${
                activeTab === 'chat'
                  ? 'bg-gradient-to-r from-slate-900 to-indigo-950 text-white shadow-md shadow-indigo-950/15'
                  : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              <MessageSquare className={`h-3.5 w-3.5 ${activeTab === 'chat' ? 'text-indigo-300' : ''}`} />
              {ui.tabs.chat}
            </button>
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <span className="rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-2xs">
              Akcje AI: <strong className="text-slate-900">{logs.filter((l) => l.status === 'success').length}</strong>
            </span>
            <span className="rounded-full border border-emerald-200/80 bg-emerald-50/70 px-3 py-1 text-[11px] font-semibold text-emerald-800">
              Zaoszczędzono ~<strong className="font-extrabold">{Math.max(15, logs.filter((l) => l.status === 'success').length * 14)} min</strong>
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/70 bg-white/65 px-4 py-2.5 text-[11px] text-slate-600 backdrop-blur-sm">
          <span className="font-medium">
            {activeTab === 'responder' &&
              '1. Wklej wiadomość klienta po lewej  →  2. AI połączy Bazę Wiedzy i internet  →  3. Skopiuj gotową odpowiedź po prawej.'}
            {activeTab === 'audit' &&
              '1. Wgraj PDF, zdjęcie lub podyktuj notatkę  →  2. AI sprawdzi zgodność z Bazą Wiedzy  →  3. Pobierz raport PDF lub przejdź do odpowiedzi.'}
            {activeTab === 'knowledge' &&
              'Dodawaj cenniki, procedury i pliki PDF swojej firmy — wszystkie moduły AI od razu korzystają z tej wiedzy.'}
            {activeTab === 'chat' &&
              'Zadaj dowolne pytanie wewnętrzne (marże, ryzyka, procedury) lub przetestuj odpowiedzi w trybie dla klienta.'}
          </span>
          <span className="hidden font-semibold text-indigo-700 sm:inline">
            {activeTilesCount} reguł aktywnych
          </span>
        </div>

        <div key={activeTab} className="animate-enter">

        {activeTab === 'responder' && (
          <SalesResponderView
            preset={preset}
            tiles={currentTiles}
            language={language}
            latestReply={currentReply}
            incomingMessage={handoffResponderText}
            onClearIncomingMessage={() => setHandoffResponderText(null)}
            onReplyComplete={(reply) =>
              setReplyByPreset((prev) => ({ ...prev, [preset.id]: reply }))
            }
            onOpenKnowledge={() => setActiveTab('knowledge')}
            onSendWebhookPayload={handleSendWebhook}
            onQuickAddTile={(tile) => {
              const newTile: KnowledgeTile = {
                id: `quick_${Date.now()}`,
                title: tile.title,
                category: tile.category,
                visibility: 'public',
                priority: 'standard',
                content: tile.content,
                enabled: true,
                updatedAt: new Date().toISOString().slice(0, 10),
              };
              setTilesByPreset((prev) => ({
                ...prev,
                [preset.id]: [newTile, ...(prev[preset.id] || [])],
              }));
              showToast('Dodano odkrytą informację do Bazy Wiedzy');
            }}
            onLogAiCall={appendLog}
          />
        )}

        {activeTab === 'audit' && (
          <AuditView
            preset={preset}
            tiles={currentTiles}
            language={language}
            latestAudit={currentAudit}
            onAuditComplete={(audit) =>
              setAuditByPreset((prev) => ({ ...prev, [preset.id]: audit }))
            }
            onCreateCrmDeal={handleCreateCrmDeal}
            onMascotUpdate={() => {}}
            onLogAiCall={appendLog}
            onSendWebhookPayload={handleSendWebhook}
            onHandoffToResponder={(text) => {
              setHandoffResponderText(text);
              setActiveTab('responder');
              showToast('Przekazano dokument do Asystenta Odpowiedzi');
            }}
            autoSendOnHighRisk={webhookConfig.autoSendOnHighRisk}
          />
        )}

        {activeTab === 'knowledge' && (
          <KnowledgeView
            preset={preset}
            tiles={currentTiles}
            language={language}
            onTilesChange={handleTilesChangeWithCloud}
            onResetPreset={handleResetPreset}
            onTestTileInChat={(prompt) => {
              setActiveTab('chat');
              setPendingChatPrompt(prompt);
            }}
            onMascotUpdate={() => {}}
            onLogAiCall={appendLog}
          />
        )}

        {activeTab === 'chat' && (
          <ChatView
            preset={preset}
            tiles={currentTiles}
            language={language}
            messages={currentMessages}
            onMessagesChange={(msgs) =>
              setMessagesByPreset((prev) => ({ ...prev, [preset.id]: msgs }))
            }
            perspective={perspective}
            onPerspectiveChange={setPerspective}
            pendingPrompt={pendingChatPrompt}
            onClearPendingPrompt={() => setPendingChatPrompt(null)}
            onMascotUpdate={() => {}}
            onLogAiCall={appendLog}
            onSendWebhookPayload={handleSendWebhook}
            onOpenKnowledge={() => setActiveTab('knowledge')}
            onHandoffToResponder={(text) => {
              setHandoffResponderText(text);
              setActiveTab('responder');
              showToast('Przekazano odpowiedź z Czatu do Asystenta Odpowiedzi');
            }}
          />
        )}
        </div>
      </main>

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed right-5 top-20 z-50 rounded-2xl px-4 py-2.5 text-xs font-semibold text-white shadow-xl transition ${
            toast.tone === 'ok' ? 'bg-slate-900' : 'bg-rose-600'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Custom Company Profile Modal */}
      <CustomProfileModal
        open={customProfileOpen}
        onClose={() => setCustomProfileOpen(false)}
        onCreateProfile={(newPreset) => {
          const nextCustom = [...customPresets, newPreset];
          setCustomPresets(nextCustom);
          try {
            localStorage.setItem(STORAGE_CUSTOM_PRESETS_KEY, JSON.stringify(nextCustom));
          } catch {
            // ignore
          }
          setTilesByPreset((prev) => ({ ...prev, [newPreset.id]: newPreset.defaultTiles }));
          setDealsByPreset((prev) => ({ ...prev, [newPreset.id]: newPreset.defaultDeals }));
          setActivePresetId(newPreset.id);
          setActiveTab('knowledge');
          showToast(`Utworzono profil: ${newPreset.name}`);
        }}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onTestLogged={(latencyMs, ok, detail) =>
          appendLog({
            action: 'test',
            latencyMs,
            promptTokens: 0,
            candidatesTokens: 0,
            totalTokens: 0,
            status: ok ? 'success' : 'error',
            summary: detail,
          })
        }
      />

      {/* Integrations Modal (Gmail / WhatsApp / Meta Business) */}
      <IntegrationsModal
        open={integrationsOpen}
        onClose={() => setIntegrationsOpen(false)}
        onConfigSaved={() => showToast('Zapisano ustawienia integracji')}
      />

      {/* Floating Realtime Cloud Toasts */}
      <ToastNotification toasts={floatingToasts} onDismiss={dismissFloatingToast} />

      {/* Onboarding & User Identity Modal */}
      <WelcomeModal
        open={welcomeModalOpen}
        currentProfile={userProfile}
        onClose={userProfile ? () => setWelcomeModalOpen(false) : undefined}
        onSave={(prof) => {
          localStorage.setItem('bizops_user_profile', JSON.stringify(prof));
          setUserProfile(prof);
          setWelcomeModalOpen(false);
          showToast(`Zalogowano jako: ${prof.name}`);
          addFloatingToast({
            type: 'info',
            title: 'Witaj w BizOps AI Studio',
            message: `Aktywny profil: ${prof.name} (${prof.role})`,
          });
        }}
      />
    </div>
  );
}

export default App;
