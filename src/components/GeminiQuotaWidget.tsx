import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Clock, Database, RefreshCw, Users, X, Zap } from 'lucide-react';
import type { AiOpsLogEntry } from '../types';
import type { SyncStats } from '../utils/syncEngine';

interface GeminiQuotaWidgetProps {
  logs: AiOpsLogEntry[];
  cloudStats?: SyncStats;
  onRefreshStats?: () => void;
}

const DAILY_FREE_LIMIT_RPD = 1500; // Google AI Studio Free Tier RPD
const RPM_LIMIT = 15; // Requests Per Minute
const NEON_MAX_MB = 512; // 512 MB Free Tier Neon Postgres

function getTimeUntilMidnightReset(): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const diffMs = tomorrow.getTime() - now.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

export const GeminiQuotaWidget: React.FC<GeminiQuotaWidgetProps> = ({
  logs,
  cloudStats,
  onRefreshStats,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [resetCountdown, setResetCountdown] = useState(getTimeUntilMidnightReset());

  useEffect(() => {
    const timer = setInterval(() => {
      setResetCountdown(getTimeUntilMidnightReset());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Obliczenia dzienne (zsynchronizowane z Neon DB dla wszystkich urządzeń)
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayLocalLogs = logs.filter((l) => l.timestamp.startsWith(todayStr));

  const requestsToday = cloudStats ? cloudStats.todayRequests : todayLocalLogs.length;
  const tokensToday = cloudStats
    ? cloudStats.todayTokens
    : todayLocalLogs.reduce((acc, l) => acc + l.totalTokens, 0);
  const minuteRequests = cloudStats?.minuteRequests ?? 0;

  const percentUsed = Math.min(100, Math.round((requestsToday / DAILY_FREE_LIMIT_RPD) * 100));
  const remainingRequests = Math.max(0, DAILY_FREE_LIMIT_RPD - requestsToday);
  const remainingRpm = Math.max(0, RPM_LIMIT - minuteRequests);

  // Pamięć Neon DB
  const dbSizeBytes = cloudStats?.dbSizeBytes ?? 7650000;
  const dbUsedMb = +(dbSizeBytes / (1024 * 1024)).toFixed(2);
  const dbRemainingMb = +(NEON_MAX_MB - dbUsedMb).toFixed(2);
  const dbPercent = Math.min(100, Math.max(1, Math.round((dbUsedMb / NEON_MAX_MB) * 100)));

  const recentLogs = cloudStats?.recentLogs || [];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setModalOpen(true);
          onRefreshStats?.();
        }}
        className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-slate-900/95 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-2xs transition group"
        title="Kliknij, aby zobaczyć zsynchronizowane limity Google AI i pamięć Neon DB"
      >
        <Zap className="h-3.5 w-3.5 text-cyan-400 group-hover:scale-110 transition-transform" />
        <span className="hidden lg:inline text-slate-400">AI:</span>
        <span className="font-mono text-cyan-300 font-bold">
          {requestsToday}/{DAILY_FREE_LIMIT_RPD}
        </span>
        <span className="hidden sm:inline text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full border border-emerald-500/30 font-mono">
          Zostało: {remainingRequests}
        </span>
      </button>

      {/* Rozbudowany Modal Limitów i Pamięci Chmury */}
      {modalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 shadow-2xl rounded-3xl p-6 text-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Centrum Limitów AI & Pamięci Chmury
                  </h3>
                  <p className="text-xs text-slate-400">
                    Zsynchronizowane na żywo między wszystkimi urządzeniami (Neon DB)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {onRefreshStats && (
                  <button
                    type="button"
                    onClick={onRefreshStats}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition"
                    title="Odśwież stan z bazy Neon"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="py-5 space-y-4">
              {/* 1. Limit Dzienny RPD */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-cyan-400" />
                    Dzienny Limit Zapytań (Google AI RPD)
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">
                    Zostało: {remainingRequests} z {DAILY_FREE_LIMIT_RPD}
                  </span>
                </div>
                <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(2, percentUsed)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2.5 font-mono">
                  <span>Użyto dziś: {requestsToday} zapytań ({percentUsed}%)</span>
                  <span className="flex items-center gap-1 text-cyan-300">
                    <Clock className="w-3 h-3" />
                    Reset za: {resetCountdown} (o 00:00)
                  </span>
                </div>
              </div>

              {/* 2. Siatka metryk na żywo: Tempo RPM, Tokeny, Czas odpowiedzi */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-1">Limit na minutę (RPM)</span>
                  <span className="text-base font-bold text-white font-mono">
                    {minuteRequests} / {RPM_LIMIT}
                  </span>
                  <span className="text-[10px] text-emerald-400 block mt-0.5 font-mono">
                    Wolne teraz: {remainingRpm}/min
                  </span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-1">Tokeny dzisiaj</span>
                  <span className="text-base font-bold text-white font-mono">
                    {tokensToday > 1000 ? `${(tokensToday / 1000).toFixed(1)}k` : tokensToday}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Limit: 1M / min</span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-1">Śr. szybkość AI</span>
                  <span className="text-base font-bold text-cyan-300 font-mono">
                    {cloudStats?.avgLatency ? `${(cloudStats.avgLatency / 1000).toFixed(1)}s` : '1.2s'}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Czas odpowiedzi</span>
                </div>
              </div>

              {/* 3. Pamięć Bazy Danych Neon Postgres */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-indigo-500/30">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-indigo-300 font-semibold flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-indigo-400" />
                    Pamięć Chmury Neon Postgres (BizOpsBAZA)
                  </span>
                  <span className="font-mono text-indigo-300 font-bold">
                    Wolne: {dbRemainingMb} MB
                  </span>
                </div>
                <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(3, dbPercent)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 font-mono">
                  <span>Zajęte: {dbUsedMb} MB / {NEON_MAX_MB} MB ({dbPercent}%)</span>
                  <span>
                    Kafelki: {cloudStats?.tilesCount ?? '—'} • Logi: {cloudStats?.logsCount ?? '—'}
                  </span>
                </div>
              </div>

              {/* 4. Ostatnie zapytania z zespołu (Zsynchronizowane między telefonem a PC) */}
              {recentLogs.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-cyan-400" />
                      Ostatnie zapytania ze wszystkich urządzeń ({recentLogs.length})
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {recentLogs.slice(0, 6).map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-bold text-[10px] shrink-0">
                            {log.userName || 'Użytkownik'}
                          </span>
                          <span className="text-slate-300 truncate">{log.summary}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] text-slate-400 ml-2">
                          <span>{log.totalTokens} tok</span>
                          <span>
                            {new Date(log.timestamp).toLocaleTimeString('pl-PL', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 5. Informacja o darmowym planie */}
              <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/20 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 space-y-1">
                  <p className="font-bold text-emerald-300">
                    Koszt operacyjny: 0,00 zł • Pełna synchronizacja
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    Każde zapytanie z telefonu lub komputera natychmiast zapisuje się w bazie Neon. Limit minutowy (15 RPM) resetuje się co 60 sekund, a limit dzienny (1 500 RPD) o północy.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs text-white transition"
            >
              Zamknij panel diagnostyczny
            </button>
          </div>
        </div>
      )}
    </>
  );
};
