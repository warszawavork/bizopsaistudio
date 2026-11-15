import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Briefcase,
  Check,
  Copy,
  Download,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  User,
  Users,
  Webhook,
  Zap,
} from 'lucide-react';
import type { AppLanguage, ChatMessage, ChatPerspective, IndustryPreset, KnowledgeTile, MascotMood } from '../types';
import { sendChatQuery } from '../utils/apiClient';

interface ChatViewProps {
  preset: IndustryPreset;
  tiles: KnowledgeTile[];
  language: AppLanguage;
  messages: ChatMessage[];
  onMessagesChange: (msgs: ChatMessage[]) => void;
  perspective: ChatPerspective;
  onPerspectiveChange: (p: ChatPerspective) => void;
  pendingPrompt: string | null;
  onClearPendingPrompt: () => void;
  onMascotUpdate: (mood: MascotMood, tip: string) => void;
  onLogAiCall: (entry: {
    action: 'chat';
    latencyMs: number;
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    status: 'success' | 'error';
    summary: string;
  }) => void;
  onSendWebhookPayload: (payload: Record<string, unknown>, label: string) => Promise<void>;
  onOpenKnowledge: () => void;
  onHandoffToResponder?: (text: string) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  preset,
  tiles,
  language,
  messages,
  onMessagesChange,
  perspective,
  onPerspectiveChange,
  pendingPrompt,
  onClearPendingPrompt,
  onMascotUpdate,
  onLogAiCall,
  onSendWebhookPayload,
  onOpenKnowledge,
  onHandoffToResponder,
}) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [webhookSendingId, setWebhookSendingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visibleTilesCount = tiles.filter(
    (t) => t.enabled && (perspective === 'internal' || t.visibility === 'public')
  ).length;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (overrideText?: string) => {
    const query = (overrideText ?? input).trim();
    if (!query || loading) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
      perspective,
    };

    const nextMessages = [...messages, userMsg];
    onMessagesChange(nextMessages);
    if (!overrideText) setInput('');
    setLoading(true);
    setError(null);
    onMascotUpdate('thinking', 'Przeszukuję bazę wiedzy firmy...');

    try {
      const res = await sendChatQuery({
        companyName: preset.name,
        companyIndustry: preset.industry,
        perspective,
        language,
        knowledgeTiles: tiles,
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
      });

      const assistantMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        content: res.answer,
        timestamp: new Date().toISOString(),
        perspective,
        citedTileIds: res.citedTileIds,
        confidence: res.confidence,
        suggestedFollowUps: res.suggestedFollowUps,
        latencyMs: res.latencyMs,
        tokens: res.usage.totalTokens,
      };

      onMessagesChange([...nextMessages, assistantMsg]);
      onMascotUpdate(res.mascotMood || 'happy', res.mascotTip || 'Gotowe! Sprawdź zacytowane źródła.');
      onLogAiCall({
        action: 'chat',
        latencyMs: res.latencyMs,
        promptTokens: res.usage.promptTokens,
        candidatesTokens: res.usage.candidatesTokens,
        totalTokens: res.usage.totalTokens,
        status: 'success',
        summary: `Czat (${perspective === 'internal' ? 'Wewnętrzny' : 'Klient'}): "${query.slice(0, 48)}"`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd zapytania do AI';
      setError(msg);
      onMascotUpdate('alert', 'Ups! Sprawdź połączenie lub klucz API w Ustawieniach.');
      onLogAiCall({
        action: 'chat',
        latencyMs: 0,
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        status: 'error',
        summary: msg,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pendingPrompt) {
      const prompt = pendingPrompt;
      onClearPendingPrompt();
      void handleSend(prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1600);
  };

  const handleSendToWebhook = async (msg: ChatMessage) => {
    setWebhookSendingId(msg.id);
    await onSendWebhookPayload(
      {
        event: 'bizops.chat.insight',
        company: preset.name,
        perspective: msg.perspective,
        confidence: msg.confidence,
        citedTileIds: msg.citedTileIds || [],
        answer: msg.content,
        timestamp: msg.timestamp,
      },
      'Wysłano odpowiedź z Czatu AI'
    );
    setWebhookSendingId(null);
  };

  const tileMap = new Map(tiles.map((t) => [t.id, t]));
  const suggestions = preset.suggestedQuestions[perspective];

  const handleExportMarkdown = () => {
    if (messages.length === 0) return;
    const lines = [
      `# Czat z Wiedzą — ${preset.name}`,
      `Data eksportu: ${new Date().toLocaleString('pl-PL')}`,
      `Tryb: ${perspective === 'internal' ? 'Wewnętrzny (Zespół)' : 'Klienta (Oficjalny)'}`,
      '',
      ...messages.map((m) =>
        m.role === 'user'
          ? `### Pytanie\n${m.content}\n`
          : `### Odpowiedź AI\n${m.content}\n`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `czat_wiedza_${preset.id}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => onPerspectiveChange('client')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                perspective === 'client'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Tryb Klienta (Oficjalny)
            </button>
            <button
              type="button"
              onClick={() => onPerspectiveChange('internal')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                perspective === 'internal'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Briefcase className="h-3.5 w-3.5" />
              Tryb Wewnętrzny (Zespół / Marże)
            </button>
          </div>
          <button
            type="button"
            onClick={onOpenKnowledge}
            className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700 sm:inline-flex"
          >
            <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
            Aktywne kafelki wiedzy: <strong className="text-slate-900">{visibleTilesCount}</strong>
          </button>
        </div>

        {messages.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
            >
              <Download className="h-3.5 w-3.5" />
              Eksportuj (.md)
            </button>
            <button
              type="button"
              onClick={() => onMessagesChange([])}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Wyczyść rozmowę
            </button>
          </div>
        )}
      </div>

      {/* Chat Container */}
      <div className="flex min-h-[470px] flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex-1 space-y-5 overflow-y-auto p-5 max-h-[540px]">
          {messages.length === 0 ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center py-8 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Ekspert AI: {preset.name}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {perspective === 'internal'
                  ? 'Pracujesz w trybie wewnętrznym: asystent korzysta ze wszystkich kafelków wiedzy, w tym poufnych marż, limitów rabatowych i ryzyk operacyjnych.'
                  : 'Pracujesz w trybie klienta: asystent odpowiada uprzejmie i sprzedażowo wyłącznie na podstawie publicznej bazy wiedzy.'}
              </p>

              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void handleSend(q)}
                    className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-left text-xs font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-indigo-800"
                  >
                    <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
                    <Bot className="h-4 w-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-slate-50/60 text-slate-800'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-[13px]">{msg.content}</div>

                  {msg.role === 'assistant' && (
                    <div className="mt-3 space-y-2.5 border-t border-slate-200/80 pt-2.5">
                      {/* Source Grounding Citations */}
                      {msg.citedTileIds && msg.citedTileIds.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-500">Źródła z bazy:</span>
                          {msg.citedTileIds.map((id) => {
                            const tile = tileMap.get(id);
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={onOpenKnowledge}
                                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                              >
                                <BookOpen className="h-3 w-3" />
                                {tile ? tile.title : id}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Meta & Actions Row */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <div className="flex items-center gap-2">
                          {msg.confidence && (
                            <span
                              className={`rounded-full px-2 py-0.5 font-semibold ${
                                msg.confidence === 'high'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : msg.confidence === 'medium'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              Pewność: {msg.confidence === 'high' ? 'Wysoka' : msg.confidence === 'medium' ? 'Średnia' : 'Niska'}
                            </span>
                          )}
                          {msg.latencyMs !== undefined && (
                            <span className="font-mono text-[10px] text-slate-400">
                              {msg.latencyMs} ms • {msg.tokens} tok.
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                          >
                            {copiedId === msg.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                            {copiedId === msg.id ? 'Skopiowano' : 'Kopiuj'}
                          </button>
                          <button
                            type="button"
                            disabled={webhookSendingId === msg.id}
                            onClick={() => void handleSendToWebhook(msg)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
                          >
                            {webhookSendingId === msg.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Webhook className="h-3 w-3 text-indigo-600" />
                            )}
                            Wyślij do Make
                          </button>
                          {onHandoffToResponder && (
                            <button
                              type="button"
                              onClick={() => onHandoffToResponder(msg.content)}
                              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                            >
                              Użyj w Asystencie
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Follow-up chips */}
                      {msg.suggestedFollowUps && msg.suggestedFollowUps.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {msg.suggestedFollowUps.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => void handleSend(f)}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
                            >
                              + {f}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-700">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))
          )}

          {loading && (
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-500">
                Gemini 3.8 Flash analizuje bazę wiedzy ({visibleTilesCount} kafelków)...
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <strong>Błąd:</strong> {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex items-center gap-2 border-t border-slate-200 bg-slate-50/70 p-3 rounded-b-2xl"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              perspective === 'internal'
                ? 'Zapytaj o marże, ryzyka operacyjne, stawki VAT lub procedury...'
                : 'Zadaj pytanie jako klient o ofertę, standard, czas realizacji...'
            }
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Wyślij
          </button>
        </form>
      </div>
    </div>
  );
};
