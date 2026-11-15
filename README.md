# BizOps AI Studio — Enterprise RAG, DocuAudit & Multi-Agent Platform

Kompleksowa platforma AI klasy B2B łącząca **Asystenta Wiedzy Firmowej (RAG + Kontekst)**, **Multimodalny Audytor Dokumentów & Notatek Głosowych (PDF / Kosztorysy / Głos)**, **3-Agentowy Orkiestrator (Multi-Agent Workflow)**, **Pipeline CRM**, moduł **„Naucz mnie” (Live Knowledge Studio)**, **Kalkulator ROI** oraz **Mostek Automatyzacji Make.com / n8n**.

Sercem interfejsu jest autorski towarzysz 2D **„Mruczek — Kotek Inżynier AI”** z systemem poziomów XP, potrzeb operacyjnych i przełączalnymi strojami służbowymi (oraz trybem prezentacji korporacyjnej).

## 7 Modułów Produkcyjnych

1. **Ekspert AI (Czat RAG z cytowaniem źródeł)** — Tryb Klienta (Publiczny) vs Tryb Wewnętrzny (Zespół / Marże / Ryzyka).
2. **Audytor Dokumentów & Głosu (DocuAudit AI)** — analiza PDF, skanów JPG/PNG i dyktowania głosowego z terenu, eksport raportu PDF A4 z polskimi znakami, zapis do CRM i wysyłka do Make.
3. **Multi-Agent Workflow (3-Agent Pipeline)** — `Agent 1: Klasyfikator` $\rightarrow$ `Agent 2: Audytor Zgodności` $\rightarrow$ `Agent 3: Egzekutor CRM & Komunikacji`.
4. **Pipeline CRM (Kanban B2B)** — 4-etapowa tablica szans sprzedaży zintegrowana z audytami AI i webhookami.
5. **„Naucz mnie” (Live Knowledge Studio)** — AI Smart Ingest z plików PDF/notatek, gotowe szablony reguł, priorytety krytyczne i testowanie reguł 1-klikiem w czacie.
6. **AI Ops & Make/n8n Bridge** — telemetria opóźnień, licznik tokenów, log audytu i inspektor payloadów JSON.
7. **Architektura & Kalkulator ROI** — interaktywna symulacja oszczędności czasu/kosztów oraz matryca kompetencji pod rekrutację.

## Dwujęzyczność (`PL | EN`) i 3 Branże
- Przełącznik języka **PL / EN** w nagłówku (zmienia interfejs oraz język odpowiedzi modeli Gemini).
- Gotowe presety branżowe: **NORVIL Domy Modułowe**, **Sportano Omnichannel (E-Commerce)**, **FleetOps Logistics (Transport & Flota)**.

## Uruchomienie lokalne i wdrożenie na Vercel
```powershell
bun install
bun run win:dev
```
W panelu Vercel dodaj zmienną środowiskową `GEMINI_API_KEY`.
