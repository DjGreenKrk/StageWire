# Wyniki prototypu gestu „port → port” (PoC-3b)

Data: 2026-11-01. Cel: zmierzyć koszt interakcji edytora (ryzyko R2) na własnym silniku Canvas 2D, zanim zaczniemy M3. Prototyp jest wyłącznie narzędziem pomiarowym, nie zalążkiem interfejsu produktu.

## 1. Co zbudowano

| Element | Plik | Uwagi |
|---|---|---|
| Logika gestu (czysta, bez DOM) | `stagewire/src/editor/connect.ts` | `planConnection`, `bestPort`, `usageOf`; poziomy `ok` / `warn` / `no` |
| Testy logiki | `stagewire/test/connect.test.ts` | 7 testów; razem z poprzednimi 67 testów przechodzi, `tsc --noEmit` czysty |
| Edytor diagramu | `stagewire/web/editor.html`, `editor.ts` | Canvas 2D + nakładka; ten sam `diagramDrawList`, `Store` i polecenia `cmd.*` co w PoC-1/2 |
| Pomiar w przeglądarce | `stagewire/bench/run-editor.mjs` | Prawdziwe zdarzenia myszy z Playwright, Edge z oknem; wyniki w `bench/results/poc3b-*` |

Zachowanie edytora:
- Przeciągnięcie z portu na port tworzy połączenie (jeden gest: wciśnięcie, ruch, puszczenie). Przeciągnięcie od wejścia do wyjścia odwraca kierunek.
- Podczas przeciągania wszystkie widoczne porty są podświetlone: zielone = bez uwag, żółte = połączenie powstanie z uwagą walidacji, szare = niedozwolone. Pasek stanu podaje powód (np. „Port IN 1 jest zajęty (V-002)").
- Upuszczenie na korpus urządzenia wybiera pierwszy zgodny wolny port.
- Wariant „klik, klik": klik portu, potem klik drugiego (do precyzyjnej pracy i późniejszego dotyku).
- Przeciąganie nagłówka przesuwa węzeł; tło przesuwa widok; kółko zmienia powiększenie; klik kabla + Delete usuwa; Ctrl+Z / Ctrl+Y; Esc anuluje.
- Zasada z DOMAIN-MODEL §7 zachowana: walidacja jest miękka. Gest nie blokuje niezgodnego połączenia (kierunek, sygnał, zajęty port), tylko je oznacza. Blokuje wyłącznie przypadki bez sensu: to samo urządzenie i para portów już połączona.

## 2. Wyniki (Edge z oknem, laptop właściciela)

Model syntetyczny „lokalny" jak w PoC-2 (połączenia między sąsiadami), 2,5 połączenia na urządzenie. Każdy wiersz to 30 gestów z automatycznym sprawdzeniem, że powstało dokładnie jedno połączenie z właściwymi portami.

### 2.1 Poprawność i opóźnienia, CPU bez ograniczeń

| Urządzeń | Poprawnych połączeń | Obsługa ruchu myszy (mediana / p95) | Start gestu (statusy portów) | Zatwierdzenie do narysowania klatki (mediana / p95) | Walidacja pełna |
|---|---|---|---|---|---|
| 200 | 30 / 30 | 0,4 / 0,6 ms | 1,4 ms | 27 / 29 ms | 1,1 ms |
| 1000 | 30 / 30 | 0,4 / 0,7 ms | 4,9 ms | 36 / 45 ms | 4,4 ms |
| 2000 | 30 / 30 | 0,4 / 0,6 ms | 7,5 ms | 54 / 71 ms | 9,1 ms |

### 2.2 To samo przy CPU spowolnionym 4× (symulacja starszego sprzętu)

| Urządzeń | Poprawnych | Obsługa ruchu (mediana / p95) | Start gestu | Zatwierdzenie do klatki (mediana / p95) | Walidacja |
|---|---|---|---|---|---|
| 1000 | 30 / 30 | 1,7 / 4,0 ms | 14 ms | 172 / 335 ms | 27 ms |
| 2000 | 30 / 30 | 1,8 / 4,6 ms | 28 ms | 296 / 579 ms | 51 ms |

### 2.3 Trafianie w port zależnie od powiększenia

Przeciągnięcie z rozrzutem ±5 px (losowo) na obu końcach, 30 prób na poziom; sukces = właściwe połączenie. Wiersz portu ma 16 px przy powiększeniu 100%.

| Powiększenie | Wysokość wiersza portu | Trafienia (200 / 1000 / 2000 urządzeń; CPU 1×) |
|---|---|---|
| 0,4 | 6,4 px | 12 / 11 / 13 z 30 |
| 0,6 | 9,6 px | 27 / 24 / 30 z 30 |
| 0,8 | 12,8 px | 30 / 30 / 30 |
| 1,0 | 16 px | 30 / 30 / 30 |
| 1,5 | 24 px | 30 / 30 / 30 |
| 2,0 | 32 px | 30 / 30 / 30 |

Wyniki przy CPU 4× są takie same (dla 1000 i 2000: 9 i 15 z 30 przy 0,4; 26 z 30 przy 0,6; 30 z 30 od 0,8). Zależą od geometrii, nie od mocy procesora.

### 2.4 Pozostałe scenariusze (wszystkie rozmiary)

| Scenariusz | Wynik |
|---|---|
| Upuszczenie na korpus urządzenia | Port wybrany poprawnie (pierwszy wolny, `IN 1`) |
| Upuszczenie na zajęty port | Połączenie powstało, uwaga V-002 pojawiła się (0 → 1), komunikat podaje przyczynę |
| „Klik, klik" | Działa |
| Zaznaczenie kabla, Delete, Ctrl+Z | Liczba połączeń: n → n−1 → n |

### 2.5 Przeciąganie węzła (krawędzie podążają za węzłem), czas klatki

| Urządzeń | CPU 1× (mediana / p95) | CPU 4× (mediana / p95) |
|---|---|---|
| 200 | 7,0 / 9,4 ms | — |
| 1000 | 21,7 / 31 ms | 119 / 180 ms |
| 2000 | 40 / 56 ms | 226 / 376 ms |

## 3. Ocena względem kryteriów

Kryteria ustaliłem przed pomiarem na podstawie ogólnie przyjętych progów (około 100 ms to granica odczuwalnego opóźnienia po zakończeniu gestu; 16,7 ms na klatkę przy 60 fps). To moje założenia, nie wymagania właściciela.

| Kryterium | Wynik |
|---|---|
| Obsługa ruchu myszy podczas gestu ≤ 8 ms | **Spełnione** także przy CPU 4× (p95 ≤ 4,6 ms) |
| Zatwierdzenie połączenia ≤ 100 ms (CPU 1×) | **Spełnione** do 2000 urządzeń (p95 71 ms) |
| Zatwierdzenie połączenia ≤ 100 ms (CPU 4×) | **Niespełnione** (172 ms przy 1000, 296 ms przy 2000) |
| Przeciąganie węzła ≥ 30 fps (CPU 1×) | **Spełnione do 1000 urządzeń** (21,7 ms), **niespełnione przy 2000** (40 ms ≈ 25 fps) |
| Poprawność gestu | 100% w 90 automatycznych próbach (3 rozmiary × 30), bez złego portu |
| Precyzja trafiania | Pewna od 12,8 px na wiersz portu (±5 px rozrzutu); poniżej ok. 10 px zawodzi |

## 4. Wnioski

1. **Sam gest jest tani.** Obsługa ruchu < 1 ms, wyliczenie zgodności wszystkich widocznych portów raz na początku gestu 1,4–7,5 ms. Ryzyko R2 dla interakcji „port → port" jest niskie: własny silnik Canvas daje to bez React Flow.
2. **Koszt zatwierdzenia i przeciągania węzła rośnie z rozmiarem projektu, bo po każdej zmianie przebudowujemy całą listę rysowania i cały indeks.** Pomiar rozbicia w Node (1000 / 2000 urządzeń): lista rysowania 9,8 / 17,1 ms, budowa R-drzewa 14,4 / 29,6 ms. Przeciąganie węzła to więc głównie ten sam koszt w każdej klatce. To uzasadnia plan M3: **przyrostowa aktualizacja listy rysowania i indeksu** (ruszamy tylko prymitywy węzła i jego krawędzi, `SpatialIndex.move` już istnieje), docelowo ≤ 8 ms niezależnie od rozmiaru. Szacunek docelowy to moja hipoteza, nie pomiar.
3. **Walidacja pełna po każdym połączeniu jest nadal akceptowalna przy 1000 urządzeń (4 ms), ale przy 2000 i CPU 4× zajmuje 51 ms.** Przyrostowa walidacja (zadanie M5) zostaje w planie.
4. **Przy małym powiększeniu portów nie da się celować.** Poniżej ok. 0,8 (13 px na wiersz) trafność spada, a przy 0,4 jest przypadkowa. Wniosek projektowy: (a) „magnes" do najbliższego zgodnego portu w promieniu kilkunastu pikseli; (b) przy powiększeniu poniżej progu pokazywać porty tylko podczas gestu lub rysować je jako pogrubione znaczniki; (c) skrót „przybliż do urządzenia". To hipotezy do sprawdzenia w M3, magnesu nie zbudowałem.
5. **Miękka walidacja w gestach działa i jest czytelna**: użytkownik widzi przed puszczeniem, co się stanie (kolor portu i komunikat), a po zatwierdzeniu uwaga jest w liczniku. Nie musieliśmy dodawać okien dialogowych.

## 5. Ograniczenia i czego nie sprawdzono

- Zmierzono wyłącznie Edge (Chromium) na Windows. Nie mierzono WebKitGTK/Linux, więc zachowanie zdarzeń wskaźnika na Linuxie jest nieznane (zob. Q-27).
- Zdarzenia pochodzą z Playwright (syntetyczne, regularne), nie od człowieka. **Nie badano użytkowników**: opinii o wygodzie gestu nie mam, a założenie, że jeden gest jest tańszy niż droga przez okno dialogowe, jest hipotezą (nie mierzyłem wariantu z oknem).
- Brak trybu dotykowego, brak obsługi touchpada z gestami, brak klawiatury poza skrótami; wymóg ≥ 44 px dla dotyku (standard rodziny) nie jest spełniony dla wierszy portów (16 px) i dotyczy telefonu, który jest platformą dodatkową tylko do podglądu (ADR-034).
- Przesuwanie węzłów nie jest w historii cofania (to dane widoku, zob. DOMAIN-MODEL); decyzja o cofaniu układu jest otwarta (Q-28).
- Trasowanie krawędzi pozostaje uproszczone (zygzak w połowie odległości); nie badano czytelności przy gęstych połączeniach.
- Model syntetyczny ma jedną rodzinę złączy i jeden sygnał; scenariusz niezgodnego sygnału sprawdzają tylko testy jednostkowe, nie pomiar w przeglądarce.
- Nie testowano przewijania widoku w trakcie gestu (automatyczne przesuwanie przy krawędzi okna) ani gestu przez granicę widoku.

## 6. Decyzje i dalsze kroki

1. ADR-037: gest „port → port" jako podstawowy sposób łączenia; miękka walidacja w gestach; kierunek normalizowany automatycznie.
2. Do M3: przyrostowa lista rysowania i indeks (cel: ≤ 8 ms na klatkę przeciągania niezależnie od rozmiaru), magnes do portu, automatyczne przesuwanie widoku przy krawędzi, cofanie układu węzłów (Q-28).
3. Pomiar na natywnym Linuxie obejmie też to wejście (Q-27).
4. Prototyp nie wchodzi do produktu; kod `web/editor.ts` jest narzędziem pomiarowym. `src/editor/connect.ts` jest kandydatem do rdzenia, bo jest czysty i przetestowany.

## 7. Zmiany w kodzie poza prototypem

`src/ids.ts` używał `node:crypto`, którego przeglądarka nie udostępnia. Zamieniono na `globalThis.crypto.getRandomValues` (działa w Node i w przeglądarce); wszystkie testy nadal przechodzą.

## 8. Uzupełnienie: przyrostowe przeciąganie węzła i magnes (2026-11-01, ta sama sesja)

Zmiany: `SpatialIndex.refresh`, przeciąganie węzła przesuwa tylko jego prymitywy i przelicza tylko jego krawędzie (trasa na pasie 0 do puszczenia, potem jedna pełna przebudowa); magnes do najbliższego oznaczonego portu w promieniu 14 px (tylko podczas gestu). Pomiar jak w §2 (te same skrypty, 30 gestów na rozmiar).

| Wynik | Przed | Po |
|---|---|---|
| Klatka przeciągania węzła, 1000 urządzeń, CPU 1× (mediana / p95) | 21,7 / 31 ms | **0,7 / 1,2 ms** |
| To samo, 2000 urządzeń | 40 / 56 ms | **0,7 / 1,0 ms** |
| To samo, 2000 urządzeń, CPU 4× | 226 / 376 ms | **2,5 / 3,9 ms** |
| Poprawność gestów (A) | 90 / 90 | 90 / 90 (plus 60 przy CPU 4×) |

**Magnes nie poprawił trafności przy małym powiększeniu**: przy 0,4 nadal 8–15 z 30, przy 0,6 24–29 z 30, od 0,8 po 30 z 30. Przyczyna (wniosek z kodu i pomiaru, nie osobny eksperyment): magnes wybiera najbliższy port, a przy rozrzucie ±5 px i wierszach 6,4 px najbliższy port jest po prostu innym, sąsiednim wierszem; dodatkowo włącza się dopiero poza prostokątem węzła. Pomaga więc w poprzecznych pudłach, nie w gęstości portów. Gęstość rozwiązuje tylko powiększenie albo inny mechanizm (np. lista portów przy najechaniu); ten wariant pozostaje nierozstrzygnięty. Magnes można wyłączyć parametrem `?magnet=0`; nie mierzyłem osobno przypadku poprzecznych pudeł, więc jego korzyść jest niepotwierdzona.

**Nadal niezałatwione:** zatwierdzenie połączenia skaluje się z rozmiarem (2000 urządzeń: 66 ms przy CPU 1×, 343 ms przy CPU 4×), bo po poleceniu przebudowuję całą listę i walidację pełną. Aktualizacja przyrostowa listy po `connect` nie została zrobiona.

## 9. Uzupełnienie: przyrostowe `connect` (2026-11-01)

Po zatwierdzeniu dokładam tylko nową krawędź do listy i indeksu (`SpatialIndex.add`, trasa na pasie 0, rysowana na wierzchu do następnej pełnej przebudowy), zamiast przebudowy całości. Pełna przebudowa pozostaje przy cofnięciu, usunięciu i zwolnieniu przeciąganego węzła.

| Zatwierdzenie połączenia (mediana / p95), CPU 1× | Przed | Po |
|---|---|---|
| 1000 urządzeń | 30 / 40 ms | **11,7 / 18 ms** |
| 2000 urządzeń | 66 / 71 ms | **19,3 / 26 ms** |

Poprawność nadal 30/30 na rozmiar. Pozostały koszt to głównie pełna walidacja (4,3 / 8,8 ms); jest zadaniem M5. Nie mierzyłem ponownie przy CPU 4× ani cofania/usuwania (nadal z pełną przebudową). Wizualny skutek uboczny: nowy kabel może przez chwilę przesłaniać ramkę węzła, dopóki nie nastąpi pełna przebudowa.
