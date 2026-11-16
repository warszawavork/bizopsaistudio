import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, ClipboardPaste, MessageSquare, Sparkles, X } from 'lucide-react';
import { parseClipboardMessage, type ParsedClipboardMessage } from '../utils/clipboardHelper';

interface QuickClipboardBarProps {
  onInjectMessage: (text: string, senderName?: string) => void;
  currentMessageText?: string;
}

export const QuickClipboardBar: React.FC<QuickClipboardBarProps> = ({
  onInjectMessage,
  currentMessageText,
}) => {
  const [detected, setDetected] = useState<ParsedClipboardMessage | null>(null);
  const [dismissedText, setDismissedText] = useState<string>('');
  const [copiedNotification, setCopiedNotification] = useState(false);

  // Nasłuchiwanie na powrót do okna aplikacji (window.focus)
  useEffect(() => {
    let active = true;

    const checkClipboard = async () => {
      if (typeof window === 'undefined' || !navigator.clipboard?.readText) return;

      try {
        const text = await navigator.clipboard.readText();
        if (!active) return;
        const trimmed = (text || '').trim();

        // Kryteria zapytania klienta:
        // 1. Długość od 20 do 4000 znaków
        // 2. Różny od aktualnie odrzuconego tekstu
        // 3. Różny od tekstu, który już jest wklejony w polu klienta
        // 4. Zawiera spację (nie jest pojedynczym hasłem, tokenem ani URL-em)
        if (
          trimmed.length >= 20 &&
          trimmed.length <= 4000 &&
          trimmed !== dismissedText &&
          trimmed !== (currentMessageText || '').trim() &&
          trimmed.includes(' ') &&
          !trimmed.startsWith('data:image/') &&
          !trimmed.startsWith('eyJ') // pomijaj JWT
        ) {
          const parsed = parseClipboardMessage(trimmed);
          setDetected(parsed);
        }
      } catch {
        // Przeglądarka może zablokować cichy odczyt schowka bez bezpośredniej interakcji
      }
    };

    // Skrót klawiszowy: Ctrl+Shift+V lub Alt+V do ręcznego zaciągnięcia schowka (bez automatycznego wyskakiwania)
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && e.key.toLowerCase() === 'v') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v')) {
        e.preventDefault();
        void checkClipboard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      active = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dismissedText, currentMessageText]);

  if (!detected) return null;

  const handleApply = () => {
    onInjectMessage(detected.cleanText, detected.senderName);
    setCopiedNotification(true);
    setTimeout(() => {
      setCopiedNotification(false);
      setDetected(null);
    }, 1200);
  };

  const handleDismiss = () => {
    setDismissedText(detected.rawText);
    setDetected(null);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 max-w-md w-full animate-in fade-in slide-in-from-bottom-5 duration-300">
      <div className="overflow-hidden rounded-2xl border border-amber-500/30 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md text-white ring-1 ring-white/10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-md">
              <ClipboardPaste className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-amber-300">
                  {detected.isWhatsApp ? 'Wiadomość z WhatsApp' : 'Wykryto tekst ze schowka (Ctrl+C)'}
                </span>
                {detected.detectedTopic && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200 border border-amber-500/30">
                    {detected.detectedTopic}
                  </span>
                )}
              </div>
              {detected.senderName && (
                <p className="text-[11px] text-slate-400 flex items-center gap-1">
                  <MessageSquare className="h-3 w-3 text-cyan-400" />
                  Nadawca: <strong className="text-slate-200">{detected.senderName}</strong>
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition"
            title="Ukryj"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Podgląd treści */}
        <p className="mt-2.5 rounded-xl bg-slate-900/90 border border-slate-800 p-2.5 text-xs text-slate-300 line-clamp-2 leading-relaxed italic">
          „{detected.cleanText}”
        </p>

        {/* Przyciski akcji */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-500 font-mono">
            Skrót: <kbd className="rounded bg-slate-800 px-1 py-0.5 text-[9px] text-slate-300 border border-slate-700">Alt+V</kbd>
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
            >
              Ignoruj
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-3.5 py-1.5 text-xs font-bold text-slate-950 shadow-md hover:brightness-110 active:scale-95 transition"
            >
              {copiedNotification ? (
                <>
                  <Check className="h-3.5 w-3.5 text-slate-950" />
                  Wklejono!
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Odpowiedz z AI
                  <ArrowRight className="h-3 w-3" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
