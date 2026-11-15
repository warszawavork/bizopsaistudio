import type { AppLanguage } from '../types';

export interface UiDictionary {
  subtitle: string;
  industryLabel: string;
  settingsButton: string;
  authorLabel: string;
  studioProLabel: string;
  tabs: {
    responder: string;
    audit: string;
    knowledge: string;
    chat: string;
  };
  tabDescriptions: {
    responder: string;
    audit: string;
    knowledge: string;
    chat: string;
  };
  studioProTabs: {
    pipeline: string;
    workflow: string;
    ops: string;
  };
  studioProDescriptions: {
    pipeline: string;
    workflow: string;
    ops: string;
  };
  header: {
    themeLight: string;
    themeDark: string;
    installPwa: string;
    integrations: string;
    addCompany: string;
    syncOnline: string;
    syncSyncing: string;
    syncQueued: string;
    syncOffline: string;
    studioProBadge: string;
  };
  common: {
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    refresh: string;
    search: string;
    close: string;
    copy: string;
    copied: string;
    exportPdf: string;
    printReport: string;
    add: string;
  };
}

export const UI_TEXT: Record<AppLanguage, UiDictionary> = {
  pl: {
    subtitle: 'Asystent Odpowiedzi AI • Czytnik Dokumentów PDF • Baza Wiedzy Firmy',
    industryLabel: 'Profil:',
    settingsButton: 'Ustawienia API',
    authorLabel: 'Bogdan Liaskevich',
    studioProLabel: 'Studio Pro',
    tabs: {
      responder: 'Asystent Odpowiedzi',
      audit: 'Czytnik Dokumentów',
      knowledge: 'Baza Wiedzy',
      chat: 'Czat z Wiedzą',
    },
    tabDescriptions: {
      responder: 'Skrzynka leadów, odpowiedzi E-mail/WhatsApp, obiekcje i follow-up',
      audit: 'Audyt umów i dokumentów PDF oraz porównywarka wersji v1 vs v2',
      knowledge: 'Kafelki wiedzy, import książek i wielkoformatowych PDF z dysku',
      chat: 'Rozmowa z bazą wiedzy firmy oraz weryfikacja online w Google',
    },
    studioProTabs: {
      pipeline: 'Lejek CRM i Oferty PDF',
      workflow: 'Pipeline 3-Agentowy AI',
      ops: 'Telemetria, Webhook i Audit Trail',
    },
    studioProDescriptions: {
      pipeline: 'Tablica szans sprzedaży z synchronizacją w chmurze i szybkim generatorze ofert PDF',
      workflow: 'Automatyczna ścieżka Klasyfikator → Audytor → Egzekutor z wysłaniem do CRM',
      ops: 'Koszty tokenów, konfiguracja Make/n8n oraz pełna historia operacji w Neon DB',
    },
    header: {
      themeLight: 'Przełącz na tryb jasny',
      themeDark: 'Przełącz na tryb ciemny',
      installPwa: 'Zainstaluj aplikację',
      integrations: 'Połączenia',
      addCompany: 'Dodaj firmę',
      syncOnline: 'Chmura online',
      syncSyncing: 'Synchronizacja...',
      syncQueued: 'Oczekuje w kolejce',
      syncOffline: 'Tryb offline',
      studioProBadge: 'Narzędzia Executive',
    },
    common: {
      save: 'Zapisz',
      cancel: 'Anuluj',
      delete: 'Usuń',
      edit: 'Edytuj',
      refresh: 'Odśwież',
      search: 'Szukaj...',
      close: 'Zamknij',
      copy: 'Kopiuj',
      copied: 'Skopiowano',
      exportPdf: 'Eksportuj PDF',
      printReport: 'Drukuj raport',
      add: 'Dodaj',
    },
  },
  en: {
    subtitle: 'AI Sales Responder • PDF Document Reader • Company Knowledge Base',
    industryLabel: 'Profile:',
    settingsButton: 'API Settings',
    authorLabel: 'Bogdan Liaskevich',
    studioProLabel: 'Studio Pro',
    tabs: {
      responder: 'Sales Responder',
      audit: 'Document Reader',
      knowledge: 'Knowledge Base',
      chat: 'Knowledge Chat',
    },
    tabDescriptions: {
      responder: 'Unified lead inbox, E-mail/WhatsApp replies, objections & follow-ups',
      audit: 'Contract & PDF compliance audit plus v1 vs v2 version comparison',
      knowledge: 'Knowledge tiles, structured book ingestion & arbitrary-size PDFs',
      chat: 'Interactive company knowledge chat with live web verification',
    },
    studioProTabs: {
      pipeline: 'CRM Pipeline & PDF Quotes',
      workflow: '3-Agent AI Pipeline',
      ops: 'Telemetry, Webhooks & Audit Trail',
    },
    studioProDescriptions: {
      pipeline: 'Cloud-synced sales board with instant PDF commercial proposal builder',
      workflow: 'Autonomous Classifier → Auditor → Executor chain with CRM & webhook push',
      ops: 'Token KPIs, Make/n8n automation blueprint & full Neon DB execution audit trail',
    },
    header: {
      themeLight: 'Switch to light mode',
      themeDark: 'Switch to dark mode',
      installPwa: 'Install app',
      integrations: 'Integrations',
      addCompany: 'Add company',
      syncOnline: 'Cloud online',
      syncSyncing: 'Syncing...',
      syncQueued: 'Queued offline',
      syncOffline: 'Offline mode',
      studioProBadge: 'Executive Suite',
    },
    common: {
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      refresh: 'Refresh',
      search: 'Search...',
      close: 'Close',
      copy: 'Copy',
      copied: 'Copied',
      exportPdf: 'Export PDF',
      printReport: 'Print report',
      add: 'Add',
    },
  },
};
