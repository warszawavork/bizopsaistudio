import React, { useState } from 'react';
import {
  Award,
  Calculator,
  CheckCircle2,
  Database,
  Layers,
  Lock,
  Webhook,
} from 'lucide-react';
import type { IndustryPreset } from '../types';

interface ArchitectureViewProps {
  preset: IndustryPreset;
}

export const ArchitectureView: React.FC<ArchitectureViewProps> = ({ preset }) => {
  const [docsPerMonth, setDocsPerMonth] = useState(180);
  const [minutesPerDoc, setMinutesPerDoc] = useState(22);
  const [hourlyRatePln, setHourlyRatePln] = useState(110);

  const hoursSavedMonthly = Math.round((docsPerMonth * minutesPerDoc * 0.85) / 60);
  const plnSavedMonthly = hoursSavedMonthly * hourlyRatePln;
  const plnSavedYearly = plnSavedMonthly * 12;

  const stackLayers = [
    {
      icon: Layers,
      title: '1. Warstwa Frontend & UX (React 19 + TypeScript + Tailwind v4)',
      desc: 'Wielomodułowy interfejs SaaS B2B: Czat RAG z cytowaniem źródeł, Audytor PDF/Głosu, Orkiestrator 3-Agentowy, Pipeline CRM oraz interaktywny towarzysz 2D „Mruczek”.',
    },
    {
      icon: Lock,
      title: '2. Warstwa Bezpieczeństwa & Serverless Proxy (/api/ai & /api/webhook)',
      desc: 'Klucze API nigdy nie są eksponowane w przeglądarce. Endpoint obsługuje automatyczny łańcuch fallbacku modeli Gemini (3.8 -> 3.7 -> 3.5 Flash) z kontrolą timeoutów.',
    },
    {
      icon: Database,
      title: '3. Warstwa Wiedzy Kontekstowej (Live RAG & Smart Ingest)',
      desc: 'Dynamiczne wstrzykiwanie kafelków wiedzy z separacją uprawnień (Tryb Klienta vs Tryb Wewnętrzny B2B) oraz automatyczna ekstrakcja reguł z surowych plików PDF.',
    },
    {
      icon: Webhook,
      title: '4. Warstwa Egzekucji Procesowej (Make.com / n8n + Raporty PDF A4)',
      desc: 'Natychmiastowa wysyłka ustrukturyzowanych payloadów JSON do scenariuszy Make/n8n oraz wektorowy generator raportów PDF z pełną obsługą polskich znaków.',
    },
  ];

  const competencies = [
    {
      role: 'AI Automation Specialist / Engineer',
      skills: ['Orkiestracja wieloagentowa (Classifier -> Auditor -> Executor)', 'Structured JSON Outputs & Schema Validation', 'Integracje REST API & Make.com / n8n Webhooks'],
    },
    {
      role: 'AI Product Builder / Product Owner',
      skills: ['Projektowanie End-to-End od problemu operacyjnego po wdrożenie na Vercel', 'Separacja perspektyw dostępu (Public vs Internal Margin Guard)', 'Mierzalny zwrot z inwestycji (ROI) i telemetria tokenów'],
    },
    {
      role: 'Business Process & AI Adoption Lead',
      skills: ['Automatyzacja audytu kosztorysów, faktur (VAT 8%/23%, MPP) i dokumentów CMR', 'Moduł „Naucz mnie” pozwalający zespołom bez kodowania rozwijać wiedzę bota', 'Gamifikacja adopcji narzędzia poprzez asystenta 2D'],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Interactive ROI Calculator */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Kalkulator ROI Automatyzacji Procesów ({preset.shortName})
              </h3>
              <p className="text-xs text-slate-500">
                Symulacja oszczędności czasu i kosztów po wdrożeniu DocuAudit AI &amp; Multi-Agent Workflow
              </p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
            Redukcja pracy manualnej: ~85%
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <div>
              <div className="mb-1 flex justify-between text-xs font-semibold text-slate-700">
                <span>Liczba kosztorysów / zapytań / dokumentów miesięcznie:</span>
                <span className="font-mono font-bold text-indigo-600">{docsPerMonth} szt.</span>
              </div>
              <input
                type="range"
                min={20}
                max={1000}
                step={10}
                value={docsPerMonth}
                onChange={(e) => setDocsPerMonth(Number(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="mb-1 flex justify-between text-xs font-semibold text-slate-700">
                <span>Średni czas ręcznej analizy i odpowiedzi (1 dokument):</span>
                <span className="font-mono font-bold text-indigo-600">{minutesPerDoc} min</span>
              </div>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={minutesPerDoc}
                onChange={(e) => setMinutesPerDoc(Number(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="mb-1 flex justify-between text-xs font-semibold text-slate-700">
                <span>Koszt godziny pracy specjalisty / handlowca / inżyniera:</span>
                <span className="font-mono font-bold text-indigo-600">{hourlyRatePln} PLN / h</span>
              </div>
              <input
                type="range"
                min={50}
                max={250}
                step={5}
                value={hourlyRatePln}
                onChange={(e) => setHourlyRatePln(Number(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:col-span-5">
            <div className="flex flex-col justify-center rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center">
              <span className="text-[11px] font-medium text-slate-500">Zaoszczędzony czas / mies.</span>
              <span className="mt-1 text-2xl font-extrabold text-slate-900">{hoursSavedMonthly} h</span>
              <span className="mt-0.5 text-[10px] text-emerald-600 font-semibold">~{(hoursSavedMonthly / 160).toFixed(1)} etatu</span>
            </div>

            <div className="flex flex-col justify-center rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-center">
              <span className="text-[11px] font-medium text-indigo-700">Oszczędność / mies.</span>
              <span className="mt-1 text-xl font-extrabold text-indigo-950">
                {plnSavedMonthly.toLocaleString('pl-PL')} zł
              </span>
              <span className="mt-0.5 text-[10px] text-indigo-600 font-semibold">Netto operacyjnie</span>
            </div>

            <div className="flex flex-col justify-center rounded-2xl bg-slate-900 p-4 text-center text-white">
              <span className="text-[11px] text-slate-300">Roczny zwrot (ROI)</span>
              <span className="mt-1 text-xl font-extrabold text-emerald-400">
                {plnSavedYearly.toLocaleString('pl-PL')} zł
              </span>
              <span className="mt-0.5 text-[10px] text-slate-400">Koszt API: $0 (Free Tier)</span>
            </div>
          </div>
        </div>
      </div>

      {/* System Architecture Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {stackLayers.map((layer, idx) => {
          const Icon = layer.icon;
          return (
            <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="mb-2 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Icon className="h-4 w-4" />
                </div>
                <h4 className="text-sm font-bold text-slate-900">{layer.title}</h4>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">{layer.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Portfolio Competency Matrix */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="mb-4 flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-500" />
          <h3 className="text-sm font-bold text-slate-900">
            Matryca Kompetencji Projektu (Podsumowanie dla Rekrutera &amp; Hiring Managera)
          </h3>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {competencies.map((comp, i) => (
            <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
              <p className="mb-2.5 text-xs font-extrabold text-indigo-700">{comp.role}</p>
              <ul className="space-y-2 text-xs text-slate-700">
                {comp.skills.map((s, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
