# ELECTRICAL-TOPOLOGY — topologia elektryczna, grzebienie, listwy i połączenia wielopunktowe

[Wróć do indeksu](README.md) · [DECISIONS.md](DECISIONS.md) (ADR-064) · [DOMAIN-MODEL.md](DOMAIN-MODEL.md) · [DEVICE-DB.md](DEVICE-DB.md)

**Status:** projekt (audyt, architektura, plan). Bez implementacji. Stan kodu: commit `faa2c2e`, 289 testów jednostkowych.
**Znaczniki:** [FAKT] sprawdzone w kodzie lub pliku, [WNIOSEK] wynika z faktów, [HIPOTEZA] do potwierdzenia, [DECYZJA] rekomendacja do ADR-064. Dane przykładowe (rozstaw styków, kolejność torów) są **ilustracją mechanizmu, nie danymi producenta**.

## 0. Rekomendacja (skrót)

Do poprawnej obsługi grzebieni, listew zaciskowych i bloków rozdzielczych wystarczy **pięć zmian addytywnych**, bez nowego silnika i bez zmiany istniejących interfejsów:

1. **Węzły elektryczne są wyliczane, nie zapisywane** (`electricalNets(project)` na zasadzie union-find z istniejących połączeń, wewnętrznych połączeń definicji i styków geometrycznych).
2. **Rozszerzyć istniejące `internalLinks`** (jest w formacie, ale nieużywane w kodzie) o rodzaje `bridge` (stały mostek), `jumper` (mostek konfigurowalny) i `switched` (zależny od stanu, nigdy nie scala węzłów) oraz o zapis grupowy `members`.
3. **Dodać do portu opcjonalny opis zacisku `terminal`**: tor (`track`), położenie na aparacie (`at`, `side`), dopuszczalne przewody (przekrój, tulejki), zgodność mechaniczna (`fits`). Pojemność przewodów to już istniejące `capacity`.
4. **Dodać warstwę montażu `din.layer`** (`body` domyślnie, `busbar`): grzebień leży na zaciskach aparatów, a nie obok nich. Styk grzebienia z zaciskiem aparatu jest **wyliczany z pozycji**, więc przesunięcie aparatu zmienia węzły i walidację samo.
5. **Dodać do pakietu pole `enclosures`** (obudowy jako szablony szaf), bo dziś obudowa bez portów nie przechodzi walidacji pakietu.

Plus dwa elementy porządkujące widok (nie wymagają nowego silnika): **domyślne filtry widoczności** (osprzęt DIN nie wchodzi na schemat blokowy, a na widoku szafy domyślnie są tylko elementy DIN) i **montaż na płycie** (`plate`) dla elementów bez DIN przykręconych do obudowy.

Pakiet `hager-basic` w obecnej postaci **nie przechodzi walidacji** (2 obudowy bez portów: VE212L, VU36AT) i zawiera 59 aparatów, bez grzebieni, listew i bloków. Ten sam problem dotyczy wszystkich obudów, więc rozwiązuje go punkt 5.

## 1. Audyt obecnego silnika

### 1.1. Co już jest [FAKT]

| Obszar | Stan | Gdzie |
|---|---|---|
| Porty | `PortDefinition`: złącze, lista sygnałów, kierunek, strona, `capacity` (liczba połączeń), `group`, pola dodatkowe zachowywane (round-trip, Z8) | `src/types.ts`, `src/pack.ts` |
| Pojemność portu | `capacity` ≥ 1; walidacja **V-002** zgłasza błąd, gdy połączeń jest więcej | `src/validation.ts:41` |
| Połączenia | punkt–punkt, `Connection {from, to, signalKey, cableId}`; wiele połączeń na jednym porcie dopuszczone do `capacity` | `src/types.ts` |
| Przewód w szafie | kabel `std/cable-wire` (zacisk–zacisk), złącze `std/din-terminal`, sygnały `std/power-ac`, `std/power-dc` | ADR-052, rejestry |
| Wewnętrzne przejścia | `internalLinks {a, b, kind: passthrough \| loopthrough}` istnieje w typie i schemacie **projektu**, ale **nic go nie czyta** (brak w walidatorze, szafie, schemacie, raportach) | `schema/project.schema.json:80` |
| Szafy DIN | rzędy szyn, moduły 17,5 mm, `dinModules` w rewizji, pozycja `din {cabinetId, row, at}`, kolizje V-028, głębokość V-029, terminale i grupy terminali, szafa jako blok na schemacie | `src/cabinets.ts`, ADR-052 |
| Pakiety | `stagewire-pack/1`: nieznane pola urządzenia/portu/pakietu to **ostrzeżenie** i są pomijane, nie błąd | `src/pack.ts:68,97,136` |
| Port: `electrical` | `{voltageMinV, voltageMaxV, maxW}` walidowane i zachowywane | `src/pack.ts:138` |
| Wersjonowanie | rewizje definicji (`changeClass`), instancja wskazuje rewizję; identyfikatory portów stabilne (`portIdOf(key)`) | ADR-050, DOMAIN-MODEL |
| Undo/redo | polecenia na `immer` z łatami; stan wyliczany nie jest zapisywany (Z10) | `src/store.ts` |

### 1.2. Czego brakuje [WNIOSEK]

| Potrzeba | Dlaczego dziś się nie da |
|---|---|
| Ustalić, które zaciski mają wspólny potencjał | Są tylko krawędzie par portów; brak pojęcia „te porty są jednym węzłem” |
| Listwa N z 10 zaciskami, blok rozdzielczy 1→6 | Brak stałych wewnętrznych połączeń (`internalLinks` nieużywane); jedyna droga to 10 niezależnych portów bez relacji |
| Grzebień 3P | Brak elementu, który łączy zaciski kilku sąsiednich aparatów i wymusza tor na zębie |
| Rozróżnienie toru (L1/L2/L3/N/PE) | Jest jeden sygnał `std/power-ac`; walidator nie odróżni L1 od N |
| Styk zależny od stanu (wyłącznik, stycznik) | Wewnętrzne przejście nie ma pojęcia stanu |
| Położenie zacisku w aparacie | Port ma tylko stronę (`side`), bez pozycji wzdłuż szyny |
| Obudowa jako pozycja biblioteki | Pakiet wymaga niepustych `ports` (`pack.ts:131`); szafa nie jest definicją urządzenia |
| Osprzęt przykręcony do obudowy (nie DIN) | Instancja może być w szafie tylko przez `din` |
| Filtrowanie widoków | Lista „Poza szafą” pokazuje wszystko z `dinModules`; schemat blokowy pokazuje wszystko, co nie jest wewnątrz szafy w trybie bloku |

### 1.3. Co można użyć ponownie

`capacity` (liczba przewodów na zacisku), `internalLinks` (struktura i miejsce w schemacie), `Connection` + `cable-wire` (przewód od zacisku do zacisku), grupy terminali szafy, rewizje i `changeClass`, ostrzeżenia o polach z nowszej wersji pakietu, mechanizm polecenie + niezmiennik + walidacja miękka, `dinModules` i `din`.

### 1.4. Uwagi o pakiecie `hager-basic` [FAKT]

- 61 urządzeń: 40 wyłączników nadprądowych, 6 różnicowoprądowych, 4 RCBO, 4 rozłączniki, 2 SPD, 2 styczniki, 1 przekaźnik, 2 obudowy.
- Porty są oznaczone jako logiczne („rzeczywista kolejność zacisków wymaga kontroli na aparacie”), złącze `std/din-terminal`, sygnał `std/power-ac` dla wszystkich torów, w tym N i PE.
- `ve212l`, `vu36at`: `ports: []` i brak `dinModules`, co słusznie wskazuje na brak miejsca na obudowy w modelu.
- Nie ma grzebieni, listew N/PE, złączek ani bloków: to elementy, dla których potrzebna jest topologia.

## 2. Architektura

### 2.1. Węzeł elektryczny: wyliczany [DECYZJA]

`ElectricalNet` = klasa równoważności portów. Wyliczana funkcją czystą `electricalNets(project): Net[]` z trzech źródeł:

1. **Połączenia projektu** (`connections`) między portami o sygnale elektrycznym (przewód łączy porty w jeden węzeł).
2. **Połączenia wewnętrzne definicji** rodzaju `bridge` oraz włączone `jumper`.
3. **Styki geometryczne**: zęby grzebienia leżące na zaciskach aparatów w tej samej szafie, rzędzie, na tym samym module i stronie (p. 2.5).

Zalety: zgodne z zasadą Z10 (wyniki pochodne nie są przechowywane), zero migracji, undo/redo za darmo, nie ma co rozjechać po przesunięciu aparatu. Wada: koszt przeliczenia. Szacunek: union-find O(n·α) na kilku tysiącach portów to milisekundy; wynik cachowany do zmiany `connections`, `equipment` lub `cabinets` (jak walidacja, M5).

| Wariant | Ocena |
|---|---|
| **Wyliczany (rekomendowany)** | prosty, spójny z Z10, bez niezmienników do pilnowania |
| Zapisywana encja `nets` z nazwą | przydatna dopiero dla nazw obwodów (np. „L1 szafa A”); można dodać później jako **adnotację** do węzła wyliczonego (klucz: najmniejszy port), bez zmiany silnika |
| Węzeł jako pośrednik w połączeniach (hub) | zmienia `Connection` i wszystkie widoki; odrzucone |

Każdy węzeł niesie: porty, **zbiór torów** (`track`) i sygnałów. Węzeł z więcej niż jednym torem jest kandydatem do błędu zwarcia (p. 3).

### 2.2. Model zacisku: rozszerzenie portu [DECYZJA]

Nie tworzymy nowego typu. Port dostaje opcjonalny obiekt `terminal` (dziś nieznane pola portu są zachowywane, a w pakiecie to ostrzeżenie, więc zmiana jest zgodna wstecz):

```jsonc
"terminal": {
  "track": "L1",                       // tor: L1 L2 L3 N PE lub dowolny napis (np. "A", "COM")
  "at": 0,                             // położenie w modułach od lewej krawędzi aparatu (środek zacisku = at + 0,5)
  "side": "top",                       // top | bottom: strona szyny, z której jest zacisk
  "wires": { "minMm2": 1.5, "maxMm2": 25, "ferrule": "allowed" },  // allowed | required | forbidden
  "kind": "screw",                     // screw | push-in | spring | comb-slot
  "fits": ["comb-1p-pitch1"]           // jakie grzebienie/mostki może przyjąć (tagi zgodności)
}
```

- **Maksymalna liczba przewodów** = istniejące `capacity`. Pojemność grzebienia na zacisku (przewód **plus** szyna) wyraża `kind: 'comb-slot'` obok zwykłego przewodu: zacisk może mieć osobne wejście na grzebień (`fits`) i na przewód (`capacity`), więc obie rzeczy nie konkurują o `capacity`.
- **Zacisk fizyczny a punkt logiczny.** Port = punkt logiczny przyłączenia. Gdy jeden zacisk fizyczny ma dwa wejścia (przewód i grzebień) albo dwa tory (zacisk wielotorowy), są to **dwa porty o wspólnym `terminal.at`**. Nie ma osobnej encji „zacisk fizyczny”.
- **Wejścia i wyjścia**: istniejące `direction`. Zacisk grzebienia jest `io`.
- **Pole `terminal` jest opcjonalne**: stare definicje działają bez zmian (brak toru = zacisk niezdefiniowany, bez reguł V-04x).

### 2.3. Tory: nie spłaszczamy do jednego węzła [DECYZJA]

Grzebień 3P ma **trzy niezależne tory** na przemian. Reprezentacja: **każdy ząb jest portem**, a ząb ma `terminal.track`. Mostkowanie obejmuje tylko zęby tego samego toru (wiele grup `bridge` w jednej definicji). Węzły L1, L2, L3 są więc rozłączne, a naruszenie (np. ząb L2 na zacisku L1 aparatu) widać jako węzeł o dwóch torach.

Tor jest łańcuchem (nie rejestrem), bo musi działać poza energetyką (A/B/GND, COM). Jeśli w praktyce zajdzie potrzeba słownika torów, przeniesie się go do rejestru sygnałów (np. `std/power-ac-l1`) bez zmiany formatu portu.

### 2.4. Wewnętrzna topologia urządzeń: rodzaje połączeń [DECYZJA]

Rozszerzenie `internalLinks` (typ i schemat; kod zaczyna je czytać):

| `kind` | Znaczenie | Wpływ na węzły |
|---|---|---|
| `bridge` | stały mostek fabryczny (listwa N, PE, złączka, blok rozdzielczy) | **zawsze scala** |
| `jumper` | mostek konfigurowalny (zworka, mostek wstawiany) | scala, gdy włączony w instancji (`portOverrides` lub parametr `jumpers`), domyślnie wyłączony |
| `switched` | styk zależny od stanu aparatu (wyłącznik, rozłącznik, stycznik, przekaźnik) | **nigdy nie scala** w obliczeniu węzłów; walidacja może pokazać „może przewodzić” |
| `passthrough`, `loopthrough` | dotychczasowe | bez zmian (rejestrowane, nieużywane przez węzły) |

Zapis grupowy, żeby nie wypisywać O(n²) par: `{ "kind": "bridge", "members": ["n1","n2",...,"n10"] }` jako alternatywa dla `{a, b}`.

`switched` niesie `contact` (np. `K1`, opcjonalnie `normally: 'open' | 'closed'`) i **nie** zakłada stanu. Pierwsza wersja nie symuluje stanów: tylko oznacza, że ścieżka przez ten styk jest warunkowa (ważne dla poprawnego zaznaczenia, że wyłącznik nie jest mostkiem). Symulacja stanów jest rozszerzeniem poza MVP.

### 2.5. Grzebienie, szyny i geometria [DECYZJA]

Grzebień jest zwykłą definicją urządzenia z zębami jako portami i warstwą montażu:

- **Warstwa:** instancja ma `din {cabinetId, row, at, layer?}`. `layer` ∈ `body` (domyślnie: aparaty, listwy, bloki) i `busbar` (grzebienie i mostki leżące na zaciskach). Kolizje V-028 liczy się **w obrębie warstwy**, więc grzebień nad aparatami nie koliduje z nimi, a dwa grzebienie nad tym samym zaciskiem tak. Pole opcjonalne, brak = `body`, więc stare projekty są nietknięte.
- **Zęby:** port `t1…tn`, `terminal.at` = indeks zęba × rozstaw (w modułach, 1 = 17,5 mm), `terminal.side` = `top` lub `bottom`, `terminal.track`, `terminal.kind: 'comb-slot'`, `terminal.fits` = tag rozstawu i typu.
- **Styk wyliczany:** ząb grzebienia (szafa, rząd, moduł bezwzględny `m = din.at + terminal.at`, strona) **styka** zacisk aparatu z `layer: body`, który ma `terminal.side` zgodną, `terminal.at` odpowiadające temu modułowi i `fits` zawierające tag zęba. Styk scala porty w węzeł jak `bridge`. Brak zacisku pod zębem: ząb nieużywany (informacja o zabezpieczeniu końca, p. 3).
- **Przesunięcie aparatu:** zmiana `din.at` zmienia styki, więc węzły i walidacja przeliczą się same. Nie trzeba migrować połączeń ani pilnować spójności.
- **Skracanie szyn:** pierwsza wersja używa osobnych definicji dla długości katalogowych. Cięcie na miarę to rozszerzenie: w definicji `trimmable {minModules, stepModules}`, w instancji `din.span` (liczba użytych zębów). Nie wchodzi do MVP.
- **Zasilanie szyny z różnych punktów:** ząb jest portem `io`, więc przewód może wejść do dowolnego zęba (lub do aparatu pod nim). Nie wymaga osobnej logiki.
- **Powiązanie z 2D/3D:** moduł bezwzględny jest wspólnym kluczem: elewacja szafy rysuje ząb nad zaciskiem; 3D bierze położenie z `din` i wymiarów definicji. Nie dodajemy współrzędnych 3D zacisków.

### 2.6. Obudowy i elementy poza szyną DIN [DECYZJA]

- **Obudowa:** nowe pole pakietu `enclosures: [{ key, manufacturer, model, widthMm, heightMm, depthMm, rows, modules, ip?, mounting?, includes? }]`. Katalog wystawia je jako presety szafy (jak `CABINET_PRESETS`). Szafa pozostaje encją `cabinets`; `enclosures` to biblioteka szablonów. Nie wymagamy portów. Starsze aplikacje zignorują pole z ostrzeżeniem.
- **Montaż na płycie:** instancja ma wartość osadzoną `plate {cabinetId, x, y}` (mm od lewego górnego rogu płyty montażowej), wykluczającą się z `din` i `mount`. Wymiary bierze z `dimensionsMm`. Kolizje prostokątów liczone w osobnej regule. Dzięki temu element bez DIN (np. zasilacz przykręcony do obudowy) jest „w szafie” bez udawania szyny.
- **Domyślne reguły widoczności** (p. 2.7).

### 2.7. Filtrowanie widoków [DECYZJA]

Wyliczana klasa montażu urządzenia: `din` (ma `dinModules`), `rack` (ma `rackUnits`), `free` (reszta).

| Widok | Domyślnie | Przełącznik |
|---|---|---|
| **Schemat blokowy** | ukrywa instancje klasy `din`, **o ile** nie są w szafie pokazywanej jako blok (ten mechanizm `asBlock` już działa); krawędzie do ukrytych węzłów rysowane przez szafę (blok) albo pomijane | „Pokaż osprzęt DIN” w pasku schematu |
| **Widok szafy**: lista „Poza szafą” | pokazuje klasę `din` i elementy już zamontowane na płycie | „Pokaż też urządzenia bez DIN” (potrzebne do `plate`) |
| **Przeglądarka biblioteki** | bez zmian; filtr „Montaż: DIN / rack / wolne” dochodzi jako kolejny filtr fasetowy | n/d |

Ustawienia filtrów są zapisem widoku (`views.*.filters`), a nie danymi domenowymi, więc nie wpływają na eksporty i walidację. Brak = zachowanie dzisiejsze dla istniejących projektów (zgodność wsteczna): domyślne ukrywanie dotyczy **nowych** projektów, a przy otwarciu starszego projektu filtr jest wyłączony i widoczny jako pole do włączenia.

## 3. Walidacja

Podział: **błąd** = da się stwierdzić jednoznacznie z danych projektu; **ostrzeżenie** = zależy od danych producenta lub kontekstu instalacji; **informacja** = podpowiedź. Zgodność geometryczna **nie** oznacza dopuszczenia przez producenta, więc reguły oparte na `fits` i rozstawie są ostrzeżeniami, dopóki dane nie mają statusu „zweryfikowane”.

| Reguła | Poziom | Warunek |
|---|---|---|
| **V-040** zwarcie torów | błąd | węzeł zawiera porty o różnych `track` spośród {L1, L2, L3, N, PE} |
| **V-041** N/PE na torze fazowym i odwrotnie | błąd | przewód łączy porty o torach z różnych klas (faza, N, PE) |
| **V-042** zwarcie niezależnych torów w jednym elemencie | błąd | dwa porty tego samego urządzenia o różnych torach w jednym węźle poza zdefiniowanym `bridge` |
| **V-043** kolejność faz w grzebieniu | ostrzeżenie | zęby sąsiednich aparatów dają sekwencję niezgodną z oczekiwaną przez definicję grzebienia (`phaseOrder`), np. L1 L3 L2 |
| **V-044** przekroczona pojemność zacisku | błąd | liczba przewodów > `capacity` (istniejące V-002, rozszerzone na przekrój: przewód o `crossSectionMm2` poza `wires.min/max` = ostrzeżenie) |
| **V-045** niezgodny typ przyłącza | błąd | złącze portów różne (istniejące sprawdzanie kabla `endPairs`) |
| **V-046** grzebień niezgodny z aparatem | ostrzeżenie | ząb nad zaciskiem bez wspólnego tagu `fits` |
| **V-047** niedopasowany rozstaw | ostrzeżenie | zęby nie trafiają w zaciski (przesunięcie o część modułu lub brak zacisku pod zębem aparatu w obrębie jego szerokości) |
| **V-048** niedozwolona kombinacja mostków | ostrzeżenie | dwa mostki/grzebienie na jednym zacisku, który ma `capacity` 1 w slocie grzebienia |
| **V-049** połączenie niespójne z położeniem | informacja | połączenie przewodem między sąsiednimi zaciskami objętymi też grzebieniem (nadmiarowość) |
| **V-050** niezabezpieczony koniec grzebienia | informacja | ząb poza ostatnim aparatem (wymaga pokrywy końcowej; zależy od danych producenta) |
| **V-051** styk zależny od stanu użyty jako mostek | ostrzeżenie | ścieżka przez `switched` bez innego połączenia, gdy na tej ścieżce zakładano stałe zasilanie (np. N przez aparat) |

Dane producenta dochodzą jako pola `fits`, `phaseOrder`, `wires`, więc reguły nie zawierają nazw producentów.

## 4. Zgodność wsteczna

| Obszar | Wpływ | Ocena |
|---|---|---|
| Schemat projektu | nowe pola opcjonalne: `terminal` (port), `internalLinks.kind` + `members`, `din.layer`, `plate`, `views.*.filters` | addytywnie; `formatVersion` `1.0.0-draft` bez podbicia, wersja drobna przy wydaniu 1.0 |
| `stagewire-pack/1` | nowe pola: `terminal`, `internalLinks`, `enclosures`; w starszych aplikacjach ostrzeżenie „nieznane pole” i pominięcie | pakiet nie przestaje się ładować; **dane topologiczne są wtedy pomijane**, co pakiet powinien zaznaczać w `description` |
| Stabilność ID portów | bez zmian; zęby grzebieni mają stałe klucze `t1…tn` | zachowana |
| Istniejące definicje | bez pól nowych działają jak dziś | zachowane |
| Import i aktualizacja | zmiana `terminal`/`internalLinks` w pakiecie to zmiana **strukturalna** (`changeClass: structural`), zgodnie z istniejącymi zasadami rewizji | bez zmiany mechanizmu |
| Walidator połączeń | nowe reguły V-04x działają tylko dla portów z `terminal` | stare projekty bez nowych ostrzeżeń |
| Schemat blokowy | filtr widoczności; połączenia węzłów ukrytych rysuje szafa (blok) | zmiana tylko wizualna |
| Plan i trasy | bez zmian | n/d |
| Widok szafy | warstwy, zęby nad zaciskami, płyta | rozszerzenie |
| Undo/redo | nowe pola przez istniejące polecenia | bez zmian |
| Zapis/odczyt, migracje | wymaga potwierdzenia, że nieznane pola projektu przechodzą round-trip (Z8) [HIPOTEZA]; sprawdzić w teście | do weryfikacji |

## 5. Przykładowe definicje (ilustracja mechanizmu) [HIPOTEZA]

Aparat 1P z zaciskami pod grzebień (fragment; reszta pól jak w `hager-basic`):

```json
{
  "key": "mcb-1p-example", "model": "MCB 1P (przykład)", "category": "zasilanie / wyłączniki nadprądowe",
  "dinModules": 1,
  "ports": [
    { "key": "in",  "label": "IN",  "connector": "std/din-terminal", "signals": ["std/power-ac"], "direction": "in",  "capacity": 1,
      "terminal": { "at": 0, "side": "top",    "kind": "screw",     "wires": { "minMm2": 1.5, "maxMm2": 25 } } },
    { "key": "in-comb", "label": "IN (grzebień)", "connector": "std/din-comb-slot", "signals": ["std/power-ac"], "direction": "in", "capacity": 1,
      "terminal": { "at": 0, "side": "top",    "kind": "comb-slot", "fits": ["comb-1p-pitch1"] } },
    { "key": "out", "label": "OUT", "connector": "std/din-terminal", "signals": ["std/power-ac"], "direction": "out", "capacity": 1,
      "terminal": { "at": 0, "side": "bottom", "kind": "screw",     "wires": { "minMm2": 1.5, "maxMm2": 25 } } }
  ],
  "internalLinks": [
    { "kind": "bridge", "members": ["in", "in-comb"] },
    { "kind": "switched", "a": "in", "b": "out", "contact": "Q" }
  ]
}
```

Grzebień 3P (6 zębów, rozstaw 1 moduł, tory na przemian):

```json
{
  "key": "comb-3p-6-example", "model": "Grzebień 3P, 6 mod. (przykład)", "category": "zasilanie / grzebienie",
  "dinModules": 6, "placementLayer": "busbar",
  "phaseOrder": ["L1", "L2", "L3"],
  "ports": [
    { "key": "t1", "label": "L1", "connector": "std/din-comb-slot", "signals": ["std/power-ac"], "direction": "io", "terminal": { "track": "L1", "at": 0, "side": "top", "kind": "comb-slot", "fits": ["comb-1p-pitch1"] } },
    { "key": "t2", "label": "L2", "connector": "std/din-comb-slot", "signals": ["std/power-ac"], "direction": "io", "terminal": { "track": "L2", "at": 1, "side": "top", "kind": "comb-slot", "fits": ["comb-1p-pitch1"] } },
    { "key": "t3", "label": "L3", "connector": "std/din-comb-slot", "signals": ["std/power-ac"], "direction": "io", "terminal": { "track": "L3", "at": 2, "side": "top", "kind": "comb-slot", "fits": ["comb-1p-pitch1"] } },
    { "key": "t4", "label": "L1", "connector": "std/din-comb-slot", "signals": ["std/power-ac"], "direction": "io", "terminal": { "track": "L1", "at": 3, "side": "top", "kind": "comb-slot", "fits": ["comb-1p-pitch1"] } },
    { "key": "t5", "label": "L2", "connector": "std/din-comb-slot", "signals": ["std/power-ac"], "direction": "io", "terminal": { "track": "L2", "at": 4, "side": "top", "kind": "comb-slot", "fits": ["comb-1p-pitch1"] } },
    { "key": "t6", "label": "L3", "connector": "std/din-comb-slot", "signals": ["std/power-ac"], "direction": "io", "terminal": { "track": "L3", "at": 5, "side": "top", "kind": "comb-slot", "fits": ["comb-1p-pitch1"] } }
  ],
  "internalLinks": [
    { "kind": "bridge", "members": ["t1", "t4"] },
    { "kind": "bridge", "members": ["t2", "t5"] },
    { "kind": "bridge", "members": ["t3", "t6"] }
  ]
}
```

Listwa N, 10 zacisków (PE analogicznie z `track: "PE"`):

```json
{
  "key": "bar-n-10-example", "model": "Listwa N, 10 zacisków (przykład)", "category": "zasilanie / listwy zaciskowe",
  "dinModules": 4,
  "ports": [ { "key": "n1", "label": "N1", "connector": "std/din-terminal", "signals": ["std/power-ac"], "direction": "io", "capacity": 2,
               "terminal": { "track": "N", "at": 0, "side": "top", "kind": "screw", "wires": { "minMm2": 1.5, "maxMm2": 16 } } } ],
  "internalLinks": [ { "kind": "bridge", "members": ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10"] } ]
}
```

(pozostałe porty `n2…n10` identyczne poza `key`, `label` i `at`.)

Blok rozdzielczy trójfazowy 1→6: cztery niezależne grupy (L1, L2, L3, N); każda ma jedno wejście i sześć wyjść w grupie `bridge` o jednym torze. Wszystkie cztery grupy są w jednej definicji, więc nie zlewają się w jeden węzeł.

Obudowa (nowe pole pakietu):

```json
"enclosures": [
  { "key": "ve212l", "manufacturer": "Hager", "model": "VE212L", "widthMm": 0, "heightMm": 0, "depthMm": 0, "rows": 2, "modules": 12, "ip": "IP65", "mounting": "surface" }
]
```

(Wymiary do uzupełnienia z karty produktu; dziś pakiet ma je w `dimensionsMm`.)

### Zmiany schematów, wprost

| Plik | Zmiana |
|---|---|
| `schema/project.schema.json` | `portDefinition.terminal` (obiekt opcjonalny); `internalLinks.items`: `kind` wzbogacone o `bridge`, `jumper`, `switched`; `members` jako alternatywa dla `a`/`b`; `contact`; `equipment.din.layer`; `equipment.plate`; `views.*.filters` |
| `schema/pack.schema.json` | `device.internalLinks`, `device.placementLayer`, `device.phaseOrder`, `port.terminal`, `pack.enclosures` |
| `src/pack.ts` | dodać pola do `DEV_FIELDS`, `PORT_FIELDS`, `TOP_FIELDS`; walidacja `terminal`, `internalLinks`, `enclosures`; zezwolić na `ports: []` tylko gdy pozycja jest w `enclosures` |
| `src/types.ts` | typy `TerminalSpec`, rozszerzone `internalLinks`, `DinMount.layer`, `PlateMount` |
| nowy `src/nets.ts` | `electricalNets(project)`, `netOf(port)` |
| `src/validation.ts` | reguły V-040…V-051 |
| `src/cabinets.ts` | kolizje w obrębie warstwy; `plate`; styki geometryczne |
| rejestry | złącze `std/din-comb-slot` |

## 6. Scenariusze testowe i oczekiwane wyniki

| # | Scenariusz | Modelowanie | Walidacja |
|---|---|---|---|
| 1 | trzy wyłączniki 1P pod grzebieniem 3P | 3 aparaty na kolejnych modułach, grzebień `busbar` nad nimi; styki: aparat 1→L1, 2→L2, 3→L3 | 3 węzły (L1, L2, L3) rozłączne; brak błędów |
| 2 | sześć 1P, sekwencja L1/L2/L3 | grzebień 6 zębów, `bridge` {t1,t4}, {t2,t5}, {t3,t6} | aparaty 1 i 4 w jednym węźle L1 itd.; zasilenie jednego zęba L1 zasila oba |
| 3 | listwa N z wieloma przewodami | `bridge` na 10 portach, `capacity` 2 | do 20 przewodów; 21. = V-044 (błąd); wszystkie porty jeden węzeł N |
| 4 | dwie listwy N dla dwóch grup RCD | dwie instancje listwy | dwa niezależne węzły N; przewód łączący je jest dozwolony przez model, ale to, że listwy należą do różnych grup RCD, jest kontekstem instalacji, więc walidacja daje **tylko informację** (bez błędu) |
| 5 | listwa PE | jak N, `track: PE` | PE połączony z N przewodem = V-041 (błąd) |
| 6 | blok rozdzielczy 3F | cztery grupy `bridge` | cztery węzły; wyjście L1 połączone z wejściem L2 = V-040 |
| 7 | złączki przelotowe z mostkami | złączka: `bridge` góra↔dół; mostek `jumper` między sąsiadkami | węzły scalone tylko po włączeniu `jumper` |
| 8 | grzebień o niezgodnym rozstawie | ząb `fits` ≠ `fits` zacisku | V-046 (ostrzeżenie), brak styku → rozłączne węzły |
| 9 | przesunięcie aparatu psuje zgodność | aparat 2 przesunięty o 1 moduł | styki przeliczone, V-047 (ostrzeżenie), węzły zmienione; **cofnięcie** przywraca stan |
| 10 | dwa sposoby podłączenia do tego samego toru | zacisk z przewodem i z grzebieniem (osobne porty o wspólnym `at`) | jeden węzeł, brak V-044; dwa przewody na zacisku z `capacity` 1 = błąd |
| 11 | rozłącznik/stycznik | `switched` IN↔OUT | IN i OUT w **różnych** węzłach; ścieżka oznaczona jako warunkowa; N przez styk bez innego połączenia = V-051 |
| 12 | stary projekt bez nowych mechanizmów | otwarcie i zapis | identyczny zapis (round-trip), te same wyniki walidacji (test regresyjny na istniejących fixture'ach) |

## 7. Plan implementacji

Etapy małe, każdy kończy się zielonymi testami. MVP = E0–E5. Późniejsze: E6+.

| Etap | Zakres | Zależności | Kryteria akceptacji | Testy regresyjne |
|---|---|---|---|---|
| **E0 Filtry widoczności** | klasa montażu (`din`/`rack`/`free`); filtr na schemacie i w widoku szafy; zapis w widoku | brak | nowy projekt: osprzęt DIN poza schematem; przełącznik przywraca; stary projekt bez zmian | testy UI schematu i szafy, 289 jednostkowych |
| **E1 Typy i schematy** | `terminal`, `internalLinks` (kinds, members), `din.layer`, `plate`, `enclosures`; walidacja pakietów; przejście round-trip | brak | pakiet z nowymi polami przechodzi walidację; starszy pakiet bez zmian; test round-trip projektu z nowymi polami | `validator-fresh`, testy pakietów |
| **E2 Węzły** (`nets.ts`) | union-find z połączeń i `bridge`/`jumper`; `switched` nie scala | E1 | scenariusze 3, 5, 6, 7, 11, 12 | wydajność na dużym projekcie (budżet kilka ms) |
| **E3 Walidacja torów** | V-040, V-041, V-042, V-044 | E2 | scenariusze 3–6 | istniejące V-002, V-028 bez zmian |
| **E4 Geometria i grzebienie** | warstwa `busbar`, styki wyliczane, V-043, V-046, V-047, V-050; rysowanie zębów w szafie | E2, E3 | scenariusze 1, 2, 8, 9, 10; przesuwanie aparatu z cofaniem | testy szafy (24 kontrole UI) |
| **E5 Obudowy i płyta** | `enclosures` w katalogu, `plate`, reguła kolizji płyty | E1 | pakiet `hager-basic` przechodzi walidację; obudowy jako presety szafy | testy katalogu |
| E6 (po MVP) | cięcie grzebieni na miarę (`trimmable`), pokrywy końcowe | E4 | — | — |
| E7 (po MVP) | symulacja stanów aparatów, ścieżki przepływu zasilania | E2 | — | — |
| E8 (po MVP) | analiza obciążeń, przekrój a prąd, selektywność, zwarcia | E7 | — | — |

Poza zakresem MVP świadomie: obliczenia elektryczne, selektywność, dobór przekrojów, symulacja stanów, pełny CAD elektryczny.

## 8. Ryzyka i pytania otwarte

- **Dane producenta:** rozstaw, tory zębów, zgodność `fits` i kolejność faz wymagają danych z kart katalogowych. Bez nich reguły geometryczne są tylko ostrzeżeniami. Biblioteka powinna oznaczać dane jako zweryfikowane lub nie (istniejące `source`).
- **Model zacisku w aparatach:** jeden zacisk fizyczny z przewodem i grzebieniem to dwa porty o wspólnym `at`. Zwiększa to liczbę portów w pakietach o ok. 1/3; do oceny, czy w UI ukrywać port „(grzebień)” do czasu włączenia widoku szafy.
- **Round-trip nieznanych pól projektu** [HIPOTEZA]: potwierdzić testem w E1, zanim pola zostaną użyte.
- **Domyślne ukrywanie na schemacie:** dotyczy nowych projektów; zmiana zachowania istniejących wymagałaby decyzji właściciela (Q-30).
- **Nazwy torów** jako napisy zamiast rejestru: do przeglądu po pierwszych pakietach spoza energetyki.
