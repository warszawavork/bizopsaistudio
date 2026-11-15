import type { AppLanguage } from '../types';

export const UI_TEXT: Record<
  AppLanguage,
  {
    subtitle: string;
    industryLabel: string;
    settingsButton: string;
    authorLabel: string;
    tabs: {
      responder: string;
      audit: string;
      knowledge: string;
      chat: string;
    };
  }
> = {
  pl: {
    subtitle: 'Asystent Odpowiedzi AI • Czytnik Dokumentów PDF • Baza Wiedzy Firmy',
    industryLabel: 'Profil:',
    settingsButton: 'Ustawienia API',
    authorLabel: 'Bogdan Liaskevich',
    tabs: {
      responder: 'Asystent Odpowiedzi',
      audit: 'Czytnik Dokumentów',
      knowledge: 'Baza Wiedzy',
      chat: 'Czat z Wiedzą',
    },
  },
  en: {
    subtitle: 'AI Sales Responder • PDF Document Reader • Company Knowledge Base',
    industryLabel: 'Profile:',
    settingsButton: 'API Settings',
    authorLabel: 'Bogdan Liaskevich',
    tabs: {
      responder: 'Sales Responder',
      audit: 'Document Reader',
      knowledge: 'Knowledge Base',
      chat: 'Knowledge Chat',
    },
  },
};
