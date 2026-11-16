import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calculator,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Send,
  Sliders,
  X,
} from 'lucide-react';
import type { CrmDeal } from '../types';
import { ingestCloudInboxItem } from '../utils/apiClient';

interface TallyConfiguratorModalProps {
  open: boolean;
  onClose: () => void;
  presetName: string;
  defaultFormId?: string;
  onQuoteToResponder?: (summaryText: string, deal?: Omit<CrmDeal, 'id' | 'createdAt'>) => void;
  onCreateDeal?: (deal: Omit<CrmDeal, 'id' | 'createdAt'>) => void;
}

const HOUSE_SIZES = [20, 28, 35, 36, 39, 40, 43, 45, 48, 52, 54, 62, 65, 70, 77, 84, 88, 108, 117];

export const TallyConfiguratorModal: React.FC<TallyConfiguratorModalProps> = ({
  open,
  onClose,
  presetName,
  defaultFormId = 'dWO4Oq',
  onQuoteToResponder,
  onCreateDeal,
}) => {
  const [activeTab, setActiveTab] = useState<'embed' | 'calculator'>('calculator');
  const [formId, setFormId] = useState(defaultFormId);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [pastedTallyText, setPastedTallyText] = useState('');
  const [liveSubmittedSummary, setLiveSubmittedSummary] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Parametry 1:1 z Tally dWO4Oq
  const [clientName, setClientName] = useState('');
  const [clientContact, setClientContact] = useState('');
  const [areaM2, setAreaM2] = useState<number>(70);
  const [insulation, setInsulation] = useState<'rekreacyjny' | 'caloroczny'>('caloroczny');
  const [standard, setStandard] = useState<'deweloperski' | 'norvil'>('norvil');
  const [floorType, setFloorType] = useState<'parter' | 'poddasze' | 'pietro'>('parter');
  const [architectPkg, setArchitectPkg] = useState<'letniskowy' | 'mieszkalny_70' | 'mieszkalny_120' | 'premium'>('mieszkalny_70');
  const [heatersCount, setHeatersCount] = useState<number>(3);
  const [acCount, setAcCount] = useState<number>(1);
  const [underfloorHeating, setUnderfloorHeating] = useState<boolean>(false);
  const [foundation, setFoundation] = useState<'brak' | 'slupy' | 'lawy' | 'plyta'>('plyta');
  const [bathroom, setBathroom] = useState<'brak' | 'podstawowy' | 'premium'>('podstawowy');
  const [coveredTerraceM2, setCoveredTerraceM2] = useState<number>(0);
  const [openTerraceM2, setOpenTerraceM2] = useState<number>(0);
  const [deliveryKm, setDeliveryKm] = useState<number>(200);
  const [deliveryModules, setDeliveryModules] = useState<number>(2);
  const [kitchenPkg, setKitchenPkg] = useState<'brak' | 'kuchnia' | 'umeblowanie' | 'kuchnia_meble'>('brak');
  const [fireplace, setFireplace] = useState<'brak' | 'przygotowanie' | 'koza'>('brak');
  const [roofAngleMpzp, setRoofAngleMpzp] = useState<boolean>(false);
  const [vatRate, setVatRate] = useState<8 | 23>(8);

  const webhookUrl = useMemo(() => {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://baihelp.vercel.app';
    return `${base}/api/integrations?presetId=norvil`;
  }, []);

  // Wyliczenia 1:1 ze zmiennych CALCULATED_FIELDS formularza Tally dWO4Oq
  const calc = useMemo(() => {
    const rateM2 =
      standard === 'deweloperski'
        ? insulation === 'caloroczny'
          ? 2650
          : 2500
        : insulation === 'caloroczny'
          ? 3150
          : 3000;

    const floorMult = floorType === 'poddasze' ? 1.5 : floorType === 'pietro' ? 2.0 : 1.0;
    const houseBaseNet = Math.round(areaM2 * rateM2 * floorMult);

    const archCost =
      architectPkg === 'letniskowy'
        ? 4500
        : architectPkg === 'mieszkalny_70'
          ? 16000
          : architectPkg === 'mieszkalny_120'
            ? 17000
            : 20000;

    const heatersCost = heatersCount * 514;
    const acCost = acCount * 3050;
    const underfloorCost = underfloorHeating ? areaM2 * 187 : 0;

    const foundationRate = foundation === 'slupy' ? 350 : foundation === 'lawy' ? 600 : foundation === 'plyta' ? 750 : 0;
    const foundationCost = areaM2 * foundationRate;

    const bathroomCost = bathroom === 'podstawowy' ? 14000 : bathroom === 'premium' ? 20000 : 0;
    const terraceCost = coveredTerraceM2 * 1500 + openTerraceM2 * 1000;
    const deliveryCost = deliveryModules > 0 && deliveryKm > 0 ? deliveryKm * deliveryModules * 25 : 0;

    const kitchenCost =
      kitchenPkg === 'umeblowanie'
        ? 8000
        : kitchenPkg === 'kuchnia'
          ? 15000
          : kitchenPkg === 'kuchnia_meble'
            ? 23000
            : 0;

    const fireplaceCost = fireplace === 'przygotowanie' ? 3300 : fireplace === 'koza' ? 9500 : 0;
    const roofCost = roofAngleMpzp ? areaM2 * 300 : 0;

    const totalNet =
      houseBaseNet +
      archCost +
      heatersCost +
      acCost +
      underfloorCost +
      foundationCost +
      bathroomCost +
      terraceCost +
      deliveryCost +
      kitchenCost +
      fireplaceCost +
      roofCost;

    const totalGross = Math.round(totalNet * (1 + vatRate / 100));
    const vatAmount = totalGross - totalNet;

    return {
      rateM2,
      floorMult,
      houseBaseNet,
      archCost,
      heatersCost,
      acCost,
      underfloorCost,
      foundationCost,
      bathroomCost,
      terraceCost,
      deliveryCost,
      kitchenCost,
      fireplaceCost,
      roofCost,
      totalNet,
      vatAmount,
      totalGross,
    };
  }, [
    areaM2,
    insulation,
    standard,
    floorType,
    architectPkg,
    heatersCount,
    acCount,
    underfloorHeating,
    foundation,
    bathroom,
    coveredTerraceM2,
    openTerraceM2,
    deliveryKm,
    deliveryModules,
    kitchenPkg,
    fireplace,
    roofAngleMpzp,
    vatRate,
  ]);

  // Nasłuch na oficjalne zdarzenie wysłania formularza osadzonego z tally.so
  useEffect(() => {
    if (!open) return;

    const handleTallyMessage = (event: MessageEvent) => {
      if (!event.origin.includes('tally.so')) return;
      try {
        const raw = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (raw?.event !== 'Tally.FormSubmitted') return;

        const payload = raw.payload as {
          formId?: string;
          fields?: Array<{ title?: string; label?: string; answer?: { value?: unknown } | unknown }>;
        };
        const fields = Array.isArray(payload?.fields) ? payload.fields : [];
        const lines: string[] = [];
        let foundName = 'Klient Tally';
        let foundContact = '';
        let foundGross = 0;

        for (const f of fields) {
          const title = String(f.title || f.label || '').trim();
          const ansObj = f.answer as { value?: unknown } | undefined;
          const valRaw = ansObj && typeof ansObj === 'object' && 'value' in ansObj ? ansObj.value : f.answer;
          if (valRaw === null || valRaw === undefined || valRaw === '') continue;
          const valStr = Array.isArray(valRaw) ? valRaw.join(', ') : String(valRaw);
          if (!title) continue;

          const low = title.toLowerCase();
          if (low.includes('imię') || low.includes('nazwisko')) foundName = valStr;
          if (low.includes('mail') || low.includes('tel')) {
            foundContact = foundContact ? `${foundContact} • ${valStr}` : valStr;
          }
          if (low.includes('brutto') || low.includes('finalsum')) {
            const parsed = Number(valStr.replace(/[^\d.,]/g, '').replace(',', '.'));
            if (Number.isFinite(parsed) && parsed > 0) foundGross = Math.round(parsed);
          }
          lines.push(`• ${title}: ${valStr}`);
        }

        const formatted = [
          `WYCENA Z KONFIGURATORA TALLY (${payload?.formId || formId}) — ${foundName}`,
          foundContact ? `Kontakt: ${foundContact}` : '',
          '',
          ...(lines.length > 0
            ? lines
            : ['• Formularz został wysłany z osadzonego widgetu Tally. Sprawdź szczegóły w panelu Skrzynki/Tally.']),
        ]
          .filter(Boolean)
          .join('\n');

        setLiveSubmittedSummary(formatted);
        setStatusNotice('Odebrano wynik prosto z formularza Tally!');

        void ingestCloudInboxItem({
          source: 'tally',
          senderName: foundName,
          senderContact: foundContact,
          fullText: formatted,
        }).catch(() => {});

        onCreateDeal?.({
          title: `Wycena Tally (${formId}) — ${foundName}`,
          client: foundName,
          valuePln: foundGross || calc.totalGross,
          stage: 'quote',
          riskLevel: 'LOW',
          score: 94,
          tags: ['Tally CPQ', formId],
          notes: formatted.slice(0, 1200),
        });
      } catch {
        // ignore non-Tally postMessage events
      }
    };

    window.addEventListener('message', handleTallyMessage);
    return () => window.removeEventListener('message', handleTallyMessage);
  }, [open, formId, calc.totalGross, onCreateDeal]);

  if (!open) return null;

  const buildStructuredQuoteSummary = (): string => {
    const who = clientName.trim() || 'Klient z konfiguratora';
    const stdLabel = standard === 'deweloperski' ? 'Stan deweloperski' : 'Standard NORVIL (wykończony bez łazienki)';
    const insLabel = insulation === 'caloroczny' ? 'Całoroczny WT2021' : 'Rekreacyjny / Letniskowy';
    const floorLabel =
      floorType === 'poddasze'
        ? 'Poddasze użytkowe (×1.5)'
        : floorType === 'pietro'
          ? 'Piętro pełnowymiarowe (×2.0)'
          : 'Parter (×1.0)';
    const fundLabel =
      foundation === 'slupy'
        ? 'Słupy / geo wkręty (350 zł/m²)'
        : foundation === 'lawy'
          ? 'Ławy (600 zł/m²)'
          : foundation === 'plyta'
            ? 'Płyta fundamentowa (750 zł/m²)'
            : 'Bez fundamentu';
    const bathLabel =
      bathroom === 'podstawowy'
        ? 'Pakiet podstawowy (14 000 zł netto)'
        : bathroom === 'premium'
          ? 'Pakiet premium (20 000 zł netto)'
          : 'Bez wykończenia łazienki';

    return [
      `KONFIGURACJA WYCENY TALLY (${formId}) — ${presetName}`,
      `Klient: ${who}${clientContact.trim() ? ` (${clientContact.trim()})` : ''}`,
      '',
      'Parametry wybranego projektu:',
      `• Metraż i kondygnacja: ${areaM2} m² • ${floorLabel}`,
      `• Ocieplenie i standard: ${insLabel} • ${stdLabel} (${calc.rateM2.toLocaleString('pl-PL')} zł/m² netto) = ${calc.houseBaseNet.toLocaleString('pl-PL')} zł netto`,
      `• Praca z architektem: ${calc.archCost.toLocaleString('pl-PL')} zł netto`,
      `• Fundament: ${fundLabel} = ${calc.foundationCost.toLocaleString('pl-PL')} zł netto`,
      `• Łazienka: ${bathLabel}`,
      `• Ogrzewanie i klima: ${heatersCount}× grzejnik (${calc.heatersCost.toLocaleString('pl-PL')} zł), ${acCount}× klimatyzacja (${calc.acCost.toLocaleString('pl-PL')} zł)${underfloorHeating ? `, podłogówka ${calc.underfloorCost.toLocaleString('pl-PL')} zł` : ''}`,
      coveredTerraceM2 || openTerraceM2
        ? `• Tarasy: zadaszony ${coveredTerraceM2} m², otwarty ${openTerraceM2} m² = ${calc.terraceCost.toLocaleString('pl-PL')} zł netto`
        : '• Tarasy: brak',
      `• Dostawa z Przemyśla: ${deliveryModules} moduł(y) × ${deliveryKm} km = ${calc.deliveryCost.toLocaleString('pl-PL')} zł netto`,
      calc.kitchenCost > 0 ? `• Kuchnia / meble: ${calc.kitchenCost.toLocaleString('pl-PL')} zł netto` : '',
      calc.fireplaceCost > 0 ? `• Kominek: ${calc.fireplaceCost.toLocaleString('pl-PL')} zł netto` : '',
      roofAngleMpzp ? `• Dostosowanie kąta dachu do MPZP/WZ: +${calc.roofCost.toLocaleString('pl-PL')} zł netto` : '',
      '',
      'Podsumowanie finansowe (Kalkulator dWO4Oq):',
      `• Razem NETTO: ${calc.totalNet.toLocaleString('pl-PL')} PLN`,
      `• VAT (${vatRate}%): ${calc.vatAmount.toLocaleString('pl-PL')} PLN`,
      `• Razem BRUTTO: ${calc.totalGross.toLocaleString('pl-PL')} PLN`,
    ]
      .filter((line, idx, arr) => line !== '' || (idx > 0 && arr[idx - 1] !== ''))
      .join('\n');
  };

  const handleDispatchQuote = async (customText?: string) => {
    setSaving(true);
    setStatusNotice(null);
    const text = (customText || buildStructuredQuoteSummary()).trim();
    const who = clientName.trim() || 'Lead Tally';
    const dealPayload: Omit<CrmDeal, 'id' | 'createdAt'> = {
      title: `Wycena ${areaM2}m² (${standard.toUpperCase()})`,
      client: who,
      valuePln: calc.totalGross,
      stage: 'quote',
      riskLevel: 'LOW',
      score: 95,
      tags: ['Tally CPQ', `${areaM2}m²`, `${vatRate}% VAT`],
      notes: text.slice(0, 1200),
    };

    try {
      await ingestCloudInboxItem({
        source: 'tally',
        senderName: who,
        senderContact: clientContact.trim(),
        fullText: text,
      });
      onCreateDeal?.(dealPayload);
      onQuoteToResponder?.(text, dealPayload);
      setStatusNotice('Wycena została wysłana do Skrzynki Cloud, zapisana w CRM i przekazana do bota!');
      onClose();
    } catch {
      onCreateDeal?.(dealPayload);
      onQuoteToResponder?.(text, dealPayload);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-5 backdrop-blur-xs">
      <div className="max-h-[93vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-indigo-600 text-white shadow-sm">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                Konfigurator Wycen Tally ({formId}) — Silnik Bota & CRM
              </h2>
              <p className="text-xs text-slate-500">
                Wylicz dokładnie według reguł Tally lub otwórz żywy formularz — wynik automatycznie trafi do Skrzynki, CRM i Asystenta AI.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('calculator')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                activeTab === 'calculator' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sliders className="h-3.5 w-3.5 text-amber-400" />
              Szybki Kalkulator Bota 1:1 (dWO4Oq)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('embed')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                activeTab === 'embed' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ExternalLink className="h-3.5 w-3.5 text-cyan-400" />
              Żywy Formularz Tally (Embed + Webhook)
            </button>
          </div>

          <a
            href={`https://tally.so/r/${encodeURIComponent(formId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"
          >
            Otwórz tally.so/r/{formId}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {statusNotice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800">
            {statusNotice}
          </div>
        )}

        {activeTab === 'calculator' ? (
          <div className="grid gap-5 lg:grid-cols-12">
            {/* Left controls */}
            <div className="space-y-3 lg:col-span-8">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Klient / Nazwa leada</label>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="np. Jan Kowalski"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-indigo-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Telefon lub E-mail klienta</label>
                  <input
                    type="text"
                    value={clientContact}
                    onChange={(e) => setClientContact(e.target.value)}
                    placeholder="+48 500 ... lub mail@..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-indigo-500 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Metraż (m²)</label>
                  <select
                    value={areaM2}
                    onChange={(e) => setAreaM2(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold outline-none focus:border-indigo-500"
                  >
                    {HOUSE_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s} m²
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Standard wykończenia</label>
                  <select
                    value={standard}
                    onChange={(e) => setStandard(e.target.value as 'deweloperski' | 'norvil')}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold outline-none focus:border-indigo-500"
                  >
                    <option value="norvil">NORVIL (3000 / 3150 zł/m²)</option>
                    <option value="deweloperski">Deweloperski (2500 / 2650 zł/m²)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Ocieplenie ścian</label>
                  <select
                    value={insulation}
                    onChange={(e) => setInsulation(e.target.value as 'rekreacyjny' | 'caloroczny')}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold outline-none focus:border-indigo-500"
                  >
                    <option value="caloroczny">Całoroczny WT2021</option>
                    <option value="rekreacyjny">Rekreacyjny / Letniskowy</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Kondygnacja (mnożnik)</label>
                  <select
                    value={floorType}
                    onChange={(e) => setFloorType(e.target.value as 'parter' | 'poddasze' | 'pietro')}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-indigo-500"
                  >
                    <option value="parter">Parter (×1.0)</option>
                    <option value="poddasze">Poddasze użytkowe (×1.5)</option>
                    <option value="pietro">Piętro pełnowymiarowe (×2.0)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Moduł Architekta</label>
                  <select
                    value={architectPkg}
                    onChange={(e) => setArchitectPkg(e.target.value as typeof architectPkg)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-indigo-500"
                  >
                    <option value="letniskowy">Letniskowy &le;70m² (4 500 zł)</option>
                    <option value="mieszkalny_70">Mieszkalny &le;70m² (16 000 zł)</option>
                    <option value="mieszkalny_120">Mieszkalny 70–120m² (17 000 zł)</option>
                    <option value="premium">Premium (20 000 zł)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Fundament</label>
                  <select
                    value={foundation}
                    onChange={(e) => setFoundation(e.target.value as typeof foundation)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-indigo-500"
                  >
                    <option value="plyta">Płyta fundamentowa (750 zł/m²)</option>
                    <option value="lawy">Ławy (600 zł/m²)</option>
                    <option value="slupy">Słupy / geowkręty (350 zł/m²)</option>
                    <option value="brak">Bez fundamentu (0 zł)</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Łazienka</label>
                  <select
                    value={bathroom}
                    onChange={(e) => setBathroom(e.target.value as typeof bathroom)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none"
                  >
                    <option value="podstawowy">Podstawowy (14 000 zł)</option>
                    <option value="premium">Premium (20 000 zł)</option>
                    <option value="brak">Brak (0 zł)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Grzejniki (514 zł/szt)</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={heatersCount}
                    onChange={(e) => setHeatersCount(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Klima (3 050 zł/szt)</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={acCount}
                    onChange={(e) => setAcCount(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Kuchnia & Meble</label>
                  <select
                    value={kitchenPkg}
                    onChange={(e) => setKitchenPkg(e.target.value as typeof kitchenPkg)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none"
                  >
                    <option value="brak">Brak</option>
                    <option value="umeblowanie">Podst. meble (8 000 zł)</option>
                    <option value="kuchnia">Kuchnia (15 000 zł)</option>
                    <option value="kuchnia_meble">Kuchnia + meble (23 000 zł)</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Kominek / Płytka</label>
                  <select
                    value={fireplace}
                    onChange={(e) => setFireplace(e.target.value as typeof fireplace)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none"
                  >
                    <option value="brak">Brak</option>
                    <option value="przygotowanie">Przygotowanie (3 300 zł)</option>
                    <option value="koza">Koza 7kW + płytka (9 500 zł)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Taras zad. (m² × 1500)</label>
                  <input
                    type="number"
                    min={0}
                    value={coveredTerraceM2}
                    onChange={(e) => setCoveredTerraceM2(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Taras otw. (m² × 1000)</label>
                  <input
                    type="number"
                    min={0}
                    value={openTerraceM2}
                    onChange={(e) => setOpenTerraceM2(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Dostawa (km × 25 zł)</label>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={deliveryKm}
                    onChange={(e) => setDeliveryKm(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-600">Liczba modułów trans.</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={deliveryModules}
                    onChange={(e) => setDeliveryModules(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
                <label className="inline-flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={underfloorHeating}
                    onChange={(e) => setUnderfloorHeating(e.target.checked)}
                    className="h-3.5 w-3.5 rounded text-indigo-600"
                  />
                  Ogrzewanie podłogowe (187 zł/m²)
                </label>
                <label className="inline-flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={roofAngleMpzp}
                    onChange={(e) => setRoofAngleMpzp(e.target.checked)}
                    className="h-3.5 w-3.5 rounded text-indigo-600"
                  />
                  Kąt dachu MPZP/WZ (+300 zł/m²)
                </label>
                <div className="inline-flex items-center gap-1.5 ml-auto">
                  <span className="font-bold text-slate-700">Stawka VAT:</span>
                  <button
                    type="button"
                    onClick={() => setVatRate(8)}
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                      vatRate === 8 ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
                    }`}
                  >
                    8% Mieszkalny
                  </button>
                  <button
                    type="button"
                    onClick={() => setVatRate(23)}
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                      vatRate === 23 ? 'bg-amber-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
                    }`}
                  >
                    23% Rekreacja / B2B
                  </button>
                </div>
              </div>
            </div>

            {/* Right summary card */}
            <div className="lg:col-span-4 rounded-2xl bg-slate-950 p-4 text-white flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <span className="inline-block rounded-full bg-amber-500/20 border border-amber-400/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  Wynik Konfiguratora Tally
                </span>
                <div>
                  <p className="text-[11px] text-slate-400">Suma Netto inwestycji</p>
                  <p className="text-xl font-extrabold text-white">
                    {calc.totalNet.toLocaleString('pl-PL')} zł
                  </p>
                </div>
                <div className="border-t border-slate-800 pt-2">
                  <p className="text-[11px] text-slate-400">Podatek VAT ({vatRate}%)</p>
                  <p className="text-sm font-bold text-slate-200">
                    +{calc.vatAmount.toLocaleString('pl-PL')} zł
                  </p>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-amber-500/20 to-emerald-500/20 border border-amber-400/30 p-3">
                  <p className="text-[11px] font-semibold text-amber-200">Łącznie BRUTTO</p>
                  <p className="text-2xl font-extrabold text-amber-300">
                    {calc.totalGross.toLocaleString('pl-PL')} zł
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={() => void handleDispatchQuote()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-3 text-xs font-extrabold text-slate-950 shadow-lg hover:brightness-110 transition disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {saving ? 'Zapisywanie...' : 'Wprowadź do Skrzynki, CRM i Bota'}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Webhook copy bar for tally.so/r/dWO4Oq */}
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 text-indigo-600" />
                    Automatyczny Webhook Tally ➔ Twoja Aplikacja (Klienci z zewnątrz też wpadają tutaj!)
                  </p>
                  <p className="text-[11px] text-indigo-800">
                    Wklej poniższy adres w panelu Tally: <strong>Twój Formularz (dWO4Oq) ➔ Integrations ➔ Webhooks</strong>. Każde wypełnienie stworzy lead w Skrzynce i w Lejku CRM!
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={formId}
                    onChange={(e) => setFormId(e.target.value.trim() || 'dWO4Oq')}
                    className="w-24 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-mono font-bold text-slate-800"
                    title="ID formularza Tally"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(webhookUrl);
                      setCopiedWebhook(true);
                      window.setTimeout(() => setCopiedWebhook(false), 1800);
                    }}
                    className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700"
                  >
                    {copiedWebhook ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiedWebhook ? 'Skopiowano URL!' : 'Kopiuj Webhook URL'}
                  </button>
                </div>
              </div>
              <p className="font-mono text-[11px] text-indigo-900 break-all bg-white/80 rounded-lg px-2.5 py-1 border border-indigo-100">
                {webhookUrl}
              </p>
            </div>

            {liveSubmittedSummary && (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900">
                    Przechwycono wysłaną konfigurację z formularza Tally!
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDispatchQuote(liveSubmittedSummary)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    Przekaż do Asystenta Odpowiedzi →
                  </button>
                </div>
                <pre className="whitespace-pre-wrap text-[11px] text-emerald-950 font-sans max-h-40 overflow-y-auto">
                  {liveSubmittedSummary}
                </pre>
              </div>
            )}

            {/* Embedded Tally Form */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <iframe
                src={`https://tally.so/embed/${encodeURIComponent(formId)}?alignLeft=1&hideTitle=0&transparentBackground=1&dynamicHeight=1`}
                title="Konfigurator Tally"
                className="w-full h-[460px] border-0"
              />
            </div>

            {/* Optional quick paste from Tally summary */}
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={pastedTallyText}
                onChange={(e) => setPastedTallyText(e.target.value)}
                placeholder="Opcjonalnie: wklej tu skopiowane podsumowanie z Tally, aby od razu zasilić bota i CRM..."
                className="flex-1 min-w-[240px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-indigo-500 focus:bg-white"
              />
              <button
                type="button"
                disabled={!pastedTallyText.trim() || saving}
                onClick={() => void handleDispatchQuote(pastedTallyText)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Prześlij tekst do Bota i CRM →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
