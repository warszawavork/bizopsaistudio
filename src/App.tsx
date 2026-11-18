import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Building2,
  Calculator,
  ChevronDown,
  Crown,
  Download,
  FileSearch,
  GitBranch,
  Kanban,
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
  WebhookSendResult,
  WorkflowRunResult,
} from './types';
import {
  fetchCloudAiStats,
  fetchCloudWorkspace,
  fetchTelegramSchedule,
  recordCloudAiLog,
  saveCloudWorkspaceKey,
  sendToWebhook,
  triggerTelegramDailyCron,
} from './utils/apiClient';
import {
  idbGetChatMessages,
  idbGetWorkspaceItem,
  idbSaveChatMessages,
} from './utils/offlineDb';
import { RobustSyncEngine, type SyncState, type SyncStats } from './utils/syncEngine';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
import { UI_TEXT } from './utils/i18n';
import { SalesResponderView } from './components/SalesResponderView';
import { CalculatorAssistantView } from './components/CalculatorAssistantView';
import { AuditView } from './components/AuditView';
import { KnowledgeView } from './components/KnowledgeView';
import { ChatView } from './components/ChatView';
import { PipelineView } from './components/PipelineView';
import { WorkflowView } from './components/WorkflowView';
import { OpsView } from './components/OpsView';
import { SettingsModal } from './components/SettingsModal';
import { CustomProfileModal } from './components/CustomProfileModal';
import { IntegrationsModal } from './components/IntegrationsModal';
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
  const [workflowByPreset, setWorkflowByPreset] = useState<Record<string, WorkflowRunResult | null>>({});
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);
  const [handoffResponderText, setHandoffResponderText] = useState<string | null>(null);
  const [studioProMenuOpen, setStudioProMenuOpen] = useState(false);

  const [logs, setLogs] = useState<AiOpsLogEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_LOGS_KEY);
      return raw ? (JSON.parse(raw) as AiOpsLogEntry[]) : [];
    } catch {
      return [];
    }
  });

  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_WEBHOOK_KEY);
      return raw
        ? (JSON.parse(raw) as WebhookConfig)
        : { url: '', autoSendOnHighRisk: false, simulateWhenEmpty: true };
    } catch {
      return { url: '', autoSendOnHighRisk: false, simulateWhenEmpty: true };
    }
  });
  const [lastWebhookResult, setLastWebhookResult] = useState<{
    payload: Record<string, unknown>;
    result: WebhookSendResult;
  } | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<SyncState>('connected');
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [cloudStats, setCloudStats] = useState<SyncStats | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
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

  // Wyskakujące powiadomienia wyłączone zgodnie z preferencją użytkownika
  const addFloatingToast = (_item: unknown) => {};

  const preset = allPresets.find((p) => p.id === activePresetId) || allPresets[0];
  const currentTiles = tilesByPreset[preset.id] || preset.defaultTiles;
  const currentDeals = dealsByPreset[preset.id] || preset.defaultDeals;
  const currentMessages = messagesByPreset[preset.id] || [];
  const currentAudit = auditByPreset[preset.id] || null;
  const currentReply = replyByPreset[preset.id] || null;
  const currentWorkflow = workflowByPreset[preset.id] || null;
  const ui = UI_TEXT[language];
  const isStudioProTab = activeTab === 'pipeline' || activeTab === 'workflow' || activeTab === 'ops';

  const syncEngineRef = useRef<RobustSyncEngine | null>(null);

  // PWA Install Prompt listener (ukryty w trybie standalone)
  useEffect(() => {
    const isStandalone =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true);
    if (isStandalone) return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  // Hydratacja historii Czatu AI oraz CRM Deals z IndexedDB i Neon DB (Offline-First)
  useEffect(() => {
    let cancelled = false;
    void idbGetChatMessages(preset.id).then((cachedMsgs) => {
      if (cancelled || !cachedMsgs || cachedMsgs.length === 0) return;
      setMessagesByPreset((prev) => {
        if (prev[preset.id] && prev[preset.id].length > 0) return prev;
        return { ...prev, [preset.id]: cachedMsgs };
      });
    });

    void idbGetWorkspaceItem<CrmDeal[]>(preset.id, 'deals').then((cachedDeals) => {
      if (cancelled || !cachedDeals?.payload || cachedDeals.payload.length === 0) return;
      setDealsByPreset((prev) => ({ ...prev, [preset.id]: cachedDeals.payload }));
    });

    void fetchCloudWorkspace(preset.id)
      .then((cloud) => {
        if (cancelled || !cloud.success || !cloud.state) return;
        if (Array.isArray(cloud.state.deals)) {
          const cloudDeals = cloud.state.deals as CrmDeal[];
          setDealsByPreset((prev) => ({ ...prev, [preset.id]: cloudDeals }));
          try {
            localStorage.setItem(`${STORAGE_DEALS_PREFIX}${preset.id}`, JSON.stringify(cloudDeals));
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // Offline gracefully stays on localStorage / IDB
      });

    return () => {
      cancelled = true;
    };
  }, [preset.id]);

  // Inicjalizacja RobustSyncEngine na starcie
  useEffect(() => {
    const engine = new RobustSyncEngine(preset.id, currentTiles, {
      onStatusChange: (status) => setCloudSyncStatus(status),
      onTilesUpdated: (presetId, newTiles) => {
        setTilesByPreset((prev) => ({ ...prev, [presetId]: newTiles }));
      },
      onStatsUpdated: (stats) => setCloudStats(stats),
      onQueueChange: (count) => setPendingQueueCount(count),
      onQueueFlushed: (flushedCount) => {
        addFloatingToast({
          type: 'sync',
          title: 'Kolejka zsynchronizowana',
          message: `Wysłano ${flushedCount} zaległych zmian offline do chmury Neon.`,
        });
      },
      onRollback: (presetId, previousTiles, reason) => {
        setTilesByPreset((prev) => ({ ...prev, [presetId]: previousTiles }));
        showToast(`Cofnięto zmianę (Rollback): ${reason}`, 'err');
      },
    });

    syncEngineRef.current = engine;

    return () => {
      engine.destroy();
      syncEngineRef.current = null;
    };
  }, []);

  // Automatyczny harmonogram dziennych raportów Telegram (działa niezawodnie co minutę bez duplikatów)
  useEffect(() => {
    let timerId: number | null = null;
    let disposed = false;

    const checkSchedule = async () => {
      try {
        const res = await fetchTelegramSchedule();
        if (disposed || !res.success || !res.schedule.enabled) return;
        const now = new Date();
        const todayStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: res.schedule.timezone || 'Europe/Warsaw',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(now);
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: res.schedule.timezone || 'Europe/Warsaw',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
            .formatToParts(now)
            .map((p) => [p.type, p.value])
        );
        const nowMins = Number(parts.hour === '24' ? 0 : parts.hour) * 60 + Number(parts.minute || 0);
        const targetMins = res.schedule.sendHour * 60 + res.schedule.sendMinute;

        if (res.schedule.lastSentDate !== todayStr && nowMins >= targetMins) {
          await triggerTelegramDailyCron(false);
        }
      } catch {
        // cichy fallback offline
      }
    };

    void checkSchedule();
    timerId = window.setInterval(() => {
      void checkSchedule();
    }, 60_000);

    return () => {
      disposed = true;
      if (timerId !== null) window.clearInterval(timerId);
    };
  }, []);

  // Obsługa przełączenia profilu branżowego bez wyścigów sieciowych
  useEffect(() => {
    if (syncEngineRef.current) {
      syncEngineRef.current.setPreset(preset.id, currentTiles);
    }
  }, [preset.id]);

  // Synchronizacja lokalnego bufora w silniku
  useEffect(() => {
    if (syncEngineRef.current) {
      syncEngineRef.current.updateLocalTiles(currentTiles);
    }
  }, [currentTiles]);

  const handleTilesChangeWithCloud = async (next: KnowledgeTile[]) => {
    setTilesByPreset((prev) => ({ ...prev, [preset.id]: next }));
    const author = userProfile?.name
      ? `${userProfile.name} (${userProfile.role.split('/')[0].trim()})`
      : 'Użytkownik';

    if (syncEngineRef.current) {
      try {
        const { deletedCount, mode } = await syncEngineRef.current.pushTiles(next, author);
        if (mode === 'rolled_back') {
          return;
        }
        if (mode === 'queued') {
          addFloatingToast({
            type: 'info',
            title: 'Zapisano lokalnie (Offline Queue)',
            message: 'Zmiany trafią do chmury Neon automatycznie po odzyskaniu sieci.',
            authorName: author,
          });
          return;
        }
        if (deletedCount > 0) {
          addFloatingToast({
            type: 'deleted',
            title: 'Usunięto z chmury',
            message: `Kafelek usunięty ze wszystkich urządzeń (${deletedCount})`,
            authorName: author,
          });
        } else {
          addFloatingToast({
            type: 'created',
            title: 'Zapisano w chmurze',
            message: 'Baza wiedzy zsynchronizowana ze wszystkimi urządzeniami',
            authorName: author,
          });
        }
      } catch (err) {
        console.error('Błąd zapisu kafelka do chmury:', err);
      }
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

  // Wyskakujące powiadomienia wyłączone zgodnie z preferencją użytkownika
  const showToast = (_text: string, _tone: 'ok' | 'err' = 'ok') => {};

  const refreshCloudStats = () => {
    void fetchCloudAiStats()
      .then((res) => {
        if (res.success && res.stats) {
          setCloudStats({ ...res.stats, recentLogs: res.logs || [] });
        }
      })
      .catch(() => {});
  };

  const appendLog = (entry: Omit<AiOpsLogEntry, 'id' | 'timestamp' | 'presetName' | 'model'>) => {
    const newLogEntry: AiOpsLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      presetName: preset.shortName,
      model: 'gemini-3.8-flash',
      ...entry,
    };
    setLogs((prev) => [newLogEntry, ...prev]);

    // Send to Neon DB for global multi-device Quota sync (with Offline SyncQueue fallback)!
    const cloudPayload = {
      ...newLogEntry,
      userName: userProfile?.name || 'Bogdan',
    };
    void recordCloudAiLog(cloudPayload)
      .then(() => {
        refreshCloudStats();
      })
      .catch(() => {
        void syncEngineRef.current?.enqueueAiLogOffline(cloudPayload);
      });
  };

  const updateDealsWithCloud = (nextDeals: CrmDeal[]) => {
    setDealsByPreset((prev) => ({
      ...prev,
      [preset.id]: nextDeals,
    }));
    void saveCloudWorkspaceKey(preset.id, 'deals', nextDeals, userProfile?.name);
  };

  const handleCreateCrmDeal = (dealInput: Omit<CrmDeal, 'id' | 'createdAt'>) => {
    const newDeal: CrmDeal = {
      ...dealInput,
      id: `deal_${Date.now()}`,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    const nextDeals = [newDeal, ...(dealsByPreset[preset.id] || preset.defaultDeals)];
    updateDealsWithCloud(nextDeals);
    showToast(`Zapisano sprawę w chmurze CRM: ${newDeal.client}`);
  };

  const handleWebhookConfigChange = (cfg: WebhookConfig) => {
    setWebhookConfig(cfg);
    try {
      localStorage.setItem(STORAGE_WEBHOOK_KEY, JSON.stringify(cfg));
    } catch {
      // ignore
    }
  };

  const handleSendWebhook = async (payload: Record<string, unknown>, label: string) => {
    try {
      const result = await sendToWebhook({
        webhookUrl: webhookConfig.url,
        simulate: webhookConfig.simulateWhenEmpty && !webhookConfig.url.trim(),
        payload,
      });
      setLastWebhookResult({ payload, result });
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
    void handleTilesChangeWithCloud(preset.defaultTiles);
    showToast(`Przywrócono domyślną bazę wiedzy dla: ${preset.shortName}`);
  };

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
      showToast('Aplikacja BizOps AI Studio została zainstalowana!');
    }
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
                title={ui.header.addCompany}
              >
                <Plus className="h-3 w-3" />
                {ui.header.addCompany}
              </button>
            </div>

            {/* User & Cloud Status Combined Badge */}
            <button
              type="button"
              onClick={() => setWelcomeModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs hover:border-cyan-400 hover:text-cyan-700 transition"
              title="Profil użytkownika i status bazy Neon w chmurze"
            >
              <span className="relative flex h-2 w-2">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    cloudSyncStatus === 'connected'
                      ? 'bg-emerald-400'
                      : cloudSyncStatus === 'syncing'
                      ? 'bg-cyan-400'
                      : cloudSyncStatus === 'offline'
                      ? 'bg-slate-400'
                      : 'bg-amber-400'
                  }`}
                ></span>
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    cloudSyncStatus === 'connected'
                      ? 'bg-emerald-500'
                      : cloudSyncStatus === 'syncing'
                      ? 'bg-cyan-500'
                      : cloudSyncStatus === 'offline'
                      ? 'bg-slate-500'
                      : 'bg-amber-500'
                  }`}
                ></span>
              </span>
              <span>
                {userProfile?.name ? `Cześć, ${userProfile.name}` : 'Mój Profil'}
                <span className="text-[10px] font-normal text-slate-500 ml-1.5">
                  {cloudSyncStatus === 'connected' && '• 🟢 Neon'}
                  {cloudSyncStatus === 'syncing' && '• 🔄 Sync'}
                  {cloudSyncStatus === 'offline' &&
                    `• ⚪ Offline${pendingQueueCount > 0 ? ` (${pendingQueueCount})` : ''}`}
                  {cloudSyncStatus === 'queued' &&
                    `• 🟠 Kolejka${pendingQueueCount > 0 ? ` (${pendingQueueCount})` : ''}`}
                  {cloudSyncStatus === 'error' && '• 🟡 Ponawianie'}
                </span>
              </span>
            </button>

            {/* AI Quota Monitor */}
            <GeminiQuotaWidget
              logs={logs}
              cloudStats={cloudStats || undefined}
              onRefreshStats={refreshCloudStats}
              onOpenAutoLearning={() => setActiveTab('knowledge')}
            />

            {/* Utility Toolbar */}
            <div className="flex items-center gap-1 border-l border-slate-200/80 pl-2">
              {installPrompt && (
                <button
                  type="button"
                  onClick={() => void handleInstallPwa()}
                  className="inline-flex items-center gap-1 rounded-xl border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition"
                  title="Zainstaluj BizOps AI Studio jako aplikację (PWA)"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Zainstaluj</span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setAppTheme((t) => (t === 'light' ? 'warm' : t === 'warm' ? 'dark' : 'light'))
                }
                className="p-1.5 rounded-xl border border-slate-200/80 bg-white text-slate-600 hover:bg-slate-50 transition"
                title={`Przełącz motyw (Aktualny: ${appTheme})`}
              >
                {appTheme === 'dark' ? (
                  <Moon className="h-4 w-4 text-indigo-400" />
                ) : (
                  <SunMedium className="h-4 w-4 text-amber-500" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setLanguage((l) => (l === 'pl' ? 'en' : 'pl'))}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200/80 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                title="Przełącz język PL / EN"
              >
                {language.toUpperCase()}
              </button>

              <button
                type="button"
                onClick={() => setIntegrationsOpen(true)}
                className="p-1.5 rounded-xl border border-indigo-200/80 bg-indigo-50/80 text-indigo-700 hover:bg-indigo-100 transition"
                title={ui.header.integrations}
              >
                <Link2 className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="p-1.5 rounded-xl border border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50 transition"
                title={ui.settingsButton}
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
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
              onClick={() => setActiveTab('calculator')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 ${
                activeTab === 'calculator'
                  ? 'bg-gradient-to-r from-emerald-700 to-teal-900 text-white shadow-md shadow-emerald-950/15'
                  : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              <Calculator className={`h-3.5 w-3.5 ${activeTab === 'calculator' ? 'text-emerald-300' : 'text-emerald-600'}`} />
              {ui.tabs.calculator}
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
              onClick={() => {
                setActiveTab('chat');
                setStudioProMenuOpen(false);
              }}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 ${
                activeTab === 'chat'
                  ? 'bg-gradient-to-r from-slate-900 to-indigo-950 text-white shadow-md shadow-indigo-950/15'
                  : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              <MessageSquare className={`h-3.5 w-3.5 ${activeTab === 'chat' ? 'text-indigo-300' : ''}`} />
              {ui.tabs.chat}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setStudioProMenuOpen((o) => !o)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition-all duration-200 ${
                  isStudioProTab
                    ? 'bg-gradient-to-r from-slate-950 via-indigo-950 to-amber-950 text-amber-300 shadow-md ring-1 ring-amber-400/50'
                    : 'border border-amber-300/70 bg-gradient-to-r from-amber-50/90 to-indigo-50/70 text-slate-900 hover:border-amber-400 hover:shadow-xs'
                }`}
              >
                <Crown className={`h-3.5 w-3.5 ${isStudioProTab ? 'text-amber-300' : 'text-amber-600'}`} />
                <span>{ui.studioProLabel}</span>
                {isStudioProTab && (
                  <span className="rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                    {activeTab === 'pipeline'
                      ? 'CRM'
                      : activeTab === 'workflow'
                        ? 'AI Flow'
                        : 'Ops'}
                  </span>
                )}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${studioProMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {studioProMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setStudioProMenuOpen(false)}
                  />
                  <div className="absolute right-0 sm:left-0 top-full z-50 mt-2 w-80 rounded-2xl border border-slate-200/90 bg-white p-2 shadow-2xl ring-1 ring-slate-950/5">
                    <div className="mb-1.5 flex items-center justify-between px-2.5 py-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700">
                        <Crown className="h-3 w-3" />
                        {ui.header.studioProBadge}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-400">3 moduły</span>
                    </div>

                    {[
                      {
                        id: 'pipeline' as const,
                        icon: Kanban,
                        accent: 'bg-amber-100 text-amber-700',
                        title: ui.studioProTabs.pipeline,
                        desc: ui.studioProDescriptions.pipeline,
                        badge: `${currentDeals.length} spraw`,
                      },
                      {
                        id: 'workflow' as const,
                        icon: GitBranch,
                        accent: 'bg-violet-100 text-violet-700',
                        title: ui.studioProTabs.workflow,
                        desc: ui.studioProDescriptions.workflow,
                        badge: '3 Agenty',
                      },
                      {
                        id: 'ops' as const,
                        icon: Activity,
                        accent: 'bg-cyan-100 text-cyan-700',
                        title: ui.studioProTabs.ops,
                        desc: ui.studioProDescriptions.ops,
                        badge: `${logs.length} logów`,
                      },
                    ].map((mod) => {
                      const Icon = mod.icon;
                      const isCurrent = activeTab === mod.id;
                      return (
                        <button
                          key={mod.id}
                          type="button"
                          onClick={() => {
                            setActiveTab(mod.id);
                            setStudioProMenuOpen(false);
                          }}
                          className={`flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition ${
                            isCurrent
                              ? 'bg-indigo-50 ring-1 ring-indigo-300'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${mod.accent}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-extrabold text-slate-900">{mod.title}</span>
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                                {mod.badge}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{mod.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
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
      <main className={`mx-auto px-4 pt-5 sm:px-6 ${activeTab === 'responder' || activeTab === 'calculator' ? 'max-w-[1580px]' : 'max-w-7xl'}`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/70 bg-white/65 px-4 py-2.5 text-[11px] text-slate-600 backdrop-blur-sm">
          <span className="font-medium">
            {activeTab === 'responder' && ui.tabDescriptions.responder}
            {activeTab === 'calculator' && ui.tabDescriptions.calculator}
            {activeTab === 'audit' && ui.tabDescriptions.audit}
            {activeTab === 'knowledge' && ui.tabDescriptions.knowledge}
            {activeTab === 'chat' && ui.tabDescriptions.chat}
            {activeTab === 'pipeline' && ui.studioProDescriptions.pipeline}
            {activeTab === 'workflow' && ui.studioProDescriptions.workflow}
            {activeTab === 'ops' && ui.studioProDescriptions.ops}
          </span>
          <span className="hidden font-semibold text-indigo-700 sm:inline">
            {activeTilesCount} reguł aktywnych
          </span>
        </div>

        {isStudioProTab && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300/50 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 p-2 text-xs text-white shadow-md">
            <span className="inline-flex items-center gap-1.5 px-2.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
              <Crown className="h-3.5 w-3.5" />
              {ui.studioProLabel}
            </span>
            {[
              { id: 'pipeline' as const, label: ui.studioProTabs.pipeline, icon: Kanban },
              { id: 'workflow' as const, label: ui.studioProTabs.workflow, icon: GitBranch },
              { id: 'ops' as const, label: ui.studioProTabs.ops, icon: Activity },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                    active
                      ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 shadow-sm'
                      : 'text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}

        <div key={activeTab} className="animate-enter">

        {activeTab === 'responder' && (
          <SalesResponderView
            preset={preset}
            tiles={currentTiles}
            language={language}
            latestReply={currentReply}
            authorName={userProfile?.name}
            incomingMessage={handoffResponderText}
            onClearIncomingMessage={() => setHandoffResponderText(null)}
            onReplyComplete={(reply) =>
              setReplyByPreset((prev) => ({ ...prev, [preset.id]: reply }))
            }
            onOpenKnowledge={() => setActiveTab('knowledge')}
            onCreateCrmDeal={handleCreateCrmDeal}
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
              void handleTilesChangeWithCloud([newTile, ...currentTiles]);
              showToast('Dodano odkrytą informację do Bazy Wiedzy');
            }}
            onLogAiCall={appendLog}
          />
        )}

        {activeTab === 'calculator' && (
          <CalculatorAssistantView
            onCreateCrmDeal={handleCreateCrmDeal}
            onHandoffToResponder={(text) => {
              setHandoffResponderText(text);
              setActiveTab('responder');
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
            messages={currentMessages}
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
            onMessagesChange={(msgs) => {
              setMessagesByPreset((prev) => ({ ...prev, [preset.id]: msgs }));
              void idbSaveChatMessages(preset.id, msgs);
            }}
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
            onAddKnowledgeTile={(newTile) => {
              void handleTilesChangeWithCloud([newTile, ...currentTiles]);
            }}
          />
        )}

        {activeTab === 'pipeline' && (
          <PipelineView
            preset={preset}
            deals={currentDeals}
            onDealsChange={updateDealsWithCloud}
            onResetDeals={() => {
              updateDealsWithCloud(preset.defaultDeals);
              showToast(`Przywrócono domyślne sprawy CRM dla: ${preset.shortName}`);
            }}
            onMascotUpdate={(_, tip) => {
              if (tip) showToast(tip);
            }}
            onSendWebhookPayload={handleSendWebhook}
          />
        )}

        {activeTab === 'workflow' && (
          <WorkflowView
            preset={preset}
            tiles={currentTiles}
            language={language}
            latestWorkflow={currentWorkflow}
            onWorkflowComplete={(res) =>
              setWorkflowByPreset((prev) => ({ ...prev, [preset.id]: res }))
            }
            onCreateCrmDeal={handleCreateCrmDeal}
            onSendWebhookPayload={handleSendWebhook}
            onMascotUpdate={(_, tip) => {
              if (tip) showToast(tip);
            }}
            onLogAiCall={appendLog}
          />
        )}

        {activeTab === 'ops' && (
          <OpsView
            logs={logs}
            onClearLogs={() => {
              setLogs([]);
              localStorage.removeItem(STORAGE_LOGS_KEY);
              showToast('Wyczyszczono logi sesji lokalnej');
            }}
            webhookConfig={webhookConfig}
            onWebhookConfigChange={handleWebhookConfigChange}
            lastWebhookResult={lastWebhookResult}
            onTestWebhook={async () => {
              await handleSendWebhook(
                {
                  event: 'bizops.ops.webhook_ping',
                  company: preset.name,
                  timestamp: new Date().toISOString(),
                },
                'Test Ping Webhook (Studio Pro Ops)'
              );
            }}
          />
        )}
        </div>
      </main>

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
        cloudStats={cloudStats || undefined}
        onRefreshStats={refreshCloudStats}
        tilesCount={currentTiles.length}
        onBackupRestored={() => {
          try {
            const rawPresets = localStorage.getItem(STORAGE_CUSTOM_PRESETS_KEY);
            if (rawPresets) setCustomPresets(JSON.parse(rawPresets) as IndustryPreset[]);
            const rawWh = localStorage.getItem(STORAGE_WEBHOOK_KEY);
            if (rawWh) setWebhookConfig(JSON.parse(rawWh) as WebhookConfig);
          } catch {
            // ignore
          }
          showToast('Przywrócono pełną konfigurację firmy z pliku backupu');
        }}
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
