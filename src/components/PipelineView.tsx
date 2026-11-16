import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  Calculator,
  Check,
  Edit3,
  FileDown,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  Webhook,
  X,
} from 'lucide-react';
import type { CrmDeal, IndustryPreset, MascotMood } from '../types';
import { QuickQuoteModal } from './QuickQuoteModal';
import { TallyConfiguratorModal } from './TallyConfiguratorModal';

interface PipelineViewProps {
  preset: IndustryPreset;
  deals: CrmDeal[];
  onDealsChange: (deals: CrmDeal[]) => void;
  onResetDeals: () => void;
  onMascotUpdate: (mood: MascotMood, tip: string) => void;
  onSendWebhookPayload: (payload: Record<string, unknown>, label: string) => Promise<void>;
}

const STAGES: Array<{
  id: CrmDeal['stage'];
  label: string;
  subtitle: string;
  accentTop: string;
  badgeClass: string;
}> = [
  {
    id: 'lead',
    label: '1. Nowe Zapytanie',
    subtitle: 'Wstępny kontakt i kwalifikacja',
    accentTop: 'border-t-slate-500',
    badgeClass: 'bg-slate-900 text-white',
  },
  {
    id: 'audited',
    label: '2. Po Audycie AI',
    subtitle: 'Zweryfikowano zgodność i ryzyko',
    accentTop: 'border-t-amber-500',
    badgeClass: 'bg-amber-500 text-white',
  },
  {
    id: 'quote',
    label: '3. Wycena & Oferta',
    subtitle: 'Oczekuje na decyzję klienta',
    accentTop: 'border-t-indigo-600',
    badgeClass: 'bg-indigo-600 text-white',
  },
  {
    id: 'won',
    label: '4. Zatwierdzone / Wygrane',
    subtitle: 'Umowa lub wdrożenie w toku',
    accentTop: 'border-t-emerald-600',
    badgeClass: 'bg-emerald-600 text-white',
  },
];

export const PipelineView: React.FC<PipelineViewProps> = ({
  preset,
  deals,
  onDealsChange,
  onResetDeals,
  onMascotUpdate,
  onSendWebhookPayload,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [showTallyModal, setShowTallyModal] = useState(false);
  const [quoteDeal, setQuoteDeal] = useState<CrmDeal | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'WON'>('ALL');
  const [editingDealId, setEditingDealId] = useState<string | null>(null);
  const [editClient, setEditClient] = useState('');
  const [editValuePln, setEditValuePln] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [valuePln, setValuePln] = useState('120000');
  const [notes, setNotes] = useState('');

  const totalPipelineValue = deals.reduce((acc, d) => acc + (d.valuePln || 0), 0);
  const wonPipelineValue = deals
    .filter((d) => d.stage === 'won')
    .reduce((acc, d) => acc + (d.valuePln || 0), 0);
  const highRiskCount = deals.filter((d) => d.riskLevel === 'HIGH').length;

  const filteredDeals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return deals.filter((d) => {
      if (riskFilter === 'HIGH' && d.riskLevel !== 'HIGH') return false;
      if (riskFilter === 'WON' && d.stage !== 'won') return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.client.toLowerCase().includes(q) ||
        d.notes.toLowerCase().includes(q) ||
        (d.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [deals, searchQuery, riskFilter]);

  const handleAddDeal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !client.trim()) return;
    const newDeal: CrmDeal = {
      id: `deal_${Date.now()}`,
      title: title.trim(),
      client: client.trim(),
      valuePln: Number(valuePln) || 0,
      stage: 'lead',
      riskLevel: 'LOW',
      score: 90,
      tags: ['Wpis ręczny'],
      notes: notes.trim() || 'Dodano z tablicy Studio Pro Pipeline CRM.',
      createdAt: new Date().toISOString().slice(0, 10),
    };
    onDealsChange([newDeal, ...deals]);
    setTitle('');
    setClient('');
    setNotes('');
    setShowAdd(false);
    onMascotUpdate('happy', `Nowa szansa sprzedaży "${newDeal.title}" dodana do tablicy!`);
  };

  const handleStartEdit = (deal: CrmDeal) => {
    setEditingDealId(deal.id);
    setEditClient(deal.client);
    setEditValuePln(String(deal.valuePln || 0));
    setEditNotes(deal.notes || '');
  };

  const handleSaveEdit = (dealId: string) => {
    onDealsChange(
      deals.map((d) =>
        d.id === dealId
          ? {
              ...d,
              client: editClient.trim() || d.client,
              valuePln: Number(editValuePln) || 0,
              notes: editNotes.trim(),
            }
          : d
      )
    );
    setEditingDealId(null);
  };

  const moveStage = (deal: CrmDeal, dir: -1 | 1) => {
    const idx = STAGES.findIndex((s) => s.id === deal.stage);
    const nextStage = STAGES[idx + dir]?.id;
    if (!nextStage) return;
    onDealsChange(deals.map((d) => (d.id === deal.id ? { ...d, stage: nextStage } : d)));
    onMascotUpdate('happy', `Przesunięto "${deal.client}" do etapu: ${STAGES[idx + dir].label}`);
  };

  return (
    <div className="space-y-5">
      {/* Executive Studio Pro Header Card */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-xl">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              <Sparkles className="h-3 w-3" />
              Studio Pro • Executive CRM & Oferty PDF
            </div>
            <h2 className="text-xl font-extrabold tracking-tight">
              Lejek Sprzedaży i Zgłoszeń — {preset.shortName}
            </h2>
            <p className="text-xs text-slate-300">
              Przesuwaj sprawy między etapami, edytuj kwoty na żywo i generuj oferty PDF A4 z transzami 30/40/30 jednym kliknięciem.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTallyModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/40 bg-white/10 px-3.5 py-2.5 text-xs font-bold text-amber-200 backdrop-blur-sm transition hover:bg-white/20"
            >
              <Calculator className="h-4 w-4 text-amber-300" />
              Kalkulator Tally (dWO4Oq)
            </button>
            <button
              type="button"
              onClick={() => setShowAdd((s) => !s)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-md shadow-amber-500/20 transition hover:brightness-105"
            >
              <Plus className="h-4 w-4" />
              Dodaj szansę / wycenę
            </button>
            <button
              type="button"
              onClick={onResetDeals}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white/90 transition hover:bg-white/20"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Domyślne
            </button>
          </div>
        </div>

        {/* Executive KPI Strip */}
        <div className="relative mt-5 grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
              <span>Wartość całego Pipeline</span>
              <TrendingUp className="h-3.5 w-3.5 text-indigo-300" />
            </div>
            <p className="mt-1 text-lg font-extrabold tracking-tight text-white">
              {totalPipelineValue.toLocaleString('pl-PL')} PLN
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 backdrop-blur-sm">
            <div className="flex items-center justify-between text-[11px] font-medium text-emerald-200">
              <span>Zatwierdzone / Wygrane</span>
              <Award className="h-3.5 w-3.5 text-emerald-300" />
            </div>
            <p className="mt-1 text-lg font-extrabold tracking-tight text-emerald-200">
              {wonPipelineValue.toLocaleString('pl-PL')} PLN
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
            <span className="text-[11px] font-medium text-slate-300">Aktywne karty CRM</span>
            <p className="mt-1 text-lg font-extrabold tracking-tight text-white">
              {deals.length} spraw
            </p>
          </div>

          <div
            className={`rounded-2xl border px-4 py-3 backdrop-blur-sm ${
              highRiskCount > 0
                ? 'border-rose-400/35 bg-rose-500/15 text-rose-100'
                : 'border-white/10 bg-white/5 text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-medium">
              <span>Alerty wysokiego ryzyka</span>
              <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />
            </div>
            <p className="mt-1 text-lg font-extrabold tracking-tight">
              {highRiskCount} {highRiskCount === 1 ? 'sprawa' : 'spraw'}
            </p>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-xs">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj klienta, modelu, tagu lub notatki..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'ALL', label: `Wszystkie (${deals.length})` },
            { id: 'HIGH', label: `Wymaga uwagi / HIGH RISK (${highRiskCount})` },
            { id: 'WON', label: `Wygrane (${deals.filter((d) => d.stage === 'won').length})` },
          ].map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setRiskFilter(btn.id as 'ALL' | 'HIGH' | 'WON')}
              className={`rounded-xl px-3 py-1.5 text-[11px] font-bold transition ${
                riskFilter === btn.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Add Deal Form */}
      {showAdd && (
        <form
          onSubmit={handleAddDeal}
          className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-md space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-indigo-900">
              Nowa szansa sprzedaży w chmurze CRM
            </h3>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-lg p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tytuł sprawy (np. Dom 70m² Pod Klucz)"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-indigo-500 focus:bg-white"
            />
            <input
              type="text"
              required
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Klient / Firma"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-indigo-500 focus:bg-white"
            />
            <input
              type="number"
              required
              value={valuePln}
              onChange={(e) => setValuePln(e.target.value)}
              placeholder="Wartość netto w PLN"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-indigo-500 focus:bg-white"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notatka operacyjna / wyniki audytu..."
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-indigo-500 focus:bg-white"
            />
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700"
            >
              Dodaj kartę
            </button>
          </div>
        </form>
      )}

      {/* 4-Column Executive Kanban Board */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((stage, stageIdx) => {
          const stageDeals = filteredDeals.filter((d) => d.stage === stage.id);
          const stageSum = stageDeals.reduce((acc, d) => acc + d.valuePln, 0);

          return (
            <div
              key={stage.id}
              className={`flex flex-col rounded-2xl border border-slate-200/90 border-t-4 ${stage.accentTop} bg-slate-100/75 p-3.5 min-h-[430px] shadow-2xs`}
            >
              <div className="mb-3 space-y-1 px-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-lg px-2.5 py-1 text-[11px] font-extrabold ${stage.badgeClass}`}>
                    {stage.label} ({stageDeals.length})
                  </span>
                  <span className="font-mono text-[11px] font-bold text-slate-700">
                    {stageSum.toLocaleString('pl-PL')} zł
                  </span>
                </div>
                <p className="text-[10px] font-medium text-slate-500">{stage.subtitle}</p>
              </div>

              <div className="flex-1 space-y-3">
                {stageDeals.length === 0 ? (
                  <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300/80 bg-white/60 p-4 text-center text-[11px] text-slate-400">
                    Brak kart pasujących do filtra na tym etapie
                  </div>
                ) : (
                  stageDeals.map((deal) => {
                    const isEditing = editingDealId === deal.id;
                    return (
                      <div
                        key={deal.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <span className="text-[11px] font-extrabold text-indigo-700 truncate">
                            {deal.client}
                          </span>
                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-[9px] font-extrabold uppercase ${
                              deal.riskLevel === 'HIGH'
                                ? 'bg-rose-100 text-rose-700'
                                : deal.riskLevel === 'MEDIUM'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {deal.score !== undefined ? `${deal.score}% • ` : ''}
                            {deal.riskLevel}
                          </span>
                        </div>

                        <h4 className="text-xs font-extrabold leading-snug text-slate-900">{deal.title}</h4>

                        {isEditing ? (
                          <div className="mt-2.5 space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-2.5">
                            <input
                              type="text"
                              value={editClient}
                              onChange={(e) => setEditClient(e.target.value)}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold"
                              placeholder="Klient"
                            />
                            <input
                              type="number"
                              value={editValuePln}
                              onChange={(e) => setEditValuePln(e.target.value)}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold"
                              placeholder="Wartość PLN"
                            />
                            <textarea
                              rows={2}
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px]"
                              placeholder="Notatka..."
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditingDealId(null)}
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600"
                              >
                                Anuluj
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(deal.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[10px] font-bold text-white"
                              >
                                <Check className="h-3 w-3" />
                                Zapisz
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="mt-1.5 text-sm font-black tracking-tight text-slate-900">
                              {deal.valuePln.toLocaleString('pl-PL')} PLN
                            </p>
                            {deal.notes && (
                              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 line-clamp-3">
                                {deal.notes}
                              </p>
                            )}
                          </>
                        )}

                        {deal.tags && deal.tags.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1">
                            {deal.tags.map((t, i) => (
                              <span
                                key={i}
                                className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={stageIdx === 0}
                              onClick={() => moveStage(deal, -1)}
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25"
                              title="Cofnij etap"
                            >
                              <ArrowLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={stageIdx === STAGES.length - 1}
                              onClick={() => moveStage(deal, 1)}
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25"
                              title="Następny etap"
                            >
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setQuoteDeal(deal)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[10px] font-bold text-white shadow-2xs hover:bg-indigo-600"
                              title="Wygeneruj Ofertę / Proformę PDF A4"
                            >
                              <FileDown className="h-3 w-3" />
                              Oferta PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(deal)}
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                              title="Edytuj kwotę i notatki"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void onSendWebhookPayload(
                                  {
                                    event: 'bizops.crm.deal_sync',
                                    company: preset.name,
                                    deal,
                                  },
                                  `CRM Sync: ${deal.client}`
                                )
                              }
                              className="rounded-lg p-1 text-indigo-600 hover:bg-indigo-50"
                              title="Wyślij kartę do Make / n8n Webhook"
                            >
                              <Webhook className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDealsChange(deals.filter((d) => d.id !== deal.id))}
                              className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              title="Usuń kartę"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      <QuickQuoteModal
        deal={quoteDeal}
        companyName={preset.name}
        onClose={() => setQuoteDeal(null)}
        onDownloaded={(qNum) =>
          onMascotUpdate('happy', `Wygenerowałem Ofertę PDF A4 nr ${qNum} z transzami 30/40/30!`)
        }
      />

      <TallyConfiguratorModal
        open={showTallyModal}
        onClose={() => setShowTallyModal(false)}
        presetName={preset.name}
        onCreateDeal={(newDeal) => {
          const created: CrmDeal = {
            id: `deal_${Date.now()}`,
            createdAt: new Date().toISOString().slice(0, 10),
            ...newDeal,
          };
          onDealsChange([created, ...deals]);
        }}
      />
    </div>
  );
};
