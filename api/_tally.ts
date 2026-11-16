export interface TallyKnowledgeTileDraft {
  title: string;
  category: string;
  visibility: 'public' | 'internal';
  priority: 'standard' | 'critical';
  content: string;
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

const TALLY_CPQ_CACHE = new Map<
  string,
  { expiresAt: number; formName: string; contextText: string; liveFetched: boolean; variablesCount: number }
>();

function formatPln(val: number): string {
  return `${val.toLocaleString('pl-PL')} zł`;
}

function buildStructuredCpqContext(
  formId: string,
  formName: string,
  vars: Map<string, number>,
  sectionMap: Array<{ section: string; items: string[] }>,
  liveFetched: boolean
): string {
  const num = (candidates: string[], fallback: number): number => {
    for (const [k, v] of vars.entries()) {
      const lower = k.toLowerCase();
      if (candidates.every((c) => lower.includes(c.toLowerCase()))) return v;
    }
    return fallback;
  };

  const dewLetn = num(['deweloperski'], 2500);
  const dewCal = num(['deweloperski', 'caloroczny'], 2650);
  const norvLetn = vars.get('priceNORVIL') ?? 3000;
  const norvCal = num(['norvil', 'caloroczny'], 3150);

  const archLetn = num(['architekt', 'letnisk'], 4500);
  const arch70 = num(['architekt', '70m2'], 16000);
  const arch120 = num(['architekt', '70-120'], 17000);
  const archPrem = num(['architekt', 'premium'], 20000);

  const fundSlupy = num(['slup'], 350);
  const fundLawy = num(['law'], 600);
  const fundPlyta = num(['plyt'], 750);

  const tarasZad = num(['taras', 'zadasony'], 1500);
  const tarasOtw = num(['taras', 'otwarty'], 1000);
  const podlogowka = num(['podlog'], 187);
  const grzejnik = num(['grejnik'], 514);
  const klima = num(['klima'], 3050);

  const lazBase = num(['lazienkabase'], 14000);
  const lazPrem = num(['lazienkapremium'], 20000);
  const umeblowanie = num(['umeblowanie'], 8000);
  const samaKuchnia = num(['sama kuchnia'], 15000);
  const kuchniaPlus = num(['kuchnia plus'], 23000);
  const kominek = num(['kominek plus'], 9500);
  const podKominek = num(['kominek'], 3300);
  const dostawaKm = num(['dostawa'], 25);

  const extraOptions = sectionMap
    .filter((s) => !/wstęp|finalizacja|podstawow/i.test(s.section))
    .map((s) => `- ${s.section}: ${s.items.slice(0, 6).join(' ').replace(/\s+/g, ' ').slice(0, 220)}`)
    .slice(0, 10);

  return [
    `OFICJALNY LIVE CENNIK I ZASADY WYCENY Z KONFIGURATORA TALLY (${formId}: "${formName}", https://tally.so/r/${formId} — ${liveFetched ? 'POBRANO NA ŻYWO' : 'PAMIĘĆ ZAPASOWA'}):`,
    'Wszystkie poniższe kwoty są kwotami NETTO (chyba że zaznaczono BRUTTO). Bot MA OBOWIĄZEK aktywnie korzystać z tych stawek przy każdej wycenie domu parterowego, z poddaszem, piętrowego i fundamentów:',
    '',
    '1. BAZA DOMU (cena za 1 m² powierzchni zabudowy podstawy × mnożnik kondygnacji):',
    `• Standard Deweloperski Letniskowy / Rekreacyjny: ${formatPln(dewLetn)}/m² netto`,
    `• Standard Deweloperski Całoroczny (WT2021): ${formatPln(dewCal)}/m² netto`,
    `• Standard NORVIL (Pod klucz) Letniskowy: ${formatPln(norvLetn)}/m² netto`,
    `• Standard NORVIL (Pod klucz) Całoroczny: ${formatPln(norvCal)}/m² netto`,
    '',
    '2. KONDYGNACJE / TYPY DOMÓW (MNOŻNIK BRYŁY):',
    '• Dom PARTEROWY (1 poziom): mnożnik × 1.0 (np. 50 m² × stawka m²)',
    '• Dom z PODDASZEM UŻYTKOWYM: mnożnik × 1.5 (np. podstawa 50 m² × 1.5 × stawka m²)',
    '• Dom PIĘTROWY PEŁNOWYMIAROWY: mnożnik × 2.0 (np. podstawa 50 m² × 2.0 × stawka m²)',
    '• WAŻNE: jeśli klient napisze np. „dom piętrowy 80 m²”, wyraźnie wskaż w wycenie czy liczone jest od podstawy 40 m² (razem 80 m² pow. po ×2.0), czy podstawa 80 m² (razem 160 m² pow. po ×2.0).',
    '',
    '3. CENNIK FUNDAMENTÓW (liczony za m² powierzchni zabudowy / przyziemia):',
    `• Bez fundamentu (po stronie inwestora): 0 zł`,
    `• Słupy fundamentowe / geo-wkręty: ${formatPln(fundSlupy)}/m² netto`,
    `• Ławy fundamentowe: ${formatPln(fundLawy)}/m² netto`,
    `• Płyta fundamentowa: ${formatPln(fundPlyta)}/m² netto`,
    '• Adnotacja: wycena fundamentu orientacyjna dla standardowych warunków gruntowych (finalnie po badaniach geotechnicznych).',
    '',
    '4. PAKIETY ARCHITEKTA (DOKUMENTACJA):',
    `• Letniskowy (zgłoszenie do 70 m²): ${formatPln(archLetn)} netto`,
    `• Mieszkalny do 70 m² (PAB, PT, zgłoszenie): ${formatPln(arch70)} netto`,
    `• Mieszkalny 70–120 m² (PAB, PT, zgłoszenie): ${formatPln(arch120)} netto`,
    `• Premium (zmiany indywidualne bryły + pełna dokumentacja): ${formatPln(archPrem)} netto`,
    '',
    '5. OGRZEWANIE, DACH MPZP, WNĘTRZE I TARASY:',
    `• Ogrzewanie podłogowe (cały dom wg m²): ${formatPln(podlogowka)}/m² netto`,
    `• Grzejnik elektryczny WiFi 1.5 kW: ${formatPln(grzejnik)}/szt. netto`,
    `• Klimatyzator (funkcja grzania/chłodzenia): ${formatPln(klima)}/szt. netto`,
    '• Zmiana kąta dachu pod MPZP / WZ: +300 zł/m² netto',
    `• Łazienka: Bez/drewno 0 zł | Pakiet Podstawowy ${formatPln(lazBase)} netto | Pakiet Premium ${formatPln(lazPrem)} netto`,
    `• Kuchnia & Meble: Samo podstawowe umeblowanie od ${formatPln(umeblowanie)} netto | Sama kuchnia na wymiar od ${formatPln(samaKuchnia)} netto | Kuchnia + podstawowe umeblowanie od ${formatPln(kuchniaPlus)} netto`,
    `• Kominek koza: Przygotowanie (10 m² płytki) ${formatPln(podKominek)} netto | Kominek z montażem + komin + płytka ${formatPln(kominek)} netto`,
    `• Tarasy: Taras zadaszony ${formatPln(tarasZad)}/m² netto | Taras otwarty ${formatPln(tarasOtw)}/m² netto`,
    '',
    '6. DOSTAWA Z PRZEMYŚLA ORAZ PODATEK VAT:',
    `• Transport modułów z Przemyśla: ${dostawaKm} zł BRUTTO/km × liczba transportów (domy do ok. 10×4,5 m = 1 transport; większe/piętrowe = 2+ transporty; po stronie klienta dźwig HDS/żuraw na działce).`,
    '• Stawki VAT: 8% VAT (budynek mieszkalny całoroczny osoby fizycznej do 300 m²) lub 23% VAT (dom rekreacyjny/letniskowy lub firma B2B). Gdy brak pewności co do celu, podaj sumę NETTO oraz oba warianty BRUTTO (8% i 23%).',
    ...(extraOptions.length > 0 ? ['', 'SKRÓT SEKCJI FORMULARZA TALLY:', ...extraOptions] : []),
  ].join('\n');
}

export async function getLiveTallyCpqContext(formId = 'dWO4Oq'): Promise<{
  contextText: string;
  formName: string;
  liveFetched: boolean;
  variablesCount: number;
}> {
  const cleanId = extractTallyFormId(formId);
  const now = Date.now();
  const cached = TALLY_CPQ_CACHE.get(cleanId);
  if (cached && cached.expiresAt > now) {
    return {
      contextText: cached.contextText,
      formName: cached.formName,
      liveFetched: cached.liveFetched,
      variablesCount: cached.variablesCount,
    };
  }

  try {
    const res = await fetch(`https://tally.so/r/${encodeURIComponent(cleanId)}`, {
      headers: { 'User-Agent': 'BizOpsAIStudio/1.0 (+live-cpq)' },
      signal: AbortSignal.timeout(5500),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const html = await res.text();
    const { formName, calcVars, sectionMap } = parseTallyNextData(html, cleanId);
    const contextText = buildStructuredCpqContext(cleanId, formName, calcVars, sectionMap, true);
    const entry = {
      expiresAt: now + 10 * 60 * 1000,
      formName,
      contextText,
      liveFetched: true,
      variablesCount: calcVars.size,
    };
    TALLY_CPQ_CACHE.set(cleanId, entry);
    return {
      contextText,
      formName,
      liveFetched: true,
      variablesCount: calcVars.size,
    };
  } catch {
    const fallbackVars = new Map<string, number>();
    const contextText = buildStructuredCpqContext(
      cleanId,
      'Kalkulator domu dla klienta FINAL',
      fallbackVars,
      [],
      false
    );
    return {
      contextText,
      formName: 'Kalkulator domu dla klienta FINAL',
      liveFetched: false,
      variablesCount: 0,
    };
  }
}
