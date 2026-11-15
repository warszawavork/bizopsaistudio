import React, { useRef, useState } from 'react';
import {
  BookPlus,
  BrainCircuit,
  Check,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileUp,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AppLanguage,
  IndustryPreset,
  KnowledgeConsistencyResult,
  KnowledgeTile,
  MascotMood,
} from '../types';
import {
  estimateTokens,
  fileToBase64,
  runKnowledgeConsistencyCheck,
  runSmartIngest,
} from '../utils/apiClient';
import { extractTextFromDocx } from '../utils/docxReader';

interface KnowledgeViewProps {
  preset: IndustryPreset;
  tiles: KnowledgeTile[];
  language: AppLanguage;
  onTilesChange: (tiles: KnowledgeTile[]) => void;
  onResetPreset: () => void;
  onTestTileInChat: (prompt: string) => void;
  onMascotUpdate: (mood: MascotMood, tip: string) => void;
  onLogAiCall: (entry: {
    action: 'ingest';
    latencyMs: number;
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    status: 'success' | 'error';
    summary: string;
  }) => void;
}

const CATEGORIES = ['Oferta', 'Technologia', 'Finanse & VAT', 'Logistyka', 'Procedury', 'Sprzedaż', 'Wewnętrzne'];

const QUICK_RULE_TEMPLATES = [
  {
    label: '+ Szablon: Reguła VAT / Faktury',
    title: 'Weryfikacja Stawki VAT i Mechanizmu Podzielonej Płatności',
    category: 'Finanse & VAT',
    visibility: 'public' as const,
    priority: 'critical' as const,
    content:
      'Każda faktura za roboty budowlane powyżej 15 000 zł brutto wymaga adnotacji "Mechanizm Podzielonej Płatności" (MPP). Stawka 8% VAT przysługuje wyłącznie osobom fizycznym/inwestorom na cele mieszkaniowe (do 300 m²). Faktury B2B na wynajem lub biuro wymagają 23% VAT.',
  },
  {
    label: '+ Szablon: Limit Rabatowy (Poufne)',
    title: 'WEWNĘTRZNE: Maksymalne progi rabatowe dla handlowców',
    category: 'Wewnętrzne',
    visibility: 'internal' as const,
    priority: 'critical' as const,
    content:
      'Handlowiec może udzielić maksymalnie 3% rabatu przy płatności gotówkowej/przelewem w transzach 50/50. Każdy rabat powyżej 3% lub darmowy transport powyżej 150 km wymaga pisemnej zgody Managera Operacyjnego.',
  },
  {
    label: '+ Szablon: Checklista Odbioru / Montażu',
    title: 'Wymagania techniczne przed rozpoczęciem realizacji',
    category: 'Logistyka',
    visibility: 'public' as const,
    priority: 'standard' as const,
    content:
      'Klient zobowiązany jest dostarczyć dokumentację fotograficzną drogi dojazdowej (min. 3,5 m szerokości), potwierdzenie przyłącza prądu 3-fazowego min. 14 kW oraz podpisany protokół gotowości fundamentu min. 7 dni przed wysyłką z fabryki.',
  },
];

export const KnowledgeView: React.FC<KnowledgeViewProps> = ({
  preset,
  tiles,
  language,
  onTilesChange,
  onResetPreset,
  onTestTileInChat,
  onMascotUpdate,
  onLogAiCall,
}) => {
  const [creatorTab, setCreatorTab] = useState<'ai' | 'manual'>('ai');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('Wszystkie');
  const [statusFilter, setStatusFilter] = useState<'all' | 'critical' | 'internal' | 'disabled'>('all');

  // AI Smart Ingest state
  const [ingestText, setIngestText] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestFile, setIngestFile] = useState<{ name: string; mimeType: string; base64: string } | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [checkingConsistency, setCheckingConsistency] = useState(false);
  const [consistencyReport, setConsistencyReport] = useState<KnowledgeConsistencyResult | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [stagedTiles, setStagedTiles] = useState<
    Array<{
      title: string;
      category: string;
      visibility: 'public' | 'internal';
      priority?: 'standard' | 'critical';
      content: string;
    }>
  >([]);
  const [ingestSummary, setIngestSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importJsonRef = useRef<HTMLInputElement>(null);

  // Manual add / Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Oferta');
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  const [priority, setPriority] = useState<'standard' | 'critical'>('standard');
  const [content, setContent] = useState('');

  const activeTiles = tiles.filter((t) => t.enabled);
  const estimatedActiveTokens = activeTiles.reduce(
    (sum, t) => sum + estimateTokens(`${t.title}\n${t.content}`),
    0
  );
  const contextPercent = Math.min(100, Math.max(0.2, (estimatedActiveTokens / 1_000_000) * 100));

  const handleIngestFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIngestError(null);
    if (file.name.toLowerCase().endsWith('.docx')) {
      try {
        const docxText = await extractTextFromDocx(file);
        setIngestText((prev) => (prev ? `${prev}\n\n${docxText}` : docxText));
        setIngestFile(null);
      } catch (err) {
        setIngestError(err instanceof Error ? err.message : 'Nie udało się odczytać pliku Word (.docx).');
      }
      return;
    }
    if (
      file.type === 'text/plain' ||
      file.name.endsWith('.md') ||
      file.name.endsWith('.csv') ||
      file.name.endsWith('.tsv') ||
      file.name.endsWith('.txt')
    ) {
      const txt = await file.text();
      setIngestText((prev) => (prev ? `${prev}\n\n${txt}` : txt));
      setIngestFile(null);
      return;
    }
    const base64 = await fileToBase64(file);
    setIngestFile({
      name: file.name,
      mimeType: file.type || 'application/pdf',
      base64,
    });
  };

  const handleRunConsistencyCheck = async () => {
    setCheckingConsistency(true);
    setIngestError(null);
    try {
      const report = await runKnowledgeConsistencyCheck({
        companyName: preset.name,
        language,
        knowledgeTiles: tiles,
      });
      setConsistencyReport(report);
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'Nie udało się sprawdzić spójności bazy.');
    } finally {
      setCheckingConsistency(false);
    }
  };

  const handleRunIngest = async () => {
    if (!ingestText.trim() && !ingestFile && !ingestUrl.trim()) return;
    setIngesting(true);
    setIngestError(null);
    onMascotUpdate('thinking', 'Analizuję materiał i buduję kafelki wiedzy...');
    try {
      const res = await runSmartIngest({
        companyName: preset.name,
        language,
        fileName: ingestFile?.name || (ingestUrl.trim() || 'Notatki własne'),
        rawText: ingestText,
        sourceUrl: ingestUrl.trim() || undefined,
        fileBase64: ingestFile?.base64,
        fileMimeType: ingestFile?.mimeType,
      });
      setStagedTiles(res.tiles);
      setIngestSummary(res.summaryNote);
      onMascotUpdate('happy', `Wyodrębniłem ${res.tiles.length} nowe kafelki wiedzy!`);
      onLogAiCall({
        action: 'ingest',
        latencyMs: res.latencyMs,
        promptTokens: res.usage.promptTokens,
        candidatesTokens: res.usage.candidatesTokens,
        totalTokens: res.usage.totalTokens,
        status: 'success',
        summary: `Naucz mnie AI: wygenerowano ${res.tiles.length} kafelki (${ingestFile?.name || ingestUrl.trim() || 'tekst'})`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd przetwarzania wiedzy';
      setIngestError(msg);
      onMascotUpdate('alert', 'Nie udało się przetworzyć materiału.');
    } finally {
      setIngesting(false);
    }
  };

  const handleCommitStaged = () => {
    const created: KnowledgeTile[] = stagedTiles.map((st, idx) => ({
      id: `custom_${Date.now()}_${idx}`,
      title: st.title,
      category: st.category || 'Oferta',
      visibility: st.visibility === 'internal' ? 'internal' : 'public',
      priority: st.priority === 'critical' ? 'critical' : 'standard',
      content: st.content,
      enabled: true,
      updatedAt: new Date().toISOString().slice(0, 10),
    }));
    onTilesChange([...created, ...tiles]);
    setStagedTiles([]);
    setIngestSummary(null);
    setIngestText('');
    setIngestFile(null);
    onMascotUpdate('happy', 'Nowa wiedza zapisana! Już z niej korzystam w czacie i audycie.');
  };

  const handleApplyTemplate = (tpl: (typeof QUICK_RULE_TEMPLATES)[number]) => {
    setCreatorTab('manual');
    setEditingId(null);
    setTitle(tpl.title);
    setCategory(tpl.category);
    setVisibility(tpl.visibility);
    setPriority(tpl.priority);
    setContent(tpl.content);
  };

  const handleManualSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    if (editingId) {
      onTilesChange(
        tiles.map((t) =>
          t.id === editingId
            ? {
                ...t,
                title: title.trim(),
                category,
                visibility,
                priority,
                content: content.trim(),
                updatedAt: new Date().toISOString().slice(0, 10),
              }
            : t
        )
      );
      setEditingId(null);
    } else {
      const newTile: KnowledgeTile = {
        id: `tile_${Date.now()}`,
        title: title.trim(),
        category,
        visibility,
        priority,
        content: content.trim(),
        enabled: true,
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      onTilesChange([newTile, ...tiles]);
    }
    setTitle('');
    setContent('');
    setVisibility('public');
    setPriority('standard');
    onMascotUpdate('happy', 'Zapamiętałem nowy kafelek wiedzy (+25 XP dla Kotka)!');
  };

  const handleStartEdit = (tile: KnowledgeTile) => {
    setCreatorTab('manual');
    setEditingId(tile.id);
    setTitle(tile.title);
    setCategory(tile.category);
    setVisibility(tile.visibility);
    setPriority(tile.priority || 'standard');
    setContent(tile.content);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(tiles, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baza_wiedzy_${preset.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as KnowledgeTile[];
      if (Array.isArray(parsed)) {
        onTilesChange(parsed);
        onMascotUpdate('happy', `Zaimportowano ${parsed.length} kafelków wiedzy!`);
      }
    } catch {
      setIngestError('Nieprawidłowy plik JSON bazy wiedzy.');
    }
  };

  const filteredTiles = tiles.filter((t) => {
    const matchesCat = categoryFilter === 'Wszystkie' || t.category === categoryFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'critical' && t.priority === 'critical') ||
      (statusFilter === 'internal' && t.visibility === 'internal') ||
      (statusFilter === 'disabled' && !t.enabled);
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q || t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q);
    return matchesCat && matchesStatus && matchesSearch;
  });

  const handleBulkToggleFiltered = (enabled: boolean) => {
    const filteredIds = new Set(filteredTiles.map((t) => t.id));
    if (filteredIds.size === 0) return;
    onTilesChange(
      tiles.map((t) => (filteredIds.has(t.id) ? { ...t, enabled } : t))
    );
  };

  return (
    <div className="space-y-5">
      {/* Memory Meter & Tools Bar */}
      <div className="soft-card flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200/80 bg-white p-5">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-slate-800">
              <BrainCircuit className="h-4 w-4 text-indigo-600" />
              Pamięć kontekstowa bota ({activeTiles.length} aktywnych kafelków)
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              ~{estimatedActiveTokens.toLocaleString('pl-PL')} / 1 000 000 tokenów
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all"
              style={{ width: `${Math.max(2, contextPercent)}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={checkingConsistency || activeTiles.length === 0}
            onClick={() => void handleRunConsistencyCheck()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-600 disabled:opacity-50"
          >
            {checkingConsistency ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5 text-indigo-300" />
            )}
            Sprawdź spójność bazy AI
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Eksport JSON
          </button>
          <button
            type="button"
            onClick={() => importJsonRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Upload className="h-3.5 w-3.5" />
            Import JSON
          </button>
          <input
            ref={importJsonRef}
            type="file"
            accept=".json"
            onChange={(e) => void handleImportJson(e)}
            className="hidden"
          />
          <button
            type="button"
            onClick={onResetPreset}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Przywróć domyślne
          </button>
        </div>
      </div>

      {/* Consistency Report Panel */}
      {consistencyReport && (
        <div className="soft-card animate-enter rounded-3xl border border-indigo-200/80 bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className={`rounded-xl px-3 py-1 text-xs font-extrabold text-white ${
                  consistencyReport.score >= 85
                    ? 'bg-emerald-600'
                    : consistencyReport.score >= 60
                      ? 'bg-amber-500'
                      : 'bg-rose-600'
                }`}
              >
                Spójność: {consistencyReport.score}%
              </span>
              <h3 className="text-sm font-bold text-slate-900">Raport Jakości Bazy Wiedzy</h3>
            </div>
            <button
              type="button"
              onClick={() => setConsistencyReport(null)}
              className="text-xs font-semibold text-slate-400 hover:text-slate-700"
            >
              Zamknij raport
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-600">{consistencyReport.summary}</p>
          {consistencyReport.conflicts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
                Wykryte sprzeczności ({consistencyReport.conflicts.length}):
              </p>
              {consistencyReport.conflicts.map((c, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-900"
                >
                  <p className="font-bold">{c.title}</p>
                  <p className="mt-0.5 text-rose-800">{c.detail}</p>
                </div>
              ))}
            </div>
          )}
          {consistencyReport.gaps.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-950">
              <p className="font-bold">Sugerowane braki do uzupełnienia:</p>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {consistencyReport.gaps.map((g, gi) => (
                  <li key={gi}>{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Creator Card ("Naucz mnie") */}
      <div className="soft-card rounded-3xl border border-slate-200/80 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Moduł „Naucz mnie” — Dodaj wiedzę do bota</h3>
            <p className="text-xs text-slate-500">
              Wszystko, co tu dodasz, natychmiast zasila Eksperta AI, Audytor Dokumentów oraz Multi-Agent Workflow.
            </p>
          </div>
          <div className="flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setCreatorTab('ai')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                creatorTab === 'ai' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI Smart Ingest (PDF / Notatki)
            </button>
            <button
              type="button"
              onClick={() => setCreatorTab('manual')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                creatorTab === 'manual' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              <BookPlus className="h-3.5 w-3.5" />
              {editingId ? 'Edycja kafelka' : 'Ręczny wpis / Szablony'}
            </button>
          </div>
        </div>

        {/* Quick Rule Templates Bar */}
        <div className="flex flex-wrap items-center gap-2 border-y border-slate-100 py-2.5">
          <span className="text-[11px] font-semibold text-slate-400">Gotowe szablony reguł:</span>
          {QUICK_RULE_TEMPLATES.map((tpl, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleApplyTemplate(tpl)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            >
              {tpl.label}
            </button>
          ))}
        </div>

        {creatorTab === 'ai' ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/70 p-4 text-center transition hover:border-indigo-400 hover:bg-indigo-50/40"
              >
                <FileUp className="mb-2 h-6 w-6 text-indigo-600" />
                <p className="text-xs font-semibold text-slate-700">
                  {ingestFile ? ingestFile.name : 'Wgraj PDF, Word (.docx), CSV lub zdjęcie'}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  AI samo streści dokument w kafelki
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.csv,.tsv,image/*"
                  onChange={(e) => void handleIngestFileSelect(e)}
                  className="hidden"
                />
              </div>

              <textarea
                rows={4}
                value={ingestText}
                onChange={(e) => setIngestText(e.target.value)}
                placeholder="Albo wklej tutaj surowe notatki firmowe, regulamin, cennik lub odpowiedzi z maili — Gemini AI automatycznie uporządkuje je w kafelki wiedzy..."
                className="md:col-span-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
              <span className="text-[11px] font-semibold text-slate-600">Lub pobierz ze strony WWW (URL):</span>
              <input
                type="url"
                value={ingestUrl}
                onChange={(e) => setIngestUrl(e.target.value)}
                placeholder="https://twojafirma.pl/oferta-lub-cennik"
                className="min-w-[240px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500"
              />
            </div>

            {ingestError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {ingestError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={ingesting || (!ingestText.trim() && !ingestFile && !ingestUrl.trim())}
                onClick={() => void handleRunIngest()}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
              >
                {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Przetwórz przez AI i przygotuj kafelki
              </button>
            </div>

            {stagedTiles.length > 0 && (
              <div className="mt-4 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-indigo-950">
                      Podgląd wyodrębnionej wiedzy ({stagedTiles.length} kafelki):
                    </p>
                    {ingestSummary && <p className="text-[11px] text-indigo-800">{ingestSummary}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStagedTiles([])}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
                    >
                      Odrzuć
                    </button>
                    <button
                      type="button"
                      onClick={handleCommitStaged}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Zapisz w bazie bota
                    </button>
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {stagedTiles.map((st, i) => (
                    <div key={i} className="rounded-xl border border-indigo-100 bg-white p-3 text-xs">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">{st.title}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          {st.category}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">
                        {st.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleManualSave} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Tytuł kafelka (np. Warunki gwarancji)"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'internal')}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
              >
                <option value="public">Publiczna (Klient + Zespół)</option>
                <option value="internal">Poufna (Tylko Zespół / Audyt)</option>
              </select>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'standard' | 'critical')}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
              >
                <option value="standard">Priorytet: Standard</option>
                <option value="critical">Priorytet: Krytyczna Reguła</option>
              </select>
            </div>
            <textarea
              rows={4}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Wpisz dokładne zasady, parametry, ceny lub procedury, którymi bot ma się kierować..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />
            <div className="flex justify-end gap-2">
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setTitle('');
                    setContent('');
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600"
                >
                  Anuluj edycję
                </button>
              )}
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                {editingId ? 'Zaktualizuj kafelek' : 'Dodaj do bazy wiedzy'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Filter & Tiles Grid */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Szukaj w bazie wiedzy..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {['Wszystkie', ...CATEGORIES].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                  categoryFilter === cat
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/70 bg-white/80 px-3.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold text-slate-500">Szybki filtr:</span>
            {[
              { id: 'all', label: `Wszystkie (${tiles.length})` },
              { id: 'critical', label: `Krytyczne (${tiles.filter((t) => t.priority === 'critical').length})` },
              { id: 'internal', label: `Poufne (${tiles.filter((t) => t.visibility === 'internal').length})` },
              { id: 'disabled', label: `Wyłączone (${tiles.filter((t) => !t.enabled).length})` },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id as 'all' | 'critical' | 'internal' | 'disabled')}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                  statusFilter === item.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {filteredTiles.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleBulkToggleFiltered(true)}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                Włącz widoczne ({filteredTiles.length})
              </button>
              <button
                type="button"
                onClick={() => handleBulkToggleFiltered(false)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
              >
                Wyłącz widoczne
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {filteredTiles.map((tile) => (
            <div
              key={tile.id}
              className={`flex flex-col justify-between rounded-2xl border bg-white p-4 shadow-xs transition ${
                tile.enabled ? 'border-slate-200' : 'border-slate-200/70 bg-slate-50/70 opacity-65'
              }`}
            >
              <div>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                      {tile.category}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        tile.visibility === 'internal'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {tile.visibility === 'internal' ? (
                        <EyeOff className="h-2.5 w-2.5" />
                      ) : (
                        <Eye className="h-2.5 w-2.5" />
                      )}
                      {tile.visibility === 'internal' ? 'Tylko zespół' : 'Publiczny'}
                    </span>
                    {tile.priority === 'critical' && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                        <ShieldAlert className="h-2.5 w-2.5" />
                        Krytyczna Reguła
                      </span>
                    )}
                    {Date.now() - Date.parse(tile.updatedAt || '') > 60 * 86400000 && (
                      <button
                        type="button"
                        onClick={() =>
                          onTilesChange(
                            tiles.map((t) =>
                              t.id === tile.id
                                ? { ...t, updatedAt: new Date().toISOString().slice(0, 10) }
                                : t
                            )
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 hover:bg-amber-200"
                        title="Reguła starsza niż 60 dni — kliknij, aby potwierdzić aktualność"
                      >
                        Do weryfikacji (&gt;60 dni) • Odśwież
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onTilesChange(
                        tiles.map((t) => (t.id === tile.id ? { ...t, enabled: !t.enabled } : t))
                      )
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                      tile.enabled ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                    title={tile.enabled ? 'Wyłącz kafelek' : 'Włącz kafelek'}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                        tile.enabled ? 'translate-x-4.5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <h4 className="text-sm font-bold text-slate-900">{tile.title}</h4>
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-600 line-clamp-5">
                  {tile.content}
                </p>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-400">
                <span className="font-mono">
                  {tile.id} • ~{estimateTokens(tile.content)} tok.
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      onTestTileInChat(`Wyjaśnij szczegółowo zasady z dokumentu: "${tile.title}"`)
                    }
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50"
                    title="Przetestuj ten kafelek w Czacie AI"
                  >
                    <MessageSquare className="h-3 w-3" />
                    Testuj w Czacie
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartEdit(tile)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                    title="Edytuj"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onTilesChange(tiles.filter((t) => t.id !== tile.id))}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                    title="Usuń"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
