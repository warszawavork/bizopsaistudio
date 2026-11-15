/**
 * Lightweight zero-dependency .docx text extractor using browser DecompressionStream.
 * Extracts plain text from word/document.xml inside a .docx ZIP archive.
 */
export async function extractTextFromDocx(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Locate ZIP local file headers (0x04034b50) for "word/document.xml"
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameStart = offset + 30;
    const nameBytes = bytes.slice(nameStart, nameStart + fileNameLen);
    const fileName = new TextDecoder().decode(nameBytes);
    const dataStart = nameStart + fileNameLen + extraLen;

    if (fileName === 'word/document.xml' && compressedSize > 0 && dataStart + compressedSize <= bytes.length) {
      const payload = bytes.slice(dataStart, dataStart + compressedSize);
      let xmlText = '';

      if (compression === 0) {
        xmlText = new TextDecoder().decode(payload);
      } else if (compression === 8 && typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([payload]).stream().pipeThrough(ds);
        xmlText = await new Response(stream).text();
      } else {
        throw new Error('Nieobsługiwana kompresja pliku .docx w tej przeglądarce.');
      }

      return xmlText
        .replace(/<\/w:p>/g, '\n')
        .replace(/<\/w:tr>/g, '\n')
        .replace(/<w:tab\/>/g, '  ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    offset = dataStart + Math.max(0, compressedSize);
  }

  throw new Error('Nie znaleziono treści dokumentu w pliku .docx.');
}
