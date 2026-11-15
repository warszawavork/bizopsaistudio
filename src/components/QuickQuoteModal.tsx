import React, { useState } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, FileDown, Loader2, X } from 'lucide-react';
import type { CrmDeal } from '../types';
import { exportOfferToPdf } from '../utils/pdfExport';

interface QuickQuoteModalProps {
  deal: CrmDeal | null;
  companyName: string;
  onClose: () => void;
  onDownloaded: (quoteNumber: string) => void;
}

export const QuickQuoteModal: React.FC<QuickQuoteModalProps> = ({
  deal,
  companyName,
  onClose,
  onDownloaded,
}) => {
  if (!deal) return null;

  const [quoteNumber, setQuoteNumber] = useState(
    `OF-${new Date().getFullYear()}-11-${Math.floor(100 + Math.random() * 900)}`
  );
  const [netPln, setNetPln] = useState(String(deal.valuePln || 250000));
  const [discountPercent, setDiscountPercent] = useState(0);
  const [vatRate, setVatRate] = useState<8 | 23>(
    deal.client.toLowerCase().includes('sp. z o.o') ? 23 : 8
  );
  const [notes, setNotes] = useState(deal.notes || '');
  const [exporting, setExporting] = useState(false);

  const numericNet = Number(netPln) || 0;
  const discountedNet = Math.round(numericNet * (1 - discountPercent / 100));
  const vatAmount = Math.round(discountedNet * (vatRate / 100));
  const grossPln = discountedNet + vatAmount;
  const isB2bClient =
    deal.client.toLowerCase().includes('sp. z o.o') ||
    deal.client.toLowerCase().includes('s.a.') ||
    deal.title.toLowerCase().includes('b2b') ||
    deal.title.toLowerCase().includes('najem');

  const hasVatWarning = isB2bClient && vatRate === 8;
  const hasDiscountWarning = discountPercent > 3;

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setExporting(true);
    try {
      await exportOfferToPdf({
        quoteNumber,
        companyName,
        clientName: deal.client,
        title: deal.title,
        netPln: numericNet,
        discountPercent,
        vatRate,
        notes,
      });
      onDownloaded(quoteNumber);
      onClose();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Generator Oferty / Proformy PDF A4
              </h3>
              <p className="text-xs text-slate-500">Klient: {deal.client}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleExport(e)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Numer dokumentu
              </label>
              <input
                type="text"
                required
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Kwota bazowa Netto (PLN)
              </label>
              <input
                type="number"
                required
                value={netPln}
                onChange={(e) => setNetPln(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 flex justify-between text-xs font-semibold text-slate-700">
                <span>Rabat handlowy (%)</span>
                <span className="font-bold text-indigo-600">{discountPercent}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Stawka VAT</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVatRate(8)}
                  className={`rounded-xl border py-2 text-xs font-bold ${
                    vatRate === 8
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  8% VAT (Dom)
                </button>
                <button
                  type="button"
                  onClick={() => setVatRate(23)}
                  className={`rounded-xl border py-2 text-xs font-bold ${
                    vatRate === 23
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  23% VAT (B2B)
                </button>
              </div>
            </div>
          </div>

          {/* Live AI Cat Guard Warnings */}
          {hasVatWarning && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span>
                <strong>Ostrzeżenie Kotka Mruczka:</strong> Klient wygląda na podmiot B2B / najem komercyjny — zastosowanie stawki 8% VAT zamiast 23% rodzi wysokie ryzyko podatkowe!
              </span>
            </div>
          )}

          {hasDiscountWarning && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>Polityka Marż:</strong> Rabat powyżej 3% ({discountPercent}%) wymaga akceptacji Managera Operacyjnego.
              </span>
            </div>
          )}

          {/* Summary Box */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1">
            <div className="flex justify-between text-slate-600">
              <span>Netto po rabacie:</span>
              <span className="font-mono font-semibold">{discountedNet.toLocaleString('pl-PL')} PLN</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Kwota VAT ({vatRate}%):</span>
              <span className="font-mono font-semibold">{vatAmount.toLocaleString('pl-PL')} PLN</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-extrabold text-slate-900">
              <span>Razem Brutto:</span>
              <span>{grossPln.toLocaleString('pl-PL')} PLN</span>
            </div>
            {grossPln >= 15000 && (
              <p className="flex items-center gap-1 pt-1 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Automatycznie dodano klauzulę Split Payment (MPP) i transze 30/40/30
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Uwagi do dokumentu PDF
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              Pobierz Ofertę PDF A4
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
