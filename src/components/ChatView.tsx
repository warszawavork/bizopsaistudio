import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Briefcase,
  Check,
  Copy,
  Download,
  FileText,
  Globe,
  Loader2,
  Mail,
  PlusCircle,
  Printer,
  Send,
  Sparkles,
  Trash2,
  User,
  Users,
  Webhook,
  Zap,
} from 'lucide-react';
import type {
  AppLanguage,
  ChatMessage,
  ChatPerspective,
  IndustryPreset,
  KnowledgeTile,
  MascotMood,
} from '../types';
import { sendChatQuery } from '../utils/apiClient';
import { copyRichEmailToClipboard, escapeHtml, markdownBodyToEmailHtml } from '../utils/emailExport';
import { exportChatTranscriptToPdf, printCleanReportHtml } from '../utils/pdfExport';
import { SimpleMarkdown } from './SimpleMarkdown';
import { WebSourcesPanel } from './WebSourcesPanel';

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
  onAddKnowledgeTile?: (tile: KnowledgeTile) => void;
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
  onAddKnowledgeTile,
}) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedEmailId, setCopiedEmailId] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [savedTileMsgId, setSavedTileMsgId] = useState<string | null>(null);
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
    onMascotUpdate(
      'thinking',
      useWebSearch
        ? 'Przeszukuję Bazę Wiedzy firmy oraz aktualny Internet (Google)...'
        : 'Przeszukuję Bazę Wiedzy firmy...'
    );

    try {
      const res = await sendChatQuery({
        companyName: preset.name,
        companyIndustry: preset.industry,
        perspective,
        language,
        useWebSearch,
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
        webSources: res.webSources,
        webFactsUsed: res.webFactsUsed,
        searchQueries: res.searchQueries,
        contextStats: res.contextStats,
        confidence: res.confidence,
        suggestedFollowUps: res.suggestedFollowUps,
        latencyMs: res.latencyMs,
        tokens: res.usage.totalTokens,
      };

      onMessagesChange([...nextMessages, assistantMsg]);
      onMascotUpdate(
        res.mascotMood || 'happy',
        res.mascotTip || 'Gotowe! Połączono wiedzę firmy i internet.'
      );
      onLogAiCall({
        action: 'chat',
        latencyMs: res.latencyMs,
        promptTokens: res.usage.promptTokens,
        candidatesTokens: res.usage.candidatesTokens,
        totalTokens: res.usage.totalTokens,
        status: 'success',
        summary: `Czat (${useWebSearch ? 'Baza+Internet' : 'Baza'}): "${query.slice(0, 44)}"`,
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

  const handleCopyAsEmail = async (msg: ChatMessage, msgIndex: number) => {
    const prevUserQuestion =
      msgIndex > 0 && messages[msgIndex - 1]?.role === 'user'
        ? messages[msgIndex - 1].content
        : 'Informacja i rekomendacja';
    await copyRichEmailToClipboard({
      subject: `${preset.name} — ${prevUserQuestion.slice(0, 80)}`,
      body: msg.content,
      companyName: preset.name,
      webSources: msg.webSources,
    });
    setCopiedEmailId(msg.id);
    window.setTimeout(() => setCopiedEmailId(null), 2000);
  };

  const handleSaveAsKnowledgeTile = (msg: ChatMessage, msgIndex: number) => {
    if (!onAddKnowledgeTile) return;
    const prevUserQuestion =
      msgIndex > 0 && messages[msgIndex - 1]?.role === 'user'
        ? messages[msgIndex - 1].content
        : 'Synteza wiedzy z Czatu AI';

    const newTile: KnowledgeTile = {
      id: `tile_chat_${Date.now()}`,
      title: prevUserQuestion.slice(0, 65),
      category: 'Wiedza + Internet',
      visibility: msg.perspective === 'internal' ? 'internal' : 'public',
      priority: 'standard',
      content: msg.content,
      enabled: true,
      updatedAt: new Date().toISOString().slice(0, 10),
    };

    onAddKnowledgeTile(newTile);
    setSavedTileMsgId(msg.id);
    window.setTimeout(() => setSavedTileMsgId(null), 2500);
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
        webSources: msg.webSources || [],
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
      `# Czat z Wiedzą + Internet — ${preset.name}`,
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

  const handleExportPdf = async () => {
    if (messages.length === 0 || exportingPdf) return;
    setExportingPdf(true);
    try {
      await exportChatTranscriptToPdf({
        companyName: preset.name,
        presetName: preset.name,
        perspectiveLabel: perspective === 'internal' ? 'Wewnętrzny (Zespół)' : 'Klienta (Oficjalny)',
        messages,
      });
    } finally {
      setExportingPdf(false);
    }
  };

  const handlePrintChat = () => {
    if (messages.length === 0) return;
    const htmlMessages = messages
      .map((m) => {
        const roleLabel =
          m.role === 'user'
            ? `Pytanie użytkownika • ${new Date(m.timestamp).toLocaleTimeString('pl-PL')}`
            : `Analiza BizOps AI • ${new Date(m.timestamp).toLocaleTimeString('pl-PL')}`;
        return `<div class="msg"><div class="msg-role">${escapeHtml(roleLabel)}</div>${markdownBodyToEmailHtml(m.content)}</div>`;
      })
      .join('\n');

    printCleanReportHtml({
      title: `Raport konsultacji AI — ${preset.name}`,
      subtitle: `Tryb: ${perspective === 'internal' ? 'Wewnętrzny (Zespół)' : 'Klienta (Oficjalny)'} • Liczba wiadomości: ${messages.length}`,
      bodyMarkdownOrHtml: htmlMessages,
      isPreformattedHtml: true,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5">
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

          {/* Przełącznik Głębokiej Integracji z Internetem (Google Search Grounding) */}
          <button
            type="button"
            onClick={() => setUseWebSearch((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
              useWebSearch
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-2xs'
                : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
            }`}
            title="Gdy włączone, AI łączy wewnętrzną Bazę Wiedzy firmy z aktualnymi informacjami z Internetu (Google Search Live)"
          >
            <Globe className={`h-3.5 w-3.5 ${useWebSearch ? 'text-emerald-600 animate-pulse' : 'text-slate-400'}`} />
            <span>Wiedza + Internet Live:</span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${
                useWebSearch ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              {useWebSearch ? 'AKTYWNE' : 'WYŁ.'}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenKnowledge}
            className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700 md:inline-flex"
          >
            <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
            Kafelki w bazie: <strong className="text-slate-900">{visibleTilesCount}</strong>
          </button>
        </div>

        {messages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={exportingPdf}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
            >
              {exportingPdf ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              Eksportuj PDF
            </button>
            <button
              type="button"
              onClick={handlePrintChat}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
            >
              <Printer className="h-3.5 w-3.5" />
              Drukuj
            </button>
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
                Ekspert AI: {preset.name} {useWebSearch && ' + 🌐 Internet Live'}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {perspective === 'internal'
                  ? 'Tryb wewnętrzny z integracją Google Search: asystent łączy wszystkie Twoje kafelki wiedzy (cenniki, marże, procedury) z aktualnymi przepisami, cenami rynkowymi i wiedzą z Internetu.'
                  : 'Tryb klienta z integracją Google Search: asystent odpowiada uprzejmie i ekspercko, łącząc oficjalną ofertę firmy z aktualnymi faktami rynkowymi i technicznymi z sieci.'}
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
            messages.map((msg, msgIndex) => (
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
                  {msg.role === 'assistant' ? (
                    <SimpleMarkdown content={msg.content} />
                  ) : (
                    <div className="whitespace-pre-wrap text-[13px]">{msg.content}</div>
                  )}

                  {msg.role === 'assistant' && (
                    <div className="mt-3 space-y-2.5 border-t border-slate-200/80 pt-2.5">
                      {/* 1. Source Grounding Citations from Company Knowledge Base */}
                      {msg.citedTileIds && msg.citedTileIds.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-500">
                            Źródła z Bazy Wiedzy:
                          </span>
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

                      {/* 2. Synthesized Facts & Live Sources from the Internet (Google Search) */}
                      <WebSourcesPanel
                        webFactsUsed={msg.webFactsUsed}
                        webSources={msg.webSources}
                        searchQueries={msg.searchQueries}
                      />

                      {/* Meta & Actions Row */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <div className="flex flex-wrap items-center gap-2">
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
                              Pewność:{' '}
                              {msg.confidence === 'high'
                                ? 'Wysoka'
                                : msg.confidence === 'medium'
                                  ? 'Średnia'
                                  : 'Niska'}
                            </span>
                          )}
                          {msg.contextStats && (
                            <span
                              className="rounded-full border border-indigo-200 bg-indigo-50/70 px-2 py-0.5 text-[10px] font-medium text-indigo-700"
                              title={`Inteligentny Kompilator Kontekstu wybrał ${msg.contextStats.selectedTilesCount} z ${msg.contextStats.totalActiveTiles} kafelków (${msg.contextStats.criticalCount} krytycznych, odfiltrowano ${msg.contextStats.omittedTilesCount}, oszczędność ok. ${msg.contextStats.tokensSavedEstimate} tokenów)`}
                            >
                              Kontekst: {msg.contextStats.selectedTilesCount}/{msg.contextStats.totalActiveTiles}
                              {msg.contextStats.tokensSavedEstimate > 0
                                ? ` (-${msg.contextStats.tokensSavedEstimate} tok.)`
                                : ''}
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
                            {copiedId === msg.id ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                            {copiedId === msg.id ? 'Skopiowano' : 'Kopiuj'}
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleCopyAsEmail(msg, msgIndex)}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                            title="Kopiuje odpowiedź z formatowaniem HTML do Outlook / Gmail"
                          >
                            {copiedEmailId === msg.id ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Mail className="h-3 w-3" />
                            )}
                            {copiedEmailId === msg.id ? 'Gotowy e-mail!' : 'Jako e-mail'}
                          </button>

                          {onAddKnowledgeTile && (
                            <button
                              type="button"
                              onClick={() => handleSaveAsKnowledgeTile(msg, msgIndex)}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 transition"
                              title="Zapisz tę odpowiedź jako nowy kafelek w Bazie Wiedzy (synchronizacja z chmurą Neon)"
                            >
                              {savedTileMsgId === msg.id ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-600" />
                                  Zapisano w Bazie!
                                </>
                              ) : (
                                <>
                                  <PlusCircle className="h-3 w-3 text-emerald-600" />
                                  Zapisz do Bazy Wiedzy
                                </>
                              )}
                            </button>
                          )}

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
                {useWebSearch
                  ? `Gemini 3.8 Flash łączy Bazę Wiedzy (${visibleTilesCount} kafelków) oraz przeszukuje Internet (Google Live)...`
                  : `Gemini 3.8 Flash analizuje Bazę Wiedzy (${visibleTilesCount} kafelków)...`}
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
                ? 'Zapytaj o marże, cenniki, prawo budowlane, stawki VAT lub dane rynkowe z sieci...'
                : 'Zadaj pytanie o ofertę, technologie, przepisy lub warunki realizacji...'
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
