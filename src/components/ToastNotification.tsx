import React, { useEffect, useState } from 'react';
import { Cloud, Sparkles, Trash2, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'sync' | 'created' | 'updated' | 'deleted' | 'info';
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
    const duration = 3200;
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

  const isDeleted = toast.type === 'deleted';

  return (
    <div className={`pointer-events-auto bg-slate-950/95 border ${isDeleted ? 'border-rose-500/30' : 'border-emerald-500/30'} backdrop-blur-xl shadow-xl shadow-slate-950/60 rounded-2xl p-3.5 text-slate-100 transform transition-all duration-300 animate-in slide-in-from-top-4 fade-in overflow-hidden relative`}>
      <div className="flex items-center gap-3">
        <div className={`p-1.5 rounded-xl ${isDeleted ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'} shrink-0`}>
          {isDeleted ? (
            <Trash2 className="w-4 h-4" />
          ) : toast.type === 'sync' ? (
            <Cloud className="w-4 h-4" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold truncate ${isDeleted ? 'text-rose-400' : 'text-emerald-400'}`}>
              {toast.title}
            </span>
            {toast.authorName && (
              <span className="text-[10px] text-slate-400 truncate">
                • {toast.authorName}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-200 truncate mt-0.5">
            {toast.message}
          </p>
        </div>

        <button
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-800/60 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-800">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-75"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
