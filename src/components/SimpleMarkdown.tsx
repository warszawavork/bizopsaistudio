import React from 'react';
import { ExternalLink } from 'lucide-react';

interface SimpleMarkdownProps {
  content: string;
  className?: string;
}

export function safeHttpUrl(rawUrl: string): string | null {
  try {
    const trimmed = rawUrl.trim();
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function trimTrailingUrlPunctuation(url: string): { cleanUrl: string; trailing: string } {
  const match = url.match(/^(.*?)([.,;:!?)]+)?$/);
  if (!match) return { cleanUrl: url, trailing: '' };
  let cleanUrl = match[1] || url;
  let trailing = match[2] || '';
  // Keep balanced closing parenthesis if the URL contains an opening one (e.g. Wikipedia links)
  if (trailing.startsWith(')') && (cleanUrl.match(/\(/g)?.length || 0) > (cleanUrl.match(/\)/g)?.length || 0)) {
    cleanUrl += ')';
    trailing = trailing.slice(1);
  }
  return { cleanUrl, trailing };
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches: [label](url), **bold**, __bold__, `code`, *italic*, or bare https?:// url
  const tokenRegex =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\n]+)\*|(https?:\/\/[^\s<>"{}|\\^`[\]]+))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const tokenKey = `${keyPrefix}-${idx++}`;

    if (match[2] !== undefined && match[3] !== undefined) {
      const safe = safeHttpUrl(match[3]);
      if (safe) {
        nodes.push(
          <a
            key={tokenKey}
            href={safe}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800"
          >
            <span>{match[2]}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-75" />
          </a>,
        );
      } else {
        nodes.push(match[0]);
      }
    } else if (match[4] !== undefined || match[5] !== undefined) {
      nodes.push(
        <strong key={tokenKey} className="font-semibold text-slate-900">
          {match[4] ?? match[5]}
        </strong>,
      );
    } else if (match[6] !== undefined) {
      nodes.push(
        <code
          key={tokenKey}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-indigo-700"
        >
          {match[6]}
        </code>,
      );
    } else if (match[7] !== undefined) {
      nodes.push(
        <em key={tokenKey} className="italic">
          {match[7]}
        </em>,
      );
    } else if (match[8] !== undefined) {
      const { cleanUrl, trailing } = trimTrailingUrlPunctuation(match[8]);
      const safe = safeHttpUrl(cleanUrl);
      if (safe) {
        let shortLabel = cleanUrl.replace(/^https?:\/\/(www\.)?/, '');
        if (shortLabel.length > 48) {
          shortLabel = shortLabel.slice(0, 45) + '...';
        }
        nodes.push(
          <React.Fragment key={tokenKey}>
            <a
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              title={safe}
              className="inline-flex items-center gap-0.5 font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800 break-all"
            >
              <span>{shortLabel}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-75" />
            </a>
            {trailing}
          </React.Fragment>,
        );
      } else {
        nodes.push(match[0]);
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function splitTableRow(line: string): string[] {
  const stripped = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return stripped.split('|').map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export const SimpleMarkdown: React.FC<SimpleMarkdownProps> = ({ content, className = '' }) => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockIdx = 0;

  while (i < lines.length) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Fenced code block ```...```
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(
        <pre
          key={`code-${blockIdx++}`}
          className="my-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-[11.5px] leading-relaxed text-slate-100"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // 2. Markdown table (header line + | --- | separator)
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1] ?? '')) {
      const headers = splitTableRow(rawLine);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i] ?? '';
        if (!rowLine.trim() || !rowLine.includes('|')) break;
        rows.push(splitTableRow(rowLine));
        i++;
      }

      const key = `tbl-${blockIdx++}`;
      blocks.push(
        <div key={key} className="my-2.5 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {headers.map((h, colIdx) => (
                  <th
                    key={`${key}-h-${colIdx}`}
                    className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap"
                  >
                    {renderInline(h, `${key}-th-${colIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, rIdx) => (
                <tr key={`${key}-r-${rIdx}`} className="hover:bg-slate-50/70">
                  {headers.map((_, colIdx) => (
                    <td
                      key={`${key}-c-${rIdx}-${colIdx}`}
                      className="px-3 py-2 align-top text-slate-700"
                    >
                      {renderInline(row[colIdx] ?? '', `${key}-td-${rIdx}-${colIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 3. Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${blockIdx++}`} className="my-2.5 border-slate-200" />);
      i++;
      continue;
    }

    // 4. Headings (# ... ####)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const key = `h-${blockIdx++}`;
      const sizeClass =
        level === 1
          ? 'text-base font-bold text-slate-900 mt-3 mb-1.5'
          : level === 2
            ? 'text-[14.5px] font-bold text-slate-900 mt-2.5 mb-1'
            : 'text-[13.5px] font-semibold text-slate-900 mt-2 mb-1';
      blocks.push(
        <div key={key} className={sizeClass}>
          {renderInline(headingText, key)}
        </div>,
      );
      i++;
      continue;
    }

    // 5. Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i++;
      }
      const key = `bq-${blockIdx++}`;
      blocks.push(
        <blockquote
          key={key}
          className="my-2 rounded-r-lg border-l-3 border-indigo-400 bg-indigo-50/50 px-3 py-1.5 text-[12.5px] text-slate-700"
        >
          {quoteLines.map((ql, qi) => (
            <div key={`${key}-${qi}`}>{renderInline(ql, `${key}-i-${qi}`)}</div>
          ))}
        </blockquote>,
      );
      continue;
    }

    // 6. Unordered list (- , * , • )
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*•]\s+/, ''));
        i++;
      }
      const key = `ul-${blockIdx++}`;
      blocks.push(
        <ul key={key} className="my-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
          {items.map((item, idx) => (
            <li key={`${key}-${idx}`} className="marker:text-indigo-500">
              {renderInline(item, `${key}-li-${idx}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // 7. Ordered list (1. , 2) )
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+[.)]\s+/, ''));
        i++;
      }
      const key = `ol-${blockIdx++}`;
      blocks.push(
        <ol key={key} className="my-1.5 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
          {items.map((item, idx) => (
            <li key={`${key}-${idx}`} className="marker:font-semibold marker:text-indigo-600">
              {renderInline(item, `${key}-li-${idx}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // 8. Paragraph (group consecutive plain lines until blank or special block)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = (lines[i] ?? '').trim();
      if (
        !cur ||
        cur.startsWith('```') ||
        cur.startsWith('#') ||
        cur.startsWith('>') ||
        /^[-*•]\s+/.test(cur) ||
        /^\d+[.)]\s+/.test(cur) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(cur) ||
        (cur.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1] ?? ''))
      ) {
        break;
      }
      paraLines.push(cur);
      i++;
    }

    if (paraLines.length > 0) {
      const key = `p-${blockIdx++}`;
      blocks.push(
        <p key={key} className="my-1.5 text-[13px] leading-relaxed">
          {paraLines.map((pl, pi) => (
            <React.Fragment key={`${key}-line-${pi}`}>
              {pi > 0 && <br />}
              {renderInline(pl, `${key}-l-${pi}`)}
            </React.Fragment>
          ))}
        </p>,
      );
    } else {
      i++;
    }
  }

  return <div className={`markdown-content space-y-1 ${className}`}>{blocks}</div>;
};
