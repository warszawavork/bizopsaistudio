/**
 * Parser wiadomości ze schowka, ze szczególnym uwzględnieniem
 * formatów eksportu i kopiowania z WhatsApp (Desktop / Web / Mobile),
 * SMS oraz standardowych nagłówków mailowych.
 */

export interface ParsedClipboardMessage {
  rawText: string;
  cleanText: string;
  senderName?: string;
  timestamp?: string;
  isWhatsApp: boolean;
  detectedTopic?: string;
}

/**
 * Rozpoznaje nagłówki WhatsApp w różnych formatach:
 * - [21:40, 15.11.2026] Jan Kowalski: Wiadomość...
 * - 15.11.2026, 21:40 - Jan Kowalski: Wiadomość...
 * - 15/11/2026, 21:40 - Jan Kowalski: Wiadomość...
 * - [15.11.2026 21:40] Jan Kowalski: Wiadomość...
 * - Jan Kowalski: Wiadomość...
 */
export function parseClipboardMessage(raw: string): ParsedClipboardMessage {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { rawText: '', cleanText: '', isWhatsApp: false };
  }

  // Wzorzec 1: [21:40, 15.11.2026] Jan Kowalski: Treść
  const bracketRegex = /^\[(\d{1,2}:\d{2}(?::\d{2})?(?:,\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4})?|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}[,\s]+\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*([\s\S]+)$/i;
  const matchBracket = trimmed.match(bracketRegex);

  if (matchBracket) {
    const timestamp = matchBracket[1].trim();
    const senderName = matchBracket[2].trim();
    const cleanText = matchBracket[3].trim();
    return {
      rawText: trimmed,
      cleanText,
      senderName,
      timestamp,
      isWhatsApp: true,
      detectedTopic: extractTopicFromMessage(cleanText),
    };
  }

  // Wzorzec 2: 15.11.2026, 21:40 - Jan Kowalski: Treść
  const dashRegex = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}[,\s]+\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*([^:]+):\s*([\s\S]+)$/i;
  const matchDash = trimmed.match(dashRegex);

  if (matchDash) {
    const timestamp = matchDash[1].trim();
    const senderName = matchDash[2].trim();
    const cleanText = matchDash[3].trim();
    return {
      rawText: trimmed,
      cleanText,
      senderName,
      timestamp,
      isWhatsApp: true,
      detectedTopic: extractTopicFromMessage(cleanText),
    };
  }

  // Wzorzec 3: Prosty format "Nadawca: Treść" (jeśli pierwsza linia zawiera dwukropek i nie jest URL)
  const lines = trimmed.split('\n');
  const firstLine = lines[0].trim();
  if (!firstLine.startsWith('http') && firstLine.includes(':')) {
    const colonIdx = firstLine.indexOf(':');
    const potentialSender = firstLine.slice(0, colonIdx).trim();
    const afterColon = firstLine.slice(colonIdx + 1).trim();

    // Jeśli "nadawca" to 1-4 słowa (np. "Michał Wiśniewski" lub "+48 500 100 200")
    if (potentialSender.length >= 2 && potentialSender.length <= 40 && !potentialSender.includes('.')) {
      const remainingBody = [afterColon, ...lines.slice(1)].join('\n').trim();
      return {
        rawText: trimmed,
        cleanText: remainingBody,
        senderName: potentialSender,
        isWhatsApp: false,
        detectedTopic: extractTopicFromMessage(remainingBody),
      };
    }
  }

  return {
    rawText: trimmed,
    cleanText: trimmed,
    isWhatsApp: false,
    detectedTopic: extractTopicFromMessage(trimmed),
  };
}

function extractTopicFromMessage(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes('dom') || lower.includes('modułow') || lower.includes('35m') || lower.includes('70m')) {
    return 'Domy modułowe';
  }
  if (lower.includes('fundament') || lower.includes('płyt') || lower.includes('grunt')) {
    return 'Fundamenty';
  }
  if (lower.includes('koszt') || lower.includes('cennik') || lower.includes('ile kosztuje') || lower.includes('wycen')) {
    return 'Wycena & Cennik';
  }
  if (lower.includes('transport') || lower.includes('dostaw') || lower.includes('hds') || lower.includes('dźwig')) {
    return 'Transport i Logistyka';
  }
  if (lower.includes('leasing') || lower.includes('kredyt') || lower.includes('finansow')) {
    return 'Finansowanie';
  }
  return undefined;
}
