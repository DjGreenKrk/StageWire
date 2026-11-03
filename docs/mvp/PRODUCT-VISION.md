# PRODUCT-VISION — wizja produktu

Status: wersja 0.1 do audytu · 2026-10-31 · nazwa robocza: **Stagewire** (placeholder; wymaga sprawdzenia kolizji znaków towarowych, zob. OPEN-QUESTIONS Q-01)

Oznaczenia pewności: [FAKT], [WNIOSEK], [HIPOTEZA], [DECYZJA]. Persony i metryki poniżej to **[HIPOTEZA]**: nie przeprowadzono badań użytkowników (luka B1).

## 1. Jednozdaniowa wizja

> Darmowe, otwartoźródłowe, działające offline narzędzie, w którym technik lub projektant AV w jednym projekcie rysuje salę w skali, rozmieszcza urządzenia, łączy ich porty i jednym kliknięciem otrzymuje komplet dokumentacji dla ekipy.

To **narzędzie do projektowania**, nie wizualizator. Wartością jest poprawny, spójny model techniczny wydarzenia, a nie obraz.

## 2. Problem

Przygotowanie techniczne wydarzenia rozbija się dziś na osobne artefakty: rzut sali (CAD lub PDF), schemat sygnałowy (rysunek), listy sprzętu i kabli (arkusz kalkulacyjny), packlista. Każda zmiana wymaga ręcznej aktualizacji wszystkich. Istniejące rozwiązania leżą na biegunach:

- **Narzędzia webowe do schematów AV** — szybkie i proste, ale płaskie: bez skali sali, bez stabilnych identyfikatorów portów, z kluczowymi funkcjami za paywallem i zależne od chmury.
- **Wtyczki do pakietów CAD** — precyzyjne technicznie, ale ciężkie, drogie, zależne od pełnego CAD i z niespójną integralnością danych.

Brakuje narzędzia pośredniego: **precyzyjnego modelu połączeń + lekkiego planu w skali + szybkiego edytora, w otwartym formacie**.

## 3. Użytkownicy docelowi (hipotezy do zweryfikowania)

| Persona | Kontekst | Czego potrzebuje | Priorytet MVP |
|---|---|---|---|
| **P1. Technik/realizator freelancer** | Konferencje, gale, eventy firmowe; laptop, często w drodze | Szybko zaprojektować system, wydrukować packlistę i patchlistę dla ekipy; pracować offline | **Główna** |
| **P2. Projektant systemów AV / integrator** | Instalacje w obiektach, dokumentacja dla klienta | Dokładne połączenia, numeracja kabli, racki, długości, dokumentacja PDF | Druga (racki, długości po MVP) |
| **P3. Technik teatralny / sceniczny** | Scena, kratownice, podesty, plan sali | Plan w skali, wymiary, elementy sceny | Druga |
| **P4. Inżynier broadcast / studio** | Rozbudowane sygnałowo (SDI, routing, sieć) | Model portów, sygnały, ścieżki end-to-end | Druga |
| **P5. Wolontariusz/mały obiekt (szkoła, kościół, dom kultury)** | Brak budżetu na licencje | Darmowe narzędzie bez konta i subskrypcji | Wspierana przez założenia produktu |

Rozstrzygnięcie priorytetu P1 vs P2 jest decyzją właściciela (OPEN-QUESTIONS Q-02). MVP jest projektowane pod P1 z modelem wystarczającym dla P2.

## 4. Typowe zastosowania

1. Konferencje i kongresy (scenariusz referencyjny MVP).
2. Wydarzenia sceniczne: teatr, koncert, gala.
3. Systemy AV w obiektach (sala konferencyjna, aula).
4. Realizacje broadcastowe i studia.
5. Instalacje audio/wideo/oświetleniowe/sieciowe w zakresie dokumentacji połączeń.

Oświetlenie: narzędzie obejmuje **dokumentację połączeń i rozmieszczenie** (zasilanie, DMX jako sygnał), nie symulację efektów.

## 5. Zasady produktu

1. **Model przed rysunkiem.** Edytor jest widokiem na model, nie odwrotnie. Eliminuje pułapkę „tylko edytor diagramów" [DECYZJA, zob. MVP-SCOPE §1].
2. **Użyteczność przed kompletnością.** Każda funkcja MVP musi mieścić się w przepływie „pusty projekt → dokumentacja" (MVP-SCOPE §2). Eliminuje pułapkę „model bez edytora".
3. **Szybkość na laptopie.** Skróty jednoliterowe, szybkie dodawanie sprzętu, praca klawiaturą.
4. **Model nie może się zepsuć; projekt może być niepoprawny.** Twarda integralność strukturalna, miękka walidacja projektowa.
5. **Offline-first, bez konta.** Plik projektu na dysku, zero obowiązkowych usług.
6. **Dane są Twoje.** Otwarty, udokumentowany, wersjonowany format; eksport CSV/PDF/SVG.
7. **Uczciwość dotycząca danych.** Każda definicja urządzenia ma pochodzenie i licencję; nie kopiujemy cudzych baz (ADR-020).
8. **Rozszerzalność przez rejestry, nie przez kod.** Własne złącza, sygnały, kable i urządzenia bez rekompilacji.
9. **Prostota przed repliką.** Nie odtwarzamy istniejących narzędzi; odtwarzamy to, co służy scenariuszowi.

## 6. Co produkt robi (granice)

### 6.1 Wewnątrz granic

- Plan sali/przestrzeni w rzeczywistej skali (2D, z wysokościami Z).
- Elementy sceny: podesty, kratownice, ekrany, stoły, krzesła, scenografia (jako obiekty bez portów).
- Urządzenia techniczne z portami, połączeniami i kablami.
- Schematy blokowe/szczegółowe połączeń.
- Biblioteka urządzeń (lokalna, rozszerzalna).
- Lokalizacje i racki (model od MVP; edytor elewacji później).
- Listy, patchlisty, packlisty, etykiety, eksport PDF/SVG/CSV.
- Zapis lokalny i przenoszenie projektu między komputerami (jeden plik).

### 6.2 Poza granicami (świadomie)

- Realistyczne renderowanie 3D, wizualizacja scen, symulacja świateł/laserów/efektów.
- Odpowiednik Depence/Capture; pełny CAD/BIM (Vectorworks, Revit, Archicad).
- Integracja z Unreal Engine jako wymaganie.
- Sterowanie urządzeniami w czasie rzeczywistym, monitoring.
- Moduł ofertowania/księgowości/wynajmu.
- Subskrypcje, konta wymagane do pracy, bramki funkcji.

### 6.3 Możliwe w przyszłości (nie komplikują MVP)

IFC/BIM (np. most do BIMCraft), MVR/GDTF, widok 3D, współpraca zespołowa i self-hosting, moduł zasilania, sieć tras kablowych 3D, edytor elewacji racków. MVP nie może zakładać żadnej z tych technologii (ADR-022, ARCHITECTURE §11).

## 7. Odróżnienie od istniejących rozwiązań

| Wymiar | Narzędzia webowe | Wtyczki CAD | **StageWire (cel)** |
|---|---|---|---|
| Cena/licencja | plan Starter z limitami, funkcje płatne | komercyjny, część pakietu CAD | Darmowy, kod źródłowy dostępny (PolyForm Shield) |
| Działanie offline | zapis pomijany bez sieci | tak (desktop) | **Offline-first** |
| Plan w skali | brak | tak (pełny CAD) | Lekki plan 2D w mm z Z |
| Tożsamość portu | indeks | nazwa/ID mieszane | **Stabilne ID** |
| Walidacja | blokująca | nieblokująca, na żądanie | Nieblokująca, ciągła, wyjaśniająca |
| Otwarty format | dokument w chmurze | zamknięty format własny | Otwarty ZIP+JSON ze schematem |
| Próg wejścia | niski | wysoki | Niski (cel) |
| Racki | brak widoku | tak | Model w MVP, elewacja później |

## 8. Wskaźniki sukcesu (hipotezy do kalibracji)

Wartości liczbowe są założeniami roboczymi, do walidacji w testach z użytkownikami po PoC.

| Wskaźnik | Cel roboczy |
|---|---|
| Czas od pustego projektu do kompletu dokumentów dla scenariusza referencyjnego (~25 urządzeń, ~35 połączeń) przez osobę po 30 min wdrożenia | ≤ 60 min |
| Czas dodania urządzenia z biblioteki i połączenia dwóch portów | ≤ 10 s |
| Zmiana nazwy portu/urządzenia nigdy nie zrywa połączeń | 100% przypadków testowych |
| Brak wiszących referencji po dowolnej sekwencji poleceń | 100% (testy własności) |
| Dokładność skali w eksporcie PDF | błąd ≤ 0,5 mm na arkuszu |
| Brak żądań sieciowych w trakcie pracy | 0 |

## 9. Kryteria „gotowe do pokazania"

- Scenariusz referencyjny (MVP-SCOPE §2) wykonany od zera, z eksportem PDF, i otwarty na drugim systemie (Windows ↔ Linux) bez zmian.
- Dokument przechodzi audyt spójności (IMPLEMENTATION-PLAN §8).
