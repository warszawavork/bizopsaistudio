import type { TallyQuoteEvaluation } from '../types';

export type QuoteDraftLang = 'pl' | 'en' | 'no' | 'de';

const SIGN_OFF_REGEX =
  /^(?:z\s+poważaniem|pozdrawiam|z\s+wyrazami\s+szacunku|best\s+regards|kind\s+regards|regards|sincerely|vennlig\s+hilsen|med\s+vennlig\s+hilsen|mit\s+freundlichen\s+grüßen|beste\s+grüße)\b/i;

export function formatPureTallyQuoteText(
  quote: TallyQuoteEvaluation,
  lang: QuoteDraftLang = 'pl'
): string {
  if (!quote || quote.breakdown.length === 0) return '';

  const isEn = lang === 'en' || lang === 'no' || lang === 'de';
  const header = isEn
    ? `Estimated Cost Breakdown (Tally Configurator ${quote.formId}):`
    : `Orientacyjny kosztorys (Konfigurator Tally ${quote.formId}):`;

  const lines = quote.breakdown.map((item) => {
    const netFormatted = item.netPln.toLocaleString('pl-PL');
    return isEn
      ? `• ${item.label}: ${netFormatted} PLN net (${item.formula})`
      : `• ${item.label}: ${netFormatted} zł netto (${item.formula})`;
  });

  const totals = isEn
    ? [
        `• Total NET: ${quote.totalNetPln.toLocaleString('pl-PL')} PLN`,
        `• VAT (${quote.vatRate}%): ${quote.vatPln.toLocaleString('pl-PL')} PLN`,
        `• Total GROSS: ${quote.totalGrossPln.toLocaleString('pl-PL')} PLN`,
        '',
        '*Note: preliminary estimate based on selected parameters; final pricing is confirmed after technical and soil verification.*',
      ]
    : [
        `• Razem NETTO: ${quote.totalNetPln.toLocaleString('pl-PL')} zł`,
        `• Podatek VAT (${quote.vatRate}%): ${quote.vatPln.toLocaleString('pl-PL')} zł`,
        `• Razem BRUTTO: ${quote.totalGrossPln.toLocaleString('pl-PL')} zł`,
        '',
        'Uwaga: wycena ma charakter orientacyjny na bazie parametrów z konfiguratora i wymaga finalnego potwierdzenia technicznego oraz geotechnicznego.',
      ];

  return [header, ...lines, '', ...totals].join('\n');
}

export function stitchReplyAndTallyQuote(
  baseBody: string,
  quote: TallyQuoteEvaluation,
  lang: QuoteDraftLang = 'pl'
): string {
  const cleanBase = baseBody.trim();
  const quoteBlock = formatPureTallyQuoteText(quote, lang);
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
