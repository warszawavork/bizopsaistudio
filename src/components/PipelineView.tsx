import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FileDown,
  Plus,
  RotateCcw,
  Trash2,
  TrendingUp,
  Webhook,
} from 'lucide-react';
import type { CrmDeal, IndustryPreset, MascotMood } from '../types';
import { QuickQuoteModal } from './QuickQuoteModal';

interface PipelineViewProps {
  preset: IndustryPreset;
  deals: CrmDeal[];
  onDealsChange: (deals: CrmDeal[]) => void;
  onResetDeals: () => void;
  onMascotUpdate: (mood: MascotMood, tip: string) => void;
  onSendWebhookPayload: (payload: Record<string, unknown>, label: string) => Promise<void>;
}

const STAGES: Array<{ id: CrmDeal['stage']; label: string; badgeClass: string }> = [
  { id: 'lead', label: '1. Nowe Zapytanie', badgeClass: 'bg-slate-100 text-slate-700' },
  { id: 'audited', label: '2. Po Audycie AI', badgeClass: 'bg-amber-100 text-amber-800' },
  { id: 'quote', label: '3. Wycena & Oferta', badgeClass: 'bg-indigo-100 text-indigo-800' },
  { id: 'won', label: '4. Zatwierdzone / Wdrożone', badgeClass: 'bg-emerald-100 text-emerald-800' },
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
  const [quoteDeal, setQuoteDeal] = useState<CrmDeal | null>(null);
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [valuePln, setValuePln] = useState('120000');
  const [notes, setNotes] = useState('');

  const totalPipelineValue = deals.reduce((acc, d) => acc + (d.valuePln || 0), 0);
  const highRiskCount = deals.filter((d) => d.riskLevel === 'HIGH').length;

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
      tags: ['Ręczny wpis'],
      notes: notes.trim() || 'Dodano z widoku Pipeline CRM.',
      createdAt: new Date().toISOString().slice(0, 10),
    };
    onDealsChange([newDeal, ...deals]);
    setTitle('');
    setClient('');
    setNotes('');
    setShowAdd(false);
    onMascotUpdate('happy', `Nowa szansa sprzedaży "${newDeal.title}" dodana do tablicy!`);
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
      {/* Top Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Wartość Pipeline ({preset.shortName})</p>
              <p className="text-lg font-extrabold text-slate-900">
                {totalPipelineValue.toLocaleString('pl-PL')} PLN
              </p>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-200 hidden sm:block" />

          <div>
            <p className="text-[11px] text-slate-500">Aktywne sprawy</p>
            <p className="text-sm font-bold text-slate-900">{deals.length} transakcji</p>
          </div>

          {highRiskCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-800">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
              {highRiskCount} wymaga weryfikacji (HIGH RISK)
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdd((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Dodaj sprawę / wycenę
          </button>
          <button
            type="button"
            onClick={onResetDeals}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Domyślne
          </button>
        </div>
      </div>

      {/* Quick Add Deal Form */}
      {showAdd && (
        <form
          onSubmit={handleAddDeal}
          className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-xs space-y-3"
        >
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
              placeholder="Wartość w PLN"
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
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              Zapisz
            </button>
          </div>
        </form>
      )}

      {/* 4-Column Kanban Board */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage, stageIdx) => {
          const stageDeals = deals.filter((d) => d.stage === stage.id);
          const stageSum = stageDeals.reduce((acc, d) => acc + d.valuePln, 0);

          return (
            <div
              key={stage.id}
              className="flex flex-col rounded-2xl border border-slate-200/90 bg-slate-100/70 p-3 min-h-[420px]"
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${stage.badgeClass}`}>
                  {stage.label} ({stageDeals.length})
                </span>
                <span className="font-mono text-[11px] font-semibold text-slate-500">
                  {stageSum.toLocaleString('pl-PL')} zł
                </span>
              </div>

              <div className="flex-1 space-y-2.5">
                {stageDeals.length === 0 ? (
                  <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/50 p-4 text-center text-[11px] text-slate-400">
                    Brak kart na tym etapie
                  </div>
                ) : (
                  stageDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-indigo-300"
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <span className="text-[11px] font-bold text-indigo-700">{deal.client}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                            deal.riskLevel === 'HIGH'
                              ? 'bg-rose-100 text-rose-700'
                              : deal.riskLevel === 'MEDIUM'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {deal.score !== undefined ? `${deal.score}% • ` : ''}
                          {deal.riskLevel}
                        </span>
                      </div>

                      <h4 className="text-xs font-bold text-slate-900">{deal.title}</h4>
                      <p className="mt-1 text-xs font-extrabold text-slate-800">
                        {deal.valuePln.toLocaleString('pl-PL')} PLN
                      </p>

                      {deal.notes && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 line-clamp-3">
                          {deal.notes}
                        </p>
                      )}

                      {deal.tags && deal.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {deal.tags.map((t, i) => (
                            <span
                              key={i}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={stageIdx === 0}
                            onClick={() => moveStage(deal, -1)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                            title="Cofnij etap"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={stageIdx === STAGES.length - 1}
                            onClick={() => moveStage(deal, 1)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                            title="Następny etap"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setQuoteDeal(deal)}
                            className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-indigo-600"
                            title="Wygeneruj Ofertę / Proformę PDF A4"
                          >
                            <FileDown className="h-3 w-3" />
                            PDF
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
                            className="rounded p-1 text-indigo-600 hover:bg-indigo-50"
                            title="Wyślij kartę do Make / n8n Webhook"
                          >
                            <Webhook className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDealsChange(deals.filter((d) => d.id !== deal.id))}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            title="Usuń kartę"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
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
    </div>
  );
};
