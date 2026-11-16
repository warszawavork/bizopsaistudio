import React, { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  Flame,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { ClientChatThread } from '../types';

interface ClientChatsSidebarProps {
  threads: ClientChatThread[];
  activeChatId: string | null;
  savingCloud?: boolean;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onToggleStar: (chatId: string) => void;
  onRenameChat: (chatId: string, nextName: string) => void;
  onDeleteChat: (chatId: string) => void;
  onCollapse: () => void;
}

function formatChatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

export const ClientChatsSidebar: React.FC<ClientChatsSidebarProps> = ({
  threads,
  activeChatId,
  savingCloud,
  onSelectChat,
  onNewChat,
  onToggleStar,
  onRenameChat,
  onDeleteChat,
  onCollapse,
}) => {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'starred'>('all');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const starredCount = useMemo(() => threads.filter((t) => t.starred).length, [threads]);

  const visibleThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = threads.filter((t) => {
      if (filterMode === 'starred' && !t.starred) return false;
      if (!q) return true;
      if (t.clientName.toLowerCase().includes(q)) return true;
      if ((t.clientContact || '').toLowerCase().includes(q)) return true;
      return t.messages.some((m) => m.text.toLowerCase().includes(q));
    });

    return [...filtered].sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [threads, search, filterMode]);

  const startRename = (chat: ClientChatThread, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditNameValue(chat.clientName);
  };

  const commitRename = (chatId: string) => {
    const trimmed = editNameValue.trim();
    if (trimmed) {
      onRenameChat(chatId, trimmed);
    }
    setEditingChatId(null);
  };

  return (
    <aside className="soft-card flex h-full flex-col rounded-3xl border border-slate-200/80 bg-white p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <MessageSquare className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-xs font-extrabold text-slate-900 truncate">Czaty klientów</h3>
            <p className="text-[10px] text-slate-500">
              {threads.length} {threads.length === 1 ? 'wątek' : 'wątków'} • {starredCount} ★
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-2xs transition hover:bg-indigo-600"
            title="Rozpocznij nowy osobny czat z klientem"
          >
            <Plus className="h-3.5 w-3.5" />
            Nowy
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-xl border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            title="Zwiń panel czatów"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="mt-3 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj klienta lub treści..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-[11px] text-slate-800 outline-none focus:border-indigo-400 focus:bg-white"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`rounded-lg py-1 text-[10px] font-bold transition ${
              filterMode === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Wszystkie ({threads.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('starred')}
            className={`inline-flex items-center justify-center gap-1 rounded-lg py-1 text-[10px] font-bold transition ${
              filterMode === 'starred'
                ? 'bg-amber-50 text-amber-800 shadow-2xs border border-amber-200/70'
                : 'text-slate-600 hover:text-amber-700'
            }`}
          >
            <Star className={`h-3 w-3 ${filterMode === 'starred' ? 'fill-amber-400 text-amber-500' : ''}`} />
            Gwiazdki ({starredCount})
          </button>
        </div>
      </div>

      {/* Chat List */}
      <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto pr-0.5 max-h-[620px]">
        {visibleThreads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-6 text-center">
            <p className="text-[11px] font-semibold text-slate-600">
              {filterMode === 'starred'
                ? 'Brak czatów oznaczonych gwiazdką'
                : search
                  ? 'Brak wyników wyszukiwania'
                  : 'Brak zapisanych czatów'}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              {filterMode === 'starred'
                ? 'Kliknij gwiazdkę ★ przy ważnej rozmowie, aby zapisać ją na stałe na górze listy.'
                : 'Wklej wiadomość klienta po prawej i wygeneruj odpowiedź — czat zapisze się tu automatycznie.'}
            </p>
          </div>
        ) : (
          visibleThreads.map((chat) => {
            const isActive = chat.id === activeChatId;
            const lastMsg = chat.messages[chat.messages.length - 1];
            const isConfirming = confirmDeleteId === chat.id;
            const isEditing = editingChatId === chat.id;

            return (
              <div
                key={chat.id}
                onClick={() => {
                  if (!isEditing && !isConfirming) {
                    onSelectChat(chat.id);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isEditing && !isConfirming) {
                    onSelectChat(chat.id);
                  }
                }}
                className={`group relative cursor-pointer rounded-2xl border p-2.5 transition ${
                  isActive
                    ? 'border-indigo-400 bg-indigo-50/70 shadow-2xs ring-1 ring-indigo-200'
                    : chat.starred
                      ? 'border-amber-200/80 bg-amber-50/30 hover:border-amber-300 hover:bg-amber-50/60'
                      : 'border-slate-200/70 bg-white hover:border-slate-300 hover:bg-slate-50/80'
                }`}
              >
                {/* Row 1: Star + Client Name + Actions */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(chat.id);
                      }}
                      className={`shrink-0 rounded-lg p-1 transition ${
                        chat.starred
                          ? 'bg-amber-100/80 text-amber-500 hover:bg-amber-200/70'
                          : 'text-slate-300 hover:bg-slate-100 hover:text-amber-500'
                      }`}
                      title={
                        chat.starred
                          ? 'Zapisany trwale ★ — kliknij, aby odpiąć'
                          : 'Oznacz gwiazdką ★ (przypnij i zachowaj trwale)'
                      }
                    >
                      <Star className={`h-3.5 w-3.5 ${chat.starred ? 'fill-amber-400 text-amber-500' : ''}`} />
                    </button>

                    {isEditing ? (
                      <div
                        className="flex flex-1 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(chat.id);
                            if (e.key === 'Escape') setEditingChatId(null);
                          }}
                          className="w-full rounded-lg border border-indigo-300 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-900 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => commitRename(chat.id)}
                          className="rounded bg-indigo-600 p-1 text-white hover:bg-indigo-700"
                          title="Zapisz nazwę"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <span className="truncate text-[11px] font-extrabold text-slate-900">
                        {chat.clientName || 'Nowy klient'}
                      </span>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <span className="text-[9px] font-medium text-slate-400 mr-0.5">
                        {formatChatTime(chat.updatedAt)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => startRename(chat, e)}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-1 text-slate-400 hover:bg-white hover:text-indigo-600 transition"
                        title="Zmień nazwę czatu"
                      >
                        <Edit3 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(isConfirming ? null : chat.id);
                        }}
                        className={`rounded p-1 transition ${
                          isConfirming
                            ? 'bg-rose-100 text-rose-600 opacity-100'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-400 hover:bg-white hover:text-rose-600'
                        }`}
                        title="Usuń czat"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline delete confirmation */}
                {isConfirming ? (
                  <div
                    className="mt-2 flex items-center justify-between gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-[10px] font-bold text-rose-800">Usunąć ten czat?</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          onDeleteChat(chat.id);
                        }}
                        className="rounded-lg bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-rose-700"
                      >
                        Usuń
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-lg bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200 hover:bg-slate-100"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Row 2: Snippet */}
                    <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-500">
                      {lastMsg
                        ? `${lastMsg.role === 'advisor' ? 'AI: ' : 'Klient: '}${lastMsg.text}`
                        : 'Pusty czat — wklej wiadomość...'}
                    </p>

                    {/* Row 3: Meta pills */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                        {chat.messages.length} wiad.
                      </span>
                      {chat.starred && (
                        <span className="rounded bg-amber-100/80 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                          ★ Zapisany
                        </span>
                      )}
                      {chat.temperature && (
                        <span
                          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                            chat.temperature === 'HOT'
                              ? 'bg-rose-100 text-rose-700'
                              : chat.temperature === 'WARM'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-sky-100 text-sky-700'
                          }`}
                        >
                          <Flame className="h-2.5 w-2.5" />
                          {chat.temperature}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer sync hint */}
      <div className="mt-3 border-t border-slate-100 pt-2.5 flex items-center justify-between text-[10px] text-slate-400">
        <span>{savingCloud ? 'Zapisywanie w chmurze...' : 'Pamięć wątku + Neon DB'}</span>
        <span className="font-semibold text-amber-600">★ = trwały zapis</span>
      </div>
    </aside>
  );
};
