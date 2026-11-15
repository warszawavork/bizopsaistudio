import React, { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  PlusCircle,
  Search,
} from 'lucide-react';
import type { WebSource } from '../types';
import { safeHttpUrl } from './SimpleMarkdown';

interface WebSourcesPanelProps {
  webFactsUsed?: string[];
  webSources?: WebSource[];
  searchQueries?: string[];
  onInsertSourceLink?: (source: WebSource) => void;
  title?: string;
}

const SourceFavicon: React.FC<{ domain: string }> = ({ domain }) => {
  const [failed, setFailed] = useState(false);

  if (failed || !domain) {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">
        <Globe className="h-3.5 w-3.5" />
      </div>
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(domain)}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-6 w-6 shrink-0 rounded-md border border-emerald-200 bg-white p-0.5 object-contain"
    />
  );
};

function extractDomain(uri: string, explicitDomain?: string): string {
  if (explicitDomain?.trim()) {
    return explicitDomain.replace(/^www\./, '');
  }
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const WebSourcesPanel: React.FC<WebSourcesPanelProps> = ({
  webFactsUsed = [],
  webSources = [],
  searchQueries = [],
  onInsertSourceLink,
  title = 'Zweryfikowane źródła i fakty z Internetu (Google Search)',
}) => {
  const [copiedUri, setCopiedUri] = useState<string | null>(null);

  const validSources = webSources
    .map((s) => {
      const safe = safeHttpUrl(s.uri);
      if (!safe) return null;
      return {
        ...s,
        uri: safe,
        domain: extractDomain(safe, s.domain),
      };
    })
    .filter((s): s is WebSource & { domain: string } => s !== null);

  if (webFactsUsed.length === 0 && validSources.length === 0 && searchQueries.length === 0) {
    return null;
  }

  const handleCopyUrl = (uri: string) => {
    void navigator.clipboard.writeText(uri);
    setCopiedUri(uri);
    window.setTimeout(() => setCopiedUri(null), 1800);
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/75 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-800">
          <Globe className="h-3.5 w-3.5 text-emerald-600" />
          <span>{title}</span>
        </div>
        {validSources.length > 0 && (
          <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            {validSources.length} {validSources.length === 1 ? 'link źródłowy' : 'linki źródłowe'}
          </span>
        )}
      </div>

      {/* Subtelne zapytania użyte w Google Search */}
      {searchQueries.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700/80">
            <Search className="h-2.5 w-2.5" />
            Wyszukiwane:
          </span>
          {searchQueries.slice(0, 4).map((q, i) => (
            <span
              key={i}
              className="rounded-full border border-emerald-200/80 bg-white/80 px-2 py-0.5 text-[10px] text-emerald-800"
            >
              {q}
            </span>
          ))}
        </div>
      )}

      {/* Wykorzystane fakty */}
      {webFactsUsed.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11.5px] leading-snug text-emerald-950">
          {webFactsUsed.map((fact, idx) => (
            <li key={idx} className="flex items-start gap-1.5">
              <span className="mt-0.5 text-emerald-600 font-bold">•</span>
              <span>{fact}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Bogate karty klikalnych źródeł (do samodzielnego zapoznania się na stronie) */}
      {validSources.length > 0 && (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {validSources.map((src, idx) => {
            const isCopied = copiedUri === src.uri;
            return (
              <div
                key={`${src.uri}-${idx}`}
                className="flex flex-col justify-between gap-2 rounded-lg border border-emerald-200/90 bg-white p-2.5 shadow-2xs transition hover:border-emerald-300"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <SourceFavicon domain={src.domain} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-[12px] font-semibold text-slate-900 hover:text-emerald-700 hover:underline"
                      title={src.title}
                    >
                      {src.title || src.domain || 'Źródło zewnętrzne'}
                    </a>
                    <div className="truncate text-[10.5px] font-medium text-emerald-700">
                      {src.domain}
                    </div>
                  </div>
                </div>

                {src.snippet && (
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-600">
                    „{src.snippet}”
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-100">
                  <a
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10.5px] font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <span>Zapoznaj się / Otwórz</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>

                  <div className="flex items-center gap-1">
                    {onInsertSourceLink && (
                      <button
                        type="button"
                        onClick={() => onInsertSourceLink(src)}
                        className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10.5px] font-medium text-indigo-700 transition hover:bg-indigo-100"
                        title="Wklej link do treści odpowiedzi e-mail"
                      >
                        <PlusCircle className="h-3 w-3" />
                        <span>Do maila</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleCopyUrl(src.uri)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10.5px] font-medium text-slate-600 transition hover:bg-slate-100"
                      title="Kopiuj link URL"
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" />
                          <span className="text-emerald-700">Skopiowano</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
