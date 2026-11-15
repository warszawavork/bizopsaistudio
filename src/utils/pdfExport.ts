import { jsPDF } from 'jspdf';
import type { AuditResult } from '../types';

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

export async function exportAuditToPdf(audit: AuditResult, companyName: string): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const hasRoboto = await ensurePolishFonts(doc);
  const fontFamily = hasRoboto ? 'Roboto' : 'helvetica';

  const pageWidth = 210;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  let y = 18;

  const ensureSpace = (needed: number) => {
    if (y + needed > 280) {
      doc.addPage();
      y = 18;
    }
  };

  // Top Header Bar
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 30, 'F');
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 30, pageWidth, 1.5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(15);
  doc.text('RAPORT AUDYTU AI — BizOps AI Studio', margin, 13);

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`Profil firmy: ${companyName}   |   Dokument: ${audit.fileName}`, margin, 20);
  doc.text(`Data analizy: ${new Date(audit.createdAt).toLocaleString('pl-PL')}   |   Model: Gemini 3.8 Flash`, margin, 25.5);

  y = 40;

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

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setFillColor(245, 158, 11);
  doc.rect(0, 34, pageWidth, 1.5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(16);
  doc.text(`KOSZTORYS OFERTOWY / PROFORMA`, margin, 14);
  doc.setFontSize(10);
  doc.setTextColor(251, 191, 36);
  doc.text(`NR DOKUMENTU: ${offer.quoteNumber}`, margin, 21);
  doc.setFont(fontFamily, 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(`Wystawca: ${offer.companyName}   |   Data: ${new Date().toLocaleDateString('pl-PL')}`, margin, 28);

  let y = 46;

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
