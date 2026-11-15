import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  GitBranch,
  Kanban,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  Webhook,
  XCircle,
} from 'lucide-react';
import type {
  AppLanguage,
  CrmDeal,
  DemoAuditScenario,
  IndustryPreset,
  KnowledgeTile,
  MascotMood,
  WorkflowRunResult,
} from '../types';
import { runAgentWorkflow } from '../utils/apiClient';

interface WorkflowViewProps {
  preset: IndustryPreset;
  tiles: KnowledgeTile[];
  language: AppLanguage;
  latestWorkflow: WorkflowRunResult | null;
  onWorkflowComplete: (res: WorkflowRunResult) => void;
  onCreateCrmDeal: (deal: Omit<CrmDeal, 'id' | 'createdAt'>) => void;
  onMascotUpdate: (mood: MascotMood, tip: string) => void;
  onLogAiCall: (entry: {
    action: 'workflow';
    latencyMs: number;
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    status: 'success' | 'error';
    summary: string;
  }) => void;
  onSendWebhookPayload: (payload: Record<string, unknown>, label: string) => Promise<void>;
}

export const WorkflowView: React.FC<WorkflowViewProps> = ({
  preset,
  tiles,
  language,
  latestWorkflow,
  onWorkflowComplete,
  onCreateCrmDeal,
  onMascotUpdate,
  onLogAiCall,
  onSendWebhookPayload,
}) => {
  const [inputTitle, setInputTitle] = useState('');
  const [inputText, setInputText] = useState('');
  const [running, setRunning] = useState(false);
  const [activeStep, setActiveStep] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [dealCreated, setDealCreated] = useState(false);
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [sendingWebhook, setSendingWebhook] = useState(false);

  const executePipeline = async (overrideTitle?: string, overrideText?: string) => {
    const title = (overrideTitle ?? inputTitle).trim() || 'Zgłoszenie B2B';
    const text = (overrideText ?? inputText).trim();
    if (!text || running) return;

    setRunning(true);
    setError(null);
    setDealCreated(false);
    setActiveStep(1);
    onMascotUpdate('thinking', 'Agent 1 (Klasyfikator) analizuje intencję i wartość sprawy...');

    const stepTimer1 = window.setTimeout(() => {
      setActiveStep(2);
      onMascotUpdate('thinking', 'Agent 2 (Audytor) sprawdza zgodność z bazą wiedzy...');
    }, 900);

    const stepTimer2 = window.setTimeout(() => {
      setActiveStep(3);
      onMascotUpdate('thinking', 'Agent 3 (Egzekutor) buduje kartę CRM i szkic odpowiedzi...');
    }, 1800);

    try {
      const res = await runAgentWorkflow({
        companyName: preset.name,
        companyIndustry: preset.industry,
        language,
        knowledgeTiles: tiles,
        inputTitle: title,
        inputText: text,
      });

      window.clearTimeout(stepTimer1);
      window.clearTimeout(stepTimer2);
      setActiveStep(4);

      const full: WorkflowRunResult = {
        id: `wf_${Date.now()}`,
        inputTitle: title,
        createdAt: new Date().toISOString(),
        ...res,
      };

      onWorkflowComplete(full);
      onMascotUpdate(
        res.auditor.riskLevel === 'HIGH' ? 'alert' : 'happy',
        res.mascotTip || `Potok 3-Agentowy zakończony (${res.latencyMs} ms)!`
      );
      onLogAiCall({
        action: 'workflow',
        latencyMs: res.latencyMs,
        promptTokens: res.usage.promptTokens,
        candidatesTokens: res.usage.candidatesTokens,
        totalTokens: res.usage.totalTokens,
        status: 'success',
        summary: `Workflow "${title}" -> ${res.classifier.clientName} (${res.auditor.complianceScore}%)`,
      });
    } catch (err) {
      window.clearTimeout(stepTimer1);
      window.clearTimeout(stepTimer2);
      setActiveStep(0);
      const msg = err instanceof Error ? err.message : 'Błąd wykonania potoku Multi-Agent';
      setError(msg);
      onMascotUpdate('alert', 'Wystąpił błąd w potoku agentowym.');
    } finally {
      setRunning(false);
    }
  };

  const handleDemoClick = (demo: DemoAuditScenario) => {
    setInputTitle(demo.label);
    setInputText(demo.documentText);
    void executePipeline(demo.label, demo.documentText);
  };

  const handleAddToCrm = () => {
    if (!latestWorkflow || dealCreated) return;
    onCreateCrmDeal({
      title: `${latestWorkflow.classifier.category}: ${latestWorkflow.inputTitle}`,
      client: latestWorkflow.classifier.clientName,
      valuePln: latestWorkflow.classifier.estimatedValuePln || 25000,
      stage: latestWorkflow.executor.recommendedStage,
      riskLevel: latestWorkflow.auditor.riskLevel,
      score: latestWorkflow.auditor.complianceScore,
      tags: [
        latestWorkflow.classifier.urgency,
        ...latestWorkflow.auditor.matchedRules.slice(0, 2),
      ],
      notes: latestWorkflow.executor.actionChecklist.join(' • '),
    });
    setDealCreated(true);
    onMascotUpdate('happy', 'Dodałem nową kartę do tablicy Pipeline CRM!');
  };

  const handleDispatchWebhook = async () => {
    if (!latestWorkflow) return;
    setSendingWebhook(true);
    await onSendWebhookPayload(
      {
        event: 'bizops.workflow.completed',
        company: preset.name,
        workflowId: latestWorkflow.id,
        classifier: latestWorkflow.classifier,
        auditor: latestWorkflow.auditor,
        executor: {
          recommendedStage: latestWorkflow.executor.recommendedStage,
          actionChecklist: latestWorkflow.executor.actionChecklist,
        },
        createdAt: latestWorkflow.createdAt,
      },
      `Multi-Agent Workflow: ${latestWorkflow.classifier.clientName}`
    );
    setSendingWebhook(false);
  };

  const nodes = [
    { id: 1, title: '1. Trigger Wejścia', sub: 'Mail / PDF / Zgłoszenie' },
    { id: 2, title: '2. Agent Klasyfikator', sub: 'Intencja, Budżet & Encje' },
    { id: 3, title: '3. Agent Audytor RAG', sub: 'Zgodność z Bazą Wiedzy' },
    { id: 4, title: '4. Agent Egzekutor', sub: 'Karta CRM + Make Webhook' },
  ];

  return (
    <div className="space-y-5">
      {/* Visual 4-Node Agentic Pipeline Graph */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <GitBranch className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Orkiestrator Agentic AI (3-Stage Multi-Agent Pipeline)
              </h3>
              <p className="text-xs text-slate-500">
                Automatyczna klasyfikacja leada, weryfikacja polityk firmy i egzekucja do CRM / Make.com
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {preset.demoScenarios.map((demo) => (
              <button
                key={demo.id}
                type="button"
                disabled={running}
                onClick={() => handleDemoClick(demo)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-1.5 text-xs font-semibold text-violet-900 transition hover:bg-violet-100 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5 text-violet-700" />
                Demo: {demo.label}
              </button>
            ))}
          </div>
        </div>

        {/* Visual Nodes Row */}
        <div className="grid gap-3 sm:grid-cols-4">
          {nodes.map((node, index) => {
            const isDone = latestWorkflow && !running ? true : activeStep > node.id;
            const isCurrent = running && activeStep === node.id;
            return (
              <div
                key={node.id}
                className={`relative flex items-center justify-between rounded-xl border p-3 transition ${
                  isCurrent
                    ? 'border-indigo-500 bg-indigo-50/80 ring-2 ring-indigo-500/20'
                    : isDone
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      isCurrent
                        ? 'bg-indigo-600 text-white'
                        : isDone
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {isCurrent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isDone ? '✓' : node.id}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">{node.title}</p>
                    <p className="text-[10px] text-slate-500">{node.sub}</p>
                  </div>
                </div>
                {index < nodes.length - 1 && (
                  <ArrowRight className="hidden h-4 w-4 text-slate-300 sm:block" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Input & Results Grid */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Left: Trigger Input */}
        <div className="lg:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Dane wejściowe dla potoku (Webhook / Mail / Zlecenie)
            </h4>
            <input
              type="text"
              value={inputTitle}
              onChange={(e) => setInputTitle(e.target.value)}
              placeholder="Tytuł sprawy (np. Zapytanie o 2 domy 70m² / Reklamacja VIP)"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />
            <textarea
              rows={9}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Wklej surową wiadomość od klienta, treść formularza Tally lub raport z trasy..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 outline-none focus:border-indigo-500 focus:bg-white"
            />

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={running || !inputText.trim()}
              onClick={() => void executePipeline()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {running ? 'Orkiestracja 3 Agentów AI w toku...' : 'Uruchom Potok Multi-Agent AI'}
            </button>
          </div>
        </div>

        {/* Right: 3-Agent Structured Outputs */}
        <div className="lg:col-span-7">
          {!latestWorkflow ? (
            <div className="flex h-full min-h-[380px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
              <Bot className="mb-3 h-10 w-10 text-slate-300" />
              <h4 className="text-sm font-bold text-slate-700">Potok Multi-Agent oczekuje na uruchomienie</h4>
              <p className="mt-1 max-w-md text-xs text-slate-500">
                Kliknij jeden z przycisków <strong>Demo</strong> na górze lub wklej własne zgłoszenie, aby zobaczyć jak 3 agenci AI klasyfikują sprawę, weryfikują reguły i tworzą gotową kartę w CRM.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Top Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    Klient: {latestWorkflow.classifier.clientName}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Szacowana wartość:{' '}
                    <strong className="text-indigo-700">
                      {latestWorkflow.classifier.estimatedValuePln.toLocaleString('pl-PL')} PLN
                    </strong>{' '}
                    • Czas potoku: {latestWorkflow.latencyMs} ms
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={dealCreated}
                    onClick={handleAddToCrm}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white shadow-xs transition ${
                      dealCreated ? 'bg-emerald-600' : 'bg-slate-900 hover:bg-slate-800'
                    }`}
                  >
                    {dealCreated ? <Check className="h-3.5 w-3.5" /> : <Kanban className="h-3.5 w-3.5" />}
                    {dealCreated ? 'Dodano do Pipeline CRM' : 'Dodaj do Pipeline CRM'}
                  </button>

                  <button
                    type="button"
                    disabled={sendingWebhook}
                    onClick={() => void handleDispatchWebhook()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    {sendingWebhook ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Webhook className="h-3.5 w-3.5" />}
                    Wyślij do Make / n8n
                  </button>
                </div>
              </div>

              {/* Agent 1 Card: Classifier */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-extrabold text-indigo-700">
                    AGENT 1: Klasyfikator &amp; Ekstraktor Encji
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      latestWorkflow.classifier.urgency === 'CRITICAL' ||
                      latestWorkflow.classifier.urgency === 'HIGH'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    PILNOŚĆ: {latestWorkflow.classifier.urgency}
                  </span>
                </div>
                <p className="text-xs text-slate-700">
                  <strong>Intencja:</strong> {latestWorkflow.classifier.intent} ({latestWorkflow.classifier.category})
                </p>
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                  {latestWorkflow.classifier.keyEntities.map((ent, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs">
                      <span className="text-[10px] text-slate-400 block">{ent.name}</span>
                      <strong className="text-slate-800">{ent.value}</strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent 2 Card: Policy & Compliance Auditor */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-extrabold text-amber-700">
                    <ShieldCheck className="h-4 w-4" />
                    AGENT 2: Audytor Zgodności z Bazą Wiedzy
                  </span>
                  <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">
                    Zgodność: {latestWorkflow.auditor.complianceScore}% ({latestWorkflow.auditor.riskLevel})
                  </span>
                </div>

                <div className="space-y-2 mt-2">
                  {latestWorkflow.auditor.policyFlags.map((flag, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
                        flag.severity === 'ok'
                          ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900'
                          : flag.severity === 'warning'
                            ? 'border-amber-200 bg-amber-50/60 text-amber-900'
                            : 'border-rose-200 bg-rose-50/70 text-rose-900'
                      }`}
                    >
                      {flag.severity === 'ok' ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      ) : flag.severity === 'warning' ? (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
                      )}
                      <span>{flag.message}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent 3 Card: Executor */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-emerald-700">
                    AGENT 3: Egzekutor Operacyjny &amp; Komunikacja
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(latestWorkflow.executor.clientReplyDraft);
                      setCopiedDraft(true);
                      window.setTimeout(() => setCopiedDraft(false), 1600);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {copiedDraft ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    {copiedDraft ? 'Skopiowano' : 'Kopiuj odpowiedź'}
                  </button>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-bold text-slate-500">Checklista zadań dla zespołu:</p>
                  <ul className="space-y-1 text-xs text-slate-700">
                    {latestWorkflow.executor.actionChecklist.map((task, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-0.5 text-indigo-600 font-bold">•</span>
                        <span>{task}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                  {latestWorkflow.executor.clientReplyDraft}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
