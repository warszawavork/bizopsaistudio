import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  Download,
  GitBranch,
  HardDrive,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import type { AdvisorSignature } from '../types';
import type { SyncStats } from '../utils/syncEngine';
import {
  clearOldCloudAiLogs,
  getStoredAdvisorSignature,
  getStoredCustomKey,
  getStoredIntegrationsConfig,
  runLangGraphWorkflow,
  setStoredAdvisorSignature,
  setStoredCustomKey,
  setStoredIntegrationsConfig,
  testAiConnection,
} from '../utils/apiClient';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onTestLogged: (latencyMs: number, ok: boolean, detail: string) => void;
  cloudStats?: SyncStats;
  onRefreshStats?: () => void;
  tilesCount?: number;
  onBackupRestored?: () => void;
}

const DAILY_LIMIT_RPD = 1500;
const MINUTE_LIMIT_RPM = 15;
const NEON_FREE_LIMIT_MB = 512;

function getResetTimeInfo() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diffMs = midnight.getTime() - now.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
  return { hours, minutes, seconds, formatted: `${hours} godz. ${minutes} min` };
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  onTestLogged,
  cloudStats,
  onRefreshStats,
  tilesCount = 0,
  onBackupRestored,
}) => {
  const [activeTab, setActiveTab] = useState<'quotas' | 'api' | 'langgraph' | 'signature' | 'backup'>('quotas');
  const [testingLangGraph, setTestingLangGraph] = useState(false);
  const [langGraphTestLogs, setLangGraphTestLogs] = useState<string[]>([]);
  const [customKey, setCustomKey] = useState(getStoredCustomKey());
  const [signature, setSignature] = useState<AdvisorSignature>(getStoredAdvisorSignature);
  const [testing, setTesting] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [includeSecretsInBackup, setIncludeSecretsInBackup] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetInfo, setResetInfo] = useState(getResetTimeInfo());
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    onRefreshStats?.();
    const interval = setInterval(() => {
      setResetInfo(getResetTimeInfo());
    }, 10000);
    return () => clearInterval(interval);
  }, [open]);

  if (!open) return null;

  const updateSignature = (patch: Partial<AdvisorSignature>) => {
    const next = { ...signature, ...patch };
    setSignature(next);
    setStoredAdvisorSignature(next);
  };

  const handleSaveKey = () => {
    setStoredCustomKey(customKey);
    setTestResult({
      ok: true,
      text: customKey.trim()
        ? 'Zapisano własny klucz w przeglądarce (localStorage). Zapytania pójdą z Twojego klucza.'
        : 'Wyczyszczono własny klucz — aplikacja używa bezpiecznego klucza serwerowego (.env).',
    });
  };

  const handleTest = async () => {
    setStoredCustomKey(customKey);
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAiConnection();
      const sourceLabel =
        res.keySource === 'custom_key'
          ? 'własny klucz z Ustawień'
          : 'bezpieczny klucz serwera (.env)';
      setTestResult({
        ok: true,
        text: `Połączono z ${res.model} (${res.latencyMs} ms) — źródło: ${sourceLabel}.`,
      });
      onTestLogged(res.latencyMs, true, `Test połączenia (${sourceLabel})`);
      onRefreshStats?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd połączenia z API';
      setTestResult({ ok: false, text: msg });
      onTestLogged(0, false, msg);
    } finally {
      setTesting(false);
    }
  };

  const handleClearOldLogs = async (all = false) => {
    setClearingLogs(true);
    try {
      const res = await clearOldCloudAiLogs(all);
      setTestResult({
        ok: true,
        text: res.message || (all ? 'Opróżniono wszystkie logi AI z bazy Neon DB.' : 'Wyczyszczono stare logi z bazy Neon DB.'),
      });
      onRefreshStats?.();
    } catch {
      setTestResult({
        ok: false,
        text: all ? 'Nie udało się opróżnić logów z bazy Neon.' : 'Nie udało się wyczyścić starych logów.',
      });
    } finally {
      setClearingLogs(false);
    }
  };

  const handleExportCompanyBackup = () => {
    const workspaceKeys: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith('bizops_quick_links_') ||
          k.startsWith('bizops_objections_playbook_') ||
          k.startsWith('bizops_deals_v2_') ||
          k.startsWith('bizops_tiles_v2_'))
      ) {
        try {
          workspaceKeys[k] = JSON.parse(localStorage.getItem(k) || 'null');
        } catch {
          // skip malformed
        }
      }
    }

    let customPresets: unknown[] = [];
    let webhookConfig: unknown = null;
    try {
      customPresets = JSON.parse(localStorage.getItem('bizops_custom_presets_v1') || '[]');
    } catch {
      customPresets = [];
    }
    try {
      webhookConfig = JSON.parse(localStorage.getItem('bizops_webhook_cfg_v2') || 'null');
    } catch {
      webhookConfig = null;
    }

    const bundle: Record<string, unknown> = {
      schema: 'bizops-ai-studio-backup-v1',
      exportedAt: new Date().toISOString(),
      customPresets,
      advisorSignature: signature,
      webhookConfig,
      workspaceKeys,
    };

    if (includeSecretsInBackup) {
      bundle.integrationsConfig = getStoredIntegrationsConfig();
    }

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BizOps_Konfiguracja_Firmy_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setTestResult({
      ok: true,
      text: includeSecretsInBackup
        ? 'Wyeksportowano pełną kopię konfiguracji wraz z tokenami integracji (.json).'
        : 'Wyeksportowano bezpieczną kopię konfiguracji firmy bez poufnych tokenów (.json).',
    });
  };

  const handleImportCompanyBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as Record<string, unknown>;
      if (raw.schema !== 'bizops-ai-studio-backup-v1') {
        throw new Error('Nieprawidłowy format pliku kopii zapasowej BizOps AI Studio.');
      }
      if (Array.isArray(raw.customPresets)) {
        localStorage.setItem('bizops_custom_presets_v1', JSON.stringify(raw.customPresets));
      }
      if (raw.advisorSignature && typeof raw.advisorSignature === 'object') {
        const sig = raw.advisorSignature as AdvisorSignature;
        setSignature(sig);
        setStoredAdvisorSignature(sig);
      }
      if (raw.webhookConfig && typeof raw.webhookConfig === 'object') {
        localStorage.setItem('bizops_webhook_cfg_v2', JSON.stringify(raw.webhookConfig));
      }
      if (raw.workspaceKeys && typeof raw.workspaceKeys === 'object') {
        for (const [k, val] of Object.entries(raw.workspaceKeys as Record<string, unknown>)) {
          if (
            k.startsWith('bizops_quick_links_') ||
            k.startsWith('bizops_objections_playbook_') ||
            k.startsWith('bizops_deals_v2_') ||
            k.startsWith('bizops_tiles_v2_')
          ) {
            localStorage.setItem(k, JSON.stringify(val));
          }
        }
      }
      if (raw.integrationsConfig && typeof raw.integrationsConfig === 'object') {
        setStoredIntegrationsConfig(raw.integrationsConfig as ReturnType<typeof getStoredIntegrationsConfig>);
      }
      onBackupRestored?.();
      setTestResult({
        ok: true,
        text: 'Konfiguracja firmy, profile, linki i stopka zostały przywrócone!',
      });
    } catch (err) {
      setTestResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Nie udało się wczytać pliku backupu.',
      });
    }
  };

  // Wyliczenia limitów Google AI
  const todayUsed = cloudStats?.todayRequests ?? 0;
  const todayRemaining = Math.max(0, DAILY_LIMIT_RPD - todayUsed);
  const todayPercent = Math.min(100, Math.round((todayUsed / DAILY_LIMIT_RPD) * 100));

  const minuteUsed = cloudStats?.minuteRequests ?? 0;
  const minuteRemaining = Math.max(0, MINUTE_LIMIT_RPM - minuteUsed);
  const minutePercent = Math.min(100, Math.round((minuteUsed / MINUTE_LIMIT_RPM) * 100));

  const todayTokens = cloudStats?.todayTokens ?? 0;

  // Wyliczenia pamięci Neon DB
  const dbSizeBytes = cloudStats?.dbSizeBytes ?? 7650000;
  const dbUsedMb = +(dbSizeBytes / (1024 * 1024)).toFixed(2);
  const dbRemainingMb = +(NEON_FREE_LIMIT_MB - dbUsedMb).toFixed(2);
  const dbPercent = Math.min(100, Math.max(1, Math.round((dbUsedMb / NEON_FREE_LIMIT_MB) * 100)));
  const cloudTilesCount = cloudStats?.tilesCount ?? tilesCount;
  const cloudLogsCount = cloudStats?.logsCount ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        {/* Nagłówek */}
        <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-600 text-white shadow-md shadow-indigo-500/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Ustawienia Systemu, Limity Google AI & Pamięć Neon DB
              </h2>
              <p className="text-xs text-slate-500">
                Pełna diagnostyka zużycia, harmonogram resetowania limitów i konfiguracja
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Pasek zakładek w Ustawieniach */}
        <div className="mb-5 flex flex-wrap gap-1.5 rounded-2xl bg-slate-100 p-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('quotas')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              activeTab === 'quotas'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            Limity Google AI & Pamięć Neon
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('api')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              activeTab === 'api'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5 text-amber-400" />
            Modele & Klucz Gemini AI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('langgraph')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              activeTab === 'langgraph'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5 text-violet-400" />
            LangGraph (StateGraph)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('signature')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              activeTab === 'signature'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
            Podpis Doradcy
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('backup')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              activeTab === 'backup'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Download className="h-3.5 w-3.5 text-indigo-400" />
            Kopia (.json)
          </button>
        </div>

        {/* ZAKŁADKA 1: LIMITY GOOGLE AI & PAMIĘĆ NEON DB */}
        {activeTab === 'quotas' && (
          <div className="space-y-4">
            {/* Karta 1: Limity Google AI Studio */}
            <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                    1. Limity Zapytań Google Gemini AI (Wspólne dla zespołu)
                  </h3>
                </div>
                {onRefreshStats && (
                  <button
                    type="button"
                    onClick={onRefreshStats}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-slate-700 transition"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Odśwież teraz
                  </button>
                )}
              </div>

              {/* Dzienny limit RPD */}
              <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5 mb-3">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-200">
                    Pula Dzienna (RPD — Requests Per Day)
                  </span>
                  <span className="font-mono font-bold text-emerald-400">
                    Zostało na dziś: {todayRemaining} zapytań
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${Math.max(2, todayPercent)}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono">
                  <span>Wykorzystano dzisiaj: {todayUsed} / {DAILY_LIMIT_RPD} ({todayPercent}%)</span>
                  <span className="text-cyan-300 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Reset puli dziennej za: {resetInfo.formatted}
                  </span>
                </div>
              </div>

              {/* Minutowy limit RPM + Tokeny */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 font-semibold">Tempo na minutę (RPM)</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {minuteUsed} / {MINUTE_LIMIT_RPM} RPM
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden my-1.5">
                    <div
                      className="h-full rounded-full bg-cyan-400 transition-all duration-300"
                      style={{ width: `${Math.max(4, minutePercent)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Dostępne w tej minucie: <strong className="text-white">{minuteRemaining}</strong>. Resetuje się automatycznie co <strong>60 sekund</strong>.
                  </p>
                </div>

                <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 font-semibold">Zużyte Tokeny (TPM / Dzień)</span>
                    <span className="font-mono font-bold text-indigo-300">
                      {todayTokens.toLocaleString('pl-PL')} tok.
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                    Darmowy limit Google to aż <strong className="text-white">1 000 000 tokenów / min</strong>. Twoje dzisiejsze użycie jest w 100% bezpłatne (0,00 zł).
                  </p>
                </div>
              </div>
            </div>

            {/* Karta 2: Pamięć Bazy Danych Neon Postgres */}
            <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-cyan-50/50 p-4">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                    2. Pamięć Chmury Neon Postgres (BizOpsBAZA • AWS eu-west-2)
                  </h3>
                </div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                  Połączono • Aktywna
                </span>
              </div>

              <div className="rounded-xl border border-indigo-100 bg-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5 text-indigo-600" />
                    Zajętość dysku w chmurze Neon:
                  </span>
                  <span className="font-mono font-bold text-indigo-700">
                    Pozostało wolne: {dbRemainingMb} MB (z {NEON_FREE_LIMIT_MB} MB)
                  </span>
                </div>

                <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden border border-slate-200/60">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      dbPercent >= 80
                        ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                        : 'bg-gradient-to-r from-indigo-600 to-cyan-500'
                    }`}
                    style={{ width: `${Math.max(2, dbPercent)}%` }}
                  />
                </div>

                <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 p-2 border border-slate-200/60">
                    <span className="block text-[10px] text-slate-500">Zajęta pamięć</span>
                    <span className="font-mono text-xs font-bold text-slate-800">
                      {dbUsedMb} MB ({dbPercent}%)
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 border border-slate-200/60">
                    <span className="block text-[10px] text-slate-500">Kafelki w chmurze</span>
                    <span className="font-mono text-xs font-bold text-indigo-700">
                      {cloudTilesCount} szt.
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 border border-slate-200/60">
                    <span className="block text-[10px] text-slate-500">Logi historii AI</span>
                    <span className="font-mono text-xs font-bold text-slate-800">
                      {cloudLogsCount} wpisów
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
                  <div className="space-y-0.5">
                    <span className="block">
                      💡 Wolne <strong>{dbRemainingMb} MB</strong> wystarczy na ok.{' '}
                      <strong>450 000 kafelków wiedzy</strong>.
                    </span>
                    <span className="block text-[10px] text-emerald-700 font-semibold">
                      🛡️ Auto-Retencja: logi starsze niż 30 dni lub przy &ge;80% limitu (410 MB) czyszczą się automatycznie.
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={clearingLogs}
                      onClick={() => void handleClearOldLogs(false)}
                      title="Usuń wpisy sprzed bieżącego dnia (pozostawia dzisiejsze)"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      {clearingLogs ? 'Przetwarzanie...' : 'Wyczyść archiwalne'}
                    </button>
                    <button
                      type="button"
                      disabled={clearingLogs}
                      onClick={() => {
                        if (window.confirm('Czy na pewno chcesz całkowicie opróżnić historię logów AI z bazy Neon DB?')) {
                          void handleClearOldLogs(true);
                        }
                      }}
                      title="Całkowicie opróżnij wszystkie logi AI z bazy Neon DB i odzyskaj pamięć"
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3 text-rose-600" />
                      {clearingLogs ? 'Opróżnianie...' : 'Opróżnij bazę logów Neon'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Karta 3: Harmonogram kiedy resetują się limity */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 space-y-1.5">
              <p className="font-bold text-slate-900 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-indigo-600" />
                Kiedy dokładnie resetują się limity?
              </p>
              <ul className="list-disc pl-5 space-y-1 text-[11px] text-slate-600">
                <li>
                  <strong>Limit minutowy (15 zapytań / min):</strong> Resetuje się płynnie co{' '}
                  <strong>60 sekund</strong>. Jeśli wyślesz 15 zapytań naraz, wystarczy odczekać niecałą minutę.
                </li>
                <li>
                  <strong>Limit dzienny (1 500 zapytań / dobę):</strong> Resetuje się automatycznie każdego dnia o północy (pozostało: <strong>{resetInfo.formatted}</strong>).
                </li>
                <li>
                  <strong>Pamięć Neon DB (512 MB):</strong> Jest bezterminowa (nie wygasa). Usunięcie kafelka lub starych logów natychmiast zwalnia miejsce w bazie.
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* ZAKŁADKA 2: MODELE I KLUCZ API GEMINI */}
        {activeTab === 'api' && (
          <div className="space-y-4">
            {/* Informacja o botach i silnikach Gemini */}
            <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-cyan-50/60 p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                    Aktywne Modele AI & Architektura Google Gemini
                  </h3>
                </div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                  Google Generative AI
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl border border-indigo-100 bg-white p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-900 font-mono">gemini-3.8-flash</span>
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">Domyślny</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Główny model BizOps AI Studio: generowanie odpowiedzi handlowych, audyt dokumentów, kompresja i ekstrakcja wiedzy.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 font-mono">gemini-3.7-flash</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Fallback #1</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Automatyczny rezerwowy model o wysokiej przepustowości w przypadku obciążenia lub chwilowych limitów kolejki.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 font-mono">gemini-3.5-flash</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Fallback #2</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Szybki silnik analizy struktury, syntezy długich tekstów i weryfikacji spójności bazy wiedzy.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 font-mono">gemini-3.5-flash-lite</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Fallback #3</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Ultra-lekki silnik awaryjny o zerowym opóźnieniu gwarantujący 100% ciągłości działania aplikacji biznesowej.
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-slate-900 text-slate-200 p-3 text-[11px] space-y-1 font-mono">
                <div className="flex items-center justify-between text-cyan-300 font-bold">
                  <span>ŁAŃCUCH NIEZAWODNOŚCI (FALLBACK CHAIN):</span>
                  <span>Auto-Switch 200 ms</span>
                </div>
                <p className="text-slate-400 font-sans">
                  Jeśli Google AI zgłosi limit, przeciążenie lub błąd modelu, serwer w ciągu 200 milisekund automatycznie przełącza się na kolejnego bota z łańcucha, nie przerywając pracy handlowca.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900">
              <p className="font-semibold">Architektura bezpieczeństwa pod Vercel:</p>
              <p className="mt-1 text-emerald-800">
                Twój główny klucz <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono">GEMINI_API_KEY</code> działa po stronie serwera w{' '}
                <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono">/api/ai</code> i nigdy nie trafia do publicznego kodu przeglądarki.
              </p>
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <KeyRound className="h-3.5 w-3.5 text-slate-500" />
                Opcjonalny własny klucz Gemini API (nadpisuje klucz serwerowy .env)
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="Pozostaw puste, aby używać klucza serwera (.env)"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={handleSaveKey}
                  className="shrink-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Zapisz klucz
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ZAKŁADKA: LANGGRAPH (STATEGRAPH ORCHESTRATION) */}
        {activeTab === 'langgraph' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/80 via-white to-indigo-50/60 p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-violet-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-violet-950">
                    Architektura LangGraph v1.7 • Cykliczny StateGraph
                  </h3>
                </div>
                <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-bold text-violet-800">
                  @langchain/langgraph
                </span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                W BizOps AI Studio proces wieloagentowy opiera się o oficjalny framework <strong>LangGraph</strong>.
                Zamiast prostego promptu, zadanie przechodzi przez 3 wyspecjalizowane węzły z pętlą korygującą (Conditional Edges).
              </p>

              {/* Wizualny Schemat Węzłów */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="rounded-xl border border-violet-100 bg-white p-3 space-y-1 shadow-2xs">
                  <div className="flex items-center justify-between font-bold text-violet-900">
                    <span>1. Node: planner</span>
                    <span className="text-[10px] bg-violet-50 px-1.5 py-0.5 rounded text-violet-700">START</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Główny Analityk: dekomponuje zapytanie klienta i dobiera wytyczne z Bazy Wiedzy.
                  </p>
                </div>

                <div className="rounded-xl border border-violet-100 bg-white p-3 space-y-1 shadow-2xs">
                  <div className="flex items-center justify-between font-bold text-indigo-900">
                    <span>2. Node: drafter</span>
                    <span className="text-[10px] bg-indigo-50 px-1.5 py-0.5 rounded text-indigo-700">ITERACJA</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Doradca Handlowy: generuje propozycję cenową i ofertę handlową w oparciu o plan.
                  </p>
                </div>

                <div className="rounded-xl border border-violet-100 bg-white p-3 space-y-1 shadow-2xs">
                  <div className="flex items-center justify-between font-bold text-rose-900">
                    <span>3. Node: critic</span>
                    <span className="text-[10px] bg-rose-50 px-1.5 py-0.5 rounded text-rose-700">AUDYT</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Audytor Ryzyka: weryfikuje VAT, terminy i marże. Jeśli wykryje błąd ➔ zawraca do Draftera!
                  </p>
                </div>
              </div>

              {/* Parametry Silnika */}
              <div className="rounded-xl bg-slate-900 text-slate-200 p-3.5 text-xs font-mono space-y-2">
                <div className="flex items-center justify-between text-violet-300 font-bold">
                  <span>PARAMETRY MASZYNY STANÓW (STATE ANNOTATION):</span>
                  <span>Max loop: 2 cykle</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                  <div>• Model agentów: <strong className="text-white">Gemini 3.8 Flash</strong></div>
                  <div>• Krawędzie warunkowe: <strong className="text-white">Critic ➔ Drafter / END</strong></div>
                  <div>• Czas wykonania: <strong className="text-emerald-400">~800 - 1800 ms</strong></div>
                  <div>• Środowisko: <strong className="text-white">Vercel Serverless Node.js</strong></div>
                </div>
              </div>

              {/* Przycisk Testu LangGraph na Żywo */}
              <div className="pt-2 border-t border-violet-100 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  Przetestuj pełny cykl StateGraph (Planner ➔ Drafter ➔ Critic):
                </span>
                <button
                  type="button"
                  disabled={testingLangGraph}
                  onClick={async () => {
                    setTestingLangGraph(true);
                    setLangGraphTestLogs([]);
                    try {
                      const res = await runLangGraphWorkflow({
                        task: 'Test orkiestracji LangGraph: wycena domu 73m2 całorocznego',
                        knowledgeContext: 'Standard WT2021, cena 229 950 zł netto + 8% VAT dla osób fizycznych.',
                      });
                      setLangGraphTestLogs(res.logs || []);
                      setTestResult({
                        ok: true,
                        text: `LangGraph v${res.version} wykonał zadanie w ${res.executionTimeMs} ms (${res.iterations} iteracje pętli). Wynik: ${res.critique}`,
                      });
                    } catch (e) {
                      setTestResult({
                        ok: false,
                        text: e instanceof Error ? e.message : 'Błąd testu LangGraph',
                      });
                    } finally {
                      setTestingLangGraph(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-violet-700 transition disabled:opacity-50"
                >
                  {testingLangGraph ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Uruchom Diagnostykę LangGraph
                </button>
              </div>

              {/* Logi diagnostyki */}
              {langGraphTestLogs.length > 0 && (
                <div className="rounded-xl bg-slate-950 border border-violet-500/30 p-3 text-[11px] font-mono text-violet-300 space-y-1">
                  <p className="font-bold text-white border-b border-slate-800 pb-1">Logi wykonania StateGraph:</p>
                  {langGraphTestLogs.map((l, li) => (
                    <p key={li}>{l}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ZAKŁADKA 3: PODPIS DORADCY */}
        {activeTab === 'signature' && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <UserCheck className="h-4 w-4 text-indigo-600" />
                Stały podpis doradcy (Automatyczna stopka do odpowiedzi e-mail)
              </div>
              <button
                type="button"
                onClick={() => updateSignature({ enabled: !signature.enabled })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                  signature.enabled ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                    signature.enabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input
                type="text"
                value={signature.name}
                onChange={(e) => updateSignature({ name: e.target.value })}
                placeholder="Imię i nazwisko"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={signature.role}
                onChange={(e) => updateSignature({ role: e.target.value })}
                placeholder="Stanowisko"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={signature.phone}
                onChange={(e) => updateSignature({ phone: e.target.value })}
                placeholder="Telefon"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={signature.email}
                onChange={(e) => updateSignature({ email: e.target.value })}
                placeholder="E-mail"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        )}

        {/* ZAKŁADKA 4: KOPIA ZAPASOWA I PRZYWRACANIE */}
        {activeTab === 'backup' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/60 p-4 text-xs text-indigo-950 space-y-2">
              <p className="font-bold">Pełny Eksport / Import konfiguracji firmy (.json)</p>
              <p className="text-[11px] leading-relaxed text-indigo-900">
                Pobierz jeden plik ze swoimi profilami firm, stopką doradcy, ustawieniami webhooków Make/n8n, linkami oraz biblioteką obiekcji, aby w sekundę przenieść studio na nowy komputer lub zabezpieczyć ustawienia.
              </p>
              <label className="flex items-center gap-2 pt-1 text-[11px] font-semibold text-rose-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSecretsInBackup}
                  onChange={(e) => setIncludeSecretsInBackup(e.target.checked)}
                  className="h-4 w-4 rounded border-rose-300 text-rose-600"
                />
                <span>
                  Dołącz poufne tokeny integracji (WhatsApp / Meta Access Token) — zaznaczaj tylko do prywatnego archiwum
                </span>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleExportCompanyBackup}
                className="flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
              >
                <Download className="h-4 w-4 text-amber-300" />
                Pobierz pełną kopię (.json)
              </button>

              <button
                type="button"
                onClick={() => backupFileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-800 shadow-2xs hover:border-indigo-300 hover:bg-indigo-50"
              >
                <Upload className="h-4 w-4 text-indigo-600" />
                Wczytaj kopię z pliku (.json)
              </button>
              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json"
                onChange={(e) => void handleImportCompanyBackup(e)}
                className="hidden"
              />
            </div>
          </div>
        )}

        {testResult && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs ${
              testResult.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span>{testResult.text}</span>
          </div>
        )}

        {/* Stopka z akcjami */}
        <div className="mt-6 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Testuj połączenie z Gemini AI
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Zamknij ustawienia
          </button>
        </div>
      </div>
    </div>
  );
};
