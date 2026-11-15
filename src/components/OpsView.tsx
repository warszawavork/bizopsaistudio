import React, { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  Download,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  Webhook,
  XCircle,
} from 'lucide-react';
import type { AiOpsLogEntry, WebhookConfig, WebhookSendResult } from '../types';

interface OpsViewProps {
  logs: AiOpsLogEntry[];
  onClearLogs: () => void;
  webhookConfig: WebhookConfig;
  onWebhookConfigChange: (cfg: WebhookConfig) => void;
  lastWebhookResult: { payload: Record<string, unknown>; result: WebhookSendResult } | null;
  onTestWebhook: () => Promise<void>;
}

export const OpsView: React.FC<OpsViewProps> = ({
  logs,
  onClearLogs,
  webhookConfig,
  onWebhookConfigChange,
  lastWebhookResult,
  onTestWebhook,
}) => {
  const [telegramToken, setTelegramToken] = useState(() => localStorage.getItem('bizops_tg_token') || '');
  const [telegramChatId, setTelegramChatId] = useState(() => localStorage.getItem('bizops_tg_chat_id') || '');
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const handleSendTelegramReport = async () => {
    if (!telegramToken.trim() || !telegramChatId.trim()) {
      setTelegramStatus('Uzupełnij Token bota i Chat ID.');
      return;
    }
    setSendingTelegram(true);
    setTelegramStatus(null);
    try {
      localStorage.setItem('bizops_tg_token', telegramToken.trim());
      localStorage.setItem('bizops_tg_chat_id', telegramChatId.trim());

      const reportText = [
        '📊 *RAPORT DZIENNY • BIZOPS AI STUDIO*',
        `📅 Data: ${new Date().toLocaleDateString('pl-PL')} ${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`,
        '',
        `⚡ *Wywołania AI ogółem:* ${logs.length}`,
        `✅ *Zakończone sukcesem:* ${logs.filter((l) => l.status === 'success').length}`,
        `⏱️ *Średni czas (latency):* ${avgLatency} ms`,
        `🔢 *Zużyte tokeny:* ${totalTokens.toLocaleString('pl-PL')}`,
        '💰 *Koszt API:* 0,00 zł (Darmowy limit Google)',
        '',
        '🤖 _Raport wygenerowany automatycznie przez BizOps AI Studio_'
      ].join('\n');

      const url = `https://api.telegram.org/bot${encodeURIComponent(telegramToken.trim())}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId.trim(),
          text: reportText,
          parse_mode: 'Markdown',
        }),
      });

      if (!res.ok) {
        throw new Error(`Błąd Telegram API: HTTP ${res.status}`);
      }
      setTelegramStatus('Wysłano raport na Telegram!');
    } catch (err) {
      setTelegramStatus(err instanceof Error ? err.message : 'Nie udało się wysłać raportu.');
    } finally {
      setSendingTelegram(false);
    }
  };

  const successLogs = logs.filter((l) => l.status === 'success' && l.latencyMs > 0);
  const avgLatency =
    successLogs.length > 0
      ? Math.round(successLogs.reduce((acc, l) => acc + l.latencyMs, 0) / successLogs.length)
      : 0;
  const totalTokens = logs.reduce((acc, l) => acc + l.totalTokens, 0);

  const handleTest = async () => {
    setTestingWebhook(true);
    await onTestWebhook();
    setTestingWebhook(false);
  };

  const handleDownloadBlueprint = () => {
    const blueprint = {
      name: 'BizOps AI Studio — Make/n8n Automation Blueprint',
      author: 'Bogdan Liaskevich',
      nodes: [
        {
          id: 'webhook_trigger',
          type: 'n8n-nodes-base.webhook',
          name: '1. Odbiór Payloadu z BizOps AI Studio',
          parameters: { httpMethod: 'POST', path: 'bizops-ai-audit' },
        },
        {
          id: 'risk_router',
          type: 'n8n-nodes-base.if',
          name: '2. Router Ryzyka (HIGH vs LOW/MEDIUM)',
          parameters: { condition: '{{$json.riskLevel}} === "HIGH"' },
        },
        {
          id: 'telegram_alert',
          type: 'n8n-nodes-base.telegram',
          name: '3A. Alert Krytyczny na Telegram Zespołu',
          parameters: { text: '🚨 HIGH RISK Audit: {{$json.clientOrSender}} ({{$json.score}}%)' },
        },
        {
          id: 'crm_sheets',
          type: 'n8n-nodes-base.googleSheets',
          name: '3B. Zapis do Rejestru Google Sheets / Pipedrive',
          parameters: { operation: 'append' },
        },
      ],
    };
    const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'BizOps_AI_Make_n8n_Blueprint.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Executive Studio Pro Ops Header */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-xl">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200">
              <Activity className="h-3 w-3" />
              Studio Pro • Telemetria, Make/n8n & Audit Trail
            </div>
            <h2 className="text-xl font-extrabold tracking-tight">
              Centrum Operacyjne Automatyzacji i Kosztów AI
            </h2>
            <p className="text-xs text-slate-300">
              Monitoruj wydajność zapytań, konfiguruj mostki webhooków Make/n8n/Zapier i przeglądaj log audytu systemu.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-xs font-bold text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Neon Postgres + Gemini Live
          </div>
        </div>

        {/* KPI Cards */}
        <div className="relative mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between text-xs font-medium text-slate-300">
              <span>Wywołania AI & Webhooki</span>
              <Activity className="h-4 w-4 text-indigo-300" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-white">{logs.length}</p>
            <p className="mt-1 text-[11px] text-emerald-300 font-semibold">
              {logs.filter((l) => l.status === 'success').length} zakończonych sukcesem
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between text-xs font-medium text-slate-300">
              <span>Średni czas odpowiedzi</span>
              <Clock className="h-4 w-4 text-sky-300" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-white">{avgLatency} ms</p>
            <p className="mt-1 text-[11px] text-slate-300">Silnik: Gemini 3.8 Flash</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between text-xs font-medium text-slate-300">
              <span>Zużycie tokenów (sesja)</span>
              <Cpu className="h-4 w-4 text-amber-300" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-white">{totalTokens.toLocaleString('pl-PL')}</p>
            <p className="mt-1 text-[11px] text-slate-300">Okno modelu: 1 000 000 tok.</p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between text-xs font-medium text-emerald-200">
              <span>Szacowany koszt API</span>
              <Coins className="h-4 w-4 text-emerald-300" />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-emerald-200">$0.00</p>
            <p className="mt-1 text-[11px] text-emerald-300/80">Darmowy plan Google AI Studio</p>
          </div>
        </div>
      </div>

      {/* Telegram Daily Executive Report Card */}
      <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/70 via-white to-indigo-50/60 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500 text-white shadow-md">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Raport Dzienny na Telegram (Executive Dispatcher)
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                  Telegram Bot API
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Wyślij błyskawiczne podsumowanie aktywności AI, zapytań i tokenów bezpośrednio na swój kanał lub do grupy zarządu.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Telegram Bot Token:
            </label>
            <input
              type="password"
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
              placeholder="np. 7123456789:AAH..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Chat ID (Twój ID lub grupy):
            </label>
            <input
              type="text"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="np. -100123456789 lub 987654321"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-sky-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-sky-100 text-xs">
          <div>
            {telegramStatus && (
              <span className={`text-xs font-semibold ${telegramStatus.includes('Wysłano') ? 'text-emerald-700' : 'text-rose-600'}`}>
                {telegramStatus}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={sendingTelegram}
            onClick={() => void handleSendTelegramReport()}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-sky-700 transition disabled:opacity-50"
          >
            {sendingTelegram ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Wyślij Raport na Telegram teraz
          </button>
        </div>
      </div>

      {/* Make / n8n Webhook Bridge Configurator */}
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Webhook className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Mostek Webhook: Make.com / n8n</h3>
              <p className="text-xs text-slate-500">
                Wysyła ustrukturyzowany JSON z audytów i czatu prosto do Twoich scenariuszy automatyzacji.
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Adres URL Webhooka (Make / n8n / Zapier)
            </label>
            <input
              type="url"
              value={webhookConfig.url}
              onChange={(e) => onWebhookConfigChange({ ...webhookConfig, url: e.target.value })}
              placeholder="https://hook.eu1.make.com/twoj-unikalny-kod-webhooka"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />
          </div>

          <div className="space-y-2.5">
            <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={webhookConfig.simulateWhenEmpty}
                onChange={(e) =>
                  onWebhookConfigChange({ ...webhookConfig, simulateWhenEmpty: e.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              <span>Tryb demonstracyjny (symuluj odpowiedź HTTP 200 gdy pole URL jest puste)</span>
            </label>

            <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={webhookConfig.autoSendOnHighRisk}
                onChange={(e) =>
                  onWebhookConfigChange({ ...webhookConfig, autoSendOnHighRisk: e.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              <span>Automatycznie wysyłaj alert JSON przy audycie o wysokim ryzyku (HIGH RISK)</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={testingWebhook}
              onClick={() => void handleTest()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
            >
              {testingWebhook ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Testuj Webhook (Wyślij Ping JSON)
            </button>
            <button
              type="button"
              onClick={handleDownloadBlueprint}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5 text-indigo-600" />
              Pobierz Blueprint n8n / Make (.json)
            </button>
          </div>
        </div>

        {/* Last Webhook Payload Inspector */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Inspektor ostatniej wysyłki Webhook</h3>
            {lastWebhookResult && (
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                  lastWebhookResult.result.ok
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                HTTP {lastWebhookResult.result.status}{' '}
                {lastWebhookResult.result.simulated ? '(Symulacja)' : '(Live)'} •{' '}
                {lastWebhookResult.result.latencyMs} ms
              </span>
            )}
          </div>

          {!lastWebhookResult ? (
            <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500">
              Kliknij „Testuj Webhook” lub wyślij wynik z Audytora / Czatu, aby zobaczyć wysłany JSON i odpowiedź serwera Make/n8n.
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-600">
                <strong>Odpowiedź:</strong> {lastWebhookResult.result.responseText}
              </p>
              <pre className="max-h-44 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] font-mono text-sky-300">
                {JSON.stringify(lastWebhookResult.payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Telemetry & Audit Log Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Log Audytu AI & Telemetria (Audit Trail)</h3>
            <p className="text-xs text-slate-500">Pełna historia wywołań modelu Gemini oraz webhooków</p>
          </div>
          {logs.length > 0 && (
            <button
              type="button"
              onClick={onClearLogs}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Wyczyść logi
            </button>
          )}
        </div>

        {logs.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">
            Brak zarejestrowanych operacji w tej sesji. Zadaj pytanie botowi lub uruchom audyt dokumentu.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">Czas</th>
                  <th className="py-2 pr-3">Moduł</th>
                  <th className="py-2 pr-3">Preset</th>
                  <th className="py-2 pr-3">Opis zdarzenia</th>
                  <th className="py-2 pr-3">Opóźnienie</th>
                  <th className="py-2 pr-3">Tokeny</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString('pl-PL')}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-600 whitespace-nowrap">{log.presetName}</td>
                    <td className="py-2.5 pr-3 text-slate-800 max-w-xs truncate">{log.summary}</td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-500">{log.latencyMs} ms</td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-500">{log.totalTokens}</td>
                    <td className="py-2.5">
                      {log.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" /> OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                          <XCircle className="h-3.5 w-3.5" /> Błąd
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
