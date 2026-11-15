import { jsPDF } from 'jspdf';
import type { AuditResult, ChatMessage, WebSource } from '../types';
import { escapeHtml, markdownBodyToEmailHtml } from './emailExport';
import { safeHttpUrl } from '../components/SimpleMarkdown';

let cachedRegularBase64: string | null = null;
let cachedBoldBase64: string | null = null;

async function fetchFontAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nie udało się pobrać czcionki ${url}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function ensurePolishFonts(doc: jsPDF): Promise<boolean> {
  try {
    if (!cachedRegularBase64) {
      cachedRegularBase64 = await fetchFontAsBase64('/fonts/Roboto-Regular.ttf');
    }
    if (!cachedBoldBase64) {
      cachedBoldBase64 = await fetchFontAsBase64('/fonts/Roboto-Bold.ttf');
    }
    doc.addFileToVFS('Roboto-Regular.ttf', cachedRegularBase64);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFileToVFS('Roboto-Bold.ttf', cachedBoldBase64);
    doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
    doc.setFont('Roboto', 'normal');
    return true;
  } catch {
    return false;
  }
}

interface PdfHeaderOptions {
  title: string;
  subtitle: string;
  metaLine?: string;
  fontFamily: string;
  accentRgb?: [number, number, number];
}

function drawPdfHeader(doc: jsPDF, opts: PdfHeaderOptions): number {
  const pageWidth = 210;
  const margin = 16;
  const barHeight = opts.metaLine ? 31 : 25;
  const accent = opts.accentRgb ?? [79, 70, 229];

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, barHeight, 'F');
  doc.setFillColor(...accent);
  doc.rect(0, barHeight, pageWidth, 1.5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont(opts.fontFamily, 'bold');
  doc.setFontSize(14.5);
  doc.text(opts.title, margin, 12.5);

  doc.setFont(opts.fontFamily, 'normal');
  doc.setFontSize(9.2);
  doc.setTextColor(203, 213, 225);
  doc.text(opts.subtitle, margin, 19.5);

  if (opts.metaLine) {
    doc.text(opts.metaLine, margin, 25.5);
  }

  return barHeight + 9.5;
}

function drawPdfPageFooters(doc: jsPDF, fontFamily: string, companyName: string): void {
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(16, 285, 194, 285);
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Wygenerowano przez BizOps AI Studio • ${companyName}`, 16, 290);
    doc.text(`Strona ${p} z ${totalPages}`, 194, 290, { align: 'right' });
  }
}

function stripMarkdownForPdf(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,4}\s+/gm, '')
    .trim();
}

export async function exportAuditToPdf(audit: AuditResult, companyName: string): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const hasRoboto = await ensurePolishFonts(doc);
  const fontFamily = hasRoboto ? 'Roboto' : 'helvetica';

  const pageWidth = 210;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  let y = drawPdfHeader(doc, {
    title: 'RAPORT AUDYTU AI — BizOps AI Studio',
    subtitle: `Profil firmy: ${companyName}   |   Dokument: ${audit.fileName}`,
    metaLine: `Data analizy: ${new Date(audit.createdAt).toLocaleString('pl-PL')}   |   Model: Gemini 3.8 Flash`,
    fontFamily,
  });

  const ensureSpace = (needed: number) => {
    if (y + needed > 280) {
      doc.addPage();
      y = 18;
    }
  };

  // Score & Metadata Summary Box
  const scoreColor: [number, number, number] =
    audit.riskLevel === 'LOW' ? [5, 150, 105] : audit.riskLevel === 'MEDIUM' ? [217, 119, 6] : [225, 29, 72];

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 24, 3, 3, 'FD');

  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`${audit.documentType} — ${audit.clientOrSender}`, margin + 5, y + 8);

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  const summaryLines = doc.splitTextToSize(audit.summary, contentWidth - 46) as string[];
  doc.text(summaryLines.slice(0, 2), margin + 5, y + 14.5);

  doc.setFillColor(...scoreColor);
  doc.roundedRect(pageWidth - margin - 34, y + 4, 30, 16, 2.5, 2.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(14);
  doc.text(`${audit.score}%`, pageWidth - margin - 19, y + 12.5, { align: 'center' });
  doc.setFontSize(7.5);
  doc.text(`RYZYKO: ${audit.riskLevel}`, pageWidth - margin - 19, y + 17.5, { align: 'center' });

  y += 32;

  // Section 1: Extracted Fields
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Wyodrębnione parametry kluczowe', margin, y);
  y += 6;

  for (const field of audit.extractedFields) {
    ensureSpace(10);
    const statusLabel = field.status === 'ok' ? 'OK' : field.status === 'warning' ? 'UWAGA' : 'BRAK';
    const badgeColor: [number, number, number] =
      field.status === 'ok' ? [16, 185, 129] : field.status === 'warning' ? [245, 158, 11] : [244, 63, 94];

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.rect(margin, y, contentWidth, 8, 'FD');

    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(field.label, margin + 3, y + 5.3);

    doc.setFont(fontFamily, 'normal');
    doc.setTextColor(15, 23, 42);
    const valClipped = field.value.length > 52 ? `${field.value.slice(0, 49)}...` : field.value;
    doc.text(valClipped, margin + 62, y + 5.3);

    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...badgeColor);
    doc.text(statusLabel, pageWidth - margin - 4, y + 5.3, { align: 'right' });

    y += 8;
  }

  y += 8;

  // Section 2: Findings
  ensureSpace(16);
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Wyniki audytu zgodności z bazą wiedzy', margin, y);
  y += 6;

  for (const finding of audit.findings) {
    const detailLines = doc.splitTextToSize(`${finding.detail} (Reguła: ${finding.ruleRef})`, contentWidth - 10) as string[];
    const blockH = 9 + detailLines.length * 4.5;
    ensureSpace(blockH + 3);

    const stripeColor: [number, number, number] =
      finding.severity === 'ok' ? [16, 185, 129] : finding.severity === 'warning' ? [245, 158, 11] : [225, 29, 72];

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentWidth, blockH, 2, 2, 'FD');
    doc.setFillColor(...stripeColor);
    doc.rect(margin, y, 2.2, blockH, 'F');

    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(finding.title, margin + 6, y + 5.5);

    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(8.8);
    doc.setTextColor(71, 85, 105);
    doc.text(detailLines, margin + 6, y + 10.5);

    y += blockH + 3;
  }

  y += 6;

  // Section 3: Recommended Email Draft
  ensureSpace(26);
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Rekomendowana odpowiedź do klienta / nadawcy', margin, y);
  y += 6;

  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(79, 70, 229);
  doc.text(`Temat: ${audit.recommendedReplySubject}`, margin, y);
  y += 5;

  const replyLines = doc.splitTextToSize(audit.recommendedReplyBody, contentWidth - 8) as string[];
  const boxHeight = Math.min(90, replyLines.length * 4.5 + 8);
  ensureSpace(boxHeight);

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, boxHeight, 2, 2, 'FD');
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(replyLines, margin + 4, y + 6);

  const safeName = audit.fileName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  doc.save(`Raport_Audytu_AI_${safeName}.pdf`);
}

export interface OfferPdfInput {
  quoteNumber: string;
  companyName: string;
  clientName: string;
  title: string;
  netPln: number;
  discountPercent: number;
  vatRate: 8 | 23;
  notes: string;
}

export async function exportOfferToPdf(offer: OfferPdfInput): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const hasRoboto = await ensurePolishFonts(doc);
  const fontFamily = hasRoboto ? 'Roboto' : 'helvetica';

  const pageWidth = 210;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;

  const discountedNet = Math.round(offer.netPln * (1 - offer.discountPercent / 100));
  const vatAmount = Math.round(discountedNet * (offer.vatRate / 100));
  const grossPln = discountedNet + vatAmount;
  const requiresMpp = grossPln >= 15000;

  let y = drawPdfHeader(doc, {
    title: 'KOSZTORYS OFERTOWY / PROFORMA',
    subtitle: `NR DOKUMENTU: ${offer.quoteNumber}`,
    metaLine: `Wystawca: ${offer.companyName}   |   Data: ${new Date().toLocaleDateString('pl-PL')}`,
    fontFamily,
    accentRgb: [245, 158, 11],
  });

  // Client Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 24, 3, 3, 'FD');

  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text('NABYWCA / INWESTOR:', margin + 5, y + 7.5);
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(offer.clientName, margin + 5, y + 14.5);
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Przedmiot wyceny: ${offer.title}`, margin + 5, y + 20.5);

  y += 33;

  // Financial Breakdown Table
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Zestawienie finansowe wyceny', margin, y);
  y += 6;

  const rows: Array<[string, string]> = [
    ['Wartość bazowa netto:', `${offer.netPln.toLocaleString('pl-PL')} PLN`],
    ['Rabat handlowy:', `${offer.discountPercent}% (-${(offer.netPln - discountedNet).toLocaleString('pl-PL')} PLN)`],
    ['Wartość netto po rabacie:', `${discountedNet.toLocaleString('pl-PL')} PLN`],
    [`Podatek VAT (${offer.vatRate}%):`, `${vatAmount.toLocaleString('pl-PL')} PLN`],
    ['WARTOŚĆ KOŃCOWA BRUTTO:', `${grossPln.toLocaleString('pl-PL')} PLN`],
  ];

  for (let i = 0; i < rows.length; i++) {
    const isTotal = i === rows.length - 1;
    doc.setFillColor(isTotal ? 238 : 255, isTotal ? 242 : 255, isTotal ? 255 : 255);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, contentWidth, 9, 'FD');

    doc.setFont(fontFamily, isTotal ? 'bold' : 'normal');
    doc.setFontSize(isTotal ? 10.5 : 9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(rows[i][0], margin + 4, y + 6);

    doc.setFont(fontFamily, 'bold');
    doc.text(rows[i][1], pageWidth - margin - 4, y + 6, { align: 'right' });
    y += 9;
  }

  y += 10;

  // Split Payment & Tranches
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(11.5);
  doc.text('2. Warunki płatności i harmonogram transz (30 / 40 / 30)', margin, y);
  y += 6;

  const t1 = Math.round(grossPln * 0.3);
  const t2 = Math.round(grossPln * 0.4);
  const t3 = grossPln - t1 - t2;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 30, 2.5, 2.5, 'FD');

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`• Transza I (30% — rezerwacja mocy produkcyjnych / start): ${t1.toLocaleString('pl-PL')} PLN brutto`, margin + 5, y + 8);
  doc.text(`• Transza II (40% — gotowość do wysyłki z zakładu): ${t2.toLocaleString('pl-PL')} PLN brutto`, margin + 5, y + 15);
  doc.text(`• Transza III (30% — odbiór końcowy po montażu): ${t3.toLocaleString('pl-PL')} PLN brutto`, margin + 5, y + 22);

  if (requiresMpp) {
    doc.setFont(fontFamily, 'bold');
    doc.setTextColor(217, 119, 6);
    doc.text('Adnotacja ustawowa: Mechanizm Podzielonej Płatności (Split Payment / MPP) — kwota pow. 15 000 PLN.', margin + 5, y + 27.5);
  }

  y += 38;

  if (offer.notes.trim()) {
    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('3. Uwagi techniczne i operacyjne AI', margin, y);
    y += 5;

    const noteLines = doc.splitTextToSize(offer.notes, contentWidth - 8) as string[];
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentWidth, Math.max(20, noteLines.length * 5 + 8), 2, 2, 'FD');
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(noteLines, margin + 4, y + 6);
  }

  doc.save(`Oferta_${offer.quoteNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
}

export interface SalesReplyPdfInput {
  companyName: string;
  senderName?: string;
  senderRole?: string;
  clientLabel?: string;
  subject: string;
  body: string;
  webSources?: WebSource[];
}

export async function exportSalesReplyToPdf(input: SalesReplyPdfInput): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const hasRoboto = await ensurePolishFonts(doc);
  const fontFamily = hasRoboto ? 'Roboto' : 'helvetica';

  const pageWidth = 210;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const nowStr = new Date().toLocaleString('pl-PL');

  let y = drawPdfHeader(doc, {
    title: 'OFERTA / ODPOWIEDŹ HANDLOWA',
    subtitle: `${input.companyName}${input.clientLabel ? `   |   Adresat: ${input.clientLabel}` : ''}`,
    metaLine: `Data przygotowania: ${nowStr}${input.senderName ? `   |   Opiekun: ${input.senderName}` : ''}`,
    fontFamily,
    accentRgb: [16, 185, 129],
  });

  // Subject box
  const subjectLines = doc.splitTextToSize(`Temat: ${input.subject || '(Brak tematu)'}`, contentWidth - 10) as string[];
  const subjectBoxH = subjectLines.length * 5.2 + 8;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, subjectBoxH, 2.5, 2.5, 'FD');

  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(subjectLines, margin + 5, y + 6.5);
  y += subjectBoxH + 8;

  // Body lines with page break support
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);

  const paragraphs = stripMarkdownForPdf(input.body).split('\n');
  for (const para of paragraphs) {
    if (!para.trim()) {
      y += 3.5;
      continue;
    }
    const wrapped = doc.splitTextToSize(para, contentWidth) as string[];
    for (const line of wrapped) {
      if (y > 274) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, margin, y);
      y += 5;
    }
    y += 1.5;
  }

  // Verified external sources section
  const validSources = (input.webSources ?? [])
    .map((s) => ({ title: s.title, uri: safeHttpUrl(s.uri) }))
    .filter((s): s is { title: string; uri: string } => s.uri !== null);

  if (validSources.length > 0) {
    if (y > 245) {
      doc.addPage();
      y = 18;
    } else {
      y += 6;
    }
    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(4, 120, 87);
    doc.text('Zweryfikowane źródła i dokumentacja zewnętrzna:', margin, y);
    y += 5.5;

    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(8.8);
    doc.setTextColor(51, 65, 85);
    for (const src of validSources) {
      const lines = doc.splitTextToSize(`• ${src.title}: ${src.uri}`, contentWidth) as string[];
      if (y + lines.length * 4.5 > 274) {
        doc.addPage();
        y = 18;
      }
      doc.text(lines, margin, y);
      y += lines.length * 4.5 + 1.5;
    }
  }

  drawPdfPageFooters(doc, fontFamily, input.companyName);
  const safeName = (input.clientLabel || input.subject || 'Odpowiedz')
    .slice(0, 36)
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Odpowiedz_${safeName}.pdf`);
}

export interface ChatTranscriptPdfInput {
  companyName: string;
  presetName: string;
  perspectiveLabel?: string;
  messages: ChatMessage[];
}

export async function exportChatTranscriptToPdf(input: ChatTranscriptPdfInput): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const hasRoboto = await ensurePolishFonts(doc);
  const fontFamily = hasRoboto ? 'Roboto' : 'helvetica';

  const pageWidth = 210;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;

  let y = drawPdfHeader(doc, {
    title: 'RAPORT KONSULTACJI BIZOPS AI',
    subtitle: `Profil: ${input.companyName}   |   Branża: ${input.presetName}`,
    metaLine: `Eksport: ${new Date().toLocaleString('pl-PL')}${input.perspectiveLabel ? `   |   Tryb: ${input.perspectiveLabel}` : ''}   |   Wiadomości: ${input.messages.length}`,
    fontFamily,
    accentRgb: [79, 70, 229],
  });

  for (const msg of input.messages) {
    if (y > 264) {
      doc.addPage();
      y = 18;
    }

    const isUser = msg.role === 'user';
    const timeStr = new Date(msg.timestamp).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    });

    // Role banner
    doc.setFillColor(isUser ? 241 : 238, isUser ? 245 : 242, isUser ? 249 : 255);
    doc.roundedRect(margin, y, contentWidth, 7, 1.5, 1.5, 'F');
    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(isUser ? 51 : 67, isUser ? 65 : 56, isUser ? 85 : 202);
    doc.text(
      `${isUser ? 'PYTANIE UŻYTKOWNIKA' : 'ANALIZA BIZOPS AI'}   •   ${timeStr}`,
      margin + 3,
      y + 4.8,
    );
    y += 10;

    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 41, 59);
    const cleanedLines = doc.splitTextToSize(stripMarkdownForPdf(msg.content), contentWidth) as string[];
    for (const line of cleanedLines) {
      if (y > 274) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, margin, y);
      y += 4.6;
    }

    const validSources = (msg.webSources ?? [])
      .map((s) => ({ title: s.title, uri: safeHttpUrl(s.uri) }))
      .filter((s): s is { title: string; uri: string } => s.uri !== null);

    if (!isUser && validSources.length > 0) {
      y += 1.5;
      doc.setFont(fontFamily, 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(4, 120, 87);
      if (y > 272) {
        doc.addPage();
        y = 18;
      }
      doc.text('Źródła internetowe:', margin, y);
      y += 4;
      doc.setFont(fontFamily, 'normal');
      doc.setTextColor(71, 85, 105);
      for (const src of validSources) {
        const sLines = doc.splitTextToSize(`• ${src.title}: ${src.uri}`, contentWidth) as string[];
        for (const sl of sLines) {
          if (y > 274) {
            doc.addPage();
            y = 18;
          }
          doc.text(sl, margin, y);
          y += 4;
        }
      }
    }

    y += 5;
  }

  drawPdfPageFooters(doc, fontFamily, input.companyName);
  doc.save(`Rozmowa_BizOps_AI_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export interface PrintReportInput {
  title: string;
  subtitle: string;
  bodyMarkdownOrHtml: string;
  isPreformattedHtml?: boolean;
  webSources?: WebSource[];
}

export function printCleanReportHtml(input: PrintReportInput): void {
  const safeSources = (input.webSources ?? [])
    .map((s) => ({ title: s.title, uri: safeHttpUrl(s.uri) }))
    .filter((s): s is { title: string; uri: string } => s.uri !== null);

  const bodySection = input.isPreformattedHtml
    ? input.bodyMarkdownOrHtml
    : markdownBodyToEmailHtml(input.bodyMarkdownOrHtml);

  const sourcesHtml =
    safeSources.length > 0
      ? `<div class="sources">
          <div class="sources-title">Zweryfikowane źródła zewnętrzne (Google Search)</div>
          <ul>
            ${safeSources
              .map(
                (s) =>
                  `<li><strong>${escapeHtml(s.title)}</strong> — <a href="${escapeHtml(s.uri)}">${escapeHtml(s.uri)}</a></li>`,
              )
              .join('')}
          </ul>
        </div>`
      : '';

  const htmlDoc = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.55; font-size: 13px; margin: 0; }
    .hdr { border-bottom: 2px solid #4f46e5; padding-bottom: 10px; margin-bottom: 18px; }
    .hdr h1 { margin: 0 0 4px; font-size: 18px; color: #0f172a; }
    .hdr .sub { font-size: 11.5px; color: #475569; }
    .msg { margin-bottom: 14px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; page-break-inside: avoid; }
    .msg-role { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #4338ca; margin-bottom: 6px; }
    .sources { margin-top: 18px; padding: 10px 12px; border: 1px solid #a7f3d0; background: #ecfdf5; border-radius: 8px; font-size: 11.5px; page-break-inside: avoid; }
    .sources-title { font-weight: 700; color: #065f46; margin-bottom: 5px; }
    a { color: #4338ca; word-break: break-all; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; font-size: 11.5px; }
    th { background: #f8fafc; }
    .ftr { margin-top: 22px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #64748b; }
  </style>
</head>
<body>
  <div class="hdr">
    <h1>${escapeHtml(input.title)}</h1>
    <div class="sub">${escapeHtml(input.subtitle)}</div>
  </div>
  ${bodySection}
  ${sourcesHtml}
  <div class="ftr">Wygenerowano przez BizOps AI Studio • ${escapeHtml(new Date().toLocaleString('pl-PL'))}</div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');

  const cleanup = () => {
    window.setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }, 800);
  };

  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      if (win) {
        win.focus();
        win.addEventListener('afterprint', cleanup, { once: true });
        win.print();
      }
    } finally {
      window.setTimeout(cleanup, 15000);
    }
  };

  document.body.appendChild(iframe);
  iframe.srcdoc = htmlDoc;
}

