# POC1-RESULTS — PoC-1: rdzeń, format i pionowy plaster

Status: wyniki z 2026-11-01 · kod: `stagewire/` (Node 26, TypeScript, Vitest, fast-check, Ajv, immer, fflate) · bez GUI

To weryfikacja implementacyjna, nie nowe badanie innych narzędzi. Pomiary zrobione na maszynie deweloperskiej właściciela (Windows 11, Node 26), **nie** na maszynie referencyjnej z Q-09, więc liczby bezwzględne nie są dowodem spełnienia celów wydajności; wskazują rząd wielkości i wąskie gardła.

## 1. Co zbudowano

| Element | Plik |
|---|---|
| Normatywny JSON Schema formatu 1.0.0-draft (klucz mapy = ID, S-01) | `schema/project.schema.json` |
| Fixtures: przykład z dokumentacji, dwie rewizje, warianty `medium`, mini-DMX, długości, legacy v0 | `fixtures/*.json` (generowane `npm run fixtures` z DOMAIN-MODEL §12) |
| Niezmienniki strukturalne | `src/invariants.ts` |
| Store: stan niemutowalny, transakcje jako łaty, cofanie/ponawianie, odrzucenie transakcji łamiącej niezmienniki | `src/store.ts` |
| Polecenia: edycja definicji (nowa rewizja), instancje, kaskada usuwania, połączenia z kablem, upgrade (usuń/anuluj), numeracja, długości | `src/commands.ts` |
| Walidacja V-001/002/004/010/011/012/013/019/026 | `src/validation.ts` |
| Patchlista, lista kabli, CSV (BOM) | `src/reports.ts` |
| Serializacja kanoniczna, ZIP z manifestem i sumą, migracja v0→v1, nowszy MAJOR, nieznane pola | `src/format.ts` |
| CLI: `validate`, `report cables [--csv] [--patch]`, `pack` | `src/cli.ts` |
| Generator syntetyczny i benchmark | `src/synthetic.ts`, `bench/bench.ts` |

## 2. Testy: 33 przechodzą, `tsc --noEmit` bez błędów

| Bramka z audytów | Wynik |
|---|---|
| Dwie rewizje współistnieją po zapisie, odczycie, cofnięciu; `PortRef` bez zmian (P0-01) | spełnione |
| Zmiana etykiety portu nie zrywa połączeń; rewizja 1 niemutowalna | spełnione |
| Usunięcie portu = rewizja strukturalna; upgrade `cancel` odrzuca, `delete` usuwa połączenia i kabel w jednym kroku cofania (N-03) | spełnione |
| Upgrade → zapis → cofnij bez zamykania (N-06) | spełnione |
| Walidator rozróżnia sygnał (V-010), końcówki kabla (V-011) i „nie da się ocenić” (info) (P0-02) | spełnione |
| `wireless`/`virtual`: bez V-011/013/019; fizyczny bez kabla: tylko V-019 (P0-03, N-02) | spełnione |
| V-026: ostrzeżenie dla 12000/10000, brak dla 15000, 20000 i 12000 (S-02) | spełnione |
| Propozycja 15 m dla wymaganych 12 m bez przydziału; przydział i przycięcie nie są „propozycją” (N-04) | spełnione |
| Numeracja nie rusza istniejących numerów | spełnione |
| Zapis deterministyczny, ponowny zapis identyczny bajt w bajt; nieznane pola i `ext` zachowane (Z8) | spełnione |
| Nowszy MAJOR: tylko metadane; zła suma, uszkodzone archiwum, migracja v0 | spełnione |
| Schemat odrzuca wireless z kablem i zły format ID; Store odrzuca naruszenie niezmienników bez zmiany stanu | spełnione |
| Mini-DMX (TS-15) bez zmian modelu | spełnione |
| **Testy własności (TS-02):** 3 fixtures × 300 losowych sekwencji ≤ 40 poleceń: niezmienniki, schemat, round-trip pliku, cofnięcie wszystkiego = stan początkowy | spełnione (900 przebiegów) |

Nie sprawdzono jeszcze: atomowość zapisu na dysku i odzyskiwanie po awarii (to PoC-3, wymaga powłoki), zachowanie na Linuxie, TS-04 w całości.

## 3. Pomiary (maszyna deweloperska, Node 26)

| Operacja | 200 urz./300 poł. | 1000/2500 | 2000/5000 (14 000 obiektów) | Cel z MVP-SCOPE §8 |
|---|---|---|---|---|
| Serializacja kanoniczna | 5 ms | 30 ms | 35 ms | — |
| Pakowanie ZIP + sha256 | 34 ms | 88 ms | 151 ms | — |
| Otwarcie (unzip + schemat) | 18 ms | 33 ms | 53 ms | < 2 s dla 5000 obiektów: **spełnione z dużym zapasem** |
| Niezmienniki (pełne) | 2,5 ms | 15 ms | 20 ms | — |
| Walidacja pełna | 3 ms | 20 ms | 27 ms | < 50 ms/edycja przy 2000 urządzeń: **spełnione nawet bez przyrostowości** |
| **1 polecenie (usunięcie urządzenia)** | 20 ms | 87 ms | **131 ms** | < 16 ms: **niespełnione** |
| Cofnięcie | 3 ms | 16 ms | 14 ms | — |
| Rozmiar: JSON / ZIP | 203 / 15 KiB | 1,4 MiB / 82 KiB | 2,7 MiB / 161 KiB | — |

## 4. Wnioski

1. **Format ZIP+JSON jest wystarczający dla zakładanej skali.** Projekt 2 000 urządzeń to 2,7 MiB JSON i 161 KiB ZIP, otwierany w ~50 ms. Kryterium rewizji formatu (ARCHITECTURE §12: > 2 s) nie zostało uruchomione. SQLite nie jest potrzebny w MVP. **[FAKT dla tej maszyny, HIPOTEZA dla maszyny referencyjnej]**
2. **Wąskie gardło: koszt pojedynczego polecenia na dużym stanie (131 ms przy 14 000 obiektów).** Przyczyny w kodzie PoC-1: (a) pełny `checkInvariants` po każdej transakcji (~20 ms), (b) polecenia przeszukujące wszystkie połączenia zamiast indeksu `connectionsByPort`, (c) immer pilnuje niemutowalności całego drzewa. Dla typowych projektów (200 urządzeń: 20 ms) jest akceptowalne, ale cel < 16 ms wymaga **niezmienników przyrostowych (sprawdzanych tylko dla obiektów dotkniętych łatami) i indeksów**. To zadanie M1, nie zmiana architektury.
3. **Walidacja pełna jest tania** (27 ms przy 14 000 obiektów), więc przyrostowość walidacji można odłożyć; wcześniej oceniałem ją jako konieczność w M5. **Korekta: pełne przeliczenie w tle wystarcza w MVP.**
4. **Rewizje definicji nie okazały się nadmiernie złożone.** Implementacja (nowa rewizja, klasyfikacja kosmetyczna/strukturalna, upgrade, pruning przy zapisie) to kilkadziesiąt linii. Warunek rewizji ADR-004 (fork-only przy > 1,5× nakładu) **nie został uruchomiony**.
5. **Model wytrzymał testy własności** bez wiszących referencji i z poprawnym cofaniem; wymusza to ścisłe rozróżnienie `CommandError` (oczekiwane) i `InvariantViolation` (błąd programistyczny).
6. **Schemat JSON i klucz-jako-ID (S-01) działają** z fixtures bez redundantnych pól.

## 5. Zmiany w modelu wynikające z implementacji

| # | Zmiana | Powód |
|---|---|---|
| 1 | Osierocony `Cable` (bez połączenia) jest naruszeniem niezmiennika, nie tylko regułą sprzątania | Test własności; prostsza semantyka kaskady |
| 2 | `Connection.cableId = null` dla `wireless`/`virtual` wymuszone też w schemacie (`if/then`) | Dwuznaczność P0-03 zamknięta na poziomie formatu |
| 3 | Numeracja: kolejny numer = max zajętego dla prefiksu + 1 (nie wypełnia luk) | Brak ponownego użycia numerów |

## 6. Czego PoC-1 nie rozstrzyga i następne kroki

- **Niezmienniki przyrostowe + indeksy** (`connectionsByPort`, `instancesByDefinition`) i ponowny pomiar na celu < 16 ms/polecenie: pierwsze zadanie M1.
- **Maszyna referencyjna (Q-09)** i powtórzenie pomiarów po jej ustaleniu.
- **PoC-2** (renderer Canvas vs SVG, interakcje) i **PoC-3** (Tauri na Windows i Linux, zapis atomowy, odzyskiwanie, PDF z polskimi znakami): niezrobione, bo nie zależą od PoC-1 w sposób blokujący.
- Decyzje właściciela nadal otwarte: Q-01, Q-03, Q-09 (w tej sesji przyjąłem rekomendacje Q-10, Q-19, Q-20, Q-22 jako zatwierdzone).
- Katalog `stagewire/` nie jest repozytorium git; zależności (`node_modules`) należy wyłączyć z ewentualnego repozytorium, a licencje zależności sprawdzić w Etapie 0.

## 7. Aktualizacja 2026-11-01: poprawa wydajności poleceń

Cel: poniżej 16 ms na polecenie. Wyjściowo usunięcie urządzenia w projekcie 2000 urządzeń / 5000 połączeń (14 000 obiektów) trwało 131 ms.

### Przyczyny (zmierzone profilem, nie zgadywane)

| Przyczyna | Udział | Naprawa |
|---|---|---|
| Polecenia skanowały kolekcje na **szkicu immera**, co tworzy proxy dla każdego elementu (np. przeszukanie 5000 połączeń per kabel) | ok. 95 z 113 ms | Odczyty zbiorcze po niezmienionym stanie bazowym (`baseOf`), jedno przejście zamiast skanu per kabel; szkic służy tylko do zapisu zmienionych kluczy |
| Pełne sprawdzanie niezmienników po każdej transakcji | ok. 20 ms | `checkInvariantsIncremental`: tylko obiekty dotknięte łatami i ich zależności zwrotne; zmiana rejestrów lub nieznana ścieżka → bezpieczny powrót do pełnego |
| Jednorazowe zamrożenie drzewa przez immer przy pierwszym poleceniu | 40–60 ms | Zamrożenie przy wczytaniu (`freeze` w konstruktorze `Store`) |

### Wyniki (ta sama maszyna, mediana z 15; 14 000 obiektów)

| Operacja | Przed | Po |
|---|---|---|
| Usunięcie urządzenia (kaskada) | 131 ms | **ok. 19 ms** |
| Rozłączenie | n/p | 13–14 ms |
| Edycja definicji (nowa rewizja) | n/p | 10–15 ms |
| Upgrade 1 instancji | n/p | ok. 9 ms |
| Cofnięcie | 14 ms | ok. 7 ms |
| Pierwsze polecenie po wczytaniu | 150–190 ms | ok. 18 ms |
| Typowy projekt (200 urządzeń, 1000 obiektów): usunięcie / rozłączenie | 20 ms | 3 ms / 1 ms |

Uwaga o rozrzucie: pojedyncze pomiary wahają się o kilka milisekund (np. 1000 urządzeń dało 19–26 ms).

### Wniosek i granica

- Cel 16 ms jest **spełniony dla typowych projektów** i dla większości poleceń także w projekcie 2000 urządzeń. **Usunięcie urządzenia w największym projekcie (ok. 19 ms) pozostaje lekko nad celem.**
- Pozostały koszt wynika z kopiowania przy zapisie (copy-on-write) całych map przy każdej zmianie: usunięcie urządzenia modyfikuje cztery duże mapy (`equipment`, `connections`, `cables`, `placements`), a immer kopiuje każdą w całości (koszt O(liczba kluczy)). Zejście poniżej tej granicy wymagałoby współdzielących strukturę map trwałych (np. HAMT) zamiast zwykłych obiektów JSON. To zmiana reprezentacji w pamięci, nie formatu pliku, ale jest kosztowna; **nie wykonuję jej bez pomiaru na maszynie referencyjnej i potrzeby z PoC-2** (interakcyjne przeciąganie nie produkuje takich poleceń na każdą klatkę: przesunięcia węzłów są w widoku, nie w modelu).
- Walidacja pełna (27–46 ms) nadal jest poza ścieżką polecenia; wystarczy ją liczyć w tle po transakcji.

### Zabezpieczenie poprawności

Optymalizacja nie może po cichu osłabić gwarancji, więc: (1) tryb `both` w testach porównuje przyrostowe sprawdzanie z pełnym przy każdej transakcji (900 losowych przebiegów); (2) 15 celowo wadliwych transakcji (wiszące połączenia, usunięty kabel w użyciu, osierocony kabel, port usunięty z przypiętej rewizji, usunięte wpisy rejestru, zły format ID, ID w dwóch kolekcjach i inne) musi zostać wykryte przez przyszłe i pełne sprawdzanie; (3) 48 testów przechodzi, `tsc --noEmit` bez błędów.
