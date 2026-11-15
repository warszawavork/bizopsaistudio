import React, { useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, UserCheck, X, AlertCircle } from 'lucide-react';
import type { AdvisorSignature } from '../types';
import {
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
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  onTestLogged,
}) => {
  const [customKey, setCustomKey] = useState(getStoredCustomKey());
  const [signature, setSignature] = useState<AdvisorSignature>(getStoredAdvisorSignature);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

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
        ? 'Zapisano własny klucz w przeglądarce (localStorage). Zapyta bezpośrednio przez proxy.'
        : 'Wyczyszczono własny klucz — aplikacja używa bezpiecznego klucza serwerowego (.env).',
    });
  };

  const handleTest = async () => {
    setStoredCustomKey(customKey);
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAiConnection();
      const sourceLabel = res.keySource === 'custom_key' ? 'własny klucz z Ustawień' : 'bezpieczny klucz serwera (.env)';
      setTestResult({
        ok: true,
        text: `Połączono z ${res.model} (${res.latencyMs} ms) — źródło: ${sourceLabel}.`,
      });
      onTestLogged(res.latencyMs, true, `Test połączenia (${sourceLabel})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd połączenia z API';
      setTestResult({ ok: false, text: msg });
      onTestLogged(0, false, msg);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Konfiguracja API Gemini</h2>
              <p className="text-xs text-slate-500">Bezpieczny proxy serwerowy (/api/ai) + opcjonalny klucz własny</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900">
            <p className="font-semibold">Architektura bezpieczeństwa pod Vercel:</p>
            <p className="mt-1 text-emerald-800">
              Twój klucz <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono">GEMINI_API_KEY</code> działa po stronie serwera w{' '}
              <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono">/api/ai</code> i nigdy nie trafia do publicznego kodu JS.
            </p>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <KeyRound className="h-3.5 w-3.5 text-slate-500" />
              Opcjonalny własny klucz Gemini API (nadpisuje .env)
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
                Zapisz
              </button>
            </div>
          </div>

          {/* Advisor Signature Section */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <UserCheck className="h-4 w-4 text-indigo-600" />
                Stały podpis doradcy (Stopka do maili)
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
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={signature.name}
                onChange={(e) => updateSignature({ name: e.target.value })}
                placeholder="Imię i nazwisko"
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={signature.role}
                onChange={(e) => updateSignature({ role: e.target.value })}
                placeholder="Stanowisko"
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={signature.phone}
                onChange={(e) => updateSignature({ phone: e.target.value })}
                placeholder="Telefon"
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={signature.email}
                onChange={(e) => updateSignature({ email: e.target.value })}
                placeholder="E-mail"
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
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
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Testuj połączenie z Gemini
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
