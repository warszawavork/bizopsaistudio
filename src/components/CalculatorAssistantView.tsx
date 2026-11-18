import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calculator,
  Check,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Flame,
  Home,
  Layers,
  Loader2,
  MailCheck,
  MapPin,
  Minus,
  Package,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Ruler,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Truck,
  Utensils,
  Wind,
  Zap,
} from 'lucide-react';
import type {
  AiOpsLogEntry,
  CrmDeal,
  TallyQuoteEvaluation,
  TallyQuoteInput,
} from '../types';
import {
  calculateDeliveryDistance,
  extractAndEvaluateTallyQuote,
  recalculateTallyQuote,
} from '../utils/apiClient';

interface CalculatorAssistantViewProps {
  onCreateCrmDeal?: (deal: Omit<CrmDeal, 'id' | 'createdAt'>) => void;
  onHandoffToResponder?: (text: string) => void;
  onLogAiCall?: (entry: Omit<AiOpsLogEntry, 'id' | 'timestamp' | 'presetName' | 'model'>) => void;
}

const DEFAULT_CALCULATOR_INPUT: TallyQuoteInput = {
  areaM2: 50,
  areaIsTotalUsable: false,
  areaEstimatedByBot: false,
  floorEstimatedByBot: false,
  quantity: 1,
  standard: 'norvil',
  insulation: 'caloroczny',
  floorType: 'parter',
  foundation: 'brak',
  architectPkg: 'none',
  underfloorHeating: false,
  heatersCount: 0,
  acCount: 0,
  bathroom: 'none',
  coveredTerraceM2: 0,
  openTerraceM2: 0,
  deliveryKm: 0,
  deliveryModules: 0,
  kitchenPkg: 'none',
  fireplace: 'none',
  roofAngleMpzp: false,
  vatRate: 8,
};

const AREA_PRESETS = [25, 35, 50, 70, 100, 120, 150, 200];

const FLOOR_LABELS: Record<NonNullable<TallyQuoteInput['floorType']>, string> = {
  parter: 'Parter (×1)',
  poddasze: 'Z poddaszem użytkowym (×1.5)',
  pietro: 'Piętrowy (×2)',
};

const STANDARD_LABELS: Record<NonNullable<TallyQuoteInput['standard']>, string> = {
  norvil: 'NORVIL (Pod klucz)',
  deweloperski: 'Stan Deweloperski',
};

const INSULATION_LABELS: Record<NonNullable<TallyQuoteInput['insulation']>, string> = {
  caloroczny: 'Całoroczny',
  letniskowy: 'Letniskowy',
};

const FOUNDATION_LABELS: Record<NonNullable<TallyQuoteInput['foundation']>, string> = {
  brak: 'Brak (po stronie klienta)',
  slupy: 'Słupy fundamentowe',
  lawy: 'Ławy fundamentowe',
  plyta: 'Płyta fundamentowa',
};

const ARCHITECT_LABELS: Record<NonNullable<TallyQuoteInput['architectPkg']>, string> = {
  none: 'Brak',
  letniskowy: 'Projekt letniskowy',
  mieszkalny_70: 'Mieszkalny do 70 m²',
  mieszkalny_120: 'Mieszkalny 70–120 m²',
  premium: 'Projekt Premium / indywidualny',
};

const BATHROOM_LABELS: Record<NonNullable<TallyQuoteInput['bathroom']>, string> = {
  none: 'Brak / standard',
  podstawowy: 'Łazienka podstawowa',
  premium: 'Łazienka Premium',
};

const KITCHEN_LABELS: Record<NonNullable<TallyQuoteInput['kitchenPkg']>, string> = {
  none: 'Brak',
  umeblowanie: 'Umeblowanie pokoi',
  kuchnia: 'Zabudowa kuchenna',
  kuchnia_meble: 'Kuchnia + Umeblowanie',
};

const FIREPLACE_LABELS: Record<NonNullable<TallyQuoteInput['fireplace']>, string> = {
  none: 'Brak',
  przygotowanie: 'Przygotowanie pod kominek',
  koza: 'Piec koza z montażem',
};

interface ParsedLocalResult {
  patch: Partial<TallyQuoteInput>;
  detectedDestination?: string;
}

function parseQuickTextLocally(rawText: string): ParsedLocalResult {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const patch: Partial<TallyQuoteInput> = {};

  const areaMatch = lower.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:m2|m²|mkw|metr)/i);
  if (areaMatch) {
    const val = parseFloat(areaMatch[1].replace(',', '.'));
    if (!Number.isNaN(val)) {
      patch.areaM2 = Math.max(0, Math.min(200, val));
    }
  }

  if (/(ca[łl]kowit|u[żz]ytkow)/i.test(lower)) {
    patch.areaIsTotalUsable = true;
  } else if (/zabudow/i.test(lower)) {
    patch.areaIsTotalUsable = false;
  }

  if (/pi[eę]tr/i.test(lower)) {
    patch.floorType = 'pietro';
  } else if (/poddasz/i.test(lower)) {
    patch.floorType = 'poddasze';
  } else if (/parter/i.test(lower)) {
    patch.floorType = 'parter';
  }

  const qtyMatch = lower.match(/(\d{1,2})\s*(?:domk|szt|modu[łl]owe domki)/i);
  if (qtyMatch) {
    const q = parseInt(qtyMatch[1], 10);
    if (q >= 1 && q <= 20) patch.quantity = q;
  }

  if (/deweloper/i.test(lower)) {
    patch.standard = 'deweloperski';
  } else if (/(norvil|pod klucz|klucz)/i.test(lower)) {
    patch.standard = 'norvil';
  }

  if (/letnisk/i.test(lower)) {
    patch.insulation = 'letniskowy';
  } else if (/ca[łl]orocz/i.test(lower)) {
    patch.insulation = 'caloroczny';
  }

  if (/bez fundament|brak fundament/i.test(lower)) {
    patch.foundation = 'brak';
  } else if (/p[łl]yt/i.test(lower)) {
    patch.foundation = 'plyta';
  } else if (/s[łl]up/i.test(lower)) {
    patch.foundation = 'slupy';
  } else if (/[łl]aw/i.test(lower)) {
    patch.foundation = 'lawy';
  }

  if (/pod[łl]og[oó]wk|ogrzewanie pod[łl]ogow/i.test(lower)) {
    patch.underfloorHeating = true;
  }

  const acMatch = lower.match(/(\d)\s*(?:x\s*)?klim/i);
  if (acMatch) {
    patch.acCount = Math.min(10, parseInt(acMatch[1], 10));
  } else if (/klimatyzacj/i.test(lower)) {
    patch.acCount = 1;
  }

  const heaterMatch = lower.match(/(\d)\s*(?:x\s*)?grzejnik/i);
  if (heaterMatch) {
    patch.heatersCount = Math.min(20, parseInt(heaterMatch[1], 10));
  }

  if (/[łl]azienk[^\n,]*premium/i.test(lower)) {
    patch.bathroom = 'premium';
  } else if (/[łl]azienk/i.test(lower)) {
    patch.bathroom = 'podstawowy';
  }

  if (/kuchni.*mebl|mebl.*kuchni/i.test(lower)) {
    patch.kitchenPkg = 'kuchnia_meble';
  } else if (/kuchni/i.test(lower)) {
    patch.kitchenPkg = 'kuchnia';
  } else if (/umeblowan|meble/i.test(lower)) {
    patch.kitchenPkg = 'umeblowanie';
  }

  if (/koza|kominek/i.test(lower)) {
    patch.fireplace = /przygotowani/i.test(lower) ? 'przygotowanie' : 'koza';
  }

  const covTerraceMatch = lower.match(/taras\s*zadaszon[^\d]{0,12}(\d{1,3})/i);
  if (covTerraceMatch) {
    patch.coveredTerraceM2 = Math.min(100, parseInt(covTerraceMatch[1], 10));
  } else {
    const openTerraceMatch = lower.match(/taras[^\d]{0,12}(\d{1,3})/i);
    if (openTerraceMatch) {
      patch.openTerraceM2 = Math.min(100, parseInt(openTerraceMatch[1], 10));
    }
  }

  if (/mpzp|k[aą]t dachu/i.test(lower)) {
    patch.roofAngleMpzp = true;
  }

  if (/23\s*%/.test(lower)) {
    patch.vatRate = 23;
  } else if (/8\s*%/.test(lower)) {
    patch.vatRate = 8;
  }

  let detectedDestination: string | undefined;
  const postalMatch = text.match(/\b\d{2}-\d{3}(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż-]+)?\b/);
  if (postalMatch) {
    detectedDestination = postalMatch[0].trim();
  } else {
    const destMatch = text.match(/(?:dostawa|transport|do miejscowości|miejscowość|lokalizacja|działka w|do)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż-]{2,}(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż-]+)?)/);
    if (destMatch) {
      detectedDestination = destMatch[1].trim();
    }
  }

  return { patch, detectedDestination };
}

function formatPln(val: number): string {
  return `${Math.round(val).toLocaleString('pl-PL')} zł`;
}

function buildCopyableOfferText(params: {
  quote: TallyQuoteEvaluation;
  input: TallyQuoteInput;
  projectTitle: string;
  deliveryInfo: { destination: string; durationText?: string } | null;
  hideItemizedPrices: boolean;
  includeWarsawRef: boolean;
  textMode: 'full' | 'short';
}): string {
  const {
    quote,
    input,
    projectTitle,
    deliveryInfo,
    hideItemizedPrices,
    includeWarsawRef,
    textMode,
  } = params;

  const qty = Math.max(1, input.quantity || quote.quantity || 1);
  const floorLabel = FLOOR_LABELS[input.floorType || 'parter'];
  const stdLabel = STANDARD_LABELS[input.standard || 'norvil'];
  const insLabel = INSULATION_LABELS[input.insulation || 'caloroczny'];
  const foundLabel = FOUNDATION_LABELS[input.foundation || 'brak'];
  const areaVal = input.areaM2 ?? quote.input.areaM2 ?? 0;
  const areaDesc = `${areaVal} m² (${input.areaIsTotalUsable ? 'pow. użytkowa całkowita' : 'pow. zabudowy'})`;

  const extrasSummary: string[] = [];
  if (input.architectPkg && input.architectPkg !== 'none') extrasSummary.push(ARCHITECT_LABELS[input.architectPkg]);
  if (input.underfloorHeating) extrasSummary.push('ogrzewanie podłogowe');
  if (input.heatersCount > 0) extrasSummary.push(`grzejniki WiFi (${input.heatersCount} szt.)`);
  if (input.acCount > 0) extrasSummary.push(`klimatyzacja (${input.acCount} szt.)`);
  if (input.bathroom && input.bathroom !== 'none') extrasSummary.push(BATHROOM_LABELS[input.bathroom]);
  if (input.kitchenPkg && input.kitchenPkg !== 'none') extrasSummary.push(KITCHEN_LABELS[input.kitchenPkg]);
  if (input.fireplace && input.fireplace !== 'none') extrasSummary.push(FIREPLACE_LABELS[input.fireplace]);
  if (input.coveredTerraceM2 > 0) extrasSummary.push(`taras zadaszony ${input.coveredTerraceM2} m²`);
  if (input.openTerraceM2 > 0) extrasSummary.push(`taras otwarty ${input.openTerraceM2} m²`);
  if (input.roofAngleMpzp) extrasSummary.push('kąt dachu pod MPZP');

  if (textMode === 'short') {
    const lines = [
      projectTitle.trim() ? `Wstępna wycena — ${projectTitle.trim()}:` : 'Wstępna wycena konfiguracji domku:',
      `• Parametry: ${areaDesc}, ${floorLabel}, ${stdLabel}, ${insLabel}${qty > 1 ? `, ilość: ${qty} szt.` : ''}`,
      `• Fundament: ${foundLabel}`,
      ...(extrasSummary.length > 0 ? [`• Dodatki: ${extrasSummary.join(', ')}`] : []),
    ];
    if (input.deliveryKm > 0) {
      const destPart = deliveryInfo?.destination ? ` (${deliveryInfo.destination})` : '';
      lines.push(`• Dostawa z Przemyśla: ${input.deliveryKm} km${destPart}`);
    }
    lines.push(
      `• Razem netto: ${formatPln(quote.totalNetPln)}`,
      `• RAZEM BRUTTO (${quote.vatRate}% VAT): ${formatPln(quote.totalGrossPln)}`,
    );
    if (quote.isIllustrativeEstimate) {
      lines.push('Uwaga: kalkulacja ma charakter orientacyjny — finalna kwota zależy od potwierdzenia szczegółów i warunków na działce.');
    }
    return lines.join('\n');
  }

  const lines: string[] = [
    projectTitle.trim()
      ? `KALKULACJA KONFIGURACJI DOMKU — ${projectTitle.trim().toUpperCase()}`
      : `KALKULACJA KONFIGURACJI DOMKU (${quote.formId}: ${quote.formName})`,
    '',
    'PARAMETRY BAZOWE:',
    `• Powierzchnia: ${areaDesc}`,
    `• Bryła budynku: ${floorLabel}`,
    `• Standard i wariant: ${stdLabel}, ${insLabel}`,
    `• Fundament: ${foundLabel}`,
    ...(qty > 1 ? [`• Liczba domków: ${qty} szt.`] : []),
    ...(input.deliveryKm > 0
      ? [
          `• Transport z Przemyśla: ${input.deliveryKm} km${
            deliveryInfo?.destination ? ` → ${deliveryInfo.destination}` : ''
          }${quote.input.deliveryModules ? ` (${quote.input.deliveryModules} mod.)` : ''}`,
        ]
      : []),
    '',
    'SKŁAD KALKULACJI:',
    ...quote.breakdown.map((b) =>
      hideItemizedPrices
        ? `• ${b.label} — w cenie konfiguracji`
        : `• ${b.label}: ${formatPln(b.netPln)} netto (${b.formula})`
    ),
    '',
    'PODSUMOWANIE CENOWE:',
    ...(qty > 1
      ? [
          `• Wartość 1 domku netto: ${formatPln(quote.perUnitNetPln)}`,
          `• RAZEM ZA ${qty} DOMKI NETTO: ${formatPln(quote.totalNetPln)}`,
        ]
      : [`• RAZEM NETTO: ${formatPln(quote.totalNetPln)}`]),
    `• Podatek VAT (${quote.vatRate}%): ${formatPln(quote.vatPln)}`,
    `• RAZEM BRUTTO (${quote.vatRate}% VAT): ${formatPln(quote.totalGrossPln)}`,
    `  (dla porównania: 8% VAT = ${formatPln(quote.altVatGross8Pln)} | 23% VAT = ${formatPln(quote.altVatGross23Pln)})`,
  ];

  if (includeWarsawRef && quote.warsawSlabReference) {
    const w = quote.warsawSlabReference;
    lines.push(
      '',
      `WARIANT ORIENTACYJNY (${w.cityLabel} + płyta fundamentowa):`,
      `• Transport (${w.distanceKm} km, ${w.modulesCount} mod.): ok. ${formatPln(w.transportGrossPln)} brutto`,
      `• Razem orientacyjnie z dostawą i płytą: ${formatPln(w.totalWithWarsawSlabGrossPln)} brutto`,
    );
  }

  if (quote.isIllustrativeEstimate) {
    lines.push(
      '',
      `⚠️ Wycena wstępna / przykładowa: ${quote.assumedSummary}`,
    );
  } else {
    lines.push(
      '',
      'Kalkulacja przygotowana na bazie aktualnego cennika Tally. Zapraszam do kontaktu w celu doprecyzowania terminu i warunków na działce.',
    );
  }

  return lines.join('\n');
}

export function CalculatorAssistantView({
  onCreateCrmDeal,
  onHandoffToResponder,
  onLogAiCall,
}: CalculatorAssistantViewProps) {
  const [input, setInput] = useState<TallyQuoteInput>(DEFAULT_CALCULATOR_INPUT);
  const [areaInputStr, setAreaInputStr] = useState<string>(String(DEFAULT_CALCULATOR_INPUT.areaM2 ?? 50));
  const [modulesAuto, setModulesAuto] = useState<boolean>(true);
  const [projectTitle, setProjectTitle] = useState<string>('');

  const [quickPasteText, setQuickPasteText] = useState<string>('');
  const [parsingText, setParsingText] = useState<boolean>(false);
  const [parseFeedback, setParseFeedback] = useState<string | null>(null);

  const [deliveryAddressInput, setDeliveryAddressInput] = useState<string>('');
  const [deliveryLoading, setDeliveryLoading] = useState<boolean>(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [deliveryInfo, setDeliveryInfo] = useState<{
    destination: string;
    distanceKm: number;
    durationText: string;
  } | null>(null);

  const [quote, setQuote] = useState<TallyQuoteEvaluation | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  const [hideItemizedPrices, setHideItemizedPrices] = useState<boolean>(false);
  const [includeWarsawRef, setIncludeWarsawRef] = useState<boolean>(false);
  const [textMode, setTextMode] = useState<'full' | 'short'>('full');
  const [offerText, setOfferText] = useState<string>('');
  const [hasManualTextEdit, setHasManualTextEdit] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [crmSavedNotice, setCrmSavedNotice] = useState<boolean>(false);

  const seqRef = useRef<number>(0);
  const debounceRef = useRef<number | null>(null);

  const runRecalculate = useCallback(async (nextInput: TallyQuoteInput) => {
    const seqId = ++seqRef.current;
    setLoading(true);
    setCalcError(null);
    try {
      const res = await recalculateTallyQuote({
        input: nextInput,
        tallyFormId: 'dWO4Oq',
      });
      if (seqId !== seqRef.current) return;
      setQuote(res.quote);
      setLatencyMs(res.latencyMs);
    } catch (err) {
      if (seqId !== seqRef.current) return;
      setCalcError(err instanceof Error ? err.message : 'Nie udało się przeliczyć konfiguracji Tally.');
    } finally {
      if (seqId === seqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void runRecalculate(DEFAULT_CALCULATOR_INPUT);
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [runRecalculate]);

  const updateInput = useCallback(
    (patch: Partial<TallyQuoteInput>, immediate = true) => {
      setInput((prev) => {
        const shouldResetAutoModules =
          modulesAuto &&
          (patch.areaM2 !== undefined || patch.floorType !== undefined || patch.quantity !== undefined) &&
          patch.deliveryModules === undefined;

        const next: TallyQuoteInput = {
          ...prev,
          ...patch,
          ...(shouldResetAutoModules ? { deliveryModules: 0 } : {}),
        };

        if (debounceRef.current) {
          window.clearTimeout(debounceRef.current);
        }
        if (immediate) {
          void runRecalculate(next);
        } else {
          debounceRef.current = window.setTimeout(() => {
            void runRecalculate(next);
          }, 220);
        }
        return next;
      });
    },
    [modulesAuto, runRecalculate]
  );

  const autoGeneratedText = useMemo(() => {
    if (!quote) return '';
    return buildCopyableOfferText({
      quote,
      input,
      projectTitle,
      deliveryInfo,
      hideItemizedPrices,
      includeWarsawRef,
      textMode,
    });
  }, [quote, input, projectTitle, deliveryInfo, hideItemizedPrices, includeWarsawRef, textMode]);

  useEffect(() => {
    if (!hasManualTextEdit && autoGeneratedText) {
      setOfferText(autoGeneratedText);
    }
  }, [autoGeneratedText, hasManualTextEdit]);

  const handleAreaNumberChange = (raw: string, immediate = false) => {
    setAreaInputStr(raw);
    if (raw.trim() === '') return;
    const normalized = parseFloat(raw.replace(',', '.'));
    if (Number.isNaN(normalized)) return;
    const clamped = Math.max(0, Math.min(200, normalized));
    updateInput({ areaM2: clamped }, immediate);
  };

  const handleCalculateDelivery = async (addressOverride?: string) => {
    const query = (addressOverride ?? deliveryAddressInput).trim();
    if (!query) {
      setDeliveryError('Wpisz miejscowość, adres lub kod pocztowy (np. 00-001 Warszawa).');
      return;
    }
    setDeliveryLoading(true);
    setDeliveryError(null);
    try {
      const res = await calculateDeliveryDistance(query);
      setDeliveryInfo({
        destination: res.destinationAddress || query,
        distanceKm: res.distanceKm,
        durationText: res.durationText,
      });
      updateInput({ deliveryKm: res.distanceKm }, true);
    } catch (err) {
      setDeliveryError(
        err instanceof Error
          ? err.message
          : 'Nie udało się wyliczyć trasy z Przemyśla. Wpisz kilometry ręcznie.'
      );
    } finally {
      setDeliveryLoading(false);
    }
  };

  const handleQuickParseText = async () => {
    const raw = quickPasteText.trim();
    if (!raw) return;
    setParsingText(true);
    setParseFeedback(null);

    try {
      const aiRes = await extractAndEvaluateTallyQuote({
        clientMessage: raw,
        tallyFormId: 'dWO4Oq',
      });
      const q = aiRes.quote;
      setQuote(q);
      setLatencyMs(aiRes.latencyMs);
      setInput(q.input);
      setAreaInputStr(String(q.input.areaM2 ?? 0));
      setModulesAuto((q.input.deliveryModules ?? 0) === 0);
      setParseFeedback('Parametry wczytane inteligentnie przez AI Tally Engine.');
      onLogAiCall?.({
        action: 'responder',
        latencyMs: aiRes.latencyMs,
        promptTokens: aiRes.usage.promptTokens,
        candidatesTokens: aiRes.usage.candidatesTokens,
        totalTokens: aiRes.usage.totalTokens,
        status: 'success',
        summary: `Kalkulator AI Parse (${q.input.areaM2 ?? 0} m², ${formatPln(q.totalGrossPln)} brutto)`,
      });

      const localGuess = parseQuickTextLocally(raw);
      if (localGuess.detectedDestination && (!q.input.deliveryKm || q.input.deliveryKm === 0)) {
        setDeliveryAddressInput(localGuess.detectedDestination);
        void handleCalculateDelivery(localGuess.detectedDestination);
      }
    } catch {
      const localParsed = parseQuickTextLocally(raw);
      const next: TallyQuoteInput = {
        ...input,
        ...localParsed.patch,
        deliveryModules: modulesAuto ? 0 : input.deliveryModules,
      };
      setInput(next);
      if (next.areaM2 !== null && next.areaM2 !== undefined) {
        setAreaInputStr(String(next.areaM2));
      }
      await runRecalculate(next);
      if (localParsed.detectedDestination) {
        setDeliveryAddressInput(localParsed.detectedDestination);
        void handleCalculateDelivery(localParsed.detectedDestination);
      }
      setParseFeedback('Parametry rozpoznane lokalnie z tekstu (tryb bez płatnego klucza AI).');
    } finally {
      setParsingText(false);
    }
  };

  const handleCopyOfferText = async () => {
    const textToCopy = offerText.trim() || autoGeneratedText;
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      // Fallback via temporary textarea if clipboard permission blocked
      const el = document.createElement('textarea');
      el.value = textToCopy;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    }
  };

  const handleSaveToCrm = () => {
    if (!quote || !onCreateCrmDeal) return;
    const label = projectTitle.trim() || deliveryInfo?.destination || 'Klient Kalkulator';
    const areaVal = input.areaM2 ?? quote.input.areaM2 ?? 0;
    onCreateCrmDeal({
      title: `Wycena ${areaVal} m² — ${label}`,
      client: label,
      valuePln: quote.totalGrossPln || quote.totalNetPln || 0,
      stage: 'quote',
      riskLevel: 'LOW',
      score: 92,
      tags: ['Asystent Kalkulacji', input.floorType || 'parter', input.standard || 'norvil'],
      notes: offerText || autoGeneratedText,
    });
    setCrmSavedNotice(true);
    window.setTimeout(() => setCrmSavedNotice(false), 2500);
  };

  const handleResetDefaults = () => {
    setInput(DEFAULT_CALCULATOR_INPUT);
    setAreaInputStr(String(DEFAULT_CALCULATOR_INPUT.areaM2 ?? 50));
    setModulesAuto(true);
    setDeliveryAddressInput('');
    setDeliveryInfo(null);
    setDeliveryError(null);
    setProjectTitle('');
    setQuickPasteText('');
    setParseFeedback(null);
    setHasManualTextEdit(false);
    void runRecalculate(DEFAULT_CALCULATOR_INPUT);
  };

  const displayArea = Number.isFinite(Number(input.areaM2)) ? Number(input.areaM2) : 0;
  const resolvedModules = quote?.input.deliveryModules ?? input.deliveryModules ?? 1;

  return (
    <div className="space-y-4 pb-8">
      {/* Top Action & Quick-Intake Header */}
      <section className="rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur-md print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-md shadow-emerald-600/20">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-extrabold text-slate-900">
                  Asystent Kalkulacji (Silnik Tally dWO4Oq)
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200/80">
                  {loading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Przeliczanie...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-3 w-3" />
                      Na żywo{latencyMs ? ` · ${latencyMs} ms` : ''}
                    </>
                  )}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Ustaw metraż 0–200 m², dodatki i dostawę z Przemyśla po lewej stronie — gotowy kosztorys do skopiowania aktualizuje się od razu po prawej.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="Klient / nazwa projektu (opcjonalnie)"
              className="w-60 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs font-medium text-slate-800 outline-none transition focus:border-emerald-400 focus:bg-white"
            />
            <button
              type="button"
              onClick={() => void runRecalculate(input)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Odśwież ceny
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Resetuj
            </button>
          </div>
        </div>

        {/* Optional Quick-Fill from Pasted Text */}
        <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-2.5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-800 sm:shrink-0">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            Szybki start z tekstu:
          </div>
          <input
            type="text"
            value={quickPasteText}
            onChange={(e) => setQuickPasteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleQuickParseText();
              }
            }}
            placeholder="Wklej np. 'Domek 50 m2 parter całoroczny pod klucz płyta taras 15 m2 dostawa 00-001 Warszawa'"
            className="min-w-0 flex-1 rounded-xl border border-indigo-200/80 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none transition focus:border-indigo-400"
          />
          <button
            type="button"
            disabled={parsingText || !quickPasteText.trim()}
            onClick={() => void handleQuickParseText()}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {parsingText ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Wczytaj parametry
          </button>
        </div>
        {parseFeedback && (
          <p className="mt-1.5 px-1 text-[11px] font-semibold text-indigo-700">{parseFeedback}</p>
        )}
      </section>

      {calcError && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 print:hidden">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {calcError}
        </div>
      )}

      {/* Main 2-Column Studio Grid */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        {/* LEFT COLUMN: Full Configurator */}
        <div className="space-y-4 lg:col-span-7 print:hidden">
          {/* Card 1: Wymiary, Bryła i Ilość */}
          <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-100 text-xs font-extrabold text-emerald-700">
                  1
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">Metraż, Bryła i Ilość</h3>
                  <p className="text-[11px] text-slate-500">Wybierz dowolną powierzchnię od 0 do 200 m²</p>
                </div>
              </div>

              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => updateInput({ areaIsTotalUsable: false })}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    !input.areaIsTotalUsable
                      ? 'bg-white text-emerald-700 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Pow. zabudowy
                </button>
                <button
                  type="button"
                  onClick={() => updateInput({ areaIsTotalUsable: true })}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    input.areaIsTotalUsable
                      ? 'bg-white text-emerald-700 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Pow. całkowita
                </button>
              </div>
            </div>

            {/* Area presets + exact number + 0-200 slider */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Ruler className="mr-0.5 h-3.5 w-3.5 text-emerald-600" />
                  {AREA_PRESETS.map((presetArea) => (
                    <button
                      key={presetArea}
                      type="button"
                      onClick={() => {
                        setAreaInputStr(String(presetArea));
                        updateInput({ areaM2: presetArea, areaEstimatedByBot: false });
                      }}
                      className={`rounded-xl px-2.5 py-1 text-xs font-extrabold transition ${
                        Math.round(displayArea) === presetArea
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-emerald-300'
                      }`}
                    >
                      {presetArea}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-2.5 py-1">
                  <input
                    type="number"
                    min={0}
                    max={200}
                    step={1}
                    value={areaInputStr}
                    onChange={(e) => handleAreaNumberChange(e.target.value, false)}
                    onBlur={() => {
                      if (areaInputStr.trim() === '') {
                        setAreaInputStr(String(displayArea));
                      }
                    }}
                    className="w-14 bg-transparent text-right text-sm font-extrabold text-slate-900 outline-none"
                  />
                  <span className="text-xs font-bold text-slate-500">m²</span>
                </div>
              </div>

              <div className="mt-3">
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  value={displayArea}
                  onChange={(e) => handleAreaNumberChange(e.target.value, false)}
                  className="h-2 w-full cursor-pointer accent-emerald-600"
                />
                <div className="mt-1 flex justify-between text-[10px] font-semibold text-slate-400">
                  <span>0 m²</span>
                  <span>50 m²</span>
                  <span>100 m²</span>
                  <span>150 m²</span>
                  <span>200 m²</span>
                </div>
              </div>
              {displayArea === 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
                  Uwaga: w silniku Tally bazowa pozycja metrażowa wymaga &gt; 0 m² (dla 0 m² backend podstawia domyślną bazę katalogową).
                </p>
              )}
            </div>

            {/* Bryla + Ilosc */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12">
              <div className="sm:col-span-8">
                <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  Bryła budynku
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(['parter', 'poddasze', 'pietro'] as const).map((ft) => (
                    <button
                      key={ft}
                      type="button"
                      onClick={() => updateInput({ floorType: ft, floorEstimatedByBot: false })}
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                        input.floorType === ft
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'
                      }`}
                    >
                      {ft === 'parter' && 'Parter (×1)'}
                      {ft === 'poddasze' && 'Poddasze (×1.5)'}
                      {ft === 'pietro' && 'Piętro (×2)'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-4">
                <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  Ilość domków
                </label>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => updateInput({ quantity: Math.max(1, (input.quantity || 1) - 1) })}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-slate-700 shadow-2xs hover:bg-slate-100"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-xs font-extrabold text-slate-900">
                    {input.quantity || 1} szt.
                  </span>
                  <button
                    type="button"
                    onClick={() => updateInput({ quantity: Math.min(20, (input.quantity || 1) + 1) })}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-slate-700 shadow-2xs hover:bg-slate-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Standard, Ocieplenie, Fundament, Architekt */}
          <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-slate-900 text-xs font-extrabold text-white">
                2
              </span>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Standard, Konstrukcja i Projekt</h3>
                <p className="text-[11px] text-slate-500">Wykończenie, izolacja, rodzaj fundamentu oraz dokumentacja</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <Home className="h-3.5 w-3.5" />
                  Standard wykonania
                </label>
                <div className="flex gap-1.5">
                  {(['norvil', 'deweloperski'] as const).map((std) => (
                    <button
                      key={std}
                      type="button"
                      onClick={() => updateInput({ standard: std })}
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                        input.standard === std
                          ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {std === 'norvil' ? 'NORVIL (Pod klucz)' : 'Deweloperski'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <Thermometer className="h-3.5 w-3.5" />
                  Ocieplenie
                </label>
                <div className="flex gap-1.5">
                  {(['caloroczny', 'letniskowy'] as const).map((ins) => (
                    <button
                      key={ins}
                      type="button"
                      onClick={() => updateInput({ insulation: ins })}
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                        input.insulation === ins
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300'
                      }`}
                    >
                      {INSULATION_LABELS[ins]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <Layers className="h-3.5 w-3.5" />
                Fundament
              </label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(['brak', 'slupy', 'lawy', 'plyta'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => updateInput({ foundation: f })}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                      input.foundation === f
                        ? 'border-amber-600 bg-amber-600 text-white shadow-xs'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300'
                    }`}
                  >
                    {f === 'brak' && 'Brak'}
                    {f === 'slupy' && 'Słupy'}
                    {f === 'lawy' && 'Ławy'}
                    {f === 'plyta' && 'Płyta'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <Building2 className="h-3.5 w-3.5" />
                Pakiet architekta / projekt
              </label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {(['none', 'letniskowy', 'mieszkalny_70', 'mieszkalny_120', 'premium'] as const).map((pkg) => (
                  <button
                    key={pkg}
                    type="button"
                    onClick={() => updateInput({ architectPkg: pkg })}
                    className={`rounded-xl border px-2.5 py-2 text-[11px] font-bold transition ${
                      input.architectPkg === pkg
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-500'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {pkg === 'none' && 'Brak'}
                    {pkg === 'letniskowy' && 'Letniskowy'}
                    {pkg === 'mieszkalny_70' && 'Do 70 m²'}
                    {pkg === 'mieszkalny_120' && '70–120 m²'}
                    {pkg === 'premium' && 'Premium'}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Card 3: Wyposażenie i Dodatki */}
          <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-600 text-xs font-extrabold text-white">
                3
              </span>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Wyposażenie, Ogrzewanie i Tarasy</h3>
                <p className="text-[11px] text-slate-500">Wszystkie opcje dodatkowe z katalogu Tally</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Podlogowka */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                  <Flame className="h-3.5 w-3.5 text-orange-500" />
                  Ogrzewanie podłogowe
                </span>
                <button
                  type="button"
                  onClick={() => updateInput({ underfloorHeating: !input.underfloorHeating })}
                  className={`w-full rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                    input.underfloorHeating
                      ? 'border-orange-500 bg-orange-500 text-white shadow-xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-orange-300'
                  }`}
                >
                  {input.underfloorHeating ? '✓ Włączone' : 'Brak (wyłączone)'}
                </button>
              </div>

              {/* Grzejniki WiFi */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                  <Thermometer className="h-3.5 w-3.5 text-rose-500" />
                  Grzejniki WiFi
                </span>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-2 py-1">
                  <button
                    type="button"
                    onClick={() => updateInput({ heatersCount: Math.max(0, (input.heatersCount || 0) - 1) })}
                    className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="text-xs font-extrabold text-slate-900">{input.heatersCount} szt.</span>
                  <button
                    type="button"
                    onClick={() => updateInput({ heatersCount: Math.min(20, (input.heatersCount || 0) + 1) })}
                    className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* Klimatyzacja */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                  <Wind className="h-3.5 w-3.5 text-sky-500" />
                  Klimatyzacja (grzanie/chłodzenie)
                </span>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-2 py-1">
                  <button
                    type="button"
                    onClick={() => updateInput({ acCount: Math.max(0, (input.acCount || 0) - 1) })}
                    className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="text-xs font-extrabold text-slate-900">{input.acCount} szt.</span>
                  <button
                    type="button"
                    onClick={() => updateInput({ acCount: Math.min(10, (input.acCount || 0) + 1) })}
                    className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Łazienka & Kuchnia & Kominek */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  Pakiet Łazienka
                </label>
                <div className="flex gap-1.5">
                  {(['none', 'podstawowy', 'premium'] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => updateInput({ bathroom: b })}
                      className={`flex-1 rounded-xl border px-2.5 py-2 text-xs font-bold transition ${
                        input.bathroom === b
                          ? 'border-violet-600 bg-violet-600 text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300'
                      }`}
                    >
                      {b === 'none' && 'Brak'}
                      {b === 'podstawowy' && 'Podstawowy'}
                      {b === 'premium' && 'Premium'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  Kominek / Koza
                </label>
                <div className="flex gap-1.5">
                  {(['none', 'przygotowanie', 'koza'] as const).map((fp) => (
                    <button
                      key={fp}
                      type="button"
                      onClick={() => updateInput({ fireplace: fp })}
                      className={`flex-1 rounded-xl border px-2.5 py-2 text-xs font-bold transition ${
                        input.fireplace === fp
                          ? 'border-orange-600 bg-orange-600 text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-orange-300'
                      }`}
                    >
                      {fp === 'none' && 'Brak'}
                      {fp === 'przygotowanie' && 'Przygotowanie'}
                      {fp === 'koza' && 'Koza'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <Utensils className="h-3.5 w-3.5" />
                Kuchnia i Umeblowanie
              </label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(['none', 'umeblowanie', 'kuchnia', 'kuchnia_meble'] as const).map((kp) => (
                  <button
                    key={kp}
                    type="button"
                    onClick={() => updateInput({ kitchenPkg: kp })}
                    className={`rounded-xl border px-2.5 py-2 text-xs font-bold transition ${
                      input.kitchenPkg === kp
                        ? 'border-teal-600 bg-teal-600 text-white shadow-xs'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300'
                    }`}
                  >
                    {kp === 'none' && 'Brak'}
                    {kp === 'umeblowanie' && 'Umeblowanie'}
                    {kp === 'kuchnia' && 'Kuchnia'}
                    {kp === 'kuchnia_meble' && 'Kuchnia + Meble'}
                  </button>
                ))}
              </div>
            </div>

            {/* Tarasy + MPZP */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                <label className="mb-1.5 block text-[11px] font-bold text-slate-600">
                  Taras zadaszony (m²)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={input.coveredTerraceM2}
                    onChange={(e) =>
                      updateInput({
                        coveredTerraceM2: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)),
                      }, false)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-extrabold text-slate-900 outline-none focus:border-emerald-400"
                  />
                  <span className="text-[11px] font-bold text-slate-500">m²</span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                <label className="mb-1.5 block text-[11px] font-bold text-slate-600">
                  Taras otwarty (m²)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={input.openTerraceM2}
                    onChange={(e) =>
                      updateInput({
                        openTerraceM2: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)),
                      }, false)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-extrabold text-slate-900 outline-none focus:border-emerald-400"
                  />
                  <span className="text-[11px] font-bold text-slate-500">m²</span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5">
                <span className="mb-1.5 block text-[11px] font-bold text-slate-600">
                  Dach pod MPZP
                </span>
                <button
                  type="button"
                  onClick={() => updateInput({ roofAngleMpzp: !input.roofAngleMpzp })}
                  className={`w-full rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                    input.roofAngleMpzp
                      ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'
                  }`}
                >
                  {input.roofAngleMpzp ? '✓ Dostosowany MPZP' : 'Standardowy'}
                </button>
              </div>
            </div>
          </section>

          {/* Card 4: Dostawa z Przemyśla */}
          <section className="rounded-3xl border border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/30 p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-700 text-xs font-extrabold text-white">
                  4
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">Dostawa z Przemyśla</h3>
                  <p className="text-[11px] text-slate-500">
                    Baza startowa: Przemyśl, Polska • Darmowy kalkulator kilometrów po adresie lub kodzie
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                <Truck className="h-3 w-3" />
                Bez płatnych kluczy API
              </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
                <input
                  type="text"
                  value={deliveryAddressInput}
                  onChange={(e) => setDeliveryAddressInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCalculateDelivery();
                    }
                  }}
                  placeholder="Wpisz adres lub kod pocztowy klienta (np. 00-001 Warszawa, Kraków)"
                  className="w-full rounded-xl border border-emerald-200 bg-white py-2 pl-9 pr-3 text-xs font-medium text-slate-800 outline-none transition focus:border-emerald-500"
                />
              </div>
              <button
                type="button"
                disabled={deliveryLoading}
                onClick={() => void handleCalculateDelivery()}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {deliveryLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MapPin className="h-3.5 w-3.5" />
                )}
                Wylicz km z Przemyśla
              </button>
            </div>

            {deliveryError && (
              <p className="mt-2 rounded-xl bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-700">
                {deliveryError}
              </p>
            )}

            {deliveryInfo && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs">
                <span className="font-bold text-slate-800">
                  Przemyśl → <span className="text-emerald-700">{deliveryInfo.destination}</span>
                </span>
                <span className="font-extrabold text-emerald-700">
                  {deliveryInfo.distanceKm} km {deliveryInfo.durationText ? `(${deliveryInfo.durationText})` : ''}
                </span>
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-600">Dystans ręczny / wynik (km)</span>
                  {input.deliveryKm > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryInfo(null);
                        updateInput({ deliveryKm: 0 });
                      }}
                      className="text-[10px] font-bold text-rose-600 hover:underline"
                    >
                      Zeruj (0 km)
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    value={input.deliveryKm}
                    onChange={(e) =>
                      updateInput({ deliveryKm: Math.max(0, parseInt(e.target.value, 10) || 0) }, false)
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-extrabold text-slate-900 outline-none focus:border-emerald-400"
                  />
                  <span className="text-xs font-bold text-slate-500">km</span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[11px] font-bold text-slate-600">
                    <Package className="h-3 w-3 text-slate-500" />
                    Moduły transportowe
                  </span>
                  {!modulesAuto ? (
                    <button
                      type="button"
                      onClick={() => {
                        setModulesAuto(true);
                        updateInput({ deliveryModules: 0 });
                      }}
                      className="text-[10px] font-bold text-indigo-600 hover:underline"
                    >
                      Przywróć auto
                    </button>
                  ) : (
                    <span className="text-[10px] font-semibold text-emerald-700">Auto z bryły/m²</span>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setModulesAuto(false);
                      updateInput({ deliveryModules: Math.max(1, resolvedModules - 1) });
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded bg-white text-slate-700 shadow-2xs hover:bg-slate-100"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="text-xs font-extrabold text-slate-900">
                    {resolvedModules} mod.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setModulesAuto(false);
                      updateInput({ deliveryModules: Math.min(20, resolvedModules + 1) });
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded bg-white text-slate-700 shadow-2xs hover:bg-slate-100"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: Live Quote + Ready-to-Copy Offer Text */}
        <div className="space-y-4 lg:sticky lg:top-24 lg:col-span-5">
          {/* Summary Card */}
          <section className="rounded-3xl border border-slate-200/90 bg-white p-4 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">
                  Podsumowanie Tally {quote?.formId ? `(${quote.formId})` : ''}
                </span>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-black tracking-tight text-slate-900">
                    {quote ? formatPln(quote.totalGrossPln) : '—'}
                  </span>
                  <span className="text-xs font-bold text-slate-500">
                    brutto ({input.vatRate}% VAT)
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-600">
                  Netto: <strong className="text-slate-900">{quote ? formatPln(quote.totalNetPln) : '—'}</strong>
                  {quote && quote.quantity > 1 && (
                    <span className="ml-2 text-slate-500">
                      ({formatPln(quote.perUnitNetPln)} netto / szt.)
                    </span>
                  )}
                </p>
              </div>

              {/* VAT Toggle */}
              <div className="flex flex-col items-end gap-1.5 print:hidden">
                <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs font-extrabold">
                  <button
                    type="button"
                    onClick={() => updateInput({ vatRate: 8 })}
                    className={`rounded-lg px-3 py-1 transition ${
                      input.vatRate === 8
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    VAT 8%
                  </button>
                  <button
                    type="button"
                    onClick={() => updateInput({ vatRate: 23 })}
                    className={`rounded-lg px-3 py-1 transition ${
                      input.vatRate === 23
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    VAT 23%
                  </button>
                </div>
                {quote && (
                  <span className="text-[10px] font-semibold text-slate-400">
                    {input.vatRate === 8
                      ? `23% VAT: ${formatPln(quote.altVatGross23Pln)}`
                      : `8% VAT: ${formatPln(quote.altVatGross8Pln)}`}
                  </span>
                )}
              </div>
            </div>

            {/* Option Pills */}
            <div className="mt-3 flex flex-wrap gap-1.5 print:hidden">
              <button
                type="button"
                onClick={() => setHideItemizedPrices((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition ${
                  hideItemizedPrices
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {hideItemizedPrices ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {hideItemizedPrices ? 'Ceny pozycji ukryte' : 'Ukryj cenniki'}
              </button>

              <button
                type="button"
                onClick={() => updateInput({ areaEstimatedByBot: !input.areaEstimatedByBot })}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition ${
                  input.areaEstimatedByBot
                    ? 'border-amber-500 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {input.areaEstimatedByBot ? 'Oznaczono jako przykładową' : 'Oznacz jako przykładową'}
              </button>

              {quote?.warsawSlabReference && (
                <button
                  type="button"
                  onClick={() => setIncludeWarsawRef((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition ${
                    includeWarsawRef
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <MapPin className="h-3.5 w-3.5" />
                  Warszawa + płyta
                </button>
              )}
            </div>

            {/* Itemized Breakdown */}
            {quote && quote.breakdown.length > 0 && (
              <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {quote.breakdown.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-start justify-between gap-3 rounded-xl bg-slate-50/80 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800">{item.label}</p>
                      <p className="text-[10px] text-slate-500">{item.formula}</p>
                    </div>
                    <span className="shrink-0 font-extrabold text-slate-900">
                      {hideItemizedPrices ? 'w cenie' : `${formatPln(item.netPln)} netto`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Ready-to-Copy Offer Card */}
          <section className="rounded-3xl border border-indigo-200/80 bg-white p-4 shadow-md">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-600" />
                <h3 className="text-sm font-extrabold text-slate-900">Tekst wyceny do skopiowania</h3>
              </div>

              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-bold print:hidden">
                <button
                  type="button"
                  onClick={() => setTextMode('full')}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    textMode === 'full' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-500'
                  }`}
                >
                  Pełna oferta
                </button>
                <button
                  type="button"
                  onClick={() => setTextMode('short')}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    textMode === 'short' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-500'
                  }`}
                >
                  Krótka (WhatsApp)
                </button>
              </div>
            </div>

            {hasManualTextEdit && (
              <div className="mb-2 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800 print:hidden">
                <span>Tekst edytowany ręcznie — zmiany suwaków go nie nadpisują.</span>
                <button
                  type="button"
                  onClick={() => {
                    setHasManualTextEdit(false);
                    setOfferText(autoGeneratedText);
                  }}
                  className="font-extrabold text-amber-900 underline"
                >
                  ↻ Odśwież z kalkulatora
                </button>
              </div>
            )}

            <textarea
              rows={13}
              value={offerText}
              onChange={(e) => {
                setHasManualTextEdit(true);
                setOfferText(e.target.value);
              }}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white"
            />

            {/* Primary Actions */}
            <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() => void handleCopyOfferText()}
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold shadow-sm transition ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gradient-to-r from-slate-900 to-indigo-950 text-white hover:opacity-95'
                }`}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Skopiowano tekst!' : 'Kopiuj tekst wyceny'}
              </button>

              {onHandoffToResponder && (
                <button
                  type="button"
                  onClick={() => onHandoffToResponder(offerText || autoGeneratedText)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs font-bold text-indigo-800 transition hover:bg-indigo-100"
                >
                  <MailCheck className="h-3.5 w-3.5" />
                  Do Odpowiedzi
                </button>
              )}

              {onCreateCrmDeal && (
                <button
                  type="button"
                  onClick={handleSaveToCrm}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs font-bold text-violet-800 transition hover:bg-violet-100"
                >
                  {crmSavedNotice ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  {crmSavedNotice ? 'Dodano!' : 'Do CRM'}
                </button>
              )}

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
              >
                <Printer className="h-3.5 w-3.5" />
                Drukuj / PDF
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
