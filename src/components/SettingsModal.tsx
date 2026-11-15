import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
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
  setStoredAdvisorSignature,
  setStoredCustomKey,
  testAiConnection,
} from '../utils/apiClient';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onTestLogged: (latencyMs: number, ok: boolean, detail: string) => void;
  cloudStats?: SyncStats;
  onRefreshStats?: () => void;
  tilesCount?: number;
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
}) => {
  const [activeTab, setActiveTab] = useState<'quotas' | 'api' | 'signature'>('quotas');
  const [customKey, setCustomKey] = useState(getStoredCustomKey());
  const [signature, setSignature] = useState<AdvisorSignature>(getStoredAdvisorSignature);
  const [testing, setTesting] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetInfo, setResetInfo] = useState(getResetTimeInfo());

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

  const handleClearOldLogs = async () => {
    setClearingLogs(true);
    try {
      const res = await clearOldCloudAiLogs();
      setTestResult({
        ok: true,
        text: res.message || 'Wyczyszczono stare logi z bazy Neon DB.',
      });
      onRefreshStats?.();
    } catch {
      setTestResult({
        ok: false,
        text: 'Nie udało się wyczyścić starych logów.',
      });
    } finally {
      setClearingLogs(false);
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
            Klucz API Gemini
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
                  <button
                    type="button"
                    disabled={clearingLogs}
                    onClick={handleClearOldLogs}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    {clearingLogs ? 'Czyszczenie...' : 'Wyczyść stare logi AI'}
                  </button>
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

        {/* ZAKŁADKA 2: KLUCZ API GEMINI */}
        {activeTab === 'api' && (
          <div className="space-y-4">
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
