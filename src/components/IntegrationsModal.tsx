import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Share2,
  X,
} from 'lucide-react';
import type { IntegrationsConfig } from '../types';
import {
  getStoredIntegrationsConfig,
  setStoredIntegrationsConfig,
  testMetaConnection,
  testWhatsAppConnection,
} from '../utils/apiClient';

interface IntegrationsModalProps {
  open: boolean;
  onClose: () => void;
  onConfigSaved?: (cfg: IntegrationsConfig) => void;
}

export const IntegrationsModal: React.FC<IntegrationsModalProps> = ({
  open,
  onClose,
  onConfigSaved,
}) => {
  const [config, setConfig] = useState<IntegrationsConfig>(getStoredIntegrationsConfig);
  const [activeChannel, setActiveChannel] = useState<'gmail' | 'whatsapp' | 'meta'>('whatsapp');
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedAppsScript, setCopiedAppsScript] = useState(false);

  if (!open) return null;

  const webhookEndpoint =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/integrations`
      : 'https://twoja-domena.vercel.app/api/integrations';

  const saveConfig = (next: IntegrationsConfig) => {
    setConfig(next);
    setStoredIntegrationsConfig(next);
    onConfigSaved?.(next);
  };

  const handleCopyWebhookUrl = () => {
    void navigator.clipboard.writeText(webhookEndpoint);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 1800);
  };

  const handleTestWhatsApp = async () => {
    setTesting(true);
    setStatusMsg(null);
    try {
      const res = await testWhatsAppConnection({
        phoneNumberId: config.whatsapp.phoneNumberId,
        accessToken: config.whatsapp.accessToken,
      });
      setStatusMsg({
        ok: true,
        text: `Połączono z WhatsApp Business: ${res.verifiedName} (${res.displayPhoneNumber}).`,
      });
      saveConfig({
        ...config,
        whatsapp: { ...config.whatsapp, enabled: true },
      });
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Błąd połączenia z WhatsApp Cloud API.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTestMeta = async () => {
    setTesting(true);
    setStatusMsg(null);
    try {
      const res = await testMetaConnection({
        pageId: config.metaBusiness.pageId,
        accessToken: config.metaBusiness.accessToken,
      });
      setStatusMsg({
        ok: true,
        text: `Połączono z Meta Business: ${res.name} (ID: ${res.id}).`,
      });
      saveConfig({
        ...config,
        metaBusiness: { ...config.metaBusiness, enabled: true },
      });
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Błąd połączenia z Meta Business API.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-emerald-500 text-white shadow-sm">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                Centrum Integracji: Gmail • WhatsApp • Meta Business
              </h2>
              <p className="text-xs text-slate-500">
                Połącz wszystkie kanały klientów z jednym Asystentem Odpowiedzi AI
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

        {/* Unified Flow Banner */}
        <div className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-[11px] text-indigo-950">
          <p className="font-bold">Jak połączyć to razem w 1 workflow?</p>
          <p className="mt-0.5 text-indigo-800">
            1. Wiadomości z <strong>Gmaila, WhatsAppa i Meta (Messenger/IG/Lead Ads)</strong> trafiają do Asystenta Odpowiedzi → 2. AI przygotowuje odpowiedź z Bazy Wiedzy → 3. Odsyłasz gotową odpowiedź 1 kliknięciem prosto na <strong>Gmail</strong> lub <strong>WhatsApp</strong>.
          </p>
        </div>

        {/* Channel Tabs */}
        <div className="mb-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1.5">
          <button
            type="button"
            onClick={() => {
              setActiveChannel('whatsapp');
              setStatusMsg(null);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              activeChannel === 'whatsapp'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp API
            {config.whatsapp.enabled && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveChannel('gmail');
              setStatusMsg(null);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              activeChannel === 'gmail'
                ? 'bg-white text-rose-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mail className="h-3.5 w-3.5" />
            Gmail
            {config.gmail.enabled && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveChannel('meta');
              setStatusMsg(null);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              activeChannel === 'meta'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Share2 className="h-3.5 w-3.5" />
            Meta Business
            {config.metaBusiness.enabled && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
          </button>
        </div>

        {/* WhatsApp Cloud API */}
        {activeChannel === 'whatsapp' && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-900">
                  WhatsApp Business Cloud API (Meta)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Bezpośrednia wysyłka wiadomości z Asystenta Odpowiedzi + Webhook odbiorczy.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.whatsapp.enabled}
                  onChange={(e) =>
                    saveConfig({
                      ...config,
                      whatsapp: { ...config.whatsapp, enabled: e.target.checked },
                    })
                  }
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Aktywny
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Phone Number ID (z Meta Developers)
                </label>
                <input
                  type="text"
                  value={config.whatsapp.phoneNumberId}
                  onChange={(e) =>
                    saveConfig({
                      ...config,
                      whatsapp: { ...config.whatsapp, phoneNumberId: e.target.value },
                    })
                  }
                  placeholder="np. 345678901234567"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Domyślny numer odbiorcy / testowy
                </label>
                <input
                  type="text"
                  value={config.whatsapp.defaultRecipient}
                  onChange={(e) =>
                    saveConfig({
                      ...config,
                      whatsapp: { ...config.whatsapp, defaultRecipient: e.target.value },
                    })
                  }
                  placeholder="np. 48500600700"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                Permanent / System User Access Token
              </label>
              <input
                type="password"
                value={config.whatsapp.accessToken}
                onChange={(e) =>
                  saveConfig({
                    ...config,
                    whatsapp: { ...config.whatsapp, accessToken: e.target.value },
                  })
                }
                placeholder="EAAG..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-emerald-500"
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-700">
                  Twój Webhook URL do wklejenia w Meta Developers:
                </span>
                <button
                  type="button"
                  onClick={handleCopyWebhookUrl}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {copiedWebhook ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  {copiedWebhook ? 'Skopiowano' : 'Kopiuj URL'}
                </button>
              </div>
              <p className="mt-1 font-mono text-[11px] text-indigo-700 break-all">{webhookEndpoint}</p>
              <p className="mt-1 text-[10px] text-slate-500">
                Verify Token: <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">bizops-meta-verify</code> (lub własny <code className="font-mono">META_VERIFY_TOKEN</code> w Vercel)
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTestWhatsApp()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Testuj połączenie WhatsApp
              </button>
            </div>
          </div>
        )}

        {/* Gmail */}
        {activeChannel === 'gmail' && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div>
              <h3 className="text-xs font-bold text-slate-900">Integracja z Gmail</h3>
              <p className="text-[11px] text-slate-500">
                Wybierz tryb natychmiastowy (otwarcie szkicu w Gmailu) lub automatyczny mostek przez Make / n8n / Google Apps Script.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  saveConfig({
                    ...config,
                    gmail: { ...config.gmail, mode: 'mailto', enabled: true },
                  })
                }
                className={`rounded-xl border p-3 text-left text-xs transition ${
                  config.gmail.mode === 'mailto'
                    ? 'border-indigo-500 bg-indigo-50/70'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <p className="font-bold text-slate-900">Tryb Szybki (Otwórz w Gmail / Poczcie)</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Działa od razu bez konfiguracji — 1 kliknięcie otwiera gotowy mail z tematem i stopką.
                </p>
              </button>
              <button
                type="button"
                onClick={() =>
                  saveConfig({
                    ...config,
                    gmail: { ...config.gmail, mode: 'webhook', enabled: true },
                  })
                }
                className={`rounded-xl border p-3 text-left text-xs transition ${
                  config.gmail.mode === 'webhook'
                    ? 'border-indigo-500 bg-indigo-50/70'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <p className="font-bold text-slate-900">Mostek Gmail (Make / n8n / Apps Script)</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Automatycznie tworzy szkic (Draft) lub wysyła maila przez Twój scenariusz Make/n8n.
                </p>
              </button>
            </div>

            {config.gmail.mode === 'webhook' && (
              <div className="space-y-2.5 pt-1">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                    Webhook URL mostka Gmail (Make / n8n / Google Apps Script)
                  </label>
                  <input
                    type="url"
                    value={config.gmail.webhookUrl}
                    onChange={(e) =>
                      saveConfig({
                        ...config,
                        gmail: { ...config.gmail, webhookUrl: e.target.value },
                      })
                    }
                    placeholder="https://hook.eu2.make.com/..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                    Twój adres Gmail nadawcy (opcjonalnie)
                  </label>
                  <input
                    type="email"
                    value={config.gmail.senderEmail}
                    onChange={(e) =>
                      saveConfig({
                        ...config,
                        gmail: { ...config.gmail, senderEmail: e.target.value },
                      })
                    }
                    placeholder="sprzedaz@twojafirma.pl"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}
            {/* Gmail Auto-Draft Google Apps Script */}
            <div className="rounded-xl border border-indigo-200/80 bg-white p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold text-slate-900">
                    Skrypt „Gmail Auto-Draft” (Google Apps Script — 1 klik)
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Wklej raz na <span className="font-mono">script.google.com</span> — nieprzeczytane maile z etykietą <code className="rounded bg-slate-100 px-1">Zapytania</code> same dostaną gotowy szkic odpowiedzi AI!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const apiBase =
                      typeof window !== 'undefined'
                        ? `${window.location.origin}/api/ai`
                        : 'https://twoja-apka.vercel.app/api/ai';
                    const script = `function createAiDraftsForZapytania() {
  const label = GmailApp.getUserLabelByName('Zapytania');
  if (!label) return;
  const threads = label.getThreads(0, 5);
  threads.forEach((thread) => {
    const msgs = thread.getMessages();
    const last = msgs[msgs.length - 1];
    if (!last.isUnread()) return;
    const res = UrlFetchApp.fetch('${apiBase}', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'reply_assistant',
        companyName: 'Twoja Firma',
        clientMessage: last.getPlainBody(),
        tone: 'sales',
        channel: 'email',
        replyLanguage: 'auto',
        useWebKnowledge: true
      })
    });
    const data = JSON.parse(res.getContentText());
    if (data.replyBody) {
      last.createDraftReply(data.replyBody);
      last.markRead();
    }
  });
}`;
                    void navigator.clipboard.writeText(script);
                    setCopiedAppsScript(true);
                    setTimeout(() => setCopiedAppsScript(false), 2200);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700"
                >
                  {copiedAppsScript ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedAppsScript ? 'Skopiowano skrypt!' : 'Kopiuj skrypt Apps Script'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Meta Business */}
        {activeChannel === 'meta' && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-900">
                  Meta Business Suite (Messenger, Instagram DM, Lead Ads)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Połącz stronę firmową na Facebooku/Instagramie oraz formularze Lead Ads.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.metaBusiness.enabled}
                  onChange={(e) =>
                    saveConfig({
                      ...config,
                      metaBusiness: { ...config.metaBusiness, enabled: e.target.checked },
                    })
                  }
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Aktywny
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Meta Page ID (lub „me”)
                </label>
                <input
                  type="text"
                  value={config.metaBusiness.pageId}
                  onChange={(e) =>
                    saveConfig({
                      ...config,
                      metaBusiness: { ...config.metaBusiness, pageId: e.target.value },
                    })
                  }
                  placeholder="np. 102938475610293"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Webhook URL do odbierania leadów (opcjonalnie)
                </label>
                <input
                  type="url"
                  value={config.metaBusiness.webhookUrl}
                  onChange={(e) =>
                    saveConfig({
                      ...config,
                      metaBusiness: { ...config.metaBusiness, webhookUrl: e.target.value },
                    })
                  }
                  placeholder="https://hook.eu2.make.com/..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                Meta Page Access Token
              </label>
              <input
                type="password"
                value={config.metaBusiness.accessToken}
                onChange={(e) =>
                  saveConfig({
                    ...config,
                    metaBusiness: { ...config.metaBusiness, accessToken: e.target.value },
                  })
                }
                placeholder="EAAG..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTestMeta()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Testuj połączenie Meta Business
              </button>
            </div>
          </div>
        )}

        {statusMsg && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs ${
              statusMsg.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {statusMsg.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
          <span className="text-[11px] text-slate-400">
            Ustawienia zapisują się automatycznie lokalnie w przeglądarce.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Gotowe
          </button>
        </div>
      </div>
    </div>
  );
};
