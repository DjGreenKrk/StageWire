# Baza urządzeń StageWire — jak ją tworzyć

Dokument dla osób (i narzędzi), które równolegle z rozwojem programu budują bazę urządzeń. Opisuje format pakietu, zasady jakości i pochodzenia danych oraz codzienny sposób pracy. Decyzje: ADR-020 (higiena IP), ADR-039/040 (katalog i edycja definicji), ADR-049 (pakiety urządzeń), ADR-050 (identyfikacja, aktualizacja, rejestry i wiarygodność danych).

## 1. Zasada nadrzędna: dane własne, ze źródłem

- Baza powstaje **od zera, własnymi słowami**, na podstawie dokumentacji producentów (karty katalogowe, instrukcje) i egzemplarzy, które ktoś faktycznie sprawdził. Fakty techniczne (liczba i rodzaj złączy, wymiary) nie są chronione, ale **układ cudzej bazy, opisy, ikony i kod** już tak.
- **Nie kopiujemy** baz, bibliotek ani plików z innych programów. Nie importujemy ich plików i nie przepisujemy ich tabel.
- Każde urządzenie ma **`source`**: skąd wiemy to, co zapisano. Bez źródła pakiet się nie zwaliduje.
- Pole `description` ma najwyżej 400 znaków i jest napisane własnymi słowami (nie kopiowane z katalogu producenta).
- Wątpliwości co do danych oznaczamy `source.kind = "estimated"`; program ostrzega, że wymagają weryfikacji.

## 2. Co to jest pakiet

Plik `*.swpack.json` (UTF-8) z listą urządzeń i opcjonalnymi własnymi złączami, sygnałami i typami kabli. Jeden pakiet = jedna spójna porcja bazy (np. „kamery Acme”, „pulpity audio – własne”). Przykład: `packs/PRZYKLAD-fikcyjny.swpack.json`; podpowiedzi w edytorze daje schemat `schema/pack.schema.json` (mapowanie w ustawieniach edytora, patrz §13; pakiet **nie** zawiera ścieżki do schematu, więc plik można skopiować na dowolny komputer).

```jsonc
{
  "format": "stagewire-pack/1",
  "id": "moj-pakiet",              // małe litery, cyfry, myślniki; stały na zawsze
  "name": "Mój pakiet",
  "version": "1.0.0",               // zwiększaj przy każdej zmianie treści
  "license": "własne (do użytku wewnętrznego)",
  "registries": { },                // tylko własne złącza/sygnały/kable (patrz §5)
  "devices": [
    {
      "key": "kd-1",                // stały klucz urządzenia w pakiecie
      "manufacturer": "Acme (fikcyjny)", "model": "KD-1",
      "category": "wideo / konwertery", "tags": ["konwerter"],
      "description": "Własny, krótki opis.",
      "dimensionsMm": { "width": 100, "depth": 80, "height": 25 },
      "weightKg": 0.4, "powerW": 5, "powerMaxW": 8,
      "rackUnits": { "heightU": 1, "widthFraction": 1 },   // tylko dla urządzeń do racka
      "ports": [
        { "key": "sdi-in",  "label": "SDI IN",  "connector": "std/bnc-75", "signals": ["std/sdi-3g"], "direction": "in" },
        { "key": "hdmi-out", "label": "HDMI OUT", "connector": "std/hdmi-a", "signals": ["std/hdmi"], "direction": "out" },
        { "key": "dc-in", "label": "DC IN", "connector": "std/dc-barrel", "signals": ["std/power-dc"], "direction": "in", "group": "Zasilanie",
          "electrical": { "voltageMinV": 9, "voltageMaxV": 15, "maxW": 8 } }
      ],
      "source": { "kind": "datasheet", "ref": "KD-1 Datasheet rev. B", "url": "https://…", "hardwareRevision": "rev B", "verified": "2026-11-02" }
    }
  ]
}
```

### Pola urządzenia

| Pole | Wymagane | Uwagi |
|---|---|---|
| `key` | tak | Stabilny identyfikator w pakiecie (`a-z`, `0-9`, `-`, `_`). **Nie zmieniaj go po publikacji**: z niego i z id pakietu powstaje identyfikator definicji w projektach |
| `manufacturer`, `model`, `category` | tak | Producent „Generic” tylko dla urządzeń ogólnych. Kategoria w postaci `grupa / podgrupa`, np. `wideo / kamery` (słownik w §4) |
| `tags` | nie | Pomagają w wyszukiwaniu (np. `ptz`, `4k`, `dante`) |
| `description` | nie | Do 400 znaków, własne słowa |
| `kind` | nie | `physical` (domyślnie) albo `virtual` (np. „Internet”, „Chmura”) |
| `dimensionsMm` | zalecane | Szerokość × głębokość × wysokość w mm. Bez wymiarów urządzenie nie trafi na plan w skali (ostrzeżenie) |
| `weightKg` | nie | Masa w kg |
| `powerW`, `powerMaxW` | nie | Pobór typowy i maksymalny w W (`powerMaxW` ≥ `powerW`). Sposób **podłączenia** zasilania to porty (§12) |
| `dinModules` | nie | całkowita liczba modułów 1–72 po 17,5 mm. **Tylko urządzenia z tym polem można zamontować na szynie DIN** (widok Szafa, ADR-052) |
| `rackUnits` | nie | `heightU` 1–60, `widthFraction` 1, 0.5 lub 0.33. **Tylko urządzenia z tym polem można zamontować w racku** (widok Rack, ADR-051) |
| `ports` | tak | Kolejność w tablicy = kolejność wyświetlania |
| `source` | tak | Patrz §3 |

### Pola portu

| Pole | Wymagane | Uwagi |
|---|---|---|
| `key` | tak | Stabilny klucz portu w urządzeniu. **Nie zmieniaj po publikacji**: połączenia w projektach wskazują porty przez identyfikator wynikający z klucza. Myślniki i podkreślenia są usuwane, więc `sdi-in-1` i `sdi_in_1` to ten sam port (walidacja zgłosi kolizję) |
| `label` | tak | Napis na panelu urządzenia (tak jak na obudowie), np. `SDI IN 1`, `LAN` |
| `connector` | tak | Klucz złącza z rejestru (§5) |
| `signals` | tak | Lista kluczy sygnałów z rejestru; pierwszy jest sygnałem głównym |
| `direction` | tak | `in`, `out`, `io` (np. sieć), `loop` (przelot) |
| `capacity` | nie | Ile kabli przyjmuje port (domyślnie 1; zwykle 1) |
| `side` | nie | `left`, `right`, `top`, `bottom`, `auto` (wskazówka rysowania) |
| `note` | nie | Uwaga o porcie |
| `group` | nie | Nazwa grupy portów (np. `Zasilanie`, `Wejścia SDI`, `PoE`); wskazówka porządkowa, nie zmienia zachowania połączeń |
| `electrical` | nie | Tylko dla portów zasilania: `voltageMinV`, `voltageMaxV`, `maxW` (§12) |

## 3. Źródło danych (`source`)

| `kind` | Znaczenie | Wymagania |
|---|---|---|
| `datasheet` | Karta katalogowa producenta | `ref`: nazwa i wersja dokumentu lub adres |
| `manual` | Instrukcja producenta | `ref` jak wyżej |
| `measured` | Sprawdzone na egzemplarzu | `ref` lub `note` (kto/kiedy sprawdził) |
| `estimated` | Szacunek, wymaga weryfikacji | zalecane `note`; program ostrzega |
| `generic` | Urządzenie ogólne, bez marki | tylko producent „Generic” |
| `custom` | Własna konfiguracja użytkownika | np. urządzenie zbudowane z elementów |

Dodatkowe pola źródła (wszystkie opcjonalne): `url` (adres `http(s)` dokumentu; program go **nie** pobiera), `hardwareRevision` (wersja sprzętowa, gdy dokument dotyczy konkretnej rewizji, np. `rev B`), `note` (komentarz) i `generated: true` (dane wytworzone automatycznie: skryptem lub modelem językowym).

**Wiarygodność** wynika wyłącznie z pól źródła i jest pokazywana w katalogu (oznaczenie „niezweryfikowane” lub „szacunkowe”):

| Status | Kiedy |
|---|---|
| zweryfikowane | `datasheet`, `manual` lub `measured` **z datą `verified`** (człowiek porównał dane z dokumentem) |
| niezweryfikowane | źródło wskazane, ale bez `verified`; `custom` bez weryfikacji; **każde** `custom` z `generated: true` |
| szacunkowe | `estimated` |
| ogólne | `generic` (urządzenie bez marki) |

Dane z generatora (`generated: true`) nigdy nie są zweryfikowane same z siebie: `verified` ustawia dopiero człowiek po sprawdzeniu dokumentu. Walidator ostrzega o danych wygenerowanych bez weryfikacji i o źródłach bez daty.

**Pewność danych rośnie w kolejności:** `estimated` < `custom`/`generic` < `datasheet`/`manual` < `measured` (ostatnie dla portów, bo karta katalogowa bywa niedokładna).

## 4. Konwencje nazw

- **Kategorie** (zbiór otwarty, ale trzymajmy się spójności): `wideo / kamery`, `wideo / źródła`, `wideo / przełączanie`, `wideo / konwertery`, `wideo / wyświetlacze`, `wideo / LED`, `wideo / nagrywanie i streaming`, `audio / pulpity`, `audio / stageboxy`, `audio / mikrofony`, `audio / głośniki`, `audio / interkom`, `oświetlenie / pulpity`, `oświetlenie / oprawy`, `oświetlenie / węzły DMX`, `sieć / switche`, `sieć / routery i AP`, `sieć / światłowody`, `sterowanie`, `synchronizacja`, `zasilanie`, `rigging` (dwa ostatnie dojdą po MVP, ale warto używać już teraz).
- **Etykiety portów**: jak na obudowie, wielkimi literami, z numerem (`SDI IN 1`, `HDMI OUT`, `LAN 2`, `DMX OUT`). Port bez numeru, jeśli jest jedyny danego rodzaju.
- **Klucz urządzenia**: z modelu, małymi literami (`kd-1`, `ptz-4k`). **Klucz portu**: z etykiety (`sdi-in-1`).
- **Model**: tak, jak na obudowie producenta; producent osobno.
- **Jedna rewizja = jeden sprawdzony stan.** Poprawiając błąd w dokumentacji urządzenia podnieś `version` pakietu; projekty, w których urządzenie już jest, zachowują dotychczasową rewizję, dopóki ich użytkownik jej nie zaktualizuje (z ekranem skutków).

## 5. Złącza, sygnały i kable (rejestry)

Program ma wbudowany słownik (pakiety `stagewire-starter` i `stagewire-registries`): popularne złącza (BNC, HDMI, DisplayPort, RJ45, XLR, Speakon, USB, SFP…), sygnały (SDI, HDMI, Dante, Art-Net, DMX512, MIDI…) i typy kabli. Nowe urządzenia **najpierw korzystają z gotowych kluczy** (`std/…`); własne wpisy dodajesz w `registries` pakietu pod kluczem `user/…` i tylko wtedy, gdy standardu nie ma w słowniku. Kabel (`kind: cable`) potrzebuje `endPairs` (jakie złącza łączy) i `carriesSignals` (jakie sygnały przenosi): na tej podstawie program dobiera typ kabla przy łączeniu i ostrzega o niezgodnościach.

Pakiet samych rejestrów (`"devices": []` i niepuste `registries`) jest dozwolony: dobry sposób na wspólny słownik dla kilku pakietów w jednym katalogu.

## 6. Codzienna praca

1. **Szkielet:** `npm run packs:new -- <id-pakietu> packs/<id>.swpack.json` (utworzy plik z jednym urządzeniem do poprawienia).
2. **Edycja:** w edytorze z podpowiedziami (`$schema`) albo w programie: dodaj urządzenie z katalogu, „Edytuj definicję…” (producent, model, wymiary, porty, źródło), przycisk **„Do mojej biblioteki”** zapisuje je do pakietu „Moje urządzenia” w folderze biblioteki. Z okna **Biblioteka urządzeń…** można wyeksportować zmienione urządzenia projektu do osobnego pakietu.
3. **Walidacja:** `npm run packs:validate` (cały katalog `packs/`) albo `node --experimental-strip-types src/cli.ts packs validate <plik|katalog>`. Pakiety w jednym katalogu mogą używać swoich rejestrów nawzajem. Kod wyjścia ≠ 0 przy błędach.
4. **Przegląd** (osoba druga, jeśli się da): sprawdź §7 dla kilku losowych urządzeń z pakietu; popraw `verified`.
5. **Użycie w programie:** plik skopiuj do folderu biblioteki (okno „Biblioteka urządzeń…” → „Importuj pakiet…” robi to z walidacją). Program wczytuje wszystkie `*.swpack.json` z tego folderu przy starcie i po „Wczytaj ponownie”.

Folder biblioteki użytkownika: `Dokumenty\StageWire\Biblioteka` (zmienna środowiskowa `STAGEWIRE_LIBRARY` wskazuje inny folder).

## 7. Lista kontrolna jednego urządzenia

- [ ] Producent i model dokładnie jak na obudowie / w dokumencie.
- [ ] **Każdy** fizyczny port z panelu jest na liście (także LAN do sterowania, USB serwisowe, wejścia synchronizacji); nic ponad to, co jest na obudowie.
- [ ] Etykiety i kolejność portów jak na panelu (od lewej do prawej, od góry do dołu).
- [ ] Rodzaj złącza i **kierunek** każdego portu (in/out/io/loop) sprawdzone, szczególnie porty przelotowe i dwukierunkowe.
- [ ] Sygnał portu w rejestrze zgodny z rzeczywistym (np. HDMI ≠ DVI, SDI 3G vs 12G); gdy port obsługuje kilka, pierwszy jest główny.
- [ ] Wymiary w mm (obudowa bez wystających uchwytów; z uchwytami tylko jeśli tak się montuje) i, jeśli dotyczy, wysokość w U.
- [ ] `source.kind` zgodny z prawdą, `ref` wskazuje dokument (nazwa + wersja), `verified` ustawiona.
- [ ] Opis własnymi słowami, bez kopiowania z katalogu.
- [ ] `packs:validate` bez błędów; ostrzeżenia przejrzane.

## 8. Ograniczenia obecnej wersji

- Okno definicji w programie edytuje jeden sygnał na port (dodatkowe sygnały z pliku pakietu są zachowywane, ale ich nie widać); portów z kilkoma sygnałami (np. HDMI + audio) edytuj w pliku pakietu.
- Zasilanie jest zapisywane (porty zasilania, moc, zakres napięć), ale program jeszcze go nie liczy: brak bilansu mocy, obciążeń i rozdziału zasilania. Rigging dojdzie po MVP.
- Okno definicji nie edytuje jeszcze `group`, `electrical`, `powerMaxW`, `url`, `hardwareRevision` ani `generated` (są zachowywane przy edycji i widoczne w pliku pakietu).
- Aktualizacja definicji z nowszej wersji pakietu jest zawsze jawna (okno „Biblioteka urządzeń…”, sekcja „Aktualizacje w projekcie”); nie ma aktualizacji automatycznej ani wielu projektów naraz.
- Brak podpisów i cen; brak kont i synchronizacji bazy (baza to pliki).
- Brak oceny wzrokowej importu z innych formatów — świadomie: **nie ma importu cudzych baz** (ADR-020).

## 9. Identyfikacja urządzeń i wersjonowanie

Trzy poziomy, każdy ma własną rolę:

| Co | Gdzie | Zmienia się |
|---|---|---|
| **Wersja pakietu** `version` (`1.2.0`) | plik pakietu | przy każdej zmianie treści pakietu; informacja dla ludzi i dla porównania „czy pakiet jest nowszy” |
| **Klucz urządzenia** `pakiet/urządzenie` (np. `acme-video/kd-1`) | `key` w rewizji definicji projektu | **nigdy**; to tożsamość urządzenia |
| **Rewizja definicji** (1, 2, 3…) | projekt | tworzona na polecenie użytkownika; niezmienna po utworzeniu |

- Identyfikator definicji w projekcie powstaje z id pakietu i klucza urządzenia: `eqd_<pakiet><urządzenie>` (bez myślników). Dwa pakiety z tym samym kluczem urządzenia (`kd-1`) **nie kolidują**, bo różnią się id pakietu. Kolidować mogą tylko pary, które po usunięciu myślników dają ten sam napis (np. `a-b`+`c` i `a`+`bc`): program wykrywa to przy wczytaniu i odrzuca drugi pakiet z komunikatem.
- Rewizja definicji w projekcie pamięta `origin.packId` i `origin.packVersion`, czyli z jakiej wersji pakietu pochodzi.
- Nie ma osobnego „numeru rewizji w pakiecie”: wersja pakietu wystarcza, a projekt ma własne rewizje (ADR-004, ADR-029).
- **Nie zmieniaj** `id` pakietu, `key` urządzenia ani `key` portu po publikacji. Zmiana oznacza dla programu nowe, niezwiązane urządzenie albo usunięty port.

## 10. Aktualizacja biblioteki a istniejące projekty

Zasada: **aktualizacja pakietu nigdy nie zmienia projektu**.

1. Wczytanie nowszego pakietu (import, „Wczytaj ponownie”, restart) zmienia tylko katalog. Projekty zawierają własne kopie definicji.
2. Program porównuje definicje projektu z katalogiem i pokazuje w oknie **Biblioteka urządzeń… → Aktualizacje w projekcie**: wersję (np. `1.0.0 → 1.1.0`), porty dodane, usunięte i zmienione oraz liczbę użyć.
3. **Nowa rewizja** tworzy rewizję 2 z danych pakietu. Istniejące urządzenia zostają na starej rewizji, więc żaden port ani połączenie nie znika. Dopiero przepięcie (przycisk „Aktualizuj” w panelu urządzenia albo **Nowa rewizja i przepnij**) przenosi urządzenia na nową rewizję i usuwa połączenia z portów, których już nie ma (z ostrzeżeniem o liczbie połączeń).
4. Każdy krok jest jednym krokiem cofania.

Przy imporcie pliku o id już wczytanego pakietu program pokazuje, co się zmieni: **nowsza wersja** (dodane, zmienione, usunięte urządzenia i **zmiany łamiące zgodność**: usunięte urządzenia i porty), **starsza wersja** (ostrzeżenie o cofnięciu), **ta sama wersja z inną treścią** (zalecenie podniesienia wersji) oraz **identyczny pakiet** (nic się nie dzieje). Import jest atomowy: błąd w jednym urządzeniu odrzuca cały pakiet i nie zmienia katalogu ani pliku w folderze biblioteki.

**Zasady dla autorów pakietów:** poprawka opisu lub parametrów → podnieś wersję patch; nowy port lub urządzenie → minor; usunięcie albo zmiana klucza portu → unikaj (jeśli port naprawdę nie istnieje, usuń go, ale wiedz, że użytkownik zobaczy ostrzeżenie o utraconych połączeniach).

## 11. Rejestry i zależności

- Klucze `std/…` należą do słownika StageWire (pakiety wbudowane). Pakiet może ich **używać** bez żadnej deklaracji. Może też dołączyć **identyczną** kopię wpisu `std/…` (np. dla wygody lektury), ale nie może zdefiniować go inaczej.
- Własne wpisy mają klucze `user/…` i leżą w `registries` pakietu. Dwa pakiety mogą zawierać ten sam wpis `user/…`, jeśli są **identyczne**: program wykrywa to i współdzieli wpis (bez duplikatów). **Różna definicja pod tym samym kluczem to błąd blokujący** z nazwą pakietu, który już ją definiuje. Nic nie jest nadpisywane po cichu.
- Brakujące złącza i sygnały są zgłaszane jedną zbiorczą listą (`Brakujące wpisy rejestrów (N): …`). Pakiet nie ma jawnej listy zależności: zależność wynika z użytych kluczy. Pakiet samych rejestrów (`"devices": []`) pozwala wydzielić wspólny słownik; w folderze biblioteki kolejność plików nie ma znaczenia (pakiety czekają na rejestry z innych plików).
- Projekt dostaje wpisy rejestrów dopiero przy dodaniu urządzenia i nigdy nie nadpisuje wpisów, które już ma.

## 12. Zasilanie i grupy portów

Zasilanie jest **zwykłymi portami i zwykłymi połączeniami**, nie osobnym modelem:

- Wejście zasilania to port: `connector` `std/iec-c14`, `std/dc-barrel`, `std/powercon`, `std/schuko`, sygnał `std/power-ac` lub `std/power-dc` (domena `power`), `direction` `in`; wyjście (PDU, zasilacz, odbiornik PoE ↔ źródło) to `out`.
- `electrical` (tylko informacja): `voltageMinV`/`voltageMaxV` (zakres napięć) i `maxW` (moc portu).
- **Redundantne wejścia** to dwa porty zasilania w tej samej grupie (`"group": "Zasilanie"`), z uwagą w `note`.
- **PoE** to dodatkowy sygnał portu RJ45: `"signals": ["std/ethernet", "std/poe"]`; urządzenie zasilane lub zasilające różni się kierunkiem i uwagą. Port główny (pierwszy sygnał) pozostaje `std/ethernet`.
- Kable zasilające: `std/cable-iec` (C13–C14), `std/cable-schuko-iec`, `std/cable-powercon`, `std/cable-dc`.
- `group` jest wskazówką porządkową (np. `Wejścia SDI`, `PoE`, `Uplink`) i trafia do definicji w projekcie. Bilans mocy, rozdział zasilania i obciążenia dojdą po MVP, a model portów nie będzie wtedy przebudowywany.
- Urządzenie nierackowe: pomiń `rackUnits`. Nieznane wymiary: pomiń `dimensionsMm` (ostrzeżenie: urządzenie nie trafi na plan w skali). Port wielostandardowy: kilka wartości w `signals`.

## 13. Zgodność formatu i narzędzia zewnętrzne

- **Format `stagewire-pack/1` jest rozszerzany tylko addytywnie.** Nowe pola opcjonalne nie zmieniają numeru. Program ignoruje pola, których nie zna, i zgłasza je jako **ostrzeżenie** (wychwytuje literówki, np. `powerw`). Zmiana łamiąca zgodność dostanie `stagewire-pack/2` z jawną migracją i bez cichej konwersji.
- **Błędy blokują** (pakiet nie jest wczytywany w całości), **ostrzeżenia nie** (pakiet działa, dane budzą wątpliwości).
- **Przenośność:** pakiet nie zawiera ścieżek do plików poza sobą. `$schema` (jeśli ktoś je doda) jest ignorowane przez import, a walidacja i import działają offline. Aby edytor podpowiadał pola, zmapuj schemat lokalnie, np. w VS Code (`settings.json`): `"json.schemas": [{ "fileMatch": ["*.swpack.json"], "url": "./stagewire/schema/pack.schema.json" }]`.
- **Generator zewnętrzny** (skrypt, który tworzy pakiety z dokumentacji) powinien: (1) wypełnić `format`, `id`, `version`, `license`; (2) dla każdego urządzenia ustawić stabilne `key`, a `source` = `{ kind, ref, url, hardwareRevision, generated: true }` **bez** `verified`; (3) używać kluczy `std/…`, a brakujące wpisy dodać jako `user/…` w `registries`; (4) sprawdzić wynik poleceniem `npm run packs:validate` (kod wyjścia ≠ 0 przy błędach); (5) zostawić `verified` człowiekowi, który porówna urządzenia z dokumentem. Do rozpoznania zmian program używa kluczy i wersji, więc generator musi zachować klucze urządzeń i portów między wydaniami.

## 14. Poza zakresem obecnej wersji (koncepcja, bez implementacji)

- **Moduły i karty rozszerzeń** oraz **porty rekonfigurowalne** (konfiguracja zmienia zestaw portów): na dziś modeluj jako osobne urządzenia lub osobne pakiety wariantów (np. `kd-1-sdi`, `kd-1-hdmi`). Wspólna podstawa to `group` i stabilne klucze portów, więc późniejsze moduły nie zmienią istniejących identyfikatorów.
- **Fizyczna geometria złączy** (położenie portu na obudowie), **modele 3D** i **automatyczne pobieranie danych od producentów**: nie planowane w MVP; dane źródłowe (`url`, `hardwareRevision`) są przygotowane, by generator mógł je później zasilać.
