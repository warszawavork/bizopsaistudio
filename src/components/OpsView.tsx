import React, { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Trash2,
  Webhook,
  XCircle,
} from 'lucide-react';
import type { AiOpsLogEntry, WebhookConfig, WebhookSendResult } from '../types';
import { detectTelegramChats, sendTelegramReport } from '../utils/apiClient';

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
  const [showTgToken, setShowTgToken] = useState(false);
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [detectingTelegram, setDetectingTelegram] = useState(false);
  const [detectedBotInfo, setDetectedBotInfo] = useState<{
    botUsername: string;
    botName: string;
    botUrl: string;
    chats: Array<{ id: string; label: string; type: string }>;
  } | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const handleDetectTelegramChat = async () => {
    const cleanToken = telegramToken.trim().replace(/^bot/i, '').replace(/\s+/g, '');
    if (!cleanToken) {
      setTelegramStatus({ ok: false, text: 'Najpierw wklej Telegram Bot Token z @BotFather.' });
      return;
    }
    setDetectingTelegram(true);
    setTelegramStatus(null);
    try {
      localStorage.setItem('bizops_tg_token', cleanToken);
      const res = await detectTelegramChats(cleanToken);
      setDetectedBotInfo({
        botUsername: res.botUsername,
        botName: res.botName,
        botUrl: res.botUrl,
        chats: res.chats,
      });
      if (res.chats.length > 0) {
        const preferred = res.chats.find((c) => c.type === 'private') || res.chats[0];
        setTelegramChatId(preferred.id);
        localStorage.setItem('bizops_tg_chat_id', preferred.id);
        setTelegramStatus({
          ok: true,
          text: `Połączono z @${res.botUsername}! Wykryto i ustawiono Chat ID: ${preferred.id} (${preferred.label}).`,
        });
      } else {
        setTelegramStatus({
          ok: false,
          text: res.botUrl
            ? `Połączono z botem @${res.botUsername}! Otwórz ${res.botUrl} w Telegramie, kliknij START (/start) i kliknij ponownie „Wykryj moje Chat ID”.`
            : 'Połączono z botem, ale nie wysłałeś mu jeszcze /start na Telegramie.',
        });
      }
    } catch (err) {
      setTelegramStatus({
        ok: false,
        text: err instanceof Error ? err.message : 'Nie udało się połączyć z botem Telegram.',
      });
    } finally {
      setDetectingTelegram(false);
    }
  };

  const handleSendTelegramReport = async () => {
    const cleanToken = telegramToken.trim().replace(/^bot/i, '').replace(/\s+/g, '');
    const cleanChatId = telegramChatId.trim().replace(/\s+/g, '');
    if (!cleanToken || !cleanChatId) {
      setTelegramStatus({ ok: false, text: 'Uzupełnij Token bota i Chat ID (albo kliknij Wykryj moje Chat ID).' });
      return;
    }
    setSendingTelegram(true);
    setTelegramStatus(null);
    try {
      localStorage.setItem('bizops_tg_token', cleanToken);
      localStorage.setItem('bizops_tg_chat_id', cleanChatId);

      const errorCount = logs.filter((l) => l.status === 'error').length;
      const reportText = [
        '📊 <b>RAPORT DZIENNY • BIZOPS AI STUDIO</b>',
        `📅 Data: ${new Date().toLocaleDateString('pl-PL')} ${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`,
        '',
        `⚡ <b>Wywołania AI ogółem:</b> ${logs.length}`,
        `✅ <b>Zakończone sukcesem:</b> ${logs.filter((l) => l.status === 'success').length}${errorCount > 0 ? ` (błędy: ${errorCount})` : ''}`,
        `⏱️ <b>Średni czas (latency):</b> ${avgLatency} ms`,
        `🔢 <b>Zużyte tokeny:</b> ${totalTokens.toLocaleString('pl-PL')}`,
        '💰 <b>Koszt API:</b> 0,00 zł (Darmowy limit Google)',
        '',
        '🤖 <i>Raport wygenerowany automatycznie przez BizOps AI Studio</i>',
      ].join('\n');

      const res = await sendTelegramReport({
        botToken: cleanToken,
        chatId: cleanChatId,
        text: reportText,
        parseMode: 'HTML',
      });
      setTelegramStatus({
        ok: true,
        text: `Wysłano raport na Telegram (${res.chatLabel || res.chatId})!`,
      });
    } catch (err) {
      setTelegramStatus({
        ok: false,
        text: err instanceof Error ? err.message : 'Nie udało się wysłać raportu na Telegram.',
      });
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
            <div className="relative">
              <input
                type={showTgToken ? 'text' : 'password'}
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="np. 7123456789:AAH..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-xs font-mono text-slate-800 outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => setShowTgToken((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                title={showTgToken ? 'Ukryj token' : 'Pokaż token'}
              >
                {showTgToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-slate-700">
                Chat ID (Twój prywatny ID lub grupy):
              </label>
              <button
                type="button"
                disabled={detectingTelegram || !telegramToken.trim()}
                onClick={() => void handleDetectTelegramChat()}
                className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800 hover:bg-sky-200 disabled:opacity-45"
                title="Sprawdź połączenie z botem i automatycznie pobierz Twoje Chat ID z Telegrama"
              >
                {detectingTelegram ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                Wykryj moje Chat ID
              </button>
            </div>
            <input
              type="text"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="np. 8699950092 lub -100123456789"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {detectedBotInfo && (
          <div className="rounded-xl border border-sky-200 bg-white/90 px-3 py-2 text-[11px] flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-slate-800">
                Aktywny bot: @{detectedBotInfo.botUsername || detectedBotInfo.botName}
              </span>
              {detectedBotInfo.chats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setTelegramChatId(c.id);
                    localStorage.setItem('bizops_tg_chat_id', c.id);
                  }}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-bold border transition ${
                    telegramChatId === c.id
                      ? 'border-sky-500 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-300'
                  }`}
                >
                  {c.label} • {c.id}
                </button>
              ))}
            </div>
            {detectedBotInfo.botUrl && (
              <a
                href={detectedBotInfo.botUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 hover:underline"
              >
                Otwórz w Telegram (kliknij /start)
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-sky-100 text-xs">
          <div className="flex-1 min-w-[220px]">
            {telegramStatus ? (
              <span className={`text-xs font-semibold ${telegramStatus.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
                {telegramStatus.text}
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">
                Wskazówka: przy nowym bocie otwórz go raz w Telegramie i kliknij <strong>START</strong>, inaczej Telegram blokuje pierwszą wiadomość priv.
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
