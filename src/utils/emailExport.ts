import type { WebSource } from '../types';
import { safeHttpUrl } from '../components/SimpleMarkdown';

export interface RichEmailExportInput {
  subject?: string;
  body: string;
  companyName?: string;
  senderName?: string;
  senderRole?: string;
  webSources?: WebSource[];
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineHtml(text: string): string {
  let escaped = escapeHtml(text);

  // Markdown links [label](https://...)
  escaped = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label: string, url: string) => {
      const safe = safeHttpUrl(url);
      if (!safe) return label;
      return `<a href="${escapeHtml(safe)}" style="color:#4338ca;text-decoration:underline;">${label}</a>`;
    },
  );

  // Bare URLs not already inside href="..."
  escaped = escaped.replace(
    /(?<!href="|">)(https?:\/\/[^\s<"]+)/g,
    (rawUrl: string) => {
      const safe = safeHttpUrl(rawUrl);
      if (!safe) return rawUrl;
      return `<a href="${escapeHtml(safe)}" style="color:#4338ca;text-decoration:underline;">${escapeHtml(safe)}</a>`;
    },
  );

  // **bold**
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#0f172a;">$1</strong>');
  // `code`
  escaped = escaped.replace(
    /`([^`]+)`/g,
    '<code style="background:#f1f5f9;padding:1px 5px;border-radius:4px;font-family:Consolas,monospace;font-size:12px;">$1</code>',
  );

  return escaped;
}

export function markdownBodyToEmailHtml(rawBody: string): string {
  const lines = rawBody.replace(/\r\n/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();
    if (!line) {
      i++;
      continue;
    }

    // Markdown table
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /\|/.test(lines[i + 1] ?? '') &&
      /-{2,}/.test(lines[i + 1] ?? '')
    ) {
      const headers = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim()) {
        rows.push(
          (lines[i] ?? '')
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim()),
        );
        i++;
      }

      const ths = headers
        .map(
          (h) =>
            `<th style="border:1px solid #cbd5e1;background:#f8fafc;padding:7px 10px;text-align:left;font-size:12px;color:#0f172a;">${formatInlineHtml(h)}</th>`,
        )
        .join('');
      const trs = rows
        .map(
          (r) =>
            `<tr>${headers
              .map(
                (_h, idx) =>
                  `<td style="border:1px solid #e2e8f0;padding:6px 10px;font-size:12px;color:#334155;">${formatInlineHtml(r[idx] ?? '')}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('');

      htmlParts.push(
        `<table style="border-collapse:collapse;width:100%;margin:10px 0;font-family:'Segoe UI',Arial,sans-serif;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`,
      );
      continue;
    }

    // Heading
    const hMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (hMatch) {
      htmlParts.push(
        `<p style="margin:12px 0 6px;font-size:14px;font-weight:700;color:#0f172a;">${formatInlineHtml(hMatch[1])}</p>`,
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*•]\s+/, ''));
        i++;
      }
      htmlParts.push(
        `<ul style="margin:6px 0 10px;padding-left:20px;color:#1e293b;">${items
          .map((item) => `<li style="margin:3px 0;">${formatInlineHtml(item)}</li>`)
          .join('')}</ul>`,
      );
      continue;
    }

    // Numbered list
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+[.)]\s+/, ''));
        i++;
      }
      htmlParts.push(
        `<ol style="margin:6px 0 10px;padding-left:20px;color:#1e293b;">${items
          .map((item) => `<li style="margin:3px 0;">${formatInlineHtml(item)}</li>`)
          .join('')}</ol>`,
      );
      continue;
    }

    // Regular paragraph group
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !(lines[i] ?? '').trim().startsWith('#') &&
      !/^[-*•]\s+/.test((lines[i] ?? '').trim()) &&
      !/^\d+[.)]\s+/.test((lines[i] ?? '').trim())
    ) {
      paraLines.push((lines[i] ?? '').trim());
      i++;
    }
    htmlParts.push(
      `<p style="margin:0 0 10px;line-height:1.55;color:#1e293b;">${paraLines
        .map((pl) => formatInlineHtml(pl))
        .join('<br/>')}</p>`,
    );
  }

  return htmlParts.join('\n');
}

export async function copyRichEmailToClipboard(input: RichEmailExportInput): Promise<'rich' | 'plain'> {
  const validSources = (input.webSources ?? [])
    .map((s) => {
      const safe = safeHttpUrl(s.uri);
      return safe ? { title: s.title, uri: safe } : null;
    })
    .filter((s): s is { title: string; uri: string } => s !== null);

  const sourcesText =
    validSources.length > 0
      ? `\n\nŹródła / linki referencyjne:\n${validSources.map((s) => `- ${s.title}: ${s.uri}`).join('\n')}`
      : '';

  const plainText = input.subject?.trim()
    ? `Temat: ${input.subject.trim()}\n\n${input.body.trim()}${sourcesText}`
    : `${input.body.trim()}${sourcesText}`;

  const bodyHtml = markdownBodyToEmailHtml(input.body);
  const sourcesHtml =
    validSources.length > 0
      ? `<div style="margin-top:14px;padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;">
          <div style="font-weight:700;color:#166534;margin-bottom:4px;">Przydatne źródła do wglądu:</div>
          <ul style="margin:0;padding-left:18px;color:#14532d;">
            ${validSources
              .map(
                (s) =>
                  `<li style="margin:2px 0;"><a href="${escapeHtml(s.uri)}" style="color:#047857;text-decoration:underline;">${escapeHtml(s.title || s.uri)}</a></li>`,
              )
              .join('')}
          </ul>
        </div>`
      : '';

  const signatureHtml =
    input.senderName || input.companyName
      ? `<div style="margin-top:14px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
          ${input.senderName ? `<strong style="color:#0f172a;">${escapeHtml(input.senderName)}</strong>` : ''}
          ${input.senderRole ? ` • ${escapeHtml(input.senderRole)}` : ''}
          ${input.companyName ? `<div>${escapeHtml(input.companyName)}</div>` : ''}
        </div>`
      : '';

  const fullHtml = `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#1e293b;max-width:680px;">
    ${
      input.subject?.trim()
        ? `<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;"><strong>Temat:</strong> ${escapeHtml(input.subject.trim())}</div>`
        : ''
    }
    ${bodyHtml}
    ${sourcesHtml}
    ${signatureHtml}
  </div>`;

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([fullHtml], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return 'rich';
    } catch {
      // Fallback to plain text if browser denies rich MIME write
    }
  }

  await navigator.clipboard.writeText(plainText);
  return 'plain';
}
