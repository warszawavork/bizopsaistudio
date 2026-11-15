import type { IndustryPreset } from '../types';

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    id: 'norvil',
    name: 'NORVIL Domy Modułowe',
    shortName: 'NORVIL (Budownictwo)',
    industry: 'Budownictwo modułowe / Prefabrykacja B2C i B2B',
    description:
      'Kompletna baza wiedzy producenta domów modułowych: metraże 20–117 m², standard WT2021, zasady VAT 8%/23%, MPP, montaż HDS i marże handlowe.',
    accentLabel: 'Preset Główny (Case Study)',
    suggestedQuestions: {
      client: [
        'Jakie metraże domów oferujecie i który wchodzi na zgłoszenie?',
        'Czym różni się pakiet Deweloperski od Pod Klucz?',
        'Kiedy obowiązuje stawka 8% VAT, a kiedy 23%?',
        'Jakie warunki musi spełniać działka przed montażem HDS?',
      ],
      internal: [
        'Jakie są maksymalne rabaty handlowe i zasady transz 30/40/30?',
        'Kiedy musimy zastosować Split Payment (MPP) na fakturze?',
        'Na jakie ukryte koszty i błędy uważać przy wycenie domu na skarpie?',
        'Co sprawdzić przed wysłaniem klienta do architekta?',
      ],
    },
    defaultTiles: [
      {
        id: 'norvil-kim-jestesmy',
        title: 'Kim jesteśmy & Oferta Metraży (20–117 m²)',
        category: 'Oferta',
        visibility: 'public',
        priority: 'standard',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `NORVIL Domy Modułowe to producent nowoczesnych, całorocznych domów modułowych o konstrukcji szkieletowej prefabrykowanej w fabryce.
Dostępne modele katalogowe:
• 20 m² (Studio / Domek gościnny), 28 m² (Tiny House), 35 m² (Standard zgłoszeniowy bez pozwolenia), 36 m² (podwójny moduł 6×6 m).
• 40 m² (2 pokoje), 48 m² (rodzinny 2+1), 54 m² (willa z dużą kuchnią), 65 m² (3 pokoje), 70 m² (maksymalny metraż na uproszczone zgłoszenie).
• 84 m² (rodzina 2+2, 3 sypialnie), 108 m² (willa Premium 4 moduły), 117 m² (Rezydencja Duplex Premium).
Domy do 70 m² powierzchni zabudowy mogą być realizowane w procedurze uproszczonego zgłoszenia (dla zaspokojenia własnych potrzeb mieszkaniowych inwestora). Powyżej 70 m² wymagane jest pełne pozwolenie na budowę.`,
      },
      {
        id: 'norvil-technologia',
        title: 'Standard Techniczny, Drewno C24 & Gwarancja',
        category: 'Technologia',
        visibility: 'public',
        priority: 'standard',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `Konstrukcja nośna wykonana jest z certyfikowanego drewna konstrukcyjnego C24 (suszonego komorowo, struganego czterostronnie).
Izolacja termiczna spełnia aktualne normy WT2021 dla domów całorocznych (ściany i dach ocieplone wełną mineralną / PIR o niskim współczynniku przenikania ciepła, okna trzyszybowe).
Firma udziela 240 miesięcy (20 lat) gwarancji na konstrukcję szkieletu.
Standardowy czas prefabrykacji w hali produkcyjnej wynosi 8–12 tygodni od zatwierdzenia finalnej specyfikacji technicznej i zaksięgowania zaliczki.`,
      },
      {
        id: 'norvil-pakiety',
        title: 'Pakiety Wykończenia: Surowy / Deweloperski / Pod Klucz',
        category: 'Oferta',
        visibility: 'public',
        priority: 'standard',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `Dostępne 3 główne warianty realizacji:
1. Stan Surowy Zamknięty: konstrukcja C24, poszycie, pełna elewacja (np. blacha na rąbek / drewno), dach, okna 3-szybowe i drzwi zewnętrzne antywłamaniowe.
2. Stan Deweloperski: dodatkowo pełna izolacja WT2021, rozprowadzona instalacja elektryczna i wod-kan, ściany przygotowane pod malowanie, ogrzewanie (folie/maty grzewcze, podłogówka lub przygotowanie pod pompę ciepła).
3. Pod Klucz: gotowy do zamieszkania — wykończona łazienka (płytki, armatura, biały montaż), podłogi (panele/deska + listwy), drzwi wewnętrzne, oświetlenie LED, opcjonalnie zabudowa kuchenna, klimatyzacja i kominek.
Orientacyjna cena bazowa w standardzie deweloperskim zaczyna się od ok. 3 900 – 4 800 zł netto/m² (zależnie od metrażu i konfiguracji).`,
      },
      {
        id: 'norvil-finanse-vat',
        title: 'Zasady VAT (8% vs 23%), Split Payment MPP & Transze',
        category: 'Finanse & VAT',
        visibility: 'public',
        priority: 'critical',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `• Stawka 8% VAT: obowiązuje wyłącznie dla budownictwa mieszkaniowego objętego społecznym programem mieszkaniowym (domy jednorodzinne o powierzchni użytkowej do 300 m², art. 41 ust. 12 ustawy o VAT).
• Stawka 23% VAT: obowiązuje dla domków rekreacyjnych/letniskowych bez funkcji mieszkalnej, obiektów komercyjnych (biura, najem krótkoterminowy na firmę, pawilony usługowe) oraz osobno fakturowanych usług transportu/dźwigu i wyposażenia ruchomego (meble wolnostojące).
• Mechanizm Podzielonej Płatności (MPP / Split Payment): obowiązkowy na fakturach powyżej 15 000 zł brutto obejmujących roboty budowlane (Załącznik nr 15 ustawy o VAT).
• Standardowy harmonogram płatności (transze): 30% przy podpisaniu umowy (start prefabrykacji C24), 40% przed wyjazdem modułów z fabryki, 30% po montażu i podpisaniu protokołu odbioru.`,
      },
      {
        id: 'norvil-logistyka-dzialka',
        title: 'Wymogi Działki, Transport Ponadgabarytowy & Montaż HDS',
        category: 'Logistyka',
        visibility: 'public',
        priority: 'critical',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `Przed montażem domu na działce Inwestor musi zapewnić:
1. Utwardzony dojazd dla zestawu ciężarowego (szerokość min. 3,5 m, brak ostrych zakrętów uniemożliwiających wjazd naczepy 13,6 m, nośność gruntu min. 25 ton dla dźwigu / HDS).
2. Brak przeszkód napowietrznych (linie energetyczne SN/NN, gęste korony drzew) nad miejscem pracy dźwigu.
3. Przygotowany fundament zgodnie z projektem (płyta fundamentowa lub stopy/pale fundamentowe) z wyprowadzonymi przyłączami (woda, kanalizacja/szambo, zasilanie 3-fazowe min. 14–16 kW przy ogrzewaniu elektrycznym/pompie ciepła).
4. Przed wjazdem na budowę klient wypełnia Zadanie Techniczne i załącza wypis z rejestru gruntów, MPZP lub Warunki Zabudowy (WZ) oraz mapę do celów projektowych.`,
      },
      {
        id: 'norvil-internal-marze',
        title: 'WEWNĘTRZNE: Polityka Rabatowa, Marże & Ryzyka Operacyjne',
        category: 'Wewnętrzne',
        visibility: 'internal',
        priority: 'critical',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `[POUFNE — TYLKO DLA ZESPOŁU NORVIL]
• Maksymalny rabat handlowy bez zgody Zarządu: 3% (wyłącznie przy płatności 50/50 lub braku indywidualnych zmian w bryle). Rabat 4–10% wymaga akceptacji Managera Operacyjnego.
• Czerwone flagi operacyjne (ryzyko straty na kontrakcie):
  - Działka na skarpie (> 5% spadku) bez aktualnych badań geotechnicznych — ryzyko dodatkowych robót fundamentowych po stronie klienta (+15–35 tys. zł).
  - Odległość transportu > 250 km od zakładu bez doliczenia pilotażu i pozwoleń ponadgabarytowych dla modułów szerszych niż 3,0 m.
  - Klient chce fakturę na firmę pod wynajem turystyczny z VAT 8% — ZAKAZ! Musi być 23% VAT (ryzyko zakwestionowania przez US).
  - Brak zgody na dojazd dźwigu po działce sąsiada w gęstej zabudowie.`,
      },
    ],
    demoScenarios: [
      {
        id: 'norvil-demo-vat-error',
        label: 'Kosztorys 70m² z błędem VAT i brakami',
        badge: 'Wysokie ryzyko',
        fileName: 'Kosztorys_NORVIL_70m2_Domek_Najem.txt',
        documentText: `KOSZTORYS OFERTOWY NR NOR-2026-11-959
Inwestor: Apartamenty Słoneczna Polana Sp. z o.o. (NIP: 525-000-11-22)
Cel inwestycji: Zakup 2 domków modułowych 70 m² pod komercyjny wynajem krótkoterminowy (turystyka) na działce rekreacyjnej w Zakopanem.
Lokalizacja: Zakopane, działka górska o nachyleniu ok. 12% (brak badań geotechnicznych). Dojazd drogą gruntową nieutwardzoną o szerokości 2,8 m.

SPECYFIKACJA:
1. Dom modułowy 70 m² — stan Pod Klucz (konstrukcja C24, WT2021): 315 000 zł netto
2. Zastosowana stawka VAT na całość pozycji: 8% VAT -> Brutto: 340 200 zł
3. Ogrzewanie: Pompa ciepła + podłogówka (klient ma na działce tylko przyłącze 1-fazowe 4 kW).
4. Transport i montaż dźwigiem: "Wliczony w cenę gratis" (nie wpisano kosztu transportu ponadgabarytowego na 480 km).
5. Zastosowano rabat handlowy 8% bez adnotacji o akceptacji Zarządu.
6. Harmonogram płatności: 10% zaliczki, 90% po odbiorze. Brak wzmianki o MPP.`,
      },
      {
        id: 'norvil-demo-vip-lead',
        label: 'Zapytanie mailowe klienta o Willę 108m²',
        badge: 'Lead VIP',
        fileName: 'Mail_Klient_Jan_Kowalski_108m2.txt',
        documentText: `Od: Jan Kowalski <j.kowalski@example.pl>
Temat: Pilne zapytanie — dom całoroczny 108 m² pod Warszawą

Dzień dobry,
jestem zainteresowany Państwa willą modułową 108 m² (4 moduły) w stanie Deweloperskim z opcją wykończenia łazienki.
Mam działkę budowlaną w gm. Lesznowola (woj. mazowieckie) z wydanym MPZP i utwardzonym dojazdem z kostki 4,5 m szerokości. Mam już skrzynkę z prądem 3-fazowym (16 kW) oraz wodociąg miejski w granicy.
Zależy mi na realizacji na wiosnę przyszłego roku. Budżet jakim dysponuję to ok. 520 000 zł brutto. Będę tam mieszkać z rodziną (dom jednorodzinny).
Proszę o informację, czy przy 108 m² wystarczy samo zgłoszenie czy potrzebuję pozwolenia na budowę, jaka będzie stawka VAT i ile trwa produkcja?

Pozdrawiam,
Jan Kowalski, tel. +48 601 222 333`,
      },
    ],
    defaultDeals: [
      {
        id: 'deal-norvil-1',
        title: 'Willa Modułowa 108 m² (Deweloperski + Łazienka)',
        client: 'Jan Kowalski (Lesznowola)',
        valuePln: 518000,
        stage: 'quote',
        riskLevel: 'LOW',
        score: 94,
        tags: ['108m2', 'VAT 8%', 'MPZP OK'],
        notes: 'Działka z dojazdem 4,5 m i przyłączem 16 kW. Wymagane pełne pozwolenie na budowę.',
        createdAt: '2026-11-12',
      },
      {
        id: 'deal-norvil-2',
        title: '2x Domek 70 m² Pod Klucz (Najem B2B)',
        client: 'Apartamenty Słoneczna Polana Sp. z o.o.',
        valuePln: 774900,
        stage: 'audited',
        riskLevel: 'HIGH',
        score: 28,
        tags: ['Korekta VAT 23%', 'Skarpa 12%', 'Brak 3-faz'],
        notes: 'Wstrzymano ofertę: konieczna zmiana VAT z 8% na 23%, doliczenie transportu 480 km i badania geotechniczne.',
        createdAt: '2026-11-13',
      },
      {
        id: 'deal-norvil-3',
        title: 'Dom 70 m² na zgłoszenie (Pod Klucz)',
        client: 'Anna i Piotr Wiśniewscy (Piaseczno)',
        valuePln: 365000,
        stage: 'won',
        riskLevel: 'LOW',
        score: 98,
        tags: ['70m2 Zgłoszenie', 'Transza 30% Opłacona'],
        notes: 'Umowa podpisana, pierwsza transza 30% zaksięgowana, drewno C24 zamówione na halę.',
        createdAt: '2026-11-10',
      },
    ],
  },
  {
    id: 'ecommerce',
    name: 'Sportano Omnichannel AI (E-Commerce)',
    shortName: 'E-Commerce / Sprzedaż',
    industry: 'E-Commerce Omnichannel & Obsługa Klienta B2C/B2B',
    description:
      'Preset dla działów Customer Experience i Automatyzacji E-Commerce: polityka zwrotów, SLA wysyłki, gabaryty rowerowe i rabaty B2B.',
    accentLabel: 'Preset E-Commerce',
    suggestedQuestions: {
      client: [
        'Ile mam dni na zwrot roweru i kto pokrywa koszt kuriera?',
        'Do której godziny zamówienie wyjdzie tego samego dnia?',
        'Czy kody rabatowe łączą się z wyprzedażą marek premium?',
      ],
      internal: [
        'Jaka jest procedura eskalacji reklamacji powyżej 2000 zł?',
        'Jakie progi rabatowe obowiązują przy zamówieniach hurtowych B2B?',
        'Kiedy konsultant może przyznać voucher przeprosinowy bez zgody TL?',
      ],
    },
    defaultTiles: [
      {
        id: 'ecom-zwroty',
        title: 'Polityka Zwrotów 30 dni & Gabaryty',
        category: 'Procedury',
        visibility: 'public',
        priority: 'critical',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `Klienci mają 30 dni kalendarzowych na zwrot nieużywanego produktu w oryginalnym opakowaniu.
• Paczki standardowe (Paczkomat / Kurier): darmowy zwrot przez generator etykiet w panelu klienta.
• Produkty wielkogabarytowe (rowery elektryczne, bieżnie, orbitreki > 30 kg): wymagany dedykowany transport paletowy; koszt odbioru w przypadku odstąpienia od umowy bez wady produktu wynosi 149 zł (odliczane od zwrotu środków).
Zwrot środków następuje w ciągu 5 dni roboczych od przyjęcia paczki na magazyn centralny.`,
      },
      {
        id: 'ecom-wysylka-sla',
        title: 'SLA Magazynu & Progi Darmowej Dostawy',
        category: 'Logistyka',
        visibility: 'public',
        priority: 'standard',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `• Zamówienia opłacone do godziny 14:00 w dni robocze wysyłane są tego samego dnia (SLA 98,5%).
• Rowery wysyłane są wstępnie wyregulowane w kartonie "Ready-to-Ride" (czas przygotowania na serwisie: +24h do standardowego SLA).
• Darmowa dostawa obowiązuje od 199 zł (paczka standard) oraz od 1 500 zł (wysyłka paletowa gabarytów).`,
      },
      {
        id: 'ecom-promocje',
        title: 'Program Lojalnościowy & Wyłączenia Rabatowe',
        category: 'Oferta',
        visibility: 'public',
        priority: 'standard',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `Kody rabatowe z newslettera (-10%) nie łączą się z innymi promocjami oraz są wyłączone dla elektroniki sportowej (Garmin, Wahoo) i wybranych marek rowerowych (Cannondale, Specialized).
Minimalna wartość koszyka dla kodu powitalnego to 300 zł.`,
      },
      {
        id: 'ecom-internal-b2b',
        title: 'WEWNĘTRZNE: Eskalacje VIP, Vouchery & B2B',
        category: 'Wewnętrzne',
        visibility: 'internal',
        priority: 'critical',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `[POUFNE — ZESPÓŁ CX & B2B]
• Konsultant może samodzielnie przyznać kod -50 zł przy opóźnieniu magazynu > 48h.
• Reklamacje uszkodzeń transportowych > 2 000 zł wymagają zdjęć etykiety, kartonu zewnętrznego i protokołu szkody spisanego z kurierem do 7 dni — eskalacja do Team Leadera CX.
• Zamówienia B2B (kluby sportowe, hotele, szkoły) od 10 sztuk odzieży/sprzętu kwalifikują się do progu rabatowego 15–22% od cen katalogowych.`,
      },
    ],
    demoScenarios: [
      {
        id: 'ecom-demo-complaint',
        label: 'Reklamacja uszkodzonego roweru elektrycznego',
        badge: 'Eskalacja CX',
        fileName: 'Zgloszenie_Reklamacyjne_Ebike_4900zl.txt',
        documentText: `TICKET #CX-88412 | Kanał: Formularz WWW
Klient: Marek Nowak (zamówienie #SP-991042, wartość: 12 499 zł brutto — rower elektryczny Trail Pro).
Treść zgłoszenia:
"Zamówiłem rower w poniedziałek o 16:30, przyszedł dopiero w czwartek mimo obietnicy wysyłki w 24h. Po otwarciu okazało się, że tylna przerzutka jest wygięta, a karton miał wgniecenie na rogu. Kurier zostawił paczkę pod drzwiami i uciekł, więc NIE MAM protokołu szkody. Chcę natychmiastowy zwrot pieniędzy na konto albo nowy rower na jutro plus 500 zł rekompensaty. Dodatkowo przy zamówieniu nie zadziałał mi kod powitalny -10%!"`,
      },
    ],
    defaultDeals: [
      {
        id: 'deal-ecom-1',
        title: 'Zamówienie B2B: 18x Trenażer + Kurtki Klubowe',
        client: 'Klub Kolarski VeloWarszawa',
        valuePln: 64200,
        stage: 'quote',
        riskLevel: 'LOW',
        score: 91,
        tags: ['Hurt B2B', 'Rabat 18%'],
        notes: 'Klient spełnia próg >10 szt. Wyłączono elektronikę Garmin z rabatu.',
        createdAt: '2026-11-13',
      },
      {
        id: 'deal-ecom-2',
        title: 'Reklamacja #CX-88412 (Rower Trail Pro)',
        client: 'Marek Nowak',
        valuePln: 12499,
        stage: 'audited',
        riskLevel: 'HIGH',
        score: 42,
        tags: ['Szkoda Kurierska', 'Brak Protokołu', 'Eskalacja TL'],
        notes: 'Wartość > 2000 zł, wymagana eskalacja do TL CX i dosłanie zdjęć kartonu.',
        createdAt: '2026-11-14',
      },
    ],
  },
  {
    id: 'logistics',
    name: 'FleetOps Logistics AI (Transport & Flota)',
    shortName: 'Logistyka & Flota',
    industry: 'Transport Międzynarodowy, Spedycja & Zarządzanie Flotą',
    description:
      'Preset operacyjny inspirowany zarządzaniem flotą i oddziałem logistyki: czas pracy kierowców, karty paliwowe, dokumentacja CMR i szkody.',
    accentLabel: 'Preset Logistyka',
    suggestedQuestions: {
      client: [
        'Jakie dokumenty są wymagane przy rozładunku CMR?',
        'Jaki jest standardowy czas reakcji dyspozytora na opóźnienie na rampie?',
      ],
      internal: [
        'Jakie są progi alarmowe spalania paliwa i zasady użycia kart paliwowych?',
        'Co kierowca musi zrobić bezpośrednio po kolizji lub szkodzie parkingowej?',
        'Jakie są limity kabotażu w UE?',
      ],
    },
    defaultTiles: [
      {
        id: 'log-cmr',
        title: 'Obieg Dokumentów CMR & Rozliczenia Frachtu',
        category: 'Procedury',
        visibility: 'public',
        priority: 'critical',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `Warunkiem uruchomienia płatności za zlecenie transportowe jest dostarczenie czytelnego skanu dokumentu CMR (podpis i pieczęć odbiorcy w polu 24, data rozładunku, ewentualne uwagi o braku uszkodzeń).
• Kierowca ma obowiązek wgrać zdjęcie CMR do systemu / bota Telegram w ciągu 2 godzin od rozładunku.
• Postój na załadunku/rozładunku powyżej 3 godzin bez winy przewoźnika musi być potwierdzony kartą postojową lub wpisem w CMR z godziną przyjazdu i wyjazdu, aby naliczyć opłatę postojową (150 EUR / dzień).`,
      },
      {
        id: 'log-tachograf',
        title: 'Normy Czasu Pracy Kierowców & Kabotaż (Pakiet Mobilności)',
        category: 'Logistyka',
        visibility: 'public',
        priority: 'critical',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `• Maksymalny dzienny czas prowadzenia pojazdu: 9h (możliwość wydłużenia do 10h maksymalnie 2 razy w tygodniu).
• Obowiązkowa przerwa: 45 min po maksymalnie 4,5h jazdy (można dzielić na 15 min + 30 min).
• Kabotaż w UE: maksymalnie 3 operacje kabotażowe w ciągu 7 dni po pełnym rozładunku transportu międzynarodowego, następnie obowiązkowy 4-dniowy okres karencji (cooling-off).`,
      },
      {
        id: 'log-internal-flota',
        title: 'WEWNĘTRZNE: Karty Paliwowe, Spalanie & Szkody Flotowe',
        category: 'Wewnętrzne',
        visibility: 'internal',
        priority: 'critical',
        enabled: true,
        updatedAt: '2026-11-14',
        content: `[POUFNE — DYSPOZYTORNIA & KIEROWNIK FLOTY]
• Limit jednorazowego tankowania na karcie paliwowej: 900 L ON + 60 L AdBlue (PIN zmieniany co kwartał, zakaz zakupu artykułów pozapaliwowych bez zgody dyspozytora).
• Norma spalania ciągnik siodłowy 40t DMC: 27–30 L/100 km (płaski teren), do 33 L/100 km (trasy górskie). Przekroczenie > 35 L/100 km generuje automatyczny audyt telematyki GPS.
• Procedura szkodowa: zdjęcia uszkodzeń z 4 stron + oświadczenie sprawcy lub notatka policji w ciągu 24h do działu ubezpieczeń/leasingu.`,
      },
    ],
    demoScenarios: [
      {
        id: 'log-demo-audit',
        label: 'Raport z trasy DE-PL + podejrzenie anomalii',
        badge: 'Audyt Floty',
        fileName: 'Raport_Trasy_WX88412_Berlin_Warszawa.txt',
        documentText: `RAPORT ZAMKNIĘCIA ZLECENIA #TR-2026-419
Pojazd: Ciągnik WX 88412 (40t) | Kierowca: Piotr Z.
Trasa: Berlin -> Poznań -> Warszawa (łącznie 580 km)

ZDARZENIA I KOSZTY:
1. Tankowanie na stacji przy granicy: 1 050 L ON (transakcja podzielona na 2 paragony w odstępie 10 minut) + zakup płynów i artykułów na kwotę 240 zł z karty flotowej bez podanego numeru zgody.
2. Średnie spalanie wyliczone z tego odcinka: 39,2 L / 100 km (teren nizinny A2).
3. Rozładunek w Warszawie: opóźnienie na rampie 5 godzin, brak wpisu godziny wyjazdu i brak pieczątki odbiorcy w polu 24 CMR (kierowca załączył rozmazane zdjęcie pierwszej strony bez podpisu).
4. Czas jazdy ciągłej przed przerwą według raportu GPS: 4h 52min (przekroczenie o 22 minuty).`,
      },
    ],
    defaultDeals: [
      {
        id: 'deal-log-1',
        title: 'Audyt Trasy #TR-2026-419 (Berlin–Warszawa)',
        client: 'Pojazd WX 88412 (Kierowca: Piotr Z.)',
        valuePln: 14800,
        stage: 'audited',
        riskLevel: 'HIGH',
        score: 31,
        tags: ['Przekroczenie 900L', 'Spalanie 39.2L', 'Brak Pieczęci CMR'],
        notes: 'Wstrzymano rozliczenie premii kierowcy do czasu wyjaśnienia 1050L ON i dosłania podpisanego CMR.',
        createdAt: '2026-11-14',
      },
    ],
  },
];
