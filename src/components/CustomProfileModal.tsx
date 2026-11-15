import React, { useState } from 'react';
import { Building2, Plus, X } from 'lucide-react';
import type { IndustryPreset } from '../types';

interface CustomProfileModalProps {
  open: boolean;
  onClose: () => void;
  onCreateProfile: (preset: IndustryPreset) => void;
}

export const CustomProfileModal: React.FC<CustomProfileModalProps> = ({
  open,
  onClose,
  onCreateProfile,
}) => {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [offerSummary, setOfferSummary] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const id = `custom_${Date.now()}`;
    const shortName = name.trim().slice(0, 24);
    const today = new Date().toISOString().slice(0, 10);

    const newPreset: IndustryPreset = {
      id,
      name: name.trim(),
      shortName,
      industry: industry.trim() || 'Usługi i Sprzedaż B2B',
      description:
        offerSummary.trim() || `Dedykowana baza wiedzy i asystent sprzedaży dla firmy ${name.trim()}.`,
      accentLabel: 'Profil własny',
      suggestedQuestions: {
        client: [
          `Jakie są główne usługi i ceny w ${shortName}?`,
          'Jaki jest czas realizacji zamówienia?',
        ],
        internal: [
          'Jakie są zasady udzielania rabatów i płatności?',
          'Na co uważać przy kwalifikacji nowego klienta?',
        ],
      },
      defaultTiles: [
        {
          id: `${id}_tile_1`,
          title: `Oferta i główne zasady — ${shortName}`,
          category: 'Oferta',
          visibility: 'public',
          priority: 'critical',
          content:
            offerSummary.trim() ||
            `Firma ${name.trim()} (${industry.trim() || 'B2B'}). Uzupełnij ten kafelek lub wgraj cennik PDF/Word w zakładce Baza Wiedzy.`,
          enabled: true,
          updatedAt: today,
        },
      ],
      demoScenarios: [
        {
          id: `${id}_demo_1`,
          label: 'Przykładowe zapytanie klienta',
          badge: 'Start',
          fileName: 'Zapytanie_Klienta.txt',
          documentText: `Dzień dobry, proszę o ofertę i warunki współpracy z firmą ${name.trim()}. Interesuje nas termin realizacji, stawka VAT oraz warunki płatności.`,
        },
      ],
      defaultDeals: [],
    };

    onCreateProfile(newPreset);
    setName('');
    setIndustry('');
    setOfferSummary('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs">
      <div className="soft-card animate-enter w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Dodaj własny profil firmy</h2>
              <p className="text-xs text-slate-500">Utwórz osobną Bazę Wiedzy w 10 sekund</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Nazwa firmy *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Studio Wnętrz Kwadrat lub Moja Firma Sp. z o.o."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Branża
            </label>
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="np. Fotowoltaika, Architektura, Usługi IT, Budownictwo"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Co sprzedajecie i jakie są główne ceny / zasady?
            </label>
            <textarea
              rows={4}
              value={offerSummary}
              onChange={(e) => setOfferSummary(e.target.value)}
              placeholder="Wpisz krótko ofertę — później możesz też wgrać cenniki PDF lub Word (.docx) w Bazie Wiedzy..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-600"
            >
              <Plus className="h-3.5 w-3.5" />
              Utwórz profil firmy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
