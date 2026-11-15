import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  BookPlus,
  BrainCircuit,
  Check,
  CheckSquare,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileUp,
  GraduationCap,
  Layers,
  Loader2,
  MessageSquare,
  Network,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Square,
  StopCircle,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AppLanguage,
  ChatMessage,
  IndustryPreset,
  KnowledgeConsistencyResult,
  KnowledgeTile,
  MascotMood,
} from '../types';
import {
  estimateTokens,
  fileToBase64,
  runAutoDistillKnowledge,
  runKnowledgeConsistencyCheck,
  runSmartIngest,
} from '../utils/apiClient';
import {
  chunkBookOrLargeText,
  readDocumentForStudio,
  type ScannedPdfPageImage,
} from '../utils/documentReader';
import { KnowledgeGraphCanvas } from './KnowledgeGraphCanvas';

interface StagedKnowledgeTile {
  title: string;
  category: string;
  visibility: 'public' | 'internal';
  priority?: 'standard' | 'critical';
  content: string;
}

function normalizeWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  return new Set(words);
}

function findSimilarTiles(
  candidateTitle: string,
  candidateContent: string,
  existing: KnowledgeTile[],
  excludeId?: string | null
): KnowledgeTile[] {
  const cleanTitle = candidateTitle.trim().toLowerCase();
  if (!cleanTitle) return [];
  const titleWords = normalizeWords(cleanTitle);
  const contentWords = normalizeWords(candidateContent.slice(0, 320));

  const matches: Array<{ tile: KnowledgeTile; score: number }> = [];
  for (const tile of existing) {
    if (excludeId && tile.id === excludeId) continue;
    const tLow = tile.title.trim().toLowerCase();
    if (tLow === cleanTitle || (cleanTitle.length >= 6 && (tLow.includes(cleanTitle) || cleanTitle.includes(tLow)))) {
      matches.push({ tile, score: 1 });
      continue;
    }
    const existingTitleWords = normalizeWords(tLow);
    if (titleWords.size > 0 && existingTitleWords.size > 0) {
      let common = 0;
      for (const w of titleWords) {
        if (existingTitleWords.has(w)) common++;
      }
      const jaccard = common / Math.max(1, titleWords.size + existingTitleWords.size - common);
      if (jaccard >= 0.45) {
        matches.push({ tile, score: jaccard });
        continue;
      }
    }
    if (contentWords.size >= 6) {
      const existingContentWords = normalizeWords(tile.content.slice(0, 320));
      let commonC = 0;
      for (const w of contentWords) {
        if (existingContentWords.has(w)) commonC++;
      }
      const jaccardC = commonC / Math.max(1, contentWords.size + existingContentWords.size - commonC);
      if (jaccardC >= 0.55) {
        matches.push({ tile, score: jaccardC * 0.8 });
      }
    }
  }
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m) => m.tile);
}

interface KnowledgeViewProps {
  preset: IndustryPreset;
  tiles: KnowledgeTile[];
  language: AppLanguage;
  messages?: ChatMessage[];
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

const CATEGORIES = [
  'Wyuczone przez AI',
  'Oferta',
  'Technologia',
  'Finanse & VAT',
  'Logistyka',
  'Procedury',
  'Sprzedaż',
  'Wewnętrzne',
];

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
  messages = [],
  onTilesChange,
  onResetPreset,
  onTestTileInChat,
  onMascotUpdate,
  onLogAiCall,
}) => {
  const [creatorTab, setCreatorTab] = useState<'ai' | 'auto_learn' | 'manual'>('ai');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('Wszystkie');
  const [statusFilter, setStatusFilter] = useState<'all' | 'critical' | 'internal' | 'disabled'>('all');

  // Auto-Learn state
  const [autoLearning, setAutoLearning] = useState(false);
  const [autoLearnSuccessMsg, setAutoLearnSuccessMsg] = useState<string | null>(null);

  // AI Smart Ingest & Book / Large PDF state
  const [ingestText, setIngestText] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestFile, setIngestFile] = useState<{ name: string; mimeType: string; base64: string } | null>(null);
  const [bookMeta, setBookMeta] = useState<{
    fileName: string;
    kind: 'pdf_text' | 'pdf_scan' | 'docx' | 'text';
    pageCount?: number;
    dimensionsSummary?: string;
    charCount: number;
    scannedPages?: ScannedPdfPageImage[];
  } | null>(null);
  const [bookMode, setBookMode] = useState<'auto' | 'book' | 'standard'>('auto');
  const [readingProgress, setReadingProgress] = useState<{ label: string; percent: number } | null>(null);
  const [ingestProgress, setIngestProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [checkingConsistency, setCheckingConsistency] = useState(false);
  const [consistencyReport, setConsistencyReport] = useState<KnowledgeConsistencyResult | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [stagedTiles, setStagedTiles] = useState<StagedKnowledgeTile[]>([]);
  const [ingestSummary, setIngestSummary] = useState<string | null>(null);
  const [selectedTileIds, setSelectedTileIds] = useState<Set<string>>(new Set());
  const [highlightedTitles, setHighlightedTitles] = useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = useState('Oferta');
  const ingestAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importJsonRef = useRef<HTMLInputElement>(null);

  // Manual add / Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Oferta');
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  const [priority, setPriority] = useState<'standard' | 'critical'>('standard');
  const [content, setContent] = useState('');

  const manualSimilarTiles = useMemo(() => {
    if (title.trim().length < 4) return [];
    return findSimilarTiles(title, content, tiles, editingId);
  }, [title, content, tiles, editingId]);

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
    e.target.value = '';

    if (file.type.startsWith('image/')) {
      const base64 = await fileToBase64(file);
      setBookMeta(null);
      setIngestFile({
        name: file.name,
        mimeType: file.type || 'image/jpeg',
        base64,
      });
      return;
    }

    setReadingProgress({ label: `Otwieram „${file.name}” i sprawdzam wymiary...`, percent: 8 });
    try {
      const parsed = await readDocumentForStudio(file, (label, percent) => {
        setReadingProgress({ label, percent });
      });
      setIngestFile(null);
      setBookMeta({
        fileName: parsed.fileName,
        kind: parsed.kind,
        pageCount: parsed.pageCount,
        dimensionsSummary: parsed.dimensionsSummary,
        charCount: parsed.charCount,
        scannedPages: parsed.scannedPages,
      });

      if (parsed.text.trim()) {
        setIngestText((prev) =>
          prev.trim() ? `${prev}\n\n${parsed.text}` : parsed.text
        );
      }

      if (parsed.charCount > 15000 || (parsed.pageCount ?? 0) > 8 || parsed.kind === 'pdf_scan') {
        setBookMode('book');
      } else {
        setBookMode('auto');
      }

      const dimsInfo = parsed.dimensionsSummary ? ` • Wymiary: ${parsed.dimensionsSummary}` : '';
      const scanInfo =
        parsed.kind === 'pdf_scan' && parsed.scannedPages
          ? ` (wykryto skan — przygotowano ${parsed.scannedPages.length} stron adaptacyjnie)`
          : '';
      onMascotUpdate(
        'happy',
        `Wczytałem „${parsed.fileName}”${dimsInfo}${scanInfo}. Kliknij „Przetwórz przez AI”, aby ustrukturyzować wiedzę.`
      );
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'Nie udało się odczytać pliku.');
    } finally {
      setReadingProgress(null);
    }
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

  const handleStopIngest = () => {
    ingestAbortRef.current?.abort();
  };

  const handleRunIngest = async () => {
    const hasScanPages = Boolean(bookMeta?.kind === 'pdf_scan' && bookMeta.scannedPages?.length);
    if (!ingestText.trim() && !ingestFile && !ingestUrl.trim() && !hasScanPages) return;

    const controller = new AbortController();
    ingestAbortRef.current = controller;
    setIngesting(true);
    setIngestError(null);
    setIngestProgress(null);
    onMascotUpdate('thinking', 'Analizuję materiał, wykrywam strukturę i tworzę kafelki wiedzy...');

    const accumulated: StagedKnowledgeTile[] = [];
    const seenTitleKeys = new Set<string>(tiles.map((t) => t.title.trim().toLowerCase()));
    const dynamicExistingTitles = tiles.map((t) => t.title);
    let totalPrompt = 0;
    let totalCandidates = 0;
    let totalTokens = 0;
    let totalLatency = 0;
    const notes: string[] = [];

    const pushUniqueTiles = (incoming: StagedKnowledgeTile[]) => {
      const addedNow: StagedKnowledgeTile[] = [];
      for (const item of incoming) {
        const key = item.title.trim().toLowerCase();
        if (!key) continue;
        // Pozwól dodać nowe jeśli nie ma identycznego duplikatu w ramach bieżącego importu
        const alreadyInBatch = accumulated.some((a) => a.title.trim().toLowerCase() === key);
        if (!alreadyInBatch) {
          accumulated.push(item);
          addedNow.push(item);
          if (!seenTitleKeys.has(key)) {
            seenTitleKeys.add(key);
            dynamicExistingTitles.push(item.title);
          }
        }
      }
      if (addedNow.length > 0) {
        setStagedTiles([...accumulated]);
      }
    };

    try {
      const effectiveName = bookMeta?.fileName || ingestFile?.name || ingestUrl.trim() || 'Notatki / Książka';

      if (hasScanPages && bookMeta?.scannedPages?.length) {
        const pages = bookMeta.scannedPages;
        const batchSize = 4;
        const totalBatches = Math.ceil(pages.length / batchSize);

        for (let b = 0; b < totalBatches; b++) {
          if (controller.signal.aborted) break;
          const slice = pages.slice(b * batchSize, (b + 1) * batchSize);
          const rangeLabel = `Strony ${slice[0].pageNum}–${slice[slice.length - 1].pageNum} (${slice[0].dimensionsLabel})`;
          setIngestProgress({
            current: b + 1,
            total: totalBatches,
            label: `Analizuję skan PDF: ${rangeLabel}...`,
          });

          const res = await runSmartIngest({
            companyName: preset.name,
            language,
            fileName: effectiveName,
            rawText: b === 0 && ingestText.trim() ? ingestText.slice(0, 6000) : undefined,
            ingestMode: 'scan_pages',
            chunkIndex: b,
            totalChunks: totalBatches,
            chapterHint: rangeLabel,
            existingTileTitles: dynamicExistingTitles.slice(-80),
            pageImages: slice.map((p) => ({
              pageNumber: p.pageNum,
              label: p.dimensionsLabel,
              base64: p.base64,
              mimeType: p.mimeType,
            })),
            signal: controller.signal,
          });
          totalPrompt += res.usage.promptTokens;
          totalCandidates += res.usage.candidatesTokens;
          totalTokens += res.usage.totalTokens;
          totalLatency += res.latencyMs;
          if (res.summaryNote) notes.push(res.summaryNote);
          pushUniqueTiles(res.tiles);
        }
      } else {
        const trimmedText = ingestText.trim();
        const shouldUseBookMode =
          !ingestFile &&
          !ingestUrl.trim() &&
          (bookMode === 'book' || trimmedText.length > 16000);

        if (shouldUseBookMode && trimmedText.length > 0) {
          const chunks = chunkBookOrLargeText(trimmedText, 16000);
          for (const ch of chunks) {
            if (controller.signal.aborted) break;
            setIngestProgress({
              current: ch.index + 1,
              total: ch.total,
              label: `Strukturyzuję rozdział ${ch.index + 1}/${ch.total}: ${ch.chapterHint}`,
            });

            const res = await runSmartIngest({
              companyName: preset.name,
              language,
              fileName: effectiveName,
              rawText: ch.text,
              ingestMode: 'book',
              chunkIndex: ch.index,
              totalChunks: ch.total,
              chapterHint: ch.chapterHint,
              existingTileTitles: dynamicExistingTitles.slice(-80),
              signal: controller.signal,
            });
            totalPrompt += res.usage.promptTokens;
            totalCandidates += res.usage.candidatesTokens;
            totalTokens += res.usage.totalTokens;
            totalLatency += res.latencyMs;
            if (res.summaryNote) notes.push(res.summaryNote);
            pushUniqueTiles(res.tiles);
          }
        } else {
          setIngestProgress({
            current: 1,
            total: 1,
            label: 'Przetwarzam materiał przez Gemini AI...',
          });
          const res = await runSmartIngest({
            companyName: preset.name,
            language,
            fileName: effectiveName,
            rawText: trimmedText,
            sourceUrl: ingestUrl.trim() || undefined,
            fileBase64: ingestFile?.base64,
            fileMimeType: ingestFile?.mimeType,
            ingestMode: 'standard',
            existingTileTitles: dynamicExistingTitles.slice(-60),
            signal: controller.signal,
          });
          totalPrompt += res.usage.promptTokens;
          totalCandidates += res.usage.candidatesTokens;
          totalTokens += res.usage.totalTokens;
          totalLatency += res.latencyMs;
          if (res.summaryNote) notes.push(res.summaryNote);
          pushUniqueTiles(res.tiles);
        }
      }

      setIngestSummary(
        notes.length > 1
          ? `Ustrukturyzowano w ${notes.length} etapach: ${notes[0]} ... (${accumulated.length} kafelków)`
          : notes[0] || `Wyodrębniono ${accumulated.length} kafelków wiedzy.`
      );
      onMascotUpdate('happy', `Gotowe! Ustrukturyzowałem ${accumulated.length} kafelków wiedzy.`);
      if (totalTokens > 0) {
        onLogAiCall({
          action: 'ingest',
          latencyMs: totalLatency,
          promptTokens: totalPrompt,
          candidatesTokens: totalCandidates,
          totalTokens,
          status: 'success',
          summary: `Naucz mnie AI: wygenerowano ${accumulated.length} kafelki (${effectiveName})`,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setIngestSummary(
          `Przerwano na żądanie użytkownika — zachowano ${accumulated.length} wyodrębnionych kafelków do zatwierdzenia.`
        );
        onMascotUpdate('happy', `Zatrzymano przetwarzanie — zachowałem ${accumulated.length} dotychczasowych kafelków!`);
      } else {
        const msg = err instanceof Error ? err.message : 'Błąd przetwarzania wiedzy';
        setIngestError(msg);
        onMascotUpdate('alert', 'Nie udało się przetworzyć materiału.');
      }
    } finally {
      setIngesting(false);
      setIngestProgress(null);
      ingestAbortRef.current = null;
    }
  };

  const handleCommitStaged = () => {
    const nowDate = new Date().toISOString().slice(0, 10);
    const created: KnowledgeTile[] = stagedTiles.map((st, idx) => ({
      id: `custom_${Date.now()}_${idx}`,
      title: st.title,
      category: st.category || 'Oferta',
      visibility: st.visibility === 'internal' ? 'internal' : 'public',
      priority: st.priority === 'critical' ? 'critical' : 'standard',
      content: st.content,
      enabled: true,
      updatedAt: nowDate,
    }));
    onTilesChange([...created, ...tiles]);
    setStagedTiles([]);
    setIngestSummary(null);
    setIngestText('');
    setIngestFile(null);
    setBookMeta(null);
    setAutoLearnSuccessMsg(null);
    onMascotUpdate('happy', 'Nowa wiedza zapisana! Już z niej korzystam w czacie, odpowiedziach i audycie.');
  };

  const handleRunAutoLearn = async () => {
    setAutoLearning(true);
    setIngestError(null);
    setAutoLearnSuccessMsg(null);
    onMascotUpdate('thinking', 'Analizuję historię pytań i syntetyzuję nową wiedzę...');

    try {
      // Przygotuj dialogi z wiadomości czatu
      const dialogs: Array<{ question: string; answer: string; webFactsUsed?: string[] }> = [];
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user' && messages[i + 1]?.role === 'assistant') {
          dialogs.push({
            question: messages[i].content,
            answer: messages[i + 1].content,
            webFactsUsed: messages[i + 1].webFactsUsed,
          });
        }
      }

      // Jeśli w obecnej sesji nie ma dialogów, użyj przykładowych najczęstszych pytań presetów
      const fallbackQuestions = preset.suggestedQuestions.client.concat(preset.suggestedQuestions.internal);
      const queryList =
        dialogs.length > 0
          ? dialogs
          : fallbackQuestions.slice(0, 4).map((q) => ({
              question: q,
              answer: 'Odpowiedź doradcy handlowego dotycząca standardu i procedur.',
            }));

      const res = await runAutoDistillKnowledge({
        companyName: preset.name,
        companyIndustry: preset.industry,
        language,
        dialogs: queryList,
        knowledgeTiles: tiles,
      });

      if (res.newTilesDiscovered && res.newTilesDiscovered.length > 0) {
        setStagedTiles(res.newTilesDiscovered);
        setIngestSummary(res.learningSummary);
        setAutoLearnSuccessMsg(`AI odkryło ${res.newTilesDiscovered.length} nowe kafelki wiedzy z analizy zapytań!`);
        onMascotUpdate('happy', `Nowa wiedza wygenerowana z ${queryList.length} zapytań!`);
      } else {
        setAutoLearnSuccessMsg(
          res.learningSummary ||
            'Twoja Baza Wiedzy w pełni pokrywa dotychczasowe zapytania — brak brakujących kafelków!'
        );
        onMascotUpdate('curious', 'Baza wiedzy jest kompletna na ten moment!');
      }

      onLogAiCall({
        action: 'ingest',
        latencyMs: res.latencyMs,
        promptTokens: res.usage.promptTokens,
        candidatesTokens: res.usage.candidatesTokens,
        totalTokens: res.usage.totalTokens,
        status: 'success',
        summary: `Samouczenie AI (Auto-Learn): przeanalizowano ${queryList.length} zapytań`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd samouczenia AI';
      setIngestError(msg);
      onMascotUpdate('alert', 'Nie udało się przeprowadzić samouczenia.');
    } finally {
      setAutoLearning(false);
    }
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
    if (highlightedTitles.length > 0) {
      const normalized = t.title.trim().toLowerCase();
      return highlightedTitles.some(
        (ht) => normalized.includes(ht.trim().toLowerCase()) || ht.trim().toLowerCase().includes(normalized)
      );
    }
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

  const toggleSelectTile = (id: string) => {
    setSelectedTileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    if (filteredTiles.length === 0) return;
    const allSelected = filteredTiles.every((t) => selectedTileIds.has(t.id));
    if (allSelected) {
      setSelectedTileIds(new Set());
    } else {
      setSelectedTileIds(new Set(filteredTiles.map((t) => t.id)));
    }
  };

  const handleBulkSelectedAction = (
    action: 'enable' | 'disable' | 'delete' | 'category',
    newCategory?: string
  ) => {
    if (selectedTileIds.size === 0) return;
    if (action === 'delete') {
      onTilesChange(tiles.filter((t) => !selectedTileIds.has(t.id)));
      setSelectedTileIds(new Set());
      return;
    }
    onTilesChange(
      tiles.map((t) => {
        if (!selectedTileIds.has(t.id)) return t;
        if (action === 'enable') return { ...t, enabled: true };
        if (action === 'disable') return { ...t, enabled: false };
        if (action === 'category' && newCategory) return { ...t, category: newCategory };
        return t;
      })
    );
    setSelectedTileIds(new Set());
  };

  const handleJumpToConflict = (affectedTitles: string[]) => {
    setHighlightedTitles(affectedTitles.length > 0 ? affectedTitles : []);
    setCategoryFilter('Wszystkie');
    setStatusFilter('all');
    setSearch('');
    document.getElementById('knowledge-tiles-grid')?.scrollIntoView({ behavior: 'smooth' });
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
          <div className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 border border-emerald-200/80 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Neon Postgres (Chmura na żywo)</span>
          </div>

          <button
            type="button"
            onClick={() => {
              onTilesChange([...tiles]);
              onMascotUpdate('happy', `Wysłano ${tiles.length} kafelków do chmury Neon!`);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:brightness-110 active:scale-95"
            title="Wyślij wszystkie kafelki z komputera do chmury Neon, aby natychmiast zsynchronizowały się na telefonie"
          >
            <Upload className="h-3.5 w-3.5" />
            Wymuś Sync do Chmury ({tiles.length})
          </button>

          <button
            type="button"
            onClick={() => setShowGraph((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-bold transition shadow-2xs ${
              showGraph
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700'
            }`}
            title="Wizualna mapa topologii i powiązań w Bazie Wiedzy"
          >
            <Network className="h-3.5 w-3.5 text-indigo-600" />
            {showGraph ? 'Ukryj mapę wiedzy' : 'Mapa wiedzy (Graf)'}
          </button>

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

      {/* Knowledge Graph Canvas */}
      {showGraph && (
        <KnowledgeGraphCanvas
          tiles={tiles}
          onSelectTile={(t) => {
            handleStartEdit(t);
            setShowGraph(false);
          }}
          onClose={() => setShowGraph(false)}
        />
      )}

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
                Wykryte sprzeczności ({consistencyReport.conflicts.length}) — kliknij kafelek, aby przejść do edycji:
              </p>
              {consistencyReport.conflicts.map((c, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-900 space-y-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">{c.title}</p>
                      <p className="mt-0.5 text-rose-800">{c.detail}</p>
                    </div>
                    {c.affectedTileTitles?.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleJumpToConflict(c.affectedTileTitles)}
                        className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                      >
                        Pokaż kafelki ({c.affectedTileTitles.length})
                      </button>
                    )}
                  </div>
                  {c.affectedTileTitles?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {c.affectedTileTitles.map((tTitle, ti) => (
                        <button
                          key={ti}
                          type="button"
                          onClick={() => handleJumpToConflict([tTitle])}
                          className="rounded-md border border-rose-200 bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-rose-800 hover:border-rose-400 hover:bg-rose-100"
                        >
                          {tTitle} →
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {consistencyReport.gaps.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3.5 text-xs text-amber-950 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-bold flex items-center gap-1.5 text-amber-900">
                  <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                  Sugerowane braki do uzupełnienia ({consistencyReport.gaps.length}):
                </p>
                <span className="text-[10px] text-amber-700">Kliknij lukę, aby utworzyć nowy kafelek:</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {consistencyReport.gaps.map((g, gi) => (
                  <div
                    key={gi}
                    className="flex items-start justify-between gap-2 rounded-xl border border-amber-200/80 bg-white/90 p-2.5 shadow-2xs hover:border-amber-400 transition"
                  >
                    <span className="text-[11px] text-slate-700 leading-snug">{g}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setTitle(g.slice(0, 50));
                        setContent(`[Uzupełnienie luki wiedzy]: ${g}\n\nWpisz tutaj szczegółowe wytyczne techniczne lub biznesowe...`);
                        setCategory('Oferta');
                        setCreatorTab('manual');
                        const creatorElem = document.getElementById('knowledge-creator-card');
                        creatorElem?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="shrink-0 rounded-lg bg-amber-500 px-2 py-1 text-[10px] font-bold text-slate-950 hover:bg-amber-400 transition shadow-xs"
                    >
                      + Uzupełnij
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Creator Card ("Naucz mnie") */}
      <div id="knowledge-creator-card" className="soft-card rounded-3xl border border-slate-200/80 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Moduł „Naucz mnie” — Dodaj wiedzę do bota</h3>
            <p className="text-xs text-slate-500">
              Wszystko, co tu dodasz, natychmiast zasila Eksperta AI, Audytor Dokumentów oraz Multi-Agent Workflow.
            </p>
          </div>
          <div className="flex flex-wrap rounded-xl bg-slate-100 p-1">
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
              onClick={() => setCreatorTab('auto_learn')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                creatorTab === 'auto_learn' ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-xs' : 'text-purple-700 hover:text-purple-900'
              }`}
            >
              <GraduationCap className="h-3.5 w-3.5" />
              Samouczenie AI (Auto-Learn)
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
                  {bookMeta
                    ? bookMeta.fileName
                    : ingestFile
                      ? ingestFile.name
                      : 'Wgraj książkę PDF (dowolne wymiary), DOCX, TXT lub skan'}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Obsługa dużych PDF (A5–A1, skany) i podział na rozdziały
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json,image/*"
                  onChange={(e) => void handleIngestFileSelect(e)}
                  className="hidden"
                />
              </div>

              <textarea
                rows={4}
                value={ingestText}
                onChange={(e) => setIngestText(e.target.value)}
                placeholder="Albo wklej tutaj książki, obszerne poradniki, regulamin, cennik lub odpowiedzi z maili — Gemini AI automatycznie podzieli treść na logiczne sekcje i uporządkuje je w kafelki..."
                className="md:col-span-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
              />
            </div>

            {readingProgress && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-900">
                  <span>{readingProgress.label}</span>
                  <span>{readingProgress.percent}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-200">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-all"
                    style={{ width: `${readingProgress.percent}%` }}
                  />
                </div>
              </div>
            )}

            {bookMeta && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[11px] text-emerald-900">
                <div className="flex flex-wrap items-center gap-2">
                  <BookOpen className="h-4 w-4 text-emerald-600" />
                  <span className="font-bold">{bookMeta.fileName}</span>
                  {bookMeta.pageCount && (
                    <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-700 border border-emerald-200">
                      {bookMeta.pageCount} str.
                    </span>
                  )}
                  {bookMeta.dimensionsSummary && (
                    <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-700 border border-emerald-200">
                      Wymiary: {bookMeta.dimensionsSummary}
                    </span>
                  )}
                  <span className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-600 border border-emerald-200">
                    {bookMeta.kind === 'pdf_scan'
                      ? `Skan PDF (${bookMeta.scannedPages?.length ?? 0} str.)`
                      : `${bookMeta.charCount.toLocaleString('pl-PL')} znaków`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBookMeta(null);
                    setIngestText('');
                    setIngestFile(null);
                  }}
                  className="text-slate-500 hover:text-rose-600"
                  title="Wyczyść wczytany plik"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                <span className="text-[11px] font-semibold text-slate-600">Lub adres WWW (URL):</span>
                <input
                  type="url"
                  value={ingestUrl}
                  onChange={(e) => setIngestUrl(e.target.value)}
                  placeholder="https://twojafirma.pl/oferta-lub-cennik"
                  className="min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-[11px]">
                <Layers className="ml-1.5 h-3.5 w-3.5 text-indigo-600" />
                {[
                  { id: 'auto', label: 'Auto' },
                  { id: 'book', label: 'Książka / Duży PDF' },
                  { id: 'standard', label: 'Krótki tekst' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setBookMode(opt.id as 'auto' | 'book' | 'standard')}
                    className={`rounded-md px-2 py-1 font-semibold transition ${
                      bookMode === opt.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {ingestError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {ingestError}
              </div>
            )}

            {ingestProgress && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                    <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                    <span>{ingestProgress.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-indigo-700">
                      Część {ingestProgress.current} / {ingestProgress.total}
                    </span>
                    <button
                      type="button"
                      onClick={handleStopIngest}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
                    >
                      <StopCircle className="h-3.5 w-3.5" />
                      Przerwij i zachowaj
                    </button>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-sky-500 transition-all"
                    style={{ width: `${Math.round((ingestProgress.current / Math.max(1, ingestProgress.total)) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={
                  ingesting ||
                  (!ingestText.trim() &&
                    !ingestFile &&
                    !ingestUrl.trim() &&
                    !(bookMeta?.kind === 'pdf_scan' && bookMeta.scannedPages?.length))
                }
                onClick={() => void handleRunIngest()}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
              >
                {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Przetwórz przez AI i uporządkuj w kafelki
              </button>
            </div>

            {stagedTiles.length > 0 && (
              <div className="mt-4 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-indigo-950">
                      Podgląd uporządkowanej wiedzy ({stagedTiles.length} kafelków):
                    </p>
                    {ingestSummary && <p className="text-[11px] text-indigo-800">{ingestSummary}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setStagedTiles((prev) =>
                          prev.filter((st) => findSimilarTiles(st.title, st.content, tiles).length === 0)
                        );
                      }}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
                    >
                      Usuń duplikaty istniejących
                    </button>
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
                      Zapisz w bazie bota ({stagedTiles.length})
                    </button>
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {stagedTiles.map((st, i) => {
                    const similarExisting = findSimilarTiles(st.title, st.content, tiles);
                    return (
                      <div key={i} className="rounded-xl border border-indigo-100 bg-white p-3 text-xs space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-slate-900">{st.title}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <select
                              value={st.category}
                              onChange={(e) =>
                                setStagedTiles((prev) =>
                                  prev.map((item, idx) =>
                                    idx === i ? { ...item, category: e.target.value } : item
                                  )
                                )
                              }
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 outline-none"
                            >
                              {CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                              {!CATEGORIES.includes(st.category) && (
                                <option value={st.category}>{st.category}</option>
                              )}
                            </select>
                            <button
                              type="button"
                              onClick={() => setStagedTiles((prev) => prev.filter((_, idx) => idx !== i))}
                              className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              title="Usuń ten kafelek z importu"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        {similarExisting.length > 0 && (
                          <div className="flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-[10px] font-semibold text-amber-800">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span>Podobny już istnieje: „{similarExisting[0].title}”</span>
                          </div>
                        )}
                        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">
                          {st.content}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : creatorTab === 'auto_learn' ? (
          <div className="space-y-3.5 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50/60 via-white to-indigo-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
                  <GraduationCap className="h-4 w-4 text-purple-600" />
                  Ciągłe Samouczenie AI (Continuous Learning Engine)
                </h4>
                <p className="text-xs text-slate-600 mt-0.5">
                  Gemini AI analizuje realne pytania i odpowiedzi ze wszystkich rozmów, identyfikuje luki i automatycznie syntetyzuje nową wiedzę w dedykowanej grupie <strong className="text-purple-800">„Wyuczone przez AI”</strong>.
                </p>
              </div>
              <button
                type="button"
                disabled={autoLearning}
                onClick={handleRunAutoLearn}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-purple-600/20 hover:brightness-110 disabled:opacity-60 transition"
              >
                {autoLearning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    AI analizuje i uczy się...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Uruchom samouczenie z pytań ({messages.length} wiadomości)
                  </>
                )}
              </button>
            </div>

            {autoLearnSuccessMsg && (
              <div className="rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-950 flex items-start gap-2">
                <Check className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Raport samouczenia:</p>
                  <p className="text-[11px] text-purple-900 mt-0.5">{autoLearnSuccessMsg}</p>
                </div>
              </div>
            )}

            {/* Staged Tiles from Auto-Learn */}
            {stagedTiles.length > 0 && (
              <div className="rounded-2xl border border-purple-300 bg-purple-50/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-purple-900">
                      Odkryto {stagedTiles.length} nowe kafelki wiedzy do zatwierdzenia:
                    </span>
                    {ingestSummary && <p className="text-[11px] text-purple-800">{ingestSummary}</p>}
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
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Zapisz nowo wyuczone kafelki w chmurze Neon
                    </button>
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {stagedTiles.map((st, i) => (
                    <div key={i} className="rounded-xl border border-purple-200 bg-white p-3 text-xs shadow-2xs">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">{st.title}</span>
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-800">
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
            {manualSimilarTiles.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    W bazie istnieje podobny kafelek:{' '}
                    <strong>„{manualSimilarTiles[0].title}”</strong> ({manualSimilarTiles[0].category}). Zamiast duplikować, możesz go zaktualizować.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleStartEdit(manualSimilarTiles[0])}
                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100"
                >
                  Edytuj istniejący
                </button>
              </div>
            )}
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
      <div id="knowledge-tiles-grid" className="space-y-3">
        {highlightedTitles.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-xs text-rose-900">
            <span>
              Pokazuję kafelki powiązane ze sprzecznością:{' '}
              <strong>{highlightedTitles.join(', ')}</strong>
            </span>
            <button
              type="button"
              onClick={() => setHighlightedTitles([])}
              className="rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
            >
              Wyczyść filtr konfliktu
            </button>
          </div>
        )}

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
                onClick={() => {
                  setHighlightedTitles([]);
                  setCategoryFilter(cat);
                }}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                  categoryFilter === cat && highlightedTitles.length === 0
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
                onClick={() => {
                  setHighlightedTitles([]);
                  setStatusFilter(item.id as 'all' | 'critical' | 'internal' | 'disabled');
                }}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                  statusFilter === item.id && highlightedTitles.length === 0
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {filteredTiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                {filteredTiles.every((t) => selectedTileIds.has(t.id)) ? (
                  <CheckSquare className="h-3 w-3" />
                ) : (
                  <Square className="h-3 w-3" />
                )}
                {filteredTiles.every((t) => selectedTileIds.has(t.id))
                  ? 'Odznacz widoczne'
                  : `Zaznacz widoczne (${filteredTiles.length})`}
              </button>
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

        {selectedTileIds.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-300 bg-indigo-950 px-4 py-2.5 text-xs text-white shadow-md">
            <span className="font-bold">
              Zaznaczono: {selectedTileIds.size} kafelków
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleBulkSelectedAction('enable')}
                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500"
              >
                Włącz
              </button>
              <button
                type="button"
                onClick={() => handleBulkSelectedAction('disable')}
                className="rounded-lg bg-slate-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-600"
              >
                Wyłącz
              </button>
              <div className="flex items-center gap-1 rounded-lg bg-slate-900/80 p-1">
                <select
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-white outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleBulkSelectedAction('category', bulkCategory)}
                  className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-indigo-500"
                >
                  Zmień kategorię
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleBulkSelectedAction('delete')}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-500"
              >
                <Trash2 className="h-3 w-3" />
                Usuń zaznaczone
              </button>
              <button
                type="button"
                onClick={() => setSelectedTileIds(new Set())}
                className="rounded-lg px-2 py-1 text-[11px] text-slate-300 hover:text-white"
              >
                Anuluj
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {filteredTiles.map((tile) => {
            const isSelected = selectedTileIds.has(tile.id);
            const isConflictMatch =
              highlightedTitles.length > 0 &&
              highlightedTitles.some(
                (ht) =>
                  tile.title.toLowerCase().includes(ht.toLowerCase()) ||
                  ht.toLowerCase().includes(tile.title.toLowerCase())
              );
            return (
              <div
                key={tile.id}
                className={`flex flex-col justify-between rounded-2xl border bg-white p-4 shadow-xs transition ${
                  isConflictMatch
                    ? 'border-rose-400 ring-2 ring-rose-500/40'
                    : isSelected
                      ? 'border-indigo-400 ring-2 ring-indigo-500/30'
                      : tile.enabled
                        ? 'border-slate-200'
                        : 'border-slate-200/70 bg-slate-50/70 opacity-65'
                }`}
              >
                <div>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleSelectTile(tile.id)}
                        className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
                        title="Zaznacz do operacji grupowych"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-indigo-600" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
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
            );
          })}
        </div>
      </div>
    </div>
  );
};
