import type { TallyQuoteEvaluation } from '../types';

export type QuoteDraftLang = 'pl' | 'en' | 'no' | 'de';

export interface QuoteFormatOptions {
  showIllustrative?: boolean;
  hideItemizedPrices?: boolean;
  includeWarsawRef?: boolean;
}

const SIGN_OFF_REGEX =
  /^(?:z\s+poważaniem|pozdrawiam|z\s+wyrazami\s+szacunku|best\s+regards|kind\s+regards|regards|sincerely|vennlig\s+hilsen|med\s+vennlig\s+hilsen|mit\s+freundlichen\s+grüßen|beste\s+grüße)\b/i;

function resolveOptions(opt?: boolean | QuoteFormatOptions): QuoteFormatOptions {
  if (typeof opt === 'boolean') return { showIllustrative: opt };
  return opt ?? {};
}

export function formatPureTallyQuoteText(
  quote: TallyQuoteEvaluation,
  lang: QuoteDraftLang = 'pl',
  optionsOrIllustrative?: boolean | QuoteFormatOptions
): string {
  if (!quote || quote.breakdown.length === 0) return '';

  const opts = resolveOptions(optionsOrIllustrative);
  const isEn = lang === 'en' || lang === 'no' || lang === 'de';
  const isIllustrative = opts.showIllustrative ?? Boolean(quote.isIllustrativeEstimate);
  const hideItemized = Boolean(opts.hideItemizedPrices);
  const includeWarsaw = opts.includeWarsawRef ?? Boolean(quote.warsawSlabReference);
  const qty = Math.max(1, quote.quantity || 1);
  const perUnitNet = quote.perUnitNetPln || Math.round(quote.totalNetPln / qty);

  const header = isEn
    ? isIllustrative
      ? `Illustrative & Helper Cost Estimate — UNCONFIRMED by client (Tally ${quote.formId}):`
      : `Estimated Cost Breakdown (Tally Configurator ${quote.formId}):`
    : isIllustrative
      ? `⚠️ KALKULACJA PRZYKŁADOWA I POMOCNICZA (niepotwierdzona przez klienta — Konfigurator Tally ${quote.formId}):`
      : hideItemized
        ? `Podsumowanie zakresu i cena końcowa (Tally ${quote.formId}):`
        : `Orientacyjny kosztorys (Konfigurator Tally ${quote.formId}):`;

  const assumptionLine =
    isIllustrative && quote.assumedSummary
      ? isEn
        ? 'Assumed helper parameters: please confirm your final dimensions & options above.'
        : quote.assumedSummary
      : '';

  const lines = quote.breakdown.map((item) => {
    if (hideItemized) {
      return `• ${item.label}`;
    }
    const netFormatted = item.netPln.toLocaleString('pl-PL');
    return isEn
      ? `• ${item.label}: ${netFormatted} PLN net (${item.formula})`
      : `• ${item.label}: ${netFormatted} zł netto (${item.formula})`;
  });

  const quantityLines =
    qty > 1
      ? isEn
        ? hideItemized
          ? [
              `• Package scope: ${qty} homes`,
              `• Final Total NET (${qty} homes): ${quote.totalNetPln.toLocaleString('pl-PL')} PLN`,
            ]
          : [
              `• Cost per 1 house NET: ${perUnitNet.toLocaleString('pl-PL')} PLN`,
              `• Total for ${qty} houses NET: ${quote.totalNetPln.toLocaleString('pl-PL')} PLN`,
            ]
        : hideItemized
          ? [
              `• Pakiet obejmuje: ${qty} domki`,
              `• Cena końcowa NETTO (${qty} domki): ${quote.totalNetPln.toLocaleString('pl-PL')} zł`,
            ]
          : [
              `• Razem za 1 domek NETTO: ${perUnitNet.toLocaleString('pl-PL')} zł`,
              `• RAZEM ZA ${qty} DOMKI NETTO: ${quote.totalNetPln.toLocaleString('pl-PL')} zł`,
            ]
      : [
          isEn
            ? `• Final Total NET: ${quote.totalNetPln.toLocaleString('pl-PL')} PLN`
            : `• ${hideItemized ? 'Cena końcowa NETTO' : 'Razem NETTO'}: ${quote.totalNetPln.toLocaleString('pl-PL')} zł`,
        ];

  const ref = quote.warsawSlabReference;
  const warsawRefLine =
    includeWarsaw && ref
      ? isEn
        ? `• Reference example (with concrete slab foundation & delivery to Warsaw ~${ref.distanceKm} km from Przemyśl): approx. ${ref.totalWithWarsawSlabNetPln.toLocaleString('pl-PL')} PLN net / ${ref.totalWithWarsawSlabGrossPln.toLocaleString('pl-PL')} PLN gross`
        : hideItemized
          ? `• Przykład końcowy (dom na płycie fundamentowej + dostawa do Warszawy ~${ref.distanceKm} km z Przemyśla): ok. ${ref.totalWithWarsawSlabNetPln.toLocaleString('pl-PL')} zł netto / ${ref.totalWithWarsawSlabGrossPln.toLocaleString('pl-PL')} zł brutto`
          : `• Przykład końcowy z dostawą do Warszawy (~${ref.distanceKm} km z Przemyśla) na płycie fundamentowej: ok. ${ref.totalWithWarsawSlabNetPln.toLocaleString('pl-PL')} zł netto / ${ref.totalWithWarsawSlabGrossPln.toLocaleString('pl-PL')} zł brutto (transport ${ref.transportGrossPln.toLocaleString('pl-PL')} zł brutto${ref.slabIncludedAlready ? ', płyta fundamentowa już w cenie' : ` + płyta ${ref.extraSlabNetPln.toLocaleString('pl-PL')} zł netto`})`
      : '';

  const totals = isEn
    ? [
        ...quantityLines,
        `• VAT (${quote.vatRate}%): ${quote.vatPln.toLocaleString('pl-PL')} PLN`,
        `• Final Total GROSS: ${quote.totalGrossPln.toLocaleString('pl-PL')} PLN`,
        ...(warsawRefLine ? ['', warsawRefLine] : []),
        '',
        isIllustrative
          ? '*Disclaimer: This calculation is strictly an unconfirmed illustrative helper estimate to give you an initial reference point until you answer the questions above.*'
          : '*Note: preliminary estimate based on selected parameters; final pricing is confirmed after technical and soil verification.*',
      ]
    : [
        ...quantityLines,
        `• Podatek VAT (${quote.vatRate}%): ${quote.vatPln.toLocaleString('pl-PL')} zł`,
        `• ${hideItemized ? 'CENA KOŃCOWA BRUTTO' : 'Razem BRUTTO'}: ${quote.totalGrossPln.toLocaleString('pl-PL')} zł`,
        ...(warsawRefLine ? ['', warsawRefLine] : []),
        '',
        isIllustrative
          ? 'Uwaga: powyższa kalkulacja jest wyliczeniem przykładowym (niepotwierdzonym przez Państwa) i ma wyłącznie charakter orientacyjnej pomocy dla klienta do czasu odpowiedzi na powyższe pytania.'
          : 'Uwaga: wycena ma charakter orientacyjny na bazie parametrów z konfiguratora i wymaga finalnego potwierdzenia technicznego oraz geotechnicznego.',
      ];

  return [header, assumptionLine, ...lines, '', ...totals].filter((l, idx) => l !== '' || idx > 0).join('\n');
}

export function stitchReplyAndTallyQuote(
  baseBody: string,
  quote: TallyQuoteEvaluation,
  lang: QuoteDraftLang = 'pl',
  optionsOrIllustrative?: boolean | QuoteFormatOptions
): string {
  const cleanBase = baseBody.trim();
  const quoteBlock = formatPureTallyQuoteText(quote, lang, optionsOrIllustrative);
  if (!quoteBlock) return cleanBase;
  if (!cleanBase) return quoteBlock;

  const lines = cleanBase.split('\n');
  const signOffIdx = lines.findIndex((line) => SIGN_OFF_REGEX.test(line.trim()));

  if (signOffIdx > 0) {
    const before = lines.slice(0, signOffIdx).join('\n').trimEnd();
    const after = lines.slice(signOffIdx).join('\n').trimStart();
    return `${before}\n\n${quoteBlock}\n\n${after}`;
  }

  return `${cleanBase}\n\n${quoteBlock}`;
}
