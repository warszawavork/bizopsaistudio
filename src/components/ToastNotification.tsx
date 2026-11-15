import React, { useEffect, useState } from 'react';
import { Cloud, Sparkles, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'sync' | 'created' | 'updated' | 'info';
  title: string;
  message: string;
  category?: string;
  authorName?: string;
  timestamp: string;
}

interface ToastNotificationProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
};

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const duration = 5000;
    const interval = 50;
    const step = (interval / duration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev <= 0) {
          clearInterval(timer);
          onDismiss();
          return 0;
        }
        return prev - step;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [onDismiss]);

  return (
    <div className="pointer-events-auto bg-slate-950/95 border border-emerald-500/40 backdrop-blur-xl shadow-2xl shadow-emerald-950/50 rounded-2xl p-4 text-slate-100 transform transition-all duration-300 animate-in slide-in-from-top-4 fade-in overflow-hidden relative">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
          {toast.type === 'sync' ? (
            <Cloud className="w-5 h-5 animate-pulse" />
          ) : (
            <Sparkles className="w-5 h-5" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
              {toast.title}
            </span>
            {toast.category && (
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                {toast.category}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-slate-100 mt-0.5 truncate">
            {toast.message}
          </p>
          {toast.authorName && (
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
              Autor: {toast.authorName} • Na żywo z chmury
            </p>
          )}
        </div>

        <button
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-800/60 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-75"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
