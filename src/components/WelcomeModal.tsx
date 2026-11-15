import React, { useState } from 'react';
import { Bot, HardHat, ShieldCheck, Sparkles, User, Briefcase, ChevronRight } from 'lucide-react';

export interface UserProfile {
  name: string;
  role: string;
  avatar: string;
}

interface WelcomeModalProps {
  open: boolean;
  currentProfile: UserProfile | null;
  onSave: (profile: UserProfile) => void;
  onClose?: () => void;
}

const ROLES = [
  'Lider Operacyjny / BizOps',
  'Handlowiec / Sprzedaż',
  'Kierownik Produkcji & Logistyki',
  'Inżynier / Architekt',
  'Właściciel / Przedsiębiorca',
  'Audytor / Gość',
];

const AVATARS = [
  { id: 'executive', label: 'Lider', icon: Briefcase, color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
  { id: 'engineer', label: 'Inżynier', icon: HardHat, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { id: 'bot', label: 'AI Pilot', icon: Bot, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  { id: 'shield', label: 'Audytor', icon: ShieldCheck, color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' },
  { id: 'sparkles', label: 'Twórca', icon: Sparkles, color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
];

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ open, currentProfile, onSave, onClose }) => {
  const [name, setName] = useState(currentProfile?.name || '');
  const [role, setRole] = useState(currentProfile?.role || ROLES[0]);
  const [avatar, setAvatar] = useState(currentProfile?.avatar || 'executive');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Wpisz swoje imię lub pseudonim operacyjny!');
      return;
    }
    setError(null);
    onSave({ name: trimmed, role, avatar });
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="relative w-full max-w-lg bg-slate-900/95 border border-cyan-500/40 shadow-2xl shadow-cyan-950/50 rounded-3xl p-6 sm:p-8 text-slate-100 overflow-hidden">
        {/* Glow accent */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-cyan-400">
                Identyfikacja Zespołowa • Neon Cloud
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                {currentProfile ? 'Edycja Profilu Operacyjnego' : 'Witaj w BizOps AI Studio!'}
              </h2>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-slate-400 mb-6">
            Podaj swoje imię, aby zespół wiedział, kto dodaje nową wiedzę, a bot mógł witać Cię za każdym razem po imieniu.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name Input */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Twoje Imię lub Pseudonim <span className="text-cyan-400">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Bogdan, Marek, Milena..."
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 rounded-2xl py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition"
                />
              </div>
              {error && <p className="text-xs text-rose-400 mt-1.5 font-medium">{error}</p>}
            </div>

            {/* Role Select */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Twoja Rola w Firmie
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 rounded-2xl py-3 px-3.5 text-sm text-white outline-none transition"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {/* Avatar Select */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Wybierz Ikonę Profilu
              </label>
              <div className="grid grid-cols-5 gap-2">
                {AVATARS.map((av) => {
                  const Icon = av.icon;
                  const isSelected = avatar === av.id;
                  return (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => setAvatar(av.id)}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-2xl border transition ${
                        isSelected
                          ? `${av.color} ring-2 ring-cyan-400/50 scale-105`
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-[10px] font-medium">{av.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3">
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Anuluj
                </button>
              )}
              <button
                type="submit"
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-black text-sm shadow-lg shadow-cyan-500/25 transition active:scale-95"
              >
                <span>{currentProfile ? 'Zapisz Zmiany' : 'Wejdź do Studia'}</span>
                <ChevronRight className="w-4 h-4 stroke-[3]" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
