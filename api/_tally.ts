import type {
  TallyQuoteBreakdownItem,
  TallyQuoteEvaluation,
  TallyQuoteInput,
} from '../src/types';

export interface TallyKnowledgeTileDraft {
  title: string;
  category: string;
  visibility: 'public' | 'internal';
  priority: 'standard' | 'critical';
  content: string;
}

export interface TallyLiveRates {
  dewLetn: number;
  dewCal: number;
  norvLetn: number;
  norvCal: number;
  archLetn: number;
  arch70: number;
  arch120: number;
  archPrem: number;
  fundSlupy: number;
  fundLawy: number;
  fundPlyta: number;
  tarasZad: number;
  tarasOtw: number;
  podlogowka: number;
  grzejnik: number;
  klima: number;
  lazBase: number;
  lazPrem: number;
  umeblowanie: number;
  samaKuchnia: number;
  kuchniaPlus: number;
  kominek: number;
  podKominek: number;
  dostawaKm: number;
  roofAngleMpzp: number;
  poddaszeMult: number;
  pietroMult: number;
}

interface TallyParsedBlock {
  type?: string;
  groupUuid?: string;
  payload?: {
    text?: string;
    title?: string;
    name?: string;
    safeHTMLSchema?: Array<[string, ...unknown[]]>;
    calculatedFields?: Array<{ name?: string; value?: number }>;
  };
}

export function extractTallyFormId(rawInput?: string): string {
  const cleaned = String(rawInput || 'dWO4Oq').trim();
  const urlMatch = cleaned.match(/tally\.so\/(?:r|embed)\/([A-Za-z0-9_-]{4,24})/i);
  const id = urlMatch ? urlMatch[1] : cleaned.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || 'dWO4Oq';
  return /^[A-Za-z0-9_-]{4,24}$/.test(id) ? id : 'dWO4Oq';
}

function parseTallyNextData(html: string, formId: string) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Nie znaleziono struktury __NEXT_DATA__ w formularzu Tally.');
  }
  const parsed = JSON.parse(match[1]) as {
    props?: {
      pageProps?: {
        name?: string;
        blocks?: TallyParsedBlock[];
      };
    };
  };

  const pp = parsed.props?.pageProps;
  const formName = pp?.name || `Konfigurator Tally (${formId})`;
  const blocks = Array.isArray(pp?.blocks) ? pp.blocks : [];

  const getBlockText = (b: TallyParsedBlock) => {
    const p = b.payload;
    if (!p) return '';
    if (Array.isArray(p.safeHTMLSchema)) {
      return p.safeHTMLSchema.map((seg) => (Array.isArray(seg) ? String(seg[0] || '') : '')).join('').trim();
    }
    return String(p.text || p.title || p.name || '').trim();
  };

  const calcVars = new Map<string, number>();
  const sectionMap: Array<{ section: string; items: string[] }> = [];
  let currentSec: { section: string; items: string[] } = { section: 'Parametry podstawowe', items: [] };

  for (const b of blocks) {
    const t = b.type || '';
    if (t === 'CALCULATED_FIELDS' && Array.isArray(b.payload?.calculatedFields)) {
      for (const cf of b.payload.calculatedFields) {
        if (cf.name && typeof cf.value === 'number' && cf.value > 0) {
          calcVars.set(cf.name.trim(), cf.value);
        }
      }
      continue;
    }

    const txt = getBlockText(b).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    if (!txt || txt.includes('Netto: @multiplier') || txt.includes('qqqqq')) continue;

    if (t === 'PAGE_BREAK') {
      if (currentSec.items.length > 0) sectionMap.push(currentSec);
      currentSec = { section: txt, items: [] };
    } else if (t === 'TITLE') {
      currentSec.items.push(`\n[${txt}]`);
    } else if (t === 'MULTIPLE_CHOICE_OPTION' || t === 'TEXT') {
      if (currentSec.items.length < 40) {
        currentSec.items.push(`• ${txt}`);
      }
    }
  }
  if (currentSec.items.length > 0) sectionMap.push(currentSec);

  return { formName, calcVars, sectionMap };
}

function extractRatesFromVars(vars: Map<string, number>): TallyLiveRates {
  const num = (candidates: string[], fallback: number): number => {
    for (const [k, v] of vars.entries()) {
      const lower = k.toLowerCase();
      if (candidates.every((c) => lower.includes(c.toLowerCase()))) return v;
    }
    return fallback;
  };

  return {
    dewLetn: vars.get('priceDEWELOPERSKI') ?? num(['pricedeweloperski'], 2500),
    dewCal: num(['deweloperski', 'caloroczny'], 2650),
    norvLetn: vars.get('priceNORVIL') ?? 3000,
    norvCal: num(['norvil', 'caloroczny'], 3150),
    archLetn: num(['architekt', 'letnisk'], 4500),
    arch70: num(['architekt', '70m2'], 16000),
    arch120: num(['architekt', '70-120'], 17000),
    archPrem: num(['architekt', 'premium'], 20000),
    fundSlupy: num(['cena', 'slup'], 350),
    fundLawy: num(['cena', 'law'], 600),
    fundPlyta: num(['cena', 'plyt'], 750),
    tarasZad: num(['taras', 'zadasony'], 1500),
    tarasOtw: num(['taras', 'otwarty'], 1000),
    podlogowka: num(['podlog'], 187),
    grzejnik: num(['grejnik'], 514),
    klima: num(['klima'], 3050),
    lazBase: num(['lazienkabase'], 14000),
    lazPrem: num(['lazienkapremium'], 20000),
    umeblowanie: num(['umeblowanie'], 8000),
    samaKuchnia: num(['sama kuchnia'], 15000),
    kuchniaPlus: num(['kuchnia plus'], 23000),
    kominek: num(['kominek plus'], 9500),
    podKominek: num(['gotowanie', 'kominek'], 3300),
    dostawaKm: num(['dostawa'], 25),
    roofAngleMpzp: 300,
    poddaszeMult: 1.5,
    pietroMult: 2.0,
  };
}

export function buildTilesFromTallyHtml(html: string, formId: string): {
  formName: string;
  tiles: TallyKnowledgeTileDraft[];
} {
  const { formName, calcVars, sectionMap } = parseTallyNextData(html, formId);
  const calcLines = Array.from(calcVars.entries()).map(
    ([name, value]) => `• ${name}: ${value.toLocaleString('pl-PL')} PLN`
  );

  const tiles: TallyKnowledgeTileDraft[] = [];

  if (calcLines.length > 0) {
    tiles.push({
      title: `Cennik Kalkulatora Tally (${formId}): Stawki bazowe i dodatki`,
      category: 'Cennik',
      visibility: 'public',
      priority: 'critical',
      content: [
        `Oficjalne stawki netto pobrane bezpośrednio z konfiguratora "${formName}" (https://tally.so/r/${formId}):`,
        ...calcLines,
        '• Kondygnacje: Parter = ×1.0, Poddasze użytkowe = ×1.5, Piętro pełnowymiarowe = ×2.0.',
        '• VAT: w konfiguratorze domyślnie brutto = netto × 1.23 (23% VAT); dla budynków mieszkalnych całorocznych osoby fizycznej do 300 m² możliwa stawka 8% VAT.',
      ].join('\n'),
    });
  }

  for (const sec of sectionMap) {
    const cleanItems = sec.items.filter(Boolean).join('\n').trim();
    if (cleanItems.length < 30) continue;
    if (/wstęp|finalizacja/i.test(sec.section)) continue;
    tiles.push({
      title: `Tally (${formId}) — ${sec.section}`,
      category: /fundament|ogrzew|dach|ociepl|techn/i.test(sec.section)
        ? 'Technologia'
        : /dostaw|transport/i.test(sec.section)
          ? 'Logistyka'
          : /finans|kredyt/i.test(sec.section)
            ? 'Finanse & VAT'
            : 'Oferta',
      visibility: 'public',
      priority: 'standard',
      content: cleanItems.slice(0, 3500),
    });
  }

  return { formName, tiles };
}

interface TallyCacheEntry {
  expiresAt: number;
  formName: string;
  contextText: string;
  rates: TallyLiveRates;
  liveFetched: boolean;
  variablesCount: number;
}

const TALLY_CPQ_CACHE = new Map<string, TallyCacheEntry>();

function formatPln(val: number): string {
  return `${Math.round(val).toLocaleString('pl-PL')} zł`;
}

function buildStructuredCpqContext(
  formId: string,
  formName: string,
  r: TallyLiveRates,
  sectionMap: Array<{ section: string; items: string[] }>,
  liveFetched: boolean
): string {
  const extraOptions = sectionMap
    .filter((s) => !/wstęp|finalizacja|podstawow/i.test(s.section))
    .map((s) => `- ${s.section}: ${s.items.slice(0, 6).join(' ').replace(/\s+/g, ' ').slice(0, 220)}`)
    .slice(0, 10);

  return [
    `OFICJALNY LIVE CENNIK I ZASADY WYCENY Z KONFIGURATORA TALLY (${formId}: "${formName}", https://tally.so/r/${formId} — ${liveFetched ? 'POBRANO NA ŻYWO' : 'PAMIĘĆ ZAPASOWA'}):`,
    'Wszystkie poniższe kwoty są kwotami NETTO (chyba że zaznaczono BRUTTO). Jawnie prezentuj klientowi wycenę pozycja po pozycji wg poniższych stawek:',
    '',
    '1. BAZA DOMU (cena za 1 m² powierzchni zabudowy podstawy × mnożnik kondygnacji):',
    `• Standard Deweloperski Letniskowy / Rekreacyjny: ${formatPln(r.dewLetn)}/m² netto`,
    `• Standard Deweloperski Całoroczny (WT2021): ${formatPln(r.dewCal)}/m² netto`,
    `• Standard NORVIL (Pod klucz) Letniskowy: ${formatPln(r.norvLetn)}/m² netto`,
    `• Standard NORVIL (Pod klucz) Całoroczny: ${formatPln(r.norvCal)}/m² netto`,
    '',
    '2. KONDYGNACJE / TYPY DOMÓW (MNOŻNIK BRYŁY):',
    `• Dom PARTEROWY (1 poziom): mnożnik × 1.0`,
    `• Dom z PODDASZEM UŻYTKOWYM: mnożnik × ${r.poddaszeMult}`,
    `• Dom PIĘTROWY PEŁNOWYMIAROWY: mnożnik × ${r.pietroMult}`,
    '',
    '3. CENNIK FUNDAMENTÓW (liczony za m² powierzchni zabudowy / przyziemia):',
    `• Bez fundamentu: 0 zł | Słupy / geo-wkręty: ${formatPln(r.fundSlupy)}/m² | Ławy: ${formatPln(r.fundLawy)}/m² | Płyta fundamentowa: ${formatPln(r.fundPlyta)}/m² netto`,
    '',
    '4. PAKIETY ARCHITEKTA:',
    `• Letniskowy do 70 m²: ${formatPln(r.archLetn)} | Mieszkalny do 70 m²: ${formatPln(r.arch70)} | Mieszkalny 70–120 m²: ${formatPln(r.arch120)} | Premium: ${formatPln(r.archPrem)} netto`,
    '',
    '5. OGRZEWANIE, DACH MPZP, WNĘTRZE I TARASY:',
    `• Ogrzewanie podłogowe: ${formatPln(r.podlogowka)}/m² | Grzejnik WiFi 1.5 kW: ${formatPln(r.grzejnik)}/szt. | Klimatyzator: ${formatPln(r.klima)}/szt.`,
    `• Zmiana kąta dachu pod MPZP/WZ: +${formatPln(r.roofAngleMpzp)}/m² netto`,
    `• Łazienka: Podstawowy ${formatPln(r.lazBase)} | Premium ${formatPln(r.lazPrem)} netto`,
    `• Kuchnia & Meble: Umeblowanie ${formatPln(r.umeblowanie)} | Sama kuchnia ${formatPln(r.samaKuchnia)} | Kuchnia + meble ${formatPln(r.kuchniaPlus)} netto`,
    `• Kominek koza: Przygotowanie ${formatPln(r.podKominek)} | Kominek + montaż + płytka ${formatPln(r.kominek)} netto`,
    `• Tarasy: Zadaszony ${formatPln(r.tarasZad)}/m² | Otwarty ${formatPln(r.tarasOtw)}/m² netto`,
    `• Transport z Przemyśla: ${r.dostawaKm} zł brutto/km × liczba modułów (dźwig po stronie klienta). VAT: 8% (mieszkalny całoroczny do 300 m²) lub 23%.`,
    ...(extraOptions.length > 0 ? ['', 'SEKCJE FORMULARZA TALLY:', ...extraOptions] : []),
  ].join('\n');
}

export async function getLiveTallyData(formId = 'dWO4Oq', forceRefresh = false): Promise<{
  formId: string;
  formName: string;
  contextText: string;
  rates: TallyLiveRates;
  liveFetched: boolean;
  variablesCount: number;
}> {
  const cleanId = extractTallyFormId(formId);
  const now = Date.now();
  const cached = TALLY_CPQ_CACHE.get(cleanId);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return {
      formId: cleanId,
      formName: cached.formName,
      contextText: cached.contextText,
      rates: cached.rates,
      liveFetched: cached.liveFetched,
      variablesCount: cached.variablesCount,
    };
  }

  try {
    const res = await fetch(`https://tally.so/r/${encodeURIComponent(cleanId)}`, {
      headers: { 'User-Agent': 'BizOpsAIStudio/1.0 (+live-cpq-engine)' },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const { formName, calcVars, sectionMap } = parseTallyNextData(html, cleanId);
    const rates = extractRatesFromVars(calcVars);
    const contextText = buildStructuredCpqContext(cleanId, formName, rates, sectionMap, true);
    const entry: TallyCacheEntry = {
      expiresAt: now + 5 * 60 * 1000,
      formName,
      contextText,
      rates,
      liveFetched: true,
      variablesCount: calcVars.size,
    };
    TALLY_CPQ_CACHE.set(cleanId, entry);
    return {
      formId: cleanId,
      ...entry,
    };
  } catch {
    if (cached) {
      return {
        formId: cleanId,
        ...cached,
      };
    }
    const fallbackRates = extractRatesFromVars(new Map());
    const contextText = buildStructuredCpqContext(
      cleanId,
      'Kalkulator domu dla klienta FINAL',
      fallbackRates,
      [],
      false
    );
    return {
      formId: cleanId,
      formName: 'Kalkulator domu dla klienta FINAL',
      contextText,
      rates: fallbackRates,
      liveFetched: false,
      variablesCount: 0,
    };
  }
}

export async function getLiveTallyCpqContext(formId = 'dWO4Oq') {
  const data = await getLiveTallyData(formId, false);
  return {
    contextText: data.contextText,
    formName: data.formName,
    liveFetched: data.liveFetched,
    variablesCount: data.variablesCount,
  };
}

export function evaluateTallyQuoteFromLiveData(
  rawInput: Partial<TallyQuoteInput>,
  live: { formId: string; formName: string; rates: TallyLiveRates; liveFetched: boolean }
): TallyQuoteEvaluation {
  const r = live.rates;

  const rawFloorType: 'parter' | 'poddasze' | 'pietro' | null =
    rawInput.floorType === 'parter' || rawInput.floorType === 'poddasze' || rawInput.floorType === 'pietro'
      ? rawInput.floorType
      : null;

  const floorEstimated = Boolean(rawInput.floorEstimatedByBot) || !rawFloorType;
  const effectiveFloorType: 'parter' | 'poddasze' | 'pietro' = rawFloorType || 'parter';
  const floorMult =
    effectiveFloorType === 'poddasze'
      ? r.poddaszeMult
      : effectiveFloorType === 'pietro'
        ? r.pietroMult
        : 1.0;

  const explicitArea =
    typeof rawInput.areaM2 === 'number' && Number.isFinite(rawInput.areaM2) && rawInput.areaM2 > 0
      ? Math.round(rawInput.areaM2)
      : null;

  const areaEstimated = !explicitArea || Boolean(rawInput.areaEstimatedByBot);
  // Jeśli klient nie podał metrażu (np. opisał tylko układ pokoi góra/dół), przyjmujemy orientacyjnie 50 m² dla piętrowego/poddasza lub 35 m² dla parteru
  let footprintM2: number = explicitArea ?? (floorMult > 1 ? 50 : 35);

  if (explicitArea && !rawInput.areaEstimatedByBot && rawInput.areaIsTotalUsable && floorMult > 1) {
    footprintM2 = Math.max(15, Math.round(explicitArea / floorMult));
  }

  const quantity = Math.max(1, Math.min(20, Math.round(Number(rawInput.quantity) || 1)));
  const standard = rawInput.standard ?? null;
  const insulation = rawInput.insulation ?? null;
  const effectiveStd = standard || 'norvil';
  const effectiveIns = insulation || 'caloroczny';
  const vatRate: 8 | 23 =
    rawInput.vatRate === 8 || rawInput.vatRate === 23
      ? rawInput.vatRate
      : effectiveIns === 'letniskowy'
        ? 23
        : 8;

  const rateM2 =
    effectiveStd === 'deweloperski'
      ? effectiveIns === 'caloroczny'
        ? r.dewCal
        : r.dewLetn
      : effectiveIns === 'caloroczny'
        ? r.norvCal
        : r.norvLetn;

  const breakdown: TallyQuoteBreakdownItem[] = [];
  const missingQuestions: string[] = [];

  const baseHouseNet = Math.round(footprintM2 * rateM2 * floorMult);
  const stdLabel =
    effectiveStd === 'deweloperski' ? 'Standard Deweloperski' : 'Standard NORVIL (Pod klucz)';
  const insLabel = effectiveIns === 'caloroczny' ? 'Całoroczny' : 'Letniskowy';
  const floorLabel =
    effectiveFloorType === 'poddasze'
      ? `z poddaszem użytkowym (×${floorMult})`
      : effectiveFloorType === 'pietro'
        ? `piętrowy pełnowymiarowy (×${floorMult})`
        : 'parterowy (×1.0)';
  const totalAreaLabel =
    floorMult > 1 ? ` ≈ ${Math.round(footprintM2 * floorMult)} m² pow. całk.` : '';

  breakdown.push({
    key: 'base_house',
    label: `Dom ${stdLabel} ${insLabel}, ${floorLabel}`,
    formula: `${areaEstimated ? 'przykładowo ' : ''}${footprintM2} m² podstawy${totalAreaLabel} × ${floorMult} × ${formatPln(rateM2)}/m²`,
    netPln: baseHouseNet,
    isDefaultAssumed: areaEstimated || !standard || !insulation || floorEstimated,
  });

  if (areaEstimated) {
    missingQuestions.push(
      `Docelowa powierzchnia zabudowy (m²) — do przykładu przyjęto ${footprintM2} m² po podłodze${floorMult > 1 ? ` (${Math.round(footprintM2 * floorMult)} m² po uwzględnieniu góry)` : ''}`
    );
  }
  if (!standard) {
    missingQuestions.push(
      `Standard wykończenia: Deweloperski (${formatPln(effectiveIns === 'caloroczny' ? r.dewCal : r.dewLetn)}/m²) czy NORVIL Pod klucz (${formatPln(effectiveIns === 'caloroczny' ? r.norvCal : r.norvLetn)}/m²)`
    );
  }
  if (!insulation) {
    missingQuestions.push('Przeznaczenie i izolacja: Dom całoroczny mieszkalny (WT2021) czy letniskowy / rekreacyjny');
  }
  if (floorEstimated) {
    missingQuestions.push(
      rawFloorType
        ? 'Rodzaj góry: Poddasze użytkowe ze skosami (×1.5) czy Pełne piętro (×2.0)'
        : 'Typ kondygnacji: Parterowy (×1.0), Poddasze użytkowe (×1.5) czy Piętrowy pełnowymiarowy (×2.0)'
    );
  }

  // Fundamenty
  const foundation = rawInput.foundation ?? null;
  if (foundation && foundation !== 'brak') {
    const fRate =
      foundation === 'slupy' ? r.fundSlupy : foundation === 'lawy' ? r.fundLawy : r.fundPlyta;
    const fLabel =
      foundation === 'slupy'
        ? 'Fundament słupowy / geo-wkręty'
        : foundation === 'lawy'
          ? 'Fundament: ławy fundamentowe'
          : 'Fundament: płyta fundamentowa';
    breakdown.push({
      key: 'foundation',
      label: fLabel,
      formula: `${areaEstimated ? 'przykładowo ' : ''}${footprintM2} m² × ${formatPln(fRate)}/m²`,
      netPln: Math.round(footprintM2 * fRate),
      isDefaultAssumed: areaEstimated,
    });
  } else if (foundation === 'brak') {
    breakdown.push({
      key: 'foundation',
      label: 'Bez fundamentu (po stronie inwestora)',
      formula: '0 zł',
      netPln: 0,
    });
  } else {
    missingQuestions.push(
      `Fundament: Słupy (${formatPln(r.fundSlupy)}/m²), Ławy (${formatPln(r.fundLawy)}/m²), Płyta (${formatPln(r.fundPlyta)}/m²) czy we własnym zakresie`
    );
  }

  // Architekt
  const arch = rawInput.architectPkg ?? null;
  if (arch && arch !== 'none') {
    const archPrice =
      arch === 'letniskowy'
        ? r.archLetn
        : arch === 'mieszkalny_70'
          ? r.arch70
          : arch === 'mieszkalny_120'
            ? r.arch120
            : r.archPrem;
    const archLabel =
      arch === 'letniskowy'
        ? 'Pakiet architekta: Letniskowy do 70 m²'
        : arch === 'mieszkalny_70'
          ? 'Pakiet architekta: Mieszkalny do 70 m² (PAB, PT)'
          : arch === 'mieszkalny_120'
            ? 'Pakiet architekta: Mieszkalny 70–120 m² (PAB, PT)'
            : 'Pakiet architekta: Premium (zmiany indywidualne)';
    breakdown.push({
      key: 'architect',
      label: archLabel,
      formula: 'ryczałt za dokumentację',
      netPln: archPrice,
    });
  } else if (!arch) {
    missingQuestions.push(
      `Dokumentacja / Pakiet architekta (Letniskowy ${formatPln(r.archLetn)}, Mieszkalny do 70 m² ${formatPln(r.arch70)}, 70–120 m² ${formatPln(r.arch120)}, Premium ${formatPln(r.archPrem)})`
    );
  }

  // Ogrzewanie podłogowe, grzejniki, klimatyzacja
  if (rawInput.underfloorHeating === true && footprintM2) {
    breakdown.push({
      key: 'underfloor',
      label: 'Ogrzewanie podłogowe na całej powierzchni',
      formula: `${footprintM2} m² × ${formatPln(r.podlogowka)}/m²`,
      netPln: Math.round(footprintM2 * r.podlogowka),
    });
  }
  const heatersCount = Math.max(0, Math.round(Number(rawInput.heatersCount) || 0));
  if (heatersCount > 0) {
    breakdown.push({
      key: 'heaters',
      label: `Grzejniki elektryczne WiFi 1.5 kW (${heatersCount} szt.)`,
      formula: `${heatersCount} szt. × ${formatPln(r.grzejnik)}`,
      netPln: heatersCount * r.grzejnik,
    });
  }
  const acCount = Math.max(0, Math.round(Number(rawInput.acCount) || 0));
  if (acCount > 0) {
    breakdown.push({
      key: 'ac',
      label: `Klimatyzacja z funkcją grzania (${acCount} szt.)`,
      formula: `${acCount} szt. × ${formatPln(r.klima)}`,
      netPln: acCount * r.klima,
    });
  }
  if (rawInput.underfloorHeating === null && heatersCount === 0 && acCount === 0) {
    missingQuestions.push(
      `Ogrzewanie: podłogówka (${formatPln(r.podlogowka)}/m²), grzejniki WiFi (${formatPln(r.grzejnik)}/szt.) lub klimatyzacja (${formatPln(r.klima)}/szt.)`
    );
  }

  // Łazienka
  const bath = rawInput.bathroom ?? null;
  if (bath === 'podstawowy' || bath === 'premium') {
    const bPrice = bath === 'premium' ? r.lazPrem : r.lazBase;
    breakdown.push({
      key: 'bathroom',
      label: bath === 'premium' ? 'Łazienka — Pakiet Premium' : 'Łazienka — Pakiet Podstawowy',
      formula: 'kompletne wykończenie z białym montażem',
      netPln: bPrice,
    });
  } else if (!bath) {
    missingQuestions.push(
      `Wykończenie łazienki: Pakiet Podstawowy (${formatPln(r.lazBase)}) czy Premium (${formatPln(r.lazPrem)})`
    );
  }

  // Kuchnia i umeblowanie
  const kitchen = rawInput.kitchenPkg ?? null;
  if (kitchen && kitchen !== 'none') {
    const kPrice =
      kitchen === 'kuchnia_meble'
        ? r.kuchniaPlus
        : kitchen === 'kuchnia'
          ? r.samaKuchnia
          : r.umeblowanie;
    const kLabel =
      kitchen === 'kuchnia_meble'
        ? 'Kuchnia na wymiar + podstawowe umeblowanie'
        : kitchen === 'kuchnia'
          ? 'Kuchnia na indywidualne zamówienie'
          : 'Podstawowe umeblowanie domu';
    breakdown.push({
      key: 'kitchen',
      label: kLabel,
      formula: 'cena od (pakiet meblowy)',
      netPln: kPrice,
    });
  } else if (!kitchen) {
    missingQuestions.push(
      `Kuchnia / umeblowanie: Umeblowanie (${formatPln(r.umeblowanie)}), Sama kuchnia (${formatPln(r.samaKuchnia)}) czy Komplet (${formatPln(r.kuchniaPlus)})`
    );
  }

  // Kominek
  const fireplace = rawInput.fireplace ?? null;
  if (fireplace === 'koza' || fireplace === 'przygotowanie') {
    breakdown.push({
      key: 'fireplace',
      label:
        fireplace === 'koza'
          ? 'Kominek wolnostojący typu Koza + montaż + 10 m² płytki'
          : 'Przygotowanie pod kominek (10 m² płytki ceramicznej)',
      formula: 'komplet prac wykończeniowych',
      netPln: fireplace === 'koza' ? r.kominek : r.podKominek,
    });
  }

  // Tarasy
  const covTerrace = Math.max(0, Math.round(Number(rawInput.coveredTerraceM2) || 0));
  if (covTerrace > 0) {
    breakdown.push({
      key: 'terrace_covered',
      label: `Taras zadaszony (${covTerrace} m²)`,
      formula: `${covTerrace} m² × ${formatPln(r.tarasZad)}/m²`,
      netPln: covTerrace * r.tarasZad,
    });
  }
  const openTerrace = Math.max(0, Math.round(Number(rawInput.openTerraceM2) || 0));
  if (openTerrace > 0) {
    breakdown.push({
      key: 'terrace_open',
      label: `Taras otwarty (${openTerrace} m²)`,
      formula: `${openTerrace} m² × ${formatPln(r.tarasOtw)}/m²`,
      netPln: openTerrace * r.tarasOtw,
    });
  }

  // Dach MPZP
  if (rawInput.roofAngleMpzp === true && footprintM2) {
    breakdown.push({
      key: 'roof_mpzp',
      label: 'Dostosowanie kąta nachylenia dachu do MPZP / WZ',
      formula: `${footprintM2} m² × ${formatPln(r.roofAngleMpzp)}/m²`,
      netPln: footprintM2 * r.roofAngleMpzp,
    });
  }

  // Dostawa (w Tally: 25 zł brutto/km * liczba transportów -> przeliczamy czysto na netto i brutto)
  const km = Math.max(0, Math.round(Number(rawInput.deliveryKm) || 0));
  const modules = Math.max(1, Math.round(Number(rawInput.deliveryModules) || (footprintM2 && footprintM2 > 45 ? 2 : 1)));
  if (km > 0) {
    const transportGross = km * modules * r.dostawaKm;
    const transportNet = Math.round(transportGross / 1.23);
    breakdown.push({
      key: 'delivery',
      label: `Transport z Przemyśla (${km} km × ${modules} transport/y)`,
      formula: `${km} km × ${modules} mod. × ${r.dostawaKm} zł brutto/km (ok. ${formatPln(transportGross)} brutto)`,
      netPln: transportNet,
    });
  } else {
    missingQuestions.push(
      `Lokalizacja działki / miejscowość (do wyliczenia dostawy z Przemyśla: ${r.dostawaKm} zł brutto/km × liczba modułów)`
    );
  }

  const perUnitNetPln = breakdown.reduce((sum, item) => sum + item.netPln, 0);
  const totalNetPln = perUnitNetPln * quantity;
  const vatPln = Math.round((totalNetPln * vatRate) / 100);
  const totalGrossPln = totalNetPln + vatPln;
  const altVatGross8Pln = Math.round(totalNetPln * 1.08);
  const altVatGross23Pln = Math.round(totalNetPln * 1.23);

  const isIllustrativeEstimate = areaEstimated || floorEstimated || !standard || !insulation || foundation === null;
  const assumptions: string[] = [];
  if (areaEstimated) assumptions.push(`przykładowa podstawa ${footprintM2} m²`);
  if (floorEstimated) assumptions.push(`${effectiveFloorType} (×${floorMult})`);
  if (!standard) assumptions.push(`Standard ${effectiveStd === 'deweloperski' ? 'Deweloperski' : 'NORVIL'}`);
  if (quantity > 1) assumptions.push(`ilość: ${quantity} domki`);
  const assumedSummary = isIllustrativeEstimate
    ? `Kalkulacja przykładowa i pomocnicza (niepotwierdzona przez klienta) — założenia tymczasowe: ${assumptions.join(', ')}.`
    : 'Kalkulacja oparta bezpośrednio na parametrach wskazanych przez klienta.';

  const normalizedInput: TallyQuoteInput = {
    areaM2: footprintM2,
    areaIsTotalUsable: rawInput.areaIsTotalUsable,
    areaEstimatedByBot: areaEstimated,
    floorEstimatedByBot: floorEstimated,
    quantity,
    standard,
    insulation,
    floorType: rawFloorType,
    foundation,
    architectPkg: arch,
    underfloorHeating: rawInput.underfloorHeating ?? null,
    heatersCount,
    acCount,
    bathroom: bath,
    coveredTerraceM2: covTerrace,
    openTerraceM2: openTerrace,
    deliveryKm: km,
    deliveryModules: modules,
    kitchenPkg: kitchen,
    fireplace,
    roofAngleMpzp: rawInput.roofAngleMpzp ?? null,
    vatRate,
  };

  const formattedQuoteBlock = [
    `KOSZTORYS WYLICZONY PRZEZ SILNIK TALLY (${live.formId}: "${live.formName}"):`,
    ...(isIllustrativeEstimate ? [`⚠️ ${assumedSummary}`] : []),
    ...breakdown.map(
      (b) => `• ${b.label}: ${formatPln(b.netPln)} netto (${b.formula})`
    ),
    ...(quantity > 1
      ? [
          `• Suma za 1 domek NETTO: ${formatPln(perUnitNetPln)}`,
          `• RAZEM ZA ${quantity} DOMKI NETTO: ${formatPln(totalNetPln)}`,
        ]
      : [`• RAZEM NETTO: ${formatPln(totalNetPln)}`]),
    `• Podatek VAT (${vatRate}%): ${formatPln(vatPln)}`,
    `• RAZEM BRUTTO (${vatRate}% VAT): ${formatPln(totalGrossPln)} (dla porównania: z 8% VAT = ${formatPln(altVatGross8Pln)}, z 23% VAT = ${formatPln(altVatGross23Pln)})`,
  ].join('\n');

  return {
    formId: live.formId,
    formName: live.formName,
    liveFetched: live.liveFetched,
    evaluatedAt: new Date().toISOString(),
    input: normalizedInput,
    breakdown,
    totalNetPln,
    perUnitNetPln,
    quantity,
    vatRate,
    vatPln,
    totalGrossPln,
    altVatGross8Pln,
    altVatGross23Pln,
    isIllustrativeEstimate,
    assumedSummary,
    missingQuestions,
    formattedQuoteBlock,
  };
}

export async function evaluateTallyQuote(
  rawInput: Partial<TallyQuoteInput>,
  formId = 'dWO4Oq',
  forceRefresh = true
): Promise<TallyQuoteEvaluation> {
  const live = await getLiveTallyData(formId, forceRefresh);
  return evaluateTallyQuoteFromLiveData(rawInput, live);
}
