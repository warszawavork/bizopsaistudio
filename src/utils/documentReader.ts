/// <reference types="vite/client" />
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractTextFromDocx } from './docxReader';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ScannedPdfPageImage {
  pageNum: number;
  base64: string;
  mimeType: string;
  dimensionsLabel: string;
}

export interface ParsedDocumentResult {
  fileName: string;
  kind: 'pdf_text' | 'pdf_scan' | 'docx' | 'text';
  text: string;
  charCount: number;
  pageCount?: number;
  dimensionsSummary?: string;
  scannedPages?: ScannedPdfPageImage[];
}

export interface TextChunk {
  index: number;
  total: number;
  chapterHint: string;
  text: string;
  charCount: number;
}

function pointsToMm(pt: number): number {
  return Math.round((pt * 25.4) / 72);
}

function describePageSize(widthPt: number, heightPt: number): string {
  const w = pointsToMm(widthPt);
  const h = pointsToMm(heightPt);
  const minSide = Math.min(w, h);
  const maxSide = Math.max(w, h);
  const orient = w > h ? 'pozioma' : 'pionowa';

  let format = `${w}×${h} mm`;
  if (Math.abs(minSide - 210) <= 10 && Math.abs(maxSide - 297) <= 12) format = `A4 (${w}×${h} mm)`;
  else if (Math.abs(minSide - 148) <= 10 && Math.abs(maxSide - 210) <= 12) format = `A5 (${w}×${h} mm)`;
  else if (Math.abs(minSide - 297) <= 12 && Math.abs(maxSide - 420) <= 15) format = `A3 (${w}×${h} mm)`;
  else if (Math.abs(minSide - 420) <= 15 && Math.abs(maxSide - 594) <= 18) format = `A2 (${w}×${h} mm)`;
  else if (Math.abs(minSide - 594) <= 18 && Math.abs(maxSide - 841) <= 22) format = `A1 (${w}×${h} mm)`;

  return `${format}, ${orient}`;
}

/**
 * Uniwersalny czytnik dokumentów i książek po stronie przeglądarki.
 * Obsługuje pliki PDF o dowolnych wymiarach stron (A5, A4, A3, A1, niestandardowe)
 * oraz dowolnej objętości bez trafiania w limit 4.5 MB żądań HTTP Vercel.
 */
export async function readDocumentForStudio(
  file: File,
  onProgress?: (label: string, percent: number) => void
): Promise<ParsedDocumentResult> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.docx')) {
    onProgress?.('Odczytywanie pliku Word (.docx)...', 35);
    const text = await extractTextFromDocx(file);
    onProgress?.('Gotowe', 100);
    return {
      fileName: file.name,
      kind: 'docx',
      text,
      charCount: text.length,
    };
  }

  if (
    file.type === 'text/plain' ||
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    lower.endsWith('.json')
  ) {
    onProgress?.('Wczytywanie dużego pliku tekstowego...', 45);
    const text = (await file.text()).replace(/\r\n/g, '\n').trim();
    onProgress?.('Gotowe', 100);
    return {
      fileName: file.name,
      kind: 'text',
      text,
      charCount: text.length,
    };
  }

  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    onProgress?.('Otwieranie struktury PDF...', 5);
    const buffer = await file.arrayBuffer();
    const loadingTask = getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;

    const totalPages = pdf.numPages;
    const pageTexts: string[] = [];
    const sizesSet = new Set<string>();
    const lowTextPageNums: number[] = [];

    for (let p = 1; p <= totalPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      sizesSet.add(describePageSize(viewport.width, viewport.height));

      const content = await page.getTextContent();
      let lastY: number | null = null;
      let pageBuf = '';

      for (const item of content.items) {
        if (!('str' in item)) continue;
        const str = item.str;
        const transform = Array.isArray(item.transform) ? item.transform : null;
        const currentY = transform && typeof transform[5] === 'number' ? transform[5] : null;

        if (lastY !== null && currentY !== null && Math.abs(lastY - currentY) > 4) {
          pageBuf += '\n';
        } else if (pageBuf && !pageBuf.endsWith(' ') && !pageBuf.endsWith('\n') && str && !str.startsWith(' ')) {
          pageBuf += ' ';
        }

        pageBuf += str;
        if ('hasEOL' in item && item.hasEOL) {
          pageBuf += '\n';
        }
        if (currentY !== null) {
          lastY = currentY;
        }
      }

      const cleanedPage = pageBuf
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (cleanedPage.length < 40) {
        lowTextPageNums.push(p);
      }
      pageTexts.push(`[Strona ${p}/${totalPages}]\n${cleanedPage}`);

      if (p === 1 || p % 5 === 0 || p === totalPages) {
        onProgress?.(
          `Czytanie stron PDF: ${p} / ${totalPages}...`,
          Math.min(85, Math.round((p / totalPages) * 80) + 5)
        );
      }
    }

    const joinedText = pageTexts
      .filter((t) => t.replace(/\[Strona \d+\/\d+\]/, '').trim().length > 0)
      .join('\n\n')
      .trim();

    const avgChars = joinedText.length / Math.max(1, totalPages);
    const isScan = joinedText.length < 120 || avgChars < 45 || lowTextPageNums.length > totalPages * 0.7;

    let scannedPages: ScannedPdfPageImage[] | undefined;

    if (isScan && typeof document !== 'undefined') {
      const pagesToRender = totalPages <= 24 ? Array.from({ length: totalPages }, (_, i) => i + 1) : Array.from({ length: 24 }, (_, i) => i + 1);
      scannedPages = [];
      for (let i = 0; i < pagesToRender.length; i++) {
        const pageNum = pagesToRender[i];
        onProgress?.(
          `Wykryto skan / grafikę — adaptacyjne renderowanie strony ${pageNum} z ${pagesToRender.length}...`,
          Math.min(96, Math.round(((i + 1) / pagesToRender.length) * 35) + 60)
        );
        const page = await pdf.getPage(pageNum);
        const baseVp = page.getViewport({ scale: 1 });
        // Adaptacyjna skala dla dowolnych wymiarów (A5, A4, A3, A0) -> dłuższy bok max 1450px
        const longest = Math.max(baseVp.width, baseVp.height, 1);
        const targetLongest = 1450;
        const scale = Math.min(2.2, Math.max(0.5, targetLongest / longest));
        const renderVp = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(renderVp.width));
        canvas.height = Math.max(1, Math.round(renderVp.height));

        await page.render({ canvas, viewport: renderVp }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

        scannedPages.push({
          pageNum,
          base64,
          mimeType: 'image/jpeg',
          dimensionsLabel: describePageSize(baseVp.width, baseVp.height),
        });
      }
    }

    const dimsArray = Array.from(sizesSet).slice(0, 3);
    const dimensionsSummary =
      dimsArray.length === 1
        ? dimsArray[0]
        : `${dimsArray.join(' / ')}${sizesSet.size > 3 ? ` (+${sizesSet.size - 3} formaty)` : ''}`;

    onProgress?.('PDF wczytany pomyślnie', 100);
    return {
      fileName: file.name,
      kind: isScan ? 'pdf_scan' : 'pdf_text',
      text: joinedText,
      charCount: joinedText.length,
      pageCount: totalPages,
      dimensionsSummary,
      scannedPages,
    };
  }

  throw new Error('Nieobsługiwany format pliku do odczytu tekstowego.');
}

const CHAPTER_HEADING_RE =
  /^(#{1,4}\s+.+|(ROZDZIAŁ|Rozdział|CHAPTER|Chapter|CZĘŚĆ|Część|PART|Part|DZIAŁ|Dział|SEKCJA|Sekcja)\s+[0-9IVXLC]+.*|§\s*\d+.*|Art\.\s*\d+.*|[0-9]{1,2}\.\s+[A-ZŻŹĆĄŚĘŁÓŃ][^\n]{4,80})$/;

/**
 * Dzieli książki i obszerne teksty na logiczne części według rozdziałów i akapitów,
 * żeby AI dokładnie ustrukturyzowało całą treść bez gubienia detali.
 */
export function chunkBookOrLargeText(rawText: string, maxChunkChars = 16000): TextChunk[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChunkChars) {
    const firstHeading =
      normalized
        .split('\n')
        .map((l) => l.trim())
        .find((l) => CHAPTER_HEADING_RE.test(l) || (l.length >= 4 && l.length <= 75)) || 'Cały dokument';
    return [
      {
        index: 0,
        total: 1,
        chapterHint: firstHeading.slice(0, 80),
        text: normalized,
        charCount: normalized.length,
      },
    ];
  }

  // Najpierw spróbuj wydzielić sekcje według wykrytych nagłówków rozdziałów
  const lines = normalized.split('\n');
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle = 'Wstęp / Początek materiału';
  let buffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (CHAPTER_HEADING_RE.test(trimmed) && buffer.join('\n').trim().length > 400) {
      sections.push({ title: currentTitle, body: buffer.join('\n').trim() });
      currentTitle = trimmed.replace(/^#+\s*/, '').slice(0, 80);
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length > 0) {
    sections.push({ title: currentTitle, body: buffer.join('\n').trim() });
  }

  // Złóż sekcje w zbilansowane paczki <= maxChunkChars (dzieląc zbyt długie sekcje po akapitach)
  const rawChunks: Array<{ chapterHint: string; text: string }> = [];
  let accTitle = '';
  let accBody = '';

  const flushAcc = () => {
    if (accBody.trim()) {
      rawChunks.push({
        chapterHint: accTitle || 'Sekcja materiału',
        text: accBody.trim(),
      });
    }
    accTitle = '';
    accBody = '';
  };

  for (const sec of sections) {
    if (!sec.body.trim()) continue;
    if (sec.body.length > maxChunkChars) {
      flushAcc();
      const paragraphs = sec.body.split(/\n{2,}/);
      let partIdx = 1;
      let pBuf = '';
      for (const para of paragraphs) {
        if (pBuf.length + para.length + 2 > maxChunkChars && pBuf.trim()) {
          rawChunks.push({
            chapterHint: `${sec.title} (cz. ${partIdx++})`.slice(0, 80),
            text: pBuf.trim(),
          });
          pBuf = para;
        } else {
          pBuf = pBuf ? `${pBuf}\n\n${para}` : para;
        }
      }
      if (pBuf.trim()) {
        rawChunks.push({
          chapterHint: (partIdx > 1 ? `${sec.title} (cz. ${partIdx})` : sec.title).slice(0, 80),
          text: pBuf.trim(),
        });
      }
      continue;
    }

    if (accBody.length + sec.body.length + 2 > maxChunkChars && accBody.trim()) {
      flushAcc();
    }
    accTitle = accTitle ? `${accTitle} / ${sec.title}`.slice(0, 80) : sec.title;
    accBody = accBody ? `${accBody}\n\n${sec.body}` : sec.body;
  }
  flushAcc();

  return rawChunks.map((c, idx) => ({
    index: idx,
    total: rawChunks.length,
    chapterHint: c.chapterHint,
    text: c.text,
    charCount: c.text.length,
  }));
}

/**
 * Automatycznie zmniejsza i kompresuje zbyt duże zdjęcia przed wysłaniem do API,
 * aby zapobiec błędom przekroczenia rozmiaru (413) i timeoutom Gemini Vision.
 */
export async function compressImageForUpload(
  file: File,
  maxDimension = 1600,
  quality = 0.85,
): Promise<{ base64: string; mimeType: string; sizeKb: number }> {
  const rawBufferPromise = () =>
    new Promise<{ base64: string; mimeType: string; sizeKb: number }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || '');
        const b64 = res.includes(',') ? res.split(',')[1] : res;
        resolve({
          base64: b64,
          mimeType: file.type || 'image/jpeg',
          sizeKb: Math.max(1, Math.round(file.size / 1024)),
        });
      };
      reader.onerror = () => reject(reader.error || new Error('Nie udało się odczytać obrazu.'));
      reader.readAsDataURL(file);
    });

  // Małe pliki (< 1.5 MB) przechodzą bez ponownej kompresji
  if (file.size <= 1.5 * 1024 * 1024 || typeof window === 'undefined') {
    return rawBufferPromise();
  }

  return new Promise((resolve) => {
    const imgUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const longest = Math.max(img.width, img.height);
        const scale = longest > maxDimension ? maxDimension / longest : 1;
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(imgUrl);
          void rawBufferPromise().then(resolve);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1] || '';
        URL.revokeObjectURL(imgUrl);
        resolve({
          base64,
          mimeType: 'image/jpeg',
          sizeKb: Math.max(1, Math.round((base64.length * 0.75) / 1024)),
        });
      } catch {
        URL.revokeObjectURL(imgUrl);
        void rawBufferPromise().then(resolve);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(imgUrl);
      void rawBufferPromise().then(resolve);
    };
    img.src = imgUrl;
  });
}
