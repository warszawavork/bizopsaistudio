import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  FileDown,
  FileText,
  FileUp,
  GitCompare,
  Kanban,
  ListChecks,
  Loader2,
  Mail,
  Mic,
  MicOff,
  Play,
  Printer,
  Sparkles,
  Upload,
  Webhook,
  XCircle,
} from 'lucide-react';
import type {
  AppLanguage,
  AuditResult,
  CrmDeal,
  DemoAuditScenario,
  DocComparisonResult,
  IndustryPreset,
  KnowledgeTile,
  MascotMood,
} from '../types';
import { fileToBase64, runDocumentAudit, runDocumentComparison } from '../utils/apiClient';
import { readDocumentForStudio } from '../utils/documentReader';
import { escapeHtml } from '../utils/emailExport';
import { exportAuditToPdf, exportComparisonToPdf, printCleanReportHtml } from '../utils/pdfExport';

interface AuditViewProps {
  preset: IndustryPreset;
  tiles: KnowledgeTile[];
  language: AppLanguage;
  latestAudit: AuditResult | null;
  onAuditComplete: (audit: AuditResult) => void;
  onCreateCrmDeal: (deal: Omit<CrmDeal, 'id' | 'createdAt'>) => void;
  onMascotUpdate: (mood: MascotMood, tip: string) => void;
  onLogAiCall: (entry: {
    action: 'audit';
    latencyMs: number;
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    status: 'success' | 'error';
    summary: string;
  }) => void;
  onSendWebhookPayload: (payload: Record<string, unknown>, label: string) => Promise<void>;
  onHandoffToResponder?: (text: string) => void;
  autoSendOnHighRisk: boolean;
}

const VOICE_NOTE_PRESETS: Record<string, { label: string; fileName: string; transcript: string }> = {
  norvil: {
    label: 'Notatka głosowa Kierownika Budowy (Wizja lokalna)',
    fileName: 'Notatka_Glosowa_Wizja_Dzialki_Serock.txt',
    transcript:
      '[Transkrypcja Głosowa z Budowy — Kierownik Montażu]: Jestem na działce klienta w Serocku pod montaż domu NORVIL 84 m² Pod Klucz. Uwaga: droga dojazdowa ma tylko 2,9 metra szerokości i ostry zakręt 90 stopni przy lesie — naczepa 13,6 m ani dźwig 35 ton tu nie wjadą bez wycinki 2 drzew i utwardzenia pobocza płytami. Dodatkowo nad wjazdem wisi linia napowietrzna niskiego napięcia, a w skrzynce budowlanej jest tylko zabezpieczenie 1-fazowe, mimo że w umowie jest pompa ciepła. Klient prosi też o fakturę na jego spółkę z o.o. ze stawką 8% VAT.',
  },
  ecommerce: {
    label: 'Notatka głosowa Magazynu Zwrotów (Uszkodzony Gabaryt)',
    fileName: 'Notatka_Glosowa_Magazyn_Zwrot_Rower.txt',
    transcript:
      '[Transkrypcja Głosowa — Magazyn Zwrotów]: Przyjęliśmy zwrot roweru elektrycznego z zamówienia #SP-77210 o wartości 14 200 zł. Klient odesłał rower zwykłym kurierem zamiast na palecie, rama ma głęboką rysę transportową, brakuje ładowarki w zestawie, a licznik wskazuje przejechane 145 km (ślady błota na oponach). Klient żąda pełnego zwrotu 100% kwoty w 24 godziny.',
  },
  logistics: {
    label: 'Notatka głosowa Kierowcy z Trasy (Awaria & Rampa)',
    fileName: 'Notatka_Glosowa_Kierowca_A2_Rampa.txt',
    transcript:
      '[Transkrypcja Głosowa — Kierowca ciągnika WX 99201]: Szefie, stoję na rozładunku pod Hanowerem już 6 godzinę, magazyn klienta odmawia podpisania karty postojowej w CMR. Dodatkowo na komputerze wyskoczył błąd AdBlue, a wczoraj zatankowałem 980 litrów diesla na stacji w Słubicach, bo cena była niższa. Zostało mi 20 minut czasu jazdy na tachografie do pauzy dobowej.',
  },
};

export const AuditView: React.FC<AuditViewProps> = ({
  preset,
  tiles,
  language,
  latestAudit,
  onAuditComplete,
  onCreateCrmDeal,
  onMascotUpdate,
  onLogAiCall,
  onSendWebhookPayload,
  onHandoffToResponder,
  autoSendOnHighRisk,
}) => {
  const [auditMode, setAuditMode] = useState<'single' | 'compare'>('single');
  const [docAName, setDocAName] = useState('Dokument A (v1 / Nasza wersja)');
  const [docBName, setDocBName] = useState('Dokument B (v2 / Rewizja klienta)');
  const [docAText, setDocAText] = useState('');
  const [docBText, setDocBText] = useState('');
  const [comparing, setComparing] = useState(false);
  const [exportingComparePdf, setExportingComparePdf] = useState(false);
  const [compareResult, setCompareResult] = useState<DocComparisonResult | null>(null);
  const [copiedGaps, setCopiedGaps] = useState(false);

  const [docText, setDocText] = useState('');
  const [readingDocInfo, setReadingDocInfo] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    mimeType: string;
    base64: string;
    sizeKb: number;
  } | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [sendingWebhook, setSendingWebhook] = useState(false);
  const [addedToCrm, setAddedToCrm] = useState(false);
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compareFileARef = useRef<HTMLInputElement>(null);
  const compareFileBRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const handleToggleVoiceDictation = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

    if (!SpeechRec) {
      // Fallback: populate realistic voice note transcript if browser has no Web Speech API
      const sample = VOICE_NOTE_PRESETS[preset.id] || VOICE_NOTE_PRESETS.norvil;
      setDocText(sample.transcript);
      onMascotUpdate('curious', 'Załadowałem przykładową transkrypcję głosową z terenu!');
      return;
    }

    if (recordingVoice && recognitionRef.current) {
      recognitionRef.current.stop();
      setRecordingVoice(false);
      onMascotUpdate('happy', 'Zakończono nagrywanie notatki głosowej!');
      return;
    }

    const recognition = new SpeechRec();
    recognition.lang = language === 'en' ? 'en-US' : 'pl-PL';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript + ' ';
      }
      setDocText((prev) => `${prev ? `${prev}\n` : '[Notatka głosowa]: '}${transcript.trim()}`);
    };

    recognition.onerror = () => {
      setRecordingVoice(false);
    };

    recognition.onend = () => {
      setRecordingVoice(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecordingVoice(true);
    onMascotUpdate('thinking', 'Słucham mikrofonu... mów teraz notatkę z budowy lub trasy!');
  };

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setReadingDocInfo(null);

    if (file.type.startsWith('image/')) {
      if (file.size > 4 * 1024 * 1024) {
        setError('Maksymalny rozmiar pojedynczego zdjęcia to 4 MB.');
        return;
      }
      const base64 = await fileToBase64(file);
      setUploadedFile({
        name: file.name,
        mimeType: file.type || 'image/jpeg',
        base64,
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
      });
      return;
    }

    try {
      setReadingDocInfo(`Wczytuję „${file.name}”...`);
      const parsed = await readDocumentForStudio(file, (label) => setReadingDocInfo(label));

      if (parsed.kind === 'pdf_scan' && parsed.scannedPages?.length) {
        const useRawPdf = file.size <= 3.6 * 1024 * 1024;
        const base64 = useRawPdf ? await fileToBase64(file) : parsed.scannedPages[0].base64;
        const mimeType = useRawPdf ? 'application/pdf' : parsed.scannedPages[0].mimeType;
        if (parsed.text.trim()) {
          setDocText(parsed.text);
        }
        setUploadedFile({
          name: file.name,
          mimeType,
          base64,
          sizeKb: Math.max(1, Math.round(file.size / 1024)),
        });
        setReadingDocInfo(
          `Skan PDF (${parsed.pageCount ?? 1} str.${parsed.dimensionsSummary ? `, ${parsed.dimensionsSummary}` : ''})`
        );
      } else {
        setDocText(parsed.text);
        setUploadedFile({
          name: file.name,
          mimeType: 'text/plain',
          base64: '',
          sizeKb: Math.max(1, Math.round(file.size / 1024)),
        });
        setReadingDocInfo(
          `${parsed.pageCount ? `${parsed.pageCount} str. • ` : ''}${parsed.dimensionsSummary ? `${parsed.dimensionsSummary} • ` : ''}${parsed.charCount.toLocaleString('pl-PL')} znaków`
        );
      }
      onMascotUpdate('happy', `Wczytałem dokument „${file.name}”!`);
    } catch (err) {
      setReadingDocInfo(null);
      setError(err instanceof Error ? err.message : 'Nie udało się odczytać dokumentu.');
    }
  };

  const loadCompareFile = async (file: File | undefined, side: 'A' | 'B') => {
    if (!file) return;
    setError(null);
    try {
      const parsed = await readDocumentForStudio(file);
      if (!parsed.text.trim()) {
        setError(
          `Plik „${file.name}” wygląda na skan graficzny bez warstwy tekstu. Przepuść go najpierw przez Audyt pojedynczy lub wklej treść ręcznie.`
        );
        return;
      }
      const dimsLabel = parsed.dimensionsSummary ? ` [${parsed.dimensionsSummary}]` : '';
      if (side === 'A') {
        setDocAName(`${file.name}${dimsLabel}`);
        setDocAText(parsed.text);
      } else {
        setDocBName(`${file.name}${dimsLabel}`);
        setDocBText(parsed.text);
      }
      onMascotUpdate('happy', `Wczytano plik „${file.name}” jako Dokument ${side}!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Nie udało się odczytać pliku do Dokumentu ${side}.`);
    }
  };

  const executeAudit = async (overrideText?: string, overrideName?: string) => {
    const textToUse = overrideText ?? docText;
    const fileName = overrideName ?? uploadedFile?.name ?? 'Wklejony_dokument.txt';
    if (!textToUse.trim() && !uploadedFile?.base64) return;

    setAuditing(true);
    setAddedToCrm(false);
    setError(null);
    onMascotUpdate('thinking', `Mruczek audytuje "${fileName}" względem bazy wiedzy...`);

    try {
      const res = await runDocumentAudit({
        companyName: preset.name,
        companyIndustry: preset.industry,
        language,
        knowledgeTiles: tiles,
        fileName,
        documentText: textToUse,
        fileBase64: overrideText ? undefined : uploadedFile?.base64 || undefined,
        fileMimeType: overrideText ? undefined : uploadedFile?.mimeType || undefined,
      });

      const fullAudit: AuditResult = {
        id: `aud_${Date.now()}`,
        fileName,
        createdAt: new Date().toISOString(),
        documentType: res.documentType,
        clientOrSender: res.clientOrSender,
        summary: res.summary,
        score: res.score,
        riskLevel: res.riskLevel,
        extractedFields: res.extractedFields,
        findings: res.findings,
        recommendedReplySubject: res.recommendedReplySubject,
        recommendedReplyBody: res.recommendedReplyBody,
        webhookSummaryTags: res.webhookSummaryTags,
        mascotMood: res.mascotMood,
        mascotTip: res.mascotTip,
        latencyMs: res.latencyMs,
        usage: res.usage,
      };

      onAuditComplete(fullAudit);
      onMascotUpdate(
        res.riskLevel === 'HIGH' ? 'alert' : 'happy',
        res.mascotTip || `Ocena audytu: ${res.score}% (${res.riskLevel})`
      );
      onLogAiCall({
        action: 'audit',
        latencyMs: res.latencyMs,
        promptTokens: res.usage.promptTokens,
        candidatesTokens: res.usage.candidatesTokens,
        totalTokens: res.usage.totalTokens,
        status: 'success',
        summary: `Audyt "${fileName}" -> ${res.score}% (${res.riskLevel})`,
      });

      if (autoSendOnHighRisk && res.riskLevel === 'HIGH') {
        await onSendWebhookPayload(buildWebhookPayload(fullAudit), `Auto-alert HIGH RISK: ${fileName}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd audytu dokumentu';
      setError(msg);
      onMascotUpdate('alert', 'Wystąpił błąd podczas audytu.');
      onLogAiCall({
        action: 'audit',
        latencyMs: 0,
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
        status: 'error',
        summary: msg,
      });
    } finally {
      setAuditing(false);
    }
  };

  const handleRunDemo = (demo: DemoAuditScenario) => {
    setUploadedFile(null);
    setDocText(demo.documentText);
    void executeAudit(demo.documentText, demo.fileName);
  };

  const handleRunVoiceSample = () => {
    const sample = VOICE_NOTE_PRESETS[preset.id] || VOICE_NOTE_PRESETS.norvil;
    setUploadedFile(null);
    setDocText(sample.transcript);
    void executeAudit(sample.transcript, sample.fileName);
  };

  const buildWebhookPayload = (audit: AuditResult): Record<string, unknown> => ({
    event: 'bizops.document.audited',
    company: preset.name,
    auditId: audit.id,
    fileName: audit.fileName,
    documentType: audit.documentType,
    clientOrSender: audit.clientOrSender,
    score: audit.score,
    riskLevel: audit.riskLevel,
    tags: audit.webhookSummaryTags,
    extractedFields: audit.extractedFields,
    criticalFindings: audit.findings.filter((f) => f.severity !== 'ok'),
    recommendedReplySubject: audit.recommendedReplySubject,
    createdAt: audit.createdAt,
  });

  const handleExportPdf = async () => {
    if (!latestAudit) return;
    setExportingPdf(true);
    try {
      await exportAuditToPdf(latestAudit, preset.name);
      onMascotUpdate('happy', 'Wygenerowałem raport PDF A4 z wynikami audytu!');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleManualWebhook = async () => {
    if (!latestAudit) return;
    setSendingWebhook(true);
    await onSendWebhookPayload(buildWebhookPayload(latestAudit), `Audyt: ${latestAudit.fileName}`);
    setSendingWebhook(false);
  };

  const handlePushAuditToCrm = () => {
    if (!latestAudit || addedToCrm) return;
    onCreateCrmDeal({
      title: `${latestAudit.documentType} (${latestAudit.fileName})`,
      client: latestAudit.clientOrSender,
      valuePln: 145000,
      stage: 'audited',
      riskLevel: latestAudit.riskLevel,
      score: latestAudit.score,
      tags: latestAudit.webhookSummaryTags.slice(0, 3),
      notes: latestAudit.summary,
    });
    setAddedToCrm(true);
    onMascotUpdate('happy', 'Wynik audytu zapisany jako karta w Pipeline CRM!');
  };

  const handleCopyReply = () => {
    if (!latestAudit) return;
    const text = `Temat: ${latestAudit.recommendedReplySubject}\n\n${latestAudit.recommendedReplyBody}`;
    void navigator.clipboard.writeText(text);
    setCopiedReply(true);
    window.setTimeout(() => setCopiedReply(false), 1800);
  };

  const handleCopyGapsChecklist = () => {
    if (!latestAudit) return;
    const missing = latestAudit.extractedFields.filter((f) => f.status !== 'ok');
    const issues = latestAudit.findings.filter((f) => f.severity !== 'ok');
    const lines: string[] = [
      `Lista braków i uwag do dokumentu (${latestAudit.fileName}):`,
      ...missing.map((m, i) => `${i + 1}. ${m.label}: ${m.value} [${m.status === 'missing' ? 'BRAK' : 'DO WERYFIKACJI'}]`),
      ...issues.map((f) => `• ${f.title} — ${f.detail}`),
    ];
    void navigator.clipboard.writeText(lines.join('\n'));
    setCopiedGaps(true);
    window.setTimeout(() => setCopiedGaps(false), 2000);
  };

  const handleRunCompare = async () => {
    if (!docAText.trim() || !docBText.trim() || comparing) return;
    setComparing(true);
    setError(null);
    try {
      const res = await runDocumentComparison({
        companyName: preset.name,
        language,
        knowledgeTiles: tiles,
        docAName,
        docAText: docAText.slice(0, 60000),
        docBName,
        docBText: docBText.slice(0, 60000),
      });
      setCompareResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd porównywania dokumentów.');
    } finally {
      setComparing(false);
    }
  };

  const handleExportComparePdf = async () => {
    if (!compareResult || exportingComparePdf) return;
    setExportingComparePdf(true);
    try {
      await exportComparisonToPdf({
        comparison: compareResult,
        docAName,
        docBName,
        companyName: preset.name,
      });
    } finally {
      setExportingComparePdf(false);
    }
  };

  const handlePrintCompareReport = () => {
    if (!compareResult) return;
    const rowsHtml = compareResult.differences
      .map(
        (d) =>
          `<tr><td><strong>${escapeHtml(d.topic)}</strong><br/><small>${escapeHtml(d.impact.toUpperCase())}</small></td><td>${escapeHtml(d.docA)}</td><td>${escapeHtml(d.docB)}</td></tr>`
      )
      .join('');
    const risksHtml =
      compareResult.hiddenRisks.length > 0
        ? `<h3>Ukryte ryzyka</h3><ul>${compareResult.hiddenRisks.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
        : '';
    printCleanReportHtml({
      title: `Porównanie dokumentów: ${docAName} vs ${docBName}`,
      subtitle: `${preset.name} • Ryzyko zmian: ${compareResult.riskLevel}`,
      bodyMarkdownOrHtml: `<p><strong>Werdykt:</strong> ${escapeHtml(compareResult.overallVerdict)}</p><p><strong>Rekomendacja:</strong> ${escapeHtml(compareResult.recommendedAction)}</p><table><thead><tr><th>Obszar / Parametr</th><th>Dokument A (${escapeHtml(docAName)})</th><th>Dokument B (${escapeHtml(docBName)})</th></tr></thead><tbody>${rowsHtml}</tbody></table>${risksHtml}`,
      isPreformattedHtml: true,
    });
  };

  const voiceSample = VOICE_NOTE_PRESETS[preset.id] || VOICE_NOTE_PRESETS.norvil;

  return (
    <div className="space-y-4">
      {/* Mode Switcher: Single Document vs Compare 2 Documents */}
      <div className="inline-flex rounded-2xl border border-slate-200/80 bg-white/85 p-1 shadow-2xs">
        <button
          type="button"
          onClick={() => setAuditMode('single')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            auditMode === 'single'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          Analiza 1 dokumentu (PDF / Word / Głos)
        </button>
        <button
          type="button"
          onClick={() => setAuditMode('compare')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            auditMode === 'compare'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <GitCompare className="h-3.5 w-3.5" />
          Porównaj 2 dokumenty (v1 vs v2)
        </button>
      </div>

      {auditMode === 'compare' ? (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-5">
            <div className="soft-card rounded-3xl border border-slate-200/80 bg-white p-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">1. Wgraj lub wklej dwa dokumenty (v1 vs v2)</h3>
                <p className="text-xs text-slate-500">
                  Wgraj PDF (dowolne wymiary), DOCX albo TXT — AI wychwyci różnice w cenach, metrażach, VAT i ukrytych zapisach.
                </p>
              </div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void loadCompareFile(e.dataTransfer.files?.[0], 'A');
                }}
                className="space-y-1.5 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700 truncate">
                    Dokument A: <span className="text-indigo-700">{docAName}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => compareFileARef.current?.click()}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
                  >
                    <Upload className="h-3 w-3" />
                    Wgraj PDF / DOCX
                  </button>
                  <input
                    ref={compareFileARef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json"
                    onChange={(e) => void loadCompareFile(e.target.files?.[0], 'A')}
                    className="hidden"
                  />
                </div>
                <textarea
                  rows={5}
                  value={docAText}
                  onChange={(e) => setDocAText(e.target.value)}
                  placeholder="Wklej albo upuść tutaj pierwszy dokument (PDF / DOCX / tekst)..."
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800 outline-none focus:border-indigo-500"
                />
              </div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void loadCompareFile(e.dataTransfer.files?.[0], 'B');
                }}
                className="space-y-1.5 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700 truncate">
                    Dokument B: <span className="text-indigo-700">{docBName}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => compareFileBRef.current?.click()}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
                  >
                    <Upload className="h-3 w-3" />
                    Wgraj PDF / DOCX
                  </button>
                  <input
                    ref={compareFileBRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json"
                    onChange={(e) => void loadCompareFile(e.target.files?.[0], 'B')}
                    className="hidden"
                  />
                </div>
                <textarea
                  rows={5}
                  value={docBText}
                  onChange={(e) => setDocBText(e.target.value)}
                  placeholder="Wklej albo upuść tutaj drugi dokument (PDF / DOCX / tekst)..."
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800 outline-none focus:border-indigo-500"
                />
              </div>
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  {error}
                </div>
              )}
              <button
                type="button"
                disabled={comparing || !docAText.trim() || !docBText.trim()}
                onClick={() => void handleRunCompare()}
                className="shimmer-bar flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-700 px-5 py-3.5 text-xs font-bold text-white shadow-md transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                {comparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
                {comparing ? 'Porównuję oba dokumenty...' : 'Porównaj Dokument A vs B'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-7">
            {!compareResult ? (
              <div className="soft-card flex h-full min-h-[420px] flex-col items-center justify-center rounded-3xl border border-slate-200/80 bg-white/90 p-10 text-center">
                <GitCompare className="mb-3 h-10 w-10 text-indigo-500" />
                <h4 className="text-base font-extrabold text-slate-900">
                  2. Tutaj pojawi się tabela różnic i ryzyk
                </h4>
                <p className="mt-1.5 max-w-md text-xs text-slate-500">
                  Wklej dwie wersje kosztorysu lub umowy po lewej stronie, a AI natychmiast wskaże, co się zmieniło.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="soft-card rounded-3xl border border-slate-200/80 bg-white p-6 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                        compareResult.riskLevel === 'LOW'
                          ? 'bg-emerald-100 text-emerald-800'
                          : compareResult.riskLevel === 'MEDIUM'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      RYZYKO ZMIAN: {compareResult.riskLevel}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-400">
                        {compareResult.latencyMs} ms
                      </span>
                      <button
                        type="button"
                        disabled={exportingComparePdf}
                        onClick={() => void handleExportComparePdf()}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {exportingComparePdf ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <FileDown className="h-3 w-3" />
                        )}
                        Eksportuj PDF różnic
                      </button>
                      <button
                        type="button"
                        onClick={handlePrintCompareReport}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <Printer className="h-3 w-3" />
                        Drukuj raport
                      </button>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-slate-900">{compareResult.overallVerdict}</p>
                  <p className="text-xs text-indigo-700 font-semibold">
                    Rekomendacja: {compareResult.recommendedAction}
                  </p>
                </div>

                <div className="soft-card overflow-hidden rounded-3xl border border-slate-200/80 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-bold">Obszar / Parametr</th>
                        <th className="px-4 py-3 font-bold">{docAName}</th>
                        <th className="px-4 py-3 font-bold">{docBName}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {compareResult.differences.map((d, i) => (
                        <tr
                          key={i}
                          className={
                            d.impact === 'critical'
                              ? 'bg-rose-50/60'
                              : d.impact === 'warning'
                                ? 'bg-amber-50/50'
                                : ''
                          }
                        >
                          <td className="px-4 py-3 font-bold text-slate-900">{d.topic}</td>
                          <td className="px-4 py-3 text-slate-600">{d.docA}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{d.docB}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {compareResult.hiddenRisks.length > 0 && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-900">
                    <p className="font-bold">Ukryte ryzyka do wyjaśnienia:</p>
                    <ul className="mt-1 list-disc pl-4 space-y-0.5">
                      {compareResult.hiddenRisks.map((r, ri) => (
                        <li key={ri}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
      /* Main Split Grid (Single Document Audit) */
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Input */}
        <div className="space-y-4 lg:col-span-5">
          <div className="soft-card rounded-3xl border border-slate-200/80 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">1. Wgraj PDF / Zdjęcie lub wklej dokument</h3>
                <p className="text-xs text-slate-500">
                  Czytnik i audytor kosztorysów PDF, umów, zdjęć i notatek.
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleVoiceDictation}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                  recordingVoice
                    ? 'border-rose-300 bg-rose-600 text-white animate-pulse'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:text-indigo-700'
                }`}
                title="Nagraj notatkę głosową przez mikrofon"
              >
                {recordingVoice ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5 text-indigo-600" />}
                {recordingVoice ? 'Zatrzymaj Mic' : 'Dyktuj głosem'}
              </button>
            </div>

            {/* Compact Sample Loader */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-500">
                Przykładowe dokumenty do szybkiego testu:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {preset.demoScenarios.map((demo) => (
                  <button
                    key={demo.id}
                    type="button"
                    disabled={auditing}
                    onClick={() => handleRunDemo(demo)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/60 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3 text-indigo-600" />
                    <span>{demo.label}</span>
                  </button>
                ))}
                <button
                  type="button"
                  disabled={auditing}
                  onClick={handleRunVoiceSample}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/60 disabled:opacity-50"
                >
                  <Mic className="h-3 w-3 text-indigo-600" />
                  <span>{voiceSample.label}</span>
                </button>
              </div>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleFileChange(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 p-6 text-center transition hover:border-indigo-400 hover:bg-indigo-50/30"
            >
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                <FileUp className="h-5 w-5" />
              </div>
              <p className="text-xs font-semibold text-slate-800">
                {uploadedFile
                  ? `${uploadedFile.name} (${uploadedFile.sizeKb} KB)`
                  : 'Przeciągnij plik PDF, Word (.docx) lub zdjęcie z budowy'}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">PDF (dowolne formaty/str.), DOCX, PNG, JPG, TXT, CSV</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json,image/*"
                onChange={(e) => void handleFileChange(e.target.files?.[0])}
                className="hidden"
              />
            </div>

            {readingDocInfo && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-[11px] font-semibold text-indigo-900">
                Wczytano: {readingDocInfo}
              </div>
            )}

            {uploadedFile?.base64 && (uploadedFile.mimeType.startsWith('image/') || uploadedFile.mimeType === 'application/pdf') && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                  <span>Podgląd dokumentu (Split-Screen)</span>
                  <span className="truncate max-w-[180px] text-slate-400">{uploadedFile.name}</span>
                </div>
                {uploadedFile.mimeType.startsWith('image/') ? (
                  <img
                    src={`data:${uploadedFile.mimeType};base64,${uploadedFile.base64}`}
                    alt={uploadedFile.name}
                    className="max-h-64 w-full object-contain bg-slate-900/5 p-2"
                  />
                ) : (
                  <iframe
                    title={uploadedFile.name}
                    src={`data:application/pdf;base64,${uploadedFile.base64}`}
                    className="h-64 w-full border-0"
                  />
                )}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Treść dokumentu / transkrypcja głosowa z terenu
              </label>
              <textarea
                rows={8}
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="Wklej treść maila od klienta, kosztorysu, albo użyj przycisku 'Dyktuj głosem'..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={auditing || (!docText.trim() && !uploadedFile?.base64)}
              onClick={() => void executeAudit()}
              className="shimmer-bar flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-700 px-5 py-3.5 text-xs font-bold text-white shadow-md shadow-indigo-950/15 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-600/25 disabled:translate-y-0 disabled:opacity-50"
            >
              {auditing ? <Loader2 className="h-4 w-4 animate-spin text-indigo-300" /> : <Sparkles className="h-4 w-4 text-indigo-300" />}
              {auditing ? 'Analizuję dokument względem Bazy Wiedzy...' : 'Uruchom Audyt AI względem Bazy Wiedzy'}
            </button>
          </div>
        </div>

        {/* Right Column: Audit Result Dashboard */}
        <div className="lg:col-span-7">
          {auditing ? (
            <div className="soft-card animate-enter flex h-full min-h-[420px] flex-col justify-between rounded-3xl border border-indigo-200/70 bg-white/90 p-7">
              <div className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                  <div>
                    <p className="text-xs font-extrabold text-slate-900">
                      Audytor AI analizuje dokument...
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Weryfikuję stawki VAT, braki formalne i zgodność z Bazą Wiedzy
                    </p>
                  </div>
                </div>
                <div className="shimmer-bar h-14 w-full rounded-2xl bg-slate-100" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="shimmer-bar h-24 rounded-2xl bg-slate-100" />
                  <div className="shimmer-bar h-24 rounded-2xl bg-slate-100" />
                </div>
                <div className="shimmer-bar h-32 w-full rounded-2xl bg-slate-100" />
              </div>
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
                <span>Silnik: Gemini 3.8 Flash Multimodal</span>
                <span>Odczyt PDF / Obrazów / Tekstu</span>
              </div>
            </div>
          ) : !latestAudit ? (
            <div className="soft-card flex h-full min-h-[420px] flex-col items-center justify-center rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/70 p-10 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-700 text-white shadow-lg shadow-indigo-500/20">
                <FileText className="h-6 w-6" />
              </div>
              <h4 className="text-base font-extrabold tracking-tight text-slate-900">
                2. Tutaj pojawi się raport z odczytu dokumentu
              </h4>
              <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
                Wgraj plik PDF / zdjęcie z budowy po lewej stronie albo kliknij jeden z przykładowych dokumentów powyżej, aby sprawdzić zgodność, wykryć błędy i wyeksportować raport PDF.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Top Score & Action Bar */}
              <div className="soft-card rounded-3xl border border-slate-200/80 bg-white p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-[220px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                        {latestAudit.documentType}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          latestAudit.riskLevel === 'LOW'
                            ? 'bg-emerald-100 text-emerald-800'
                            : latestAudit.riskLevel === 'MEDIUM'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        RYZYKO: {latestAudit.riskLevel}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {latestAudit.latencyMs} ms • {latestAudit.usage.totalTokens} tok.
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900">{latestAudit.clientOrSender}</h3>
                    <p className="text-xs leading-relaxed text-slate-600">{latestAudit.summary}</p>
                  </div>

                  {/* Score Pill */}
                  <div
                    className={`flex flex-col items-center justify-center rounded-2xl px-4 py-3 text-white shadow-sm ${
                      latestAudit.score >= 80
                        ? 'bg-emerald-600'
                        : latestAudit.score >= 50
                          ? 'bg-amber-500'
                          : 'bg-rose-600'
                    }`}
                  >
                    <span className="text-2xl font-extrabold leading-none">{latestAudit.score}%</span>
                    <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider opacity-90">
                      Zgodność
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    disabled={exportingPdf}
                    onClick={() => void handleExportPdf()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {exportingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                    Eksportuj Raport PDF (A4)
                  </button>

                  <button
                    type="button"
                    disabled={addedToCrm}
                    onClick={handlePushAuditToCrm}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
                      addedToCrm
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700'
                    }`}
                  >
                    {addedToCrm ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Kanban className="h-3.5 w-3.5 text-indigo-600" />}
                    {addedToCrm ? 'Dodano do CRM' : 'Zapisz w Pipeline CRM'}
                  </button>

                  <button
                    type="button"
                    disabled={sendingWebhook}
                    onClick={() => void handleManualWebhook()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                  >
                    {sendingWebhook ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Webhook className="h-3.5 w-3.5" />}
                    Wyślij JSON do Make / n8n
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyGapsChecklist}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
                      copiedGaps
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    {copiedGaps ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <ListChecks className="h-3.5 w-3.5" />}
                    {copiedGaps ? 'Skopiowano checklistę' : 'Kopiuj listę braków (WhatsApp / SMS)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowJsonPreview((s) => !s)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    {showJsonPreview ? 'Ukryj JSON' : 'Podgląd JSON'}
                  </button>

                  {onHandoffToResponder && (
                    <button
                      type="button"
                      onClick={() =>
                        onHandoffToResponder(
                          `Dokument: ${latestAudit.fileName} (${latestAudit.documentType})\nKlient / Nadawca: ${latestAudit.clientOrSender}\nPodsumowanie audytu (Zgodność ${latestAudit.score}%):\n${latestAudit.summary}\n\nWykryte uwagi:\n${latestAudit.findings
                            .filter((f) => f.severity !== 'ok')
                            .map((f) => `- ${f.title}: ${f.detail}`)
                            .join('\n')}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                    >
                      Odpowiedz w Asystencie
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {showJsonPreview && (
                  <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] font-mono text-emerald-300">
                    {JSON.stringify(buildWebhookPayload(latestAudit), null, 2)}
                  </pre>
                )}
              </div>

              {/* Extracted Key Fields */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Wyodrębnione parametry kluczowe
                </h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {latestAudit.extractedFields.map((field, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-xs"
                    >
                      <div>
                        <p className="text-[11px] font-medium text-slate-500">{field.label}</p>
                        <p className="mt-0.5 font-semibold text-slate-900">{field.value}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                          field.status === 'ok'
                            ? 'bg-emerald-100 text-emerald-700'
                            : field.status === 'warning'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {field.status === 'ok' ? 'OK' : field.status === 'warning' ? 'UWAGA' : 'BRAK'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Audit Findings */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Wykryte niezgodności i checklisty
                </h4>
                <div className="space-y-2.5">
                  {latestAudit.findings.map((f, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-xs ${
                        f.severity === 'ok'
                          ? 'border-emerald-200 bg-emerald-50/50'
                          : f.severity === 'warning'
                            ? 'border-amber-200 bg-amber-50/60'
                            : 'border-rose-200 bg-rose-50/70'
                      }`}
                    >
                      {f.severity === 'ok' ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      ) : f.severity === 'warning' ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                      )}
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-slate-900">{f.title}</span>
                          <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
                            {f.ruleRef}
                          </span>
                        </div>
                        <p className="mt-1 leading-relaxed text-slate-700">{f.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommended Email Reply */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                    <Mail className="h-3.5 w-3.5 text-indigo-600" />
                    Gotowy szkic odpowiedzi do klienta
                  </h4>
                  <button
                    type="button"
                    onClick={handleCopyReply}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {copiedReply ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    {copiedReply ? 'Skopiowano' : 'Kopiuj wiadomość'}
                  </button>
                </div>
                <p className="mb-2 text-xs font-semibold text-indigo-700">
                  Temat: {latestAudit.recommendedReplySubject}
                </p>
                <div className="whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700">
                  {latestAudit.recommendedReplyBody}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
