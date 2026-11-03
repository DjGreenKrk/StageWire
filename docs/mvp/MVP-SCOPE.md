# MVP-SCOPE — zakres MVP i kryteria akceptacji

Status: wersja 0.1 do audytu · 2026-10-31

Priorytety: **M** = wymagane (Must), **S** = pożądane (Should, wchodzi do MVP, jeśli nie zagraża terminowi; kandydaci do wycięcia w kolejności odwrotnej do numeru), **C** = opcjonalne (Could), **D** = odłożone, **X** = świadomie wykluczone. Pojęcia modelu: [DOMAIN-MODEL.md](DOMAIN-MODEL.md). Wnioski `W-xx`: wewnętrzne materiały badawcze

## 1. Jak MVP unika trzech pułapek

| Pułapka | Mechanizm obrony |
|---|---|
| 1. Tylko edytor diagramów bez modelu technicznego | Diagram jest widokiem modelu: węzły wskazują `EquipmentInstance`, krawędzie są pochodne od `Connection`. Walidacja, kable, raporty i plan działają na tym samym modelu od pierwszego etapu |
| 2. Rozbudowany model bez użytecznego edytora | Do modelu wchodzi tylko to, co obsługuje scenariusz referencyjny (§2). Elementy modelu bez UI w MVP są jawnie oznaczone „R" (rezerwa). **Pionowy plaster** (urządzenie → połączenie → lista kabli w CSV) powstaje już w PoC-1 (plan realizacji §4, §9 jest kanoniczny) |
| 3. Pełne narzędzia CAD i webowe | Lista „Odłożone" i „Wykluczone" (§5, §6), każdy odłożony mechanizm ma uzasadnienie kosztu/wartości (wewnętrzne materiały badawcze). Zakres ograniczony do **jednego** scenariusza referencyjnego |

## 2. Scenariusz referencyjny (definiuje „skończone")

**Konferencja w sali 20 × 15 m.**

| Element | Wymaganie |
|---|---|
| Sala | `Space` prostokątny 20 × 15 m, strefy: SCENA, FOH, ewentualnie REŻYSERKA |
| Scena | Podest 8 × 4 m, wysokość 0,6 m (`StageObject`) |
| Ekran | Ekran LED lub projekcja (urządzenie z wejściami wideo) |
| FOH | Stanowisko z miksem wideo i audio |
| Kamery | 2 kamery (SDI) |
| Mikser wideo | Wejścia SDI/HDMI, wyjście PGM |
| Audio | Mikser audio, 2 głośniki PA (L/R), 2 mikrofony bezprzewodowe z odbiornikami, laptop prelegenta |
| Sieć | Przełącznik sieciowy, router/AP (urządzenia z portami RJ45) |
| Połączenia | Minimum ~25 urządzeń i ~35 połączeń z rzeczywistymi typami sygnałów i kabli |
| Wynik | Lista sprzętu, lista kabli (z numerami i długościami), patchlista, packlista, plan w skali PDF, schemat PDF |

Scenariusz jest także zestawem testów akceptacyjnych (TS-01, §9). **Cel czasowy** (hipoteza do walidacji): od pustego projektu do dokumentów ≤ 60 min dla osoby po krótkim wdrożeniu.

## 3. Ocena dwóch kontrowersyjnych elementów

### 3.1 Rack Designer

| Aspekt | Ocena |
|---|---|
| Wartość dla scenariusza | Niska–średnia (mikser audio, stagebox i switch często jadą w case/racku, ale lista „co jest w racku i na której pozycji" wystarczy bez rysunku elewacji) |
| Koszt pełnego edytora elewacji | Średni–wysoki: rysowanie 19″, U, strona front/rear, połowy szerokości, wielo-U, widok do druku |
| Koszt samego modelu + walidacji + raportu | Niski: pole `mount`, reguła V-003, raport „zawartość racka" |
| Decyzja | **Model + przypisanie w panelu właściwości + raport + walidacja = S (w MVP, jeśli czas pozwoli). Edytor elewacji = D (v1.0).** Zob. ADR-012 |

### 3.2 Zaawansowany routing kabli

| Aspekt | Ocena |
|---|---|
| Wartość | Wysoka dla instalacji (zamawianie kabli), umiarkowana dla jednodniowych eventów |
| Koszt sieci tras 3D (wysokości, drop pointy, najkrótsza ścieżka, diagnostyka) | Wysoki |
| Tańsza alternatywa | Długość = Manhattan z planu + zapasy + zaokrąglenie do długości katalogowych (S-03). Tryb ręczny zawsze dostępny |
| Decyzja | **Estymata długości z planu = S. Sieć tras = D.** Zob. ADR-013 |

## 4. Funkcje wymagane (M) i pożądane (S)

Każda funkcja ma identyfikator `F-xx` używany w planie realizacji. Kryteria akceptacji to warunki sprawdzalne; scenariusze testów w §9.

### F-01 Projekt: tworzenie, otwieranie, zapis [M]

Opis: plik projektu (ZIP + JSON), nowy projekt (pusty / szablon „Konferencja"), otwórz, zapisz, zapisz jako, ostatnie projekty, autozapis i odzyskiwanie, kopie zapasowe, wersjonowany format z migracją.

| Kryterium akceptacji | Test |
|---|---|
| Zapis jest atomowy: przerwanie procesu w trakcie zapisu nie niszczy poprzedniej wersji pliku | TS-04 |
| Po awarii (zabicie procesu) aplikacja proponuje odzyskanie z autozapisu z utratą ≤ 30 s pracy | TS-04 |
| Plik zapisany na Windows otwiera się na Linuxie i odwrotnie; ponowny zapis kanoniczny daje identyczne bajty JSON | TS-10 |
| Plik z nowszym MAJOR formatu: aplikacja pokazuje metadane i ostrzeżenie, **nie zapisuje ani nie migruje**; podgląd treści tylko jeśli plik da się sparsować | TS-05 |
| Plik z nieznanymi polami zachowuje je po odczycie i zapisie | TS-04 |
| Zachowywane są ostatnie N kopii (domyślnie 5) | TS-04 |
| Przy otwartym pliku drugi proces ostrzega o blokadzie (blokada doradcza, możliwość przejęcia) | TS-04 |
| Zero połączeń sieciowych przy pracy | TS-09 |

### F-02 Cofanie i ponawianie [M]

| Kryterium | Test |
|---|---|
| Każda operacja zmieniająca model jest poleceniem cofalnym | TS-02, TS-03 |
| Operacja złożona (np. usunięcie urządzenia z kaskadą, upgrade definicji, przeciągnięcie wielu obiektów) to **jeden** krok cofania | TS-03 |
| Dowolna sekwencja poleceń i pełne cofnięcie przywraca stan identyczny z początkowym (test własności) | TS-02 |
| Historia nie jest zapisywana w pliku (świadoma decyzja, ADR-015) | — |

### F-03 Plan sali w skali [M]

Opis: widok `plan` jednej przestrzeni. Rysowanie sali (prostokąt przez wpisanie wymiarów, wielokąt), strefy, rozmieszczenie `StageObject` i urządzeń, przesuwanie/obrót/kopiowanie/wyrównywanie, siatka i przyciąganie w mm, linijki, wymiary, teksty, podstawowe kształty.

| Kryterium | Test |
|---|---|
| Wpisanie „20000 × 15000" tworzy salę o tych wymiarach; zaznaczenie obiektu pokazuje wymiary w mm | TS-07 |
| Podczas rysowania i przesuwania można wpisać wartość liczbową (Tab) | TS-07 |
| Narzędzie wymiaru wyświetla długość z dokładnością do 1 mm | TS-07 |
| Eksport PDF w skali 1:100 daje na arkuszu 80 mm dla obiektu 8000 mm (tolerancja 0,5 mm) | TS-07 |
| Zaznaczanie obszarem, wielokrotne zaznaczanie, kopiuj/wklej, usuń | TS-01 |
| Zoom/pan płynny ≥ 60 fps do 1 000 widocznych obiektów i ≥ 30 fps przy 5 000 na maszynie referencyjnej (cel; weryfikuje PoC-2) | TS-08 |
| Upuszczenie obiektu w strefie podpowiada przypisanie `zoneId` | TS-01 |
| Obiekty `StageObject` i `EquipmentInstance` mają w UI wyraźnie różne reprezentacje i panele; elementy rysunkowe nie występują w raportach sprzętu | TS-01 |

### F-04 Biblioteka i edytor definicji urządzeń [M]

Opis: wbudowana biblioteka startowa (zakres w §7), wyszukiwanie z fasetami, dodawanie do projektu, własne definicje (tworzenie, edycja, kopia „fork"), szybkie dodawanie portów (`HDMI IN ×4`), import/eksport paczki, rewizje i upgrade z podglądem skutków (S).

| Kryterium | Test |
|---|---|
| Wyszukiwanie po producencie, modelu, kategorii zwraca wynik < 100 ms dla 5 000 definicji | TS-08 |
| Utworzenie własnego urządzenia z 8 portami ≤ 90 s (cel) | TS-01 |
| Zmiana etykiety portu w definicji nie zrywa żadnego połączenia | TS-02 |
| Każda edycja definicji tworzy nową niemutowalną rewizję; instancje pozostają przypięte do starej do czasu świadomego upgrade | TS-13a |
| **Upgrade podstawowy [M]:** „Zaktualizuj do rewizji N"; gdy rewizja usuwa porty z połączeniami, lista połączeń i wybór „usuń połączenia / anuluj"; jedna transakcja | TS-13a |
| Dwie instancje tej samej definicji na różnych rewizjach współistnieją po zapisie, odczycie, cofnięciu i imporcie bez zmiany `PortRef` | TS-13a |
| Usunięcie portu z połączeniem wymaga potwierdzenia z listą skutków; po potwierdzeniu połączenie znika i jest to jeden krok cofania | TS-03 |
| Każda definicja pokazuje pochodzenie i licencję | TS-13a |
| Projekt przeniesiony na komputer bez biblioteki zawiera wszystkie użyte definicje | TS-10 |

### F-05 Instancje urządzeń [M]

| Kryterium | Test |
|---|---|
| Dodanie urządzenia: wyszukanie i wstawienie ≤ 3 interakcje (skrót `G`, wpis, Enter) | TS-01 |
| Automatyczna numeracja nazw (`CAM1`, `CAM2`…) | TS-01 |
| Duplikat nazwy dozwolony, ale zgłoszony przez V-012 | TS-06 |
| Przypisanie strefy, notatki, `supply` w panelu właściwości; edycja wielu zaznaczonych | TS-01 |
| Instancja przypięta do rewizji definicji; nowa rewizja nie zmienia istniejących instancji bez upgrade | TS-13a |

### F-06 Edytor schematu (diagram) [M]

Opis: widok `diagram` z węzłami (urządzenie z portami, wejścia po lewej, wyjścia po prawej, grupy portów), tworzenie połączenia przeciągnięciem port → port, krawędzie ortogonalne z waypointami, kolor wg sygnału, ramki grupujące, wiele diagramów, „dodaj do widoku" i „usuń z widoku".

| Kryterium | Test |
|---|---|
| Podczas przeciągania porty zgodne podświetlają się, niezgodne pokazują powód po najechaniu; można wymusić połączenie (ze skutkiem w liście problemów) | TS-06 |
| Połączenie powstaje jednym przeciągnięciem; domyślny sygnał i typ kabla ustawiają się automatycznie | TS-01 |
| Krawędź pojawia się na każdym diagramie, na którym oba końce mają węzły; usunięcie węzła z widoku nie usuwa urządzenia | TS-12 |
| „Usuń z projektu" i „Usuń z widoku" są odrębnymi poleceniami z różnym potwierdzeniem | TS-03 |
| Przesunięcie węzła nie zmienia danych modelu (test: hash modelu bez `views` identyczny) | TS-12 |
| Jedno urządzenie może mieć węzły na wielu diagramach | TS-12 |
| Koniec krawędzi można przepiąć na inny port przeciągnięciem (jedno polecenie, jeden krok cofania) | TS-03 |
| ≥ 30 fps przy 1 000 węzłów i 2 500 krawędzi (cel; PoC-2) | TS-08 |

### F-07 Połączenia i kable [M]

| Kryterium | Test |
|---|---|
| `Connection` i `Cable` są odrębnymi obiektami; domyślnie powstają razem (1:1) | TS-01 |
| Typ kabla domyślny dobierany z sygnału i złącza; zmienialny | TS-01 |
| Numeracja kabli poleceniem „Nadaj brakujące numery" według wzorca `{prefix}{seq:3}`, bez ruszania już nadanych; „Numeruj od nowa" jawnie | TS-11 |
| Długość: pole liczbowe w mm + źródło (`manual`/`estimated`/`unknown`) | TS-11 |
| Zmiana nazwy portu lub urządzenia nie zmienia żadnego `Connection` | TS-02 |
| Dwa końce tego samego portu przy `capacity = 1` → błąd V-002, ale model przyjmuje stan | TS-06 |
| Test „wireless/virtual": połączenie bez kabla nie zgłasza V-011, V-013 ani V-019; V-011/V-013 uruchamiają się tylko dla `physical` z kablem | TS-06 |
| `medium` połączenia: `physical`/`wireless`/`virtual`. Połączenie bezprzewodowe nie trafia do listy brakujących kabli; fizyczne bez kabla (np. po usunięciu kabla) jest „kabel nieprzypisany" (V-019) | TS-06 |
| Długość kabla wprowadzana ręcznie w mm jest w pełni wystarczająca do raportów (estymata z planu to [S], F-16) | TS-01 |

### F-08 Walidacja [M]

| Kryterium | Test |
|---|---|
| Panel problemów z poziomami error/warning/info, filtrem i liczbą | TS-06 |
| Kliknięcie problemu zaznacza i przybliża obiekt w aktywnym widoku | TS-06 |
| Walidacja nie blokuje pracy ani zapisu | TS-06 |
| Walidacja przyrostowa: po edycji zaktualizowana w < 50 ms przy 2 000 urządzeniach (cel) | TS-08 |
| Reguły V-001, V-002, V-004, V-010…V-013, V-015, V-016, V-019, V-020, V-021 [M] działają zgodnie z [DOMAIN-MODEL §7](DOMAIN-MODEL.md); V-003 (nakładanie U) tylko z F-14 [S], V-025 tylko z F-16 [S] | TS-06 |
| Walidator rozróżnia: zgodność sygnału (V-010), zgodność końcówek kabla (V-011, wynik trójwartościowy) i sytuację „nie da się ocenić" (info); przypadki: BNC gniazdo — kabel BNC/BNC — BNC gniazdo (zgodne), RJ45 — patchcord — RJ45, SDI OUT → HDMI IN bezpośrednio (V-010), ten sam tor przez konwerter jako urządzenie (bez ostrzeżeń) | TS-06 |
| Każdy problem zawiera powód w jednym zdaniu i, jeśli istnieje, szybką naprawę | TS-06 |
| Użytkownik może odrzucić problem z uzasadnieniem (`suppressions`) i zobaczyć listę odrzuconych | TS-06 |
| Poziom reguły można zmienić na poziomie projektu | TS-06 |
| Walidacja obejmuje wszystkie klasy wiszących referencji (nie istnieją, bo niezmiennik; test własności) | TS-02 |

### F-09 Panel właściwości [M]

Kontekstowy: jeden obiekt, wiele obiektów (wspólne pola), puste zaznaczenie → właściwości widoku/projektu. Zmiany jako polecenia cofalne.

| Kryterium | Test |
|---|---|
| Edycja pola wielu obiektów jest jednym krokiem cofania | TS-02 |
| Pola numeryczne akceptują jednostki (`2,5 m`, `2500`) i pokazują błędy w polu | TS-01 |
| Dla `EquipmentInstance` widać: nazwę, definicję (rewizję), strefę, położenie X/Y/Z/obrót, listę portów z połączeniami | TS-01 |

### F-10 Raporty [M]

Raporty pochodne (zapytania nad modelem), ekranowe tabele z sortowaniem i filtrem, eksport CSV i PDF.

| Raport | Zawartość | Test |
|---|---|---|
| Lista sprzętu | Grupowanie po `definitionId` (+ opcjonalnie wg `supply`), ilość, producent, model, nazwy instancji | TS-11 |
| Lista kabli | Numer, typ, od (urządzenie/port) → do (urządzenie/port), sygnał, długość, źródło długości | TS-11 |
| Patchlista | Wiersz na połączenie, sortowana wg urządzenia/portu | TS-11 |
| Packlista | Sprzęt (wg definicji) + kable (wg typu i długości katalogowej) + „extras"; checkbox „spakowane" i postęp | TS-11 |
| Połączenia urządzenia | Dla wybranego urządzenia: porty i do czego są podłączone | TS-11 |

| Kryterium wspólne | Test |
|---|---|
| Zmiana modelu odświeża raport bez ręcznego przeliczania | TS-11 |
| Dwa różne urządzenia o tej samej nazwie nie scalają się w packliście (grupowanie po definicji, nie po nazwie) | TS-11 |
| **Klucze grupowania:** sprzęt wg `definitionId` + `supply` (rewizja pomijana); kable wg typu i `stockLengthMm` (przydzielona) albo **propozycji** z `lengthMm` i `stockCableLengthsMm`, oznaczonej „do weryfikacji"; obiekty sceny wg `kind` + wymiarów. Test długości: wymagane 12 m, magazyn 10/15/20 m → propozycja 15 m; ręczny przydział 20 m; kabel przycięty na wymiar (przydział = 12 m) | TS-11 |
| Obiekt sceny jest obrysem koncepcyjnym (podest 8×4 m = 1 sztuka); moduły, nogi i łączniki użytkownik dodaje jako osobne obiekty | TS-11 |
| **Raport „Elementy sceny i scenografii"** (podest, kratownice, stoły…): ilości i wymiary, osobna sekcja packlisty; packlista wyraźnie rozdziela sprzęt techniczny, elementy sceny i kable. Grafika (elementy rysunkowe) nie występuje w żadnym raporcie | TS-11 |
| Zmiana liczby pozycji po oznaczeniu jako spakowane nie zawyża postępu: licznik jest trwale przycinany (5→3→5 daje 3 z 5); zmiana `supply` zaczyna od zera | TS-11 |
| Brak „Unknown" jako ukrytej kategorii: pozycje bez typu są jawnie oznaczone i zliczone | TS-11 |
| Eksport CSV w UTF-8 z BOM (otwiera się poprawnie w Excelu z polskimi znakami) | TS-14 |
| Eksport PDF zawiera polskie znaki (ą, ę, ł, ż…) | TS-14 |

### F-11 Eksport dokumentacji graficznej [M]

| Kryterium | Test |
|---|---|
| Plan: PDF i SVG w skali, format papieru (A4/A3), orientacja, tabliczka (projekt, klient, autor, data, skala) | TS-07 |
| Diagram: PDF i SVG, automatyczny podział na strony lub dopasowanie do arkusza | TS-01 |
| PNG (rastry) z wybraną rozdzielczością | TS-01 |
| Wektorowy: tekst w PDF jest tekstem (zaznaczalny), nie bitmapą | TS-14 |
| Generowanie bez połączenia z siecią | TS-09 |

### F-12 Import i eksport projektu, przenoszenie [M]

| Kryterium | Test |
|---|---|
| Pojedynczy plik zawiera projekt wraz z użytymi definicjami i zasobami | TS-10 |
| „Zapisz projekt przenośny" zawiera definicje, rewizje i podkłady (wierne odwzorowanie). „Zapisz lekką kopię bez podkładów" jest **jawnie oznaczona jako stratna** i pokazuje, czego brakuje (listę pominiętych zasobów) | TS-10 |
| Import definicji z paczki JSON z walidacją schematu i raportem błędów | TS-13a |
| Eksport danych w formacie projektu = zapis; format jest udokumentowany | — |

### F-13 Podstawy UX i lokalizacja [M]

| Kryterium | Test |
|---|---|
| UI po polsku i angielsku, napisy w plikach tłumaczeń od pierwszego dnia | TS-14 |
| Obsługa klawiaturą: skróty jednoliterowe, `Ctrl+K` paleta poleceń (S), nawigacja po panelu struktury | TS-01 |
| Czytelny na ekranie 1366 × 768; panele zwijalne | TS-01 |
| Wskaźnik stanu zapisu (zapisano / niezapisane / autozapis) | TS-04 |
| Komunikaty błędów w formie: co się stało, dlaczego, co zrobić | TS-06 |

### Funkcje pożądane (S)

| ID | Funkcja | Uwagi |
|---|---|---|
| F-14 [S] | **Racki: przypisanie w panelu, V-003, raport „zawartość racka"**, bez edytora elewacji | Model w całości w MVP |
| F-15a **[M]** *(awans po audycie P1-04, do zatwierdzenia w Q-10)* | **Podkład planu z PNG/JPG + kalibracja skali dwoma punktami** (odległość wpisana przez użytkownika) | Plany obiektów przychodzą od zamawiającego; bez podkładu użytkownik musi przerysować salę. Test obowiązkowy: TS-07a (kalibracja), TS-10 (podkład w pliku) |
| F-15b [S] | **Podkład z PDF** (rasteryzacja pierwszej wybranej strony, pdf.js, Apache-2.0) | Wymaga dodatkowej zależności |
| F-16 [S] | **Estymata długości z planu** (Manhattan + zapasy + długości katalogowe), z `estimateBasis` i oznaczeniem nieaktualności; odmowa między różnymi `Space` | ADR-013; wynik to szacunek do zamówienia, nie długość montażowa |
| F-17 [S] | **Nakładka kabli na planie** (linie pochodne między `Placement`) | Wizualizuje trasy i źródło estymaty |
| F-18 [S] | **Paleta poleceń `Ctrl+K`** | |
| F-19 [S] | **Upgrade rewizji z tabelą różnic portów** (dodane/usunięte/zmienione) i mapowaniem | Upgrade *podstawowy* (lista dotkniętych połączeń, usuń/anuluj) jest w F-04 [M]; ta funkcja dodaje tabelę różnic i **przepinanie** (mapowanie stary→nowy port); w Core usunięty port = usunięcie powiązanych połączeń lub anulowanie |
| F-20 [S] | **Ścieżki end-to-end przez patchpanel** (`InternalLink`) w patchliście | |
| F-21 [S] | **Atrybuty portu** (IP, VLAN, kanał) w patchliście | G4 |
| F-22 [S] | **Etykiety kabli i urządzeń do druku** (arkusz PDF/CSV) | |
| F-23 [S] | **Eksport XLSX** | CSV jest wymagane; XLSX tylko, jeśli licencja biblioteki i rozmiar są akceptowalne |
| F-24 [S] | Ciemny motyw | Wnętrza sal bywają ciemne |

### Funkcje opcjonalne (C)

Szablony projektu, własne reguły numeracji (poza wzorcem), wyrównywanie i rozmieszczanie obiektów (rozszerzone), kolorowanie wg strefy lub sygnału jako tryb widoku, historia zmian (log) w UI, import listy urządzeń z CSV.

## 5. Funkcje odłożone (D)

| Funkcja | Kiedy | Powód odłożenia |
|---|---|---|
| Edytor elewacji racka (rysowanie 19″) | v1.0 | Koszt vs wartość dla scenariusza (§3.1) |
| Sieć tras kablowych 3D, drop pointy, analiza tras | po v1.0 | Koszt (§3.2) |
| Router kabli z omijaniem przeszkód | po v1.0 | Wystarczy ortogonalny + waypointy |
| Multicore (wiązka: końce, przejściówki, fanouty) | v1.0 | `Connection.cableId` pozwala współdzielić kabel, ale nie opisuje fizycznej wiązki; wymaga osobnego projektu |
| Logiczne przepływy (Dante, NDI, VLAN) jako encje | po v1.0 | Brak wzorca w obu produktach [G4] |
| Zasilanie: bilans mocy, rozdzielnie, obciążenia, kable zasilające | v1.0/po (w zakresie produktu) | Poza MVP. Model ma `powerW` w definicji. Zakres i podział z StageCalc (predykcja obciążeń) do ustalenia przed v1.0: własny moduł, współdzielone dane lub synchronizacja (ADR-035, Q-25) |
| Rigging i obciążenia kratownic/konstrukcji | po MVP (w zakresie produktu) | `StageObject` ma wymiary, pozycję i `weightKg`; punkty zawieszeń i obliczenia po MVP, z uwzględnieniem StageCalc (ADR-035, Q-25) |
| Import DXF/DWG, IFC; eksport IFC; MVR/GDTF | po v1.0 | Interop; format musi być do niego gotowy, nie realizować go teraz |
| Widok 3D | po v1.0 | Nie jest celem |
| Współpraca zespołowa, synchronizacja, self-hosting | po v1.0 | Brak serwera w MVP |
| Porównanie wersji projektu | v1.0 | G7 |
| Wymiana definicji urządzenia z mapowaniem portów („Replace") | v1.0 | |
| Własne reguły walidacji (skrypty) i system wtyczek | po v1.0 | |
| Import z formatów innych narzędzi | nie planowane | Zasady prawne i różnice modeli (ADR-020) |
| Użytkownikowe warstwy planu | v1.0 | MVP: stałe kategorie widoczności |
| Wersja przeglądarkowa (hostowana) | po v1.0 | |

## 6. Funkcje świadomie wykluczone (X)

Renderowanie realistyczne 3D; symulacja oświetlenia, laserów, efektów; odpowiednik Depence; pełny CAD/BIM; integracja z Unreal Engine; sterowanie i monitoring urządzeń; subskrypcje, konta wymagane do pracy, blokady funkcji; telemetria domyślnie włączona; edytor tekstu bogatego (W-27); edytor kształtu symbolu urządzenia.

## 7. Biblioteka startowa — zakres i ryzyko

| Parametr | Wartość |
|---|---|
| Zawartość | ~40–60 **generycznych** definicji (w tym 3 do mini-testu oświetleniowego TS-15: konsola DMX, splitter DMX, oprawa) i kilkanaście obiektów sceny wystarczających do scenariusza referencyjnego (kamera, mikser wideo, ekran/LED, projektor, mikser audio, stagebox, głośnik, mikrofon, odbiornik bezprzewodowy, laptop, przełącznik, router, AP, konwerter, splitter, patchpanel…) |
| Pochodzenie | Tworzone od zera lub z oficjalnych kart katalogowych producentów. **Zakaz kopiowania** cudzych baz, bibliotek społecznościowych oraz ich plików (ADR-020) |
| Rejestry | ~30 złączy, ~30 sygnałów, ~20 typów kabli (zakres do zatwierdzenia po B7) |
| Ryzyko | Autorstwo i weryfikacja danych portów to realny koszt; zob. IMPLEMENTATION-PLAN M3 i OPEN-QUESTIONS Q-07 |
| Jakość | Każda definicja ma pochodzenie, licencję i datę weryfikacji; walidator schematu paczki w narzędziu CLI |

## 8. Wymagania niefunkcjonalne MVP

| Obszar | Wymaganie (cel; **[HIPOTEZA]**, kalibrowane w PoC) |
|---|---|
| Platformy **(propozycja do zatwierdzenia w Q-09; poprawka audytu P1-11)** | Windows 10 22H2 i Windows 11 x64 z WebView2; Linux x64: **Ubuntu 22.04 LTS i 24.04 LTS** (wymagany systemowy `webkit2gtk-4.1`; starsze wydania, np. 20.04, nie są celem); testowane na GPU zintegrowanym Intel; pakiety instalacyjne i wersja przenośna. Inne dystrybucje „best effort" |
| Status liczb w tej tabeli | Poniższe wartości to **progi PoC / cele docelowe**, nie fakty; PoC je potwierdza lub koryguje (bramka PoC) |
| Maszyna referencyjna | Laptop ok. 2016 r.: 4 rdzenie niskonapięciowe, 8 GB RAM, zintegrowana grafika (założenie do potwierdzenia przez właściciela, Q-09) |
| Czas startu | < 3 s do ekranu startowego na maszynie referencyjnej |
| Otwarcie projektu 5 000 obiektów | < 2 s |
| Pamięć | < 500 MB przy projekcie 2 000 urządzeń |
| Offline | 0 żądań sieciowych; ścisła polityka CSP |
| Prywatność | Bez telemetrii |
| Dostępność | Obsługa klawiaturą; panel struktury z etykietami tekstowymi jako alternatywa dla canvasu; kontrast WCAG AA dla UI |
| Niezawodność | Brak utraty danych w testach awarii zapisu (TS-04) |
| Licencje zależności | Wyłącznie zgodne z wybraną licencją projektu; audyt przed wydaniem (ADR-019) |

## 9. Scenariusze testowe

Tabela mapuje scenariusze na funkcje; szczegółowe kroki są w kolumnie „Przebieg".

| ID | Nazwa | Przebieg w skrócie | Funkcje |
|---|---|---|---|
| TS-01 | **Scenariusz referencyjny od zera — profil Core [M]** | Nowy projekt; sala 20×15 (wariant z podkładem PNG nie jest wymagany w TS-01; F-15a ma obowiązkowy, odrębny TS-07a); scena 8×4 h=0,6; strefy; dodaj ~25 urządzeń; połącz ~35 portów; numeruj kable; **długości wpisane ręcznie**; raporty (sprzęt, elementy sceny, kable, patchlista, packlista); eksport PDF planu i schematu; zapisz. Listy zgodne z liczbą obiektów. **Przechodzi wyłącznie z funkcjami [M]** (bez racków, estymaty długości, upgrade z tabelą różnic) | F-01…F-13, F-15a |
| TS-01+ | Rozszerzenie TS-01 o funkcje [S] (warunkowe) | Kroki z F-14 (rack ze sprzętem i V-003), F-16 (oszacowanie długości i flaga nieaktualności), F-20, F-22. Zaliczane według deklaracji wydania | F-14, F-16, F-20…F-22 |
| TS-02 | **Tożsamość i cofanie (testy własności)** | Losowa sekwencja poleceń (dodaj/usuń/zmień nazwę/połącz/przesuń) → niezmienniki strukturalne zachowane; cofnij wszystko → stan identyczny z początkowym; zmiana etykiety portu i nazwy urządzenia nie zmienia żadnego `PortRef` | F-02, F-04, F-07 |
| TS-03 | **Usuwanie i kaskady** | Usuń urządzenie z 3 połączeniami: dialog z listą skutków; po potwierdzeniu połączenia i kable znikają; jedno cofnięcie przywraca wszystko; „usuń z widoku" nie usuwa urządzenia | F-02, F-04, F-06 |
| TS-04 | **Trwałość i awarie** | Zabij proces w trakcie zapisu: plik poprzedni nienaruszony. Zabij w trakcie pracy: odzyskanie z autozapisu. Zachowanie nieznanych pól. Rotacja kopii. Blokada doradcza | F-01 |
| TS-05 | **Migracje** | Pliki wzorcowe v1.0.0 … vN otwierają się i migrują do bieżącej; plik z nowszym MAJOR tylko do odczytu | F-01 |
| TS-06 | **Walidacja [M]** | Wymuś połączenia out→out, niezgodne sygnały, niedopasowane końcówki kabla (BNC/BNC, RJ45 patchcord, SDI→HDMI bezpośrednio vs przez konwerter), nadmiar na porcie, duplikat nazwy, fizyczne połączenie bez kabla, połączenie `wireless` (bez V-019); sprawdź poziom, powód, szybką naprawę (V-001: wskaż inny port), nawigację, odrzucenie i zmianę poziomu; model nigdy nie blokuje zapisu | F-07, F-08 |
| TS-06+ | Walidacja [S] | Nakładanie U w racku (V-003), nieaktualna estymata (V-025) | F-14, F-16 |
| TS-07 | **Dokładność skali** | Obiekt 8000×4000 mm; wymiar 8000; eksport PDF 1:100 → 80×40 mm ±0,5 mm; eksport SVG zgodny | F-03, F-11 |
| TS-07a | **Podkład planu [M] (F-15a)** | Wstaw PNG/JPG; kalibracja dwoma punktami i wpisana odległość; wymiar narzędziem pomiaru zgodny z kalibracją ±1 mm w skali podkładu; podkład w pliku projektu (round-trip, TS-10); wersja „lekka bez podkładów" ostrzega o stracie | F-15a |
| TS-08 | **Wydajność** | Syntetyczny projekt 2 000 urządzeń, 5 000 połączeń: otwarcie, pan/zoom, przeciągnięcie 100 obiektów, walidacja przyrostowa, wyszukiwanie w 5 000 definicji; pomiar względem celów §8 | F-03, F-06, F-08 |
| TS-09 | **Offline** | Uruchomienie z zablokowaną siecią; monitorowanie połączeń: 0 żądań; wszystkie funkcje działają | wszystkie |
| TS-10 | **Przenośność** | Projekt z Windows otwarty na Linuxie bez biblioteki: definicje obecne; zapis kanoniczny identyczny; eksport PDF zgodny | F-01, F-12 |
| TS-11 | **Spójność raportów** | Zmień połączenie / typ kabla / dodaj urządzenie → listy zmieniają się natychmiast; dwa urządzenia o tej samej nazwie nie scalają się w packliście; numeracja nie rusza istniejących | F-07, F-10 |
| TS-12 | **Wiele diagramów** | To samo urządzenie na dwóch diagramach; połączenie pojawia się na obu; przesunięcie węzła nie zmienia modelu | F-06 |
| TS-13a | **Biblioteka i rewizje [M]** | Import paczki z błędnym schematem → raport błędów; każda edycja definicji tworzy rewizję; instancja A na rew. 1, B na rew. 2 (różne porty), połączenia do obu — zapis/odczyt/cofnięcie/import bez zmiany `PortRef`; upgrade podstawowy z listą dotkniętych połączeń; pochodzenie widoczne | F-04, F-05 |
| TS-13b | Rewizje [S] | Tabela różnic portów i przepinanie przy upgrade | F-19 |
| TS-15 | **Uniwersalność modelu: tor oświetleniowy (mini-test)** | Konsola oświetleniowa → splitter DMX → oprawa (3 generyczne definicje, złącze XLR-5, sygnał DMX); kratownica jako `StageObject` z oprawą na `z` kratownicy; połączenia, kable, patchlista i plan działają bez zmian modelu. Test modelu, nie moduł oświetleniowy | F-04…F-10 |
| TS-14 | **Język i druk** | Polskie znaki w UI, CSV (BOM), PDF (osadzona czcionka); przełączenie PL/EN | F-10, F-11, F-13 |

## 9a. Matryca profilu Core MVP (poprawka audytu P0-04)

Profil **Core [M]** musi przejść komplet testów bez żadnej funkcji [S]. Testy z sufiksem „+" lub „b" są warunkowe.

| Funkcja | Status | Etap | Test(y) | Zaliczenie |
|---|---|---|---|---|
| F-01, F-02 | M | M1 | TS-02, TS-04, TS-05, TS-09, TS-10 | obowiązkowe |
| F-03, F-15a | M | M2 | TS-01, TS-07, **TS-07a**, TS-08 | obowiązkowe |
| F-04 (w tym upgrade podstawowy), F-05 | M | M3 | TS-13a, TS-15 | obowiązkowe |
| F-06, F-07 (długość ręczna) | M | M4/M5 | TS-03, TS-06, TS-11, TS-12 | obowiązkowe |
| F-08 (reguły [M]) | M | M5 | TS-06 | obowiązkowe |
| F-09, F-10 (w tym elementy sceny), F-11, F-12, F-13 | M | M1…M7 | TS-01, TS-11, TS-14 | obowiązkowe |
| F-14 racki, V-003 | S | M5 | TS-01+, TS-06+ | wg deklaracji wydania |
| F-15b podkład PDF | S | M2 | TS-07 (wariant) | wg deklaracji |
| F-16 estymata, V-025 | S | M5 | TS-01+, TS-06+ | wg deklaracji |
| F-19 tabela różnic | S | M3 | TS-13b | wg deklaracji |
| F-17, F-18, F-20…F-24 | S | M2…M7 | TS-01+ | wg deklaracji |

## 10. Definicja ukończenia MVP

1. TS-01…TS-15 (warianty [M]) przechodzą na Windows i Linuxie; warianty z sufiksem „+" i „b" według deklaracji w wydaniu. TS-01 przechodzi bez żadnej funkcji [S].
2. Cele wydajności z TS-08 osiągnięte na maszynie referencyjnej albo świadomie skorygowane w DECISIONS.
3. Format projektu opisany specyfikacją i schematem JSON; pliki wzorcowe i test migracji istnieją.
4. Biblioteka startowa wystarcza do scenariusza referencyjnego; każda pozycja ma pochodzenie i licencję.
5. Audyt licencji zależności i audyt IP biblioteki zakończone (ADR-019, ADR-020).
6. Osoba spoza zespołu wykonała scenariusz referencyjny w ≤ 60 min (hipoteza celu) i przekazała uwagi.
