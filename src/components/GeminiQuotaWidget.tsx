import React, { useState } from 'react';
import { Activity, CheckCircle2, X, Zap } from 'lucide-react';
import type { AiOpsLogEntry } from '../types';

interface GeminiQuotaWidgetProps {
  logs: AiOpsLogEntry[];
}

const DAILY_FREE_LIMIT_RPD = 1500; // Google AI Studio Free Tier RPD for Gemini Flash
const RPM_LIMIT = 15; // Requests Per Minute

export const GeminiQuotaWidget: React.FC<GeminiQuotaWidgetProps> = ({ logs }) => {
  const [modalOpen, setModalOpen] = useState(false);

  // Filter logs for today
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayLogs = logs.filter((l) => l.timestamp.startsWith(todayStr));
  const requestsToday = todayLogs.length;
  const tokensToday = todayLogs.reduce((acc, l) => acc + l.totalTokens, 0);

  const percentUsed = Math.min(100, Math.round((requestsToday / DAILY_FREE_LIMIT_RPD) * 100));
  const remainingRequests = Math.max(0, DAILY_FREE_LIMIT_RPD - requestsToday);

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-slate-900/90 hover:bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-2xs transition group"
        title="Kliknij, aby zobaczyć statystyki zużycia i darmowe limity Gemini API"
      >
        <Zap className="h-3.5 w-3.5 text-cyan-400 group-hover:scale-110 transition-transform" />
        <span className="hidden md:inline text-slate-400">Limity AI:</span>
        <span className="font-mono text-cyan-300 font-bold">
          {requestsToday} / {DAILY_FREE_LIMIT_RPD}
        </span>
        <span className="hidden sm:inline text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/30">
          Darmowy Plan (0 zł)
        </span>
      </button>

      {/* Quota Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 shadow-2xl rounded-3xl p-6 text-slate-100 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Monitor Limitów Gemini API</h3>
                  <p className="text-xs text-slate-400">Google AI Studio • Darmowy Plan Operacyjny</p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-5 space-y-4">
              {/* Daily progress bar */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-slate-300 font-medium">Wykorzystanie limitu dziennego (RPD)</span>
                  <span className="font-mono text-cyan-400 font-bold">{percentUsed}%</span>
                </div>
                <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(4, percentUsed)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 font-mono">
                  <span>Dzisiaj: {requestsToday} zapytań</span>
                  <span>Pozostało: {remainingRequests} darmowych</span>
                </div>
              </div>

              {/* Stat Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-[11px] text-slate-400 block mb-1">Maksymalne tempo</span>
                  <span className="text-lg font-bold text-white font-mono">{RPM_LIMIT} RPM</span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Zapytań na minutę</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-[11px] text-slate-400 block mb-1">Zużyte tokeny</span>
                  <span className="text-lg font-bold text-white font-mono">
                    {tokensToday > 1000 ? `${(tokensToday / 1000).toFixed(1)}k` : tokensToday}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Wszystkie akcje dzisiaj</span>
                </div>
              </div>

              {/* Status info */}
              <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/20 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 space-y-1">
                  <p className="font-bold text-emerald-300">Koszt API: 0,00 zł (Całkowicie za darmo)</p>
                  <p className="text-slate-400 leading-relaxed">
                    Model <strong>Gemini 3.8 Flash</strong> w Google AI Studio oferuje 1 500 bezpłatnych zapytań każdego dnia. Limit resetuje się automatycznie o północy (UTC-8).
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setModalOpen(false)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-xs text-white transition"
            >
              Rozumiem, zamknij
            </button>
          </div>
        </div>
      )}
    </>
  );
};
