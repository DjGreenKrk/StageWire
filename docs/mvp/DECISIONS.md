# DECISIONS — rejestr decyzji architektonicznych (ADR)

Status: wersja 0.1 do audytu · 2026-10-31

Wszystkie decyzje mają status **Proponowana**, dopóki właściciel projektu ich nie zatwierdzi. Decyzje oznaczone ⚑ wymagają zatwierdzenia przed kodowaniem (zob. [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)). Decyzje z „bramką" mogą zostać zmienione na podstawie wyników PoC.

Format: **Kontekst → Decyzja → Alternatywy → Konsekwencje → Dowody → Warunek rewizji**.

---

## ADR-001 — Własny produkt, niezależny od istniejących narzędzi
**Kontekst.** Wcześniej rozważano BIMCraft jako fundament; jego ograniczenia modelowania i ergonomii CAD zdecydowały o rezygnacji z obowiązkowej podstawy.
**Decyzja.** Projekt ma własny model, format i kod, bez zależności od BIMCraft. BIMCraft jest możliwą przyszłą integracją (eksport/most), nie podstawą.
**Alternatywy.** Moduł BIMCraft (odrzucone: `deny_unknown_fields`, brak konektorów i widoku schematu, zależność od planów upstream); fork CAD-owego rozwiązania (niemożliwe prawnie i technicznie).
**Konsekwencje.** Pełna kontrola, ale też pełny koszt budowy edytora i modelu.


## ADR-002 — Jeden model, wiele widoków; informacja domenowa raz
**Kontekst.** Narzędzia webowe oferują zwykle tylko schemat, a narzędzia CAD sklejają schemat, rack i plan nazwami.
**Decyzja.** Rozdzielenie A–E: model (A) jest źródłem prawdy; plan (B), diagram (C), fizyczny (D) są widokami; dokumentacja (E) jest wyliczana. `Placement` należy do modelu; pozycja węzła diagramu do widoku.
**Alternatywy.** Model per widok z synchronizacją (odrzucone: dryf danych); dane domenowe w obiektach graficznych, jak w narzędziach CAD (odrzucone).
**Konsekwencje.** Każda funkcja musi mieć jasne miejsce na dane; ułatwia raporty i sync.


## ADR-003 — Stabilne identyfikatory niezależne od nazw ⚑
**Kontekst.** Część narzędzi adresuje porty indeksem, a część zrywa połączenie przy zmianie nazwy portu.
**Decyzja.** Każdy obiekt, w tym `PortDefinition`, ma niezmienny ID (prefiks typu + UUIDv7 w base32); ID nigdy nie jest używany ponownie; relacje przez ID. Nazwy i etykiety to dane użytkownika, unikalność jako walidacja.
**Alternatywy.** Klucze naturalne (nazwa) — odrzucone; indeksy tablicowe — odrzucone.
**Konsekwencje.** Zmiana etykiet jest bezpieczna; wymaga generatora ID i czytelnych ID w testach. Dłuższe ID w pliku.


## ADR-004 — Definicja i instancja z przypiętą rewizją, osadzone w projekcie ⚑
**Kontekst.** W narzędziach webowych instancja bywa kopią bez propagacji zmian, a w narzędziach CAD definicja siedzi w symbolu i jej zmiana może zrywać obwody.
**Decyzja.** `EquipmentDefinition` ma rewizje; `EquipmentInstance` wskazuje `definitionId` + `definitionRevision`; użyte rewizje są osadzone w pliku projektu. Zmiana struktury portów tworzy nową rewizję; upgrade instancji jest jawny; w Core ([M]) pokazuje listę dotkniętych połączeń z wyborem „usuń / anuluj", a tabela różnic i przepinanie portów to F-19 [S]. Instancja nie ma własnej listy portów; modyfikacja = fork definicji.
**Alternatywy.** (a) Kopia w instancji bez propagacji — odrzucone (brak propagacji, rozjazd); (b) żywe wiązanie instancja→biblioteka — odrzucone (projekt nieprzenośny, zmiana biblioteki psuje stare projekty); (c) brak rewizji, tylko fork — dopuszczalny plan awaryjny, jeśli PoC-1 wykaże nadmierną złożoność.
**Konsekwencje.** Przenośność, bezpieczne zmiany; kosztem logiki rewizji i UI upgrade.

**Doprecyzowanie po audycie (P0-01).** Magazyn: `definitions[id].revisions[n]`, rewizje niemutowalne, każda edycja tworzy nową; w pliku rewizje przypięte + najnowsza; upgrade, fork, import i usunięcie portu opisane w DOMAIN-MODEL §5.3. Upgrade podstawowy (lista dotkniętych połączeń) jest [M], tabela różnic [S].
**Warunek rewizji.** PoC-1: jeśli rewizje wymagają > ~1,5× zaplanowanego nakładu, MVP przechodzi na model fork-only (ta sama struktura `revisions`, jedna rewizja); TS-13a dostosować.

## ADR-005 — Port: trzy niezależne osie (złącze, sygnał, kierunek); `PortInstance` wirtualna
**Kontekst.** Złącze, sygnał i kierunek są niezależne i wielowartościowe; istniejące narzędzia mieszają je w nakładających się taksonomiach.
**Decyzja.** `PortDefinition` ma `connectorKey`, `signalKeys[]` i `direction`, plus `capacity`, `side`, `group`. Rejestry (złącza, sygnały, kable) są jednym mechanizmem z kluczami i możliwością własnych wpisów. `PortInstance` nie jest encją; tożsamość portu instancji to `PortRef {instanceId, portId}`, a rzadkie dane trzymane są w `portOverrides`. Krotność („Qty") realizuje edytor przez generowanie N portów.
**Alternatywy.** Materializowanie `PortInstance` dla każdej instancji (więcej danych do synchronizacji z rewizjami); pojedyncza oś „typ”.
**Konsekwencje.** Brak duplikacji portów w pliku; upgrade rewizji nie wymaga migracji portów.


## ADR-006 — `Connection` (logiczne) ≠ `Cable` (fizyczne), domyślnie 1:1
**Kontekst.** Część narzędzi rozdziela obwód i kabel, a część łączy oba pojęcia.
**Decyzja.** Dwie encje; `Connection.cableId` opcjonalne; UI MVP tworzy parę 1:1; model pozwala wielu połączeniom wskazywać jeden kabel (to nie opisuje jeszcze fizycznej wiązki multicore, która wymaga osobnego projektu w v1.0) oraz połączenia bez kabla (`medium`).
**Alternatywy.** Jedna encja na obwód i kabel — odrzucone (blokuje współdzielenie kabla i dane kablowe); osobne końce kabla — odrzucone (duplikacja).
**Doprecyzowanie po audycie (P0-03).** `Connection.medium` (`physical`/`wireless`/`virtual`) jednoznacznie odróżnia połączenie bezprzewodowe od fizycznego bez kabla; `cableId = null` przy `physical` = kabel nieprzypisany (V-019).
**Konsekwencje.** Raporty kabli i patchlisty mają jasne źródła.


## ADR-007 — Walidacja nieblokująca, trzypoziomowa, wyliczana; twarde tylko niezmienniki strukturalne ⚑
**Kontekst.** Narzędzia webowe bywają blokujące przy tworzeniu kabla, a narzędzia CAD nie blokują niczego, ale ich znaczniki są obiektami w stanie dokumentu.
**Decyzja.** Reguły projektowe (zgodność sygnałów, kierunek, pojemność, nakładanie U…) dają wyniki `error/warning/info`, wyliczane i niezapisywane; gest łączenia pokazuje powód i pozwala wymusić. Twarde niezmienniki (referencje) wymusza warstwa poleceń. Poziomy konfigurowalne; odrzucanie z uzasadnieniem.
**Alternatywy.** Walidacja blokująca — odrzucona (nietypowe przypadki, adaptery, tymczasowe plany); znaczniki jako obiekty dokumentu — odrzucone (stan do synchronizacji, brak odświeżania).
**Konsekwencje.** Użytkownik może mieć niepoprawny, ale spójny projekt; wymagane czytelne komunikaty (UX §8).


## ADR-008 — Jedna reguła usuwania: kaskada z potwierdzeniem, bez osieroconych obiektów ⚑
**Kontekst.** W niektórych narzędziach CAD usunięcie portu usuwa obwód bez ostrzeżenia, a usunięcie urządzenia zostawia osierocony obwód.
**Decyzja.** Usunięcie obiektu usuwa zależne połączenia/kable/węzły w jednej transakcji, z oknem skutków, gdy skutki wykraczają poza obiekt; jeden krok cofania. „Usuń z widoku" nigdy nie usuwa danych modelu. Tabela reguł: DOMAIN-MODEL §6.
**Alternatywy.** Osierocanie — odrzucone; blokowanie usunięcia — odrzucone (utrudnia pracę).
**Konsekwencje.** Przewidywalność; test własności „brak wiszących referencji".


## ADR-009 — Trzy klasy obiektów; przestrzeń jako osobny `Placement` (X/Y/Z, obrót) ⚑
**Kontekst.** Wymaganie: nie mieszać urządzenia technicznego z obiektem rysunkowym; X/Y/Z od początku; brak 3D w MVP. W narzędziach webowych kształty nie mają związku z urządzeniami, a w narzędziach CAD są sprzężone z modelem 3D.
**Decyzja.** `EquipmentInstance` (porty), `StageObject` (fizyczny, bez portów), `DrawingElement` (grafika widoku). `Placement` jest odrębną, opcjonalną encją, co najwyżej jedną na obiekt; współrzędne w mm (X→E, Y→N, Z→góra), obrót wokół Z, `orientation` zarezerwowane.
**Alternatywy.** Pola położenia w instancji — odrzucone (urządzenia wirtualne, rozdział domeny od przestrzeni); jedna klasa „item” — odrzucone.
**Konsekwencje.** Estymata długości i eksport 3D możliwe bez modelu 3D.


## ADR-010 — Układ diagramu w widoku; krawędzie pochodne
**Decyzja.** Węzły (`DiagramNode`) i waypointy (`EdgeLayout`) należą do widoku; krawędź jest rysowana, gdy oba końce mają węzły w widoku, z możliwością ukrycia. Urządzenie może mieć węzły na wielu diagramach.
**Alternatywy.** Krawędź jako byt widoku (wiszące krawędzie, konieczna synchronizacja) — odrzucone.


## ADR-011 — Lokalizacja jako jawna relacja, nie wyprowadzana z geometrii
**Kontekst.** Pomieszczenie, rack i pozycja w racku są niezależne od współrzędnych planu.
**Decyzja.** `EquipmentInstance.zoneId` i `mount` są jawne; edytor podpowiada strefę przy upuszczeniu; niezgodność z geometrią to ostrzeżenie V-016.
**Alternatywy.** Lokalizacja wyliczana z geometrii (ukryte zmiany, niejednoznaczność dla stref bez geometrii) — odrzucone.
**Konsekwencje.** Podwójny wpis ograniczony podpowiedzią.


## ADR-012 — Racki: model w MVP, edytor elewacji po MVP
**Decyzja.** Encja `Rack` i `mount` w modelu; V-003 i raport zawartości w MVP jako [S]; rysowanie elewacji w v1.0. Zawartość racka nie ma własnych `Placement`.
**Alternatywy.** Pełny Rack Designer w MVP — odrzucone (koszt vs wartość dla scenariusza); brak racków — odrzucone (wymusiłoby zmianę modelu).


## ADR-013 — Brak sieci tras 3D w MVP; długość kabla jako liczba z źródłem i estymatą z planu
**Decyzja.** `Cable.lengthMm` + `lengthSource`; estymata Manhattan + zapasy + długości katalogowe jako jawne polecenie [S]; sieć tras jako encja po v1.0.
**Alternatywy.** Pełna sieć tras — odłożone; sama etykieta tekstowa trasy — odrzucone.


## ADR-014 — Format: ZIP + JSON, schemat JSON Schema, migracje, round-trip nieznanych pól ⚑
**Decyzja.** Plik `.stagewire` (nazwa robocza) = ZIP z `manifest.json`, `project.json` (kanoniczna serializacja), zasobami; kolekcje jako mapy ID → obiekt; semver; migracje czyste; schemat normatywny. Dostęp przez port `ProjectStore`.
**Alternatywy.** SQLite (lepszy przy bardzo dużych projektach, gorszy diff/czytelność) — plan awaryjny; katalog plików (git-friendly) — tryb dodatkowy po MVP; jeden goły JSON (brak zasobów).
**Konsekwencje.** Ładowanie całego modelu do pamięci; ograniczenie skali, mierzone w PoC-1.
**Warunek rewizji.** Pomiar PoC-1 (ARCHITECTURE §12).


## ADR-015 — Cofanie przez transakcje i łaty; historia tylko w pamięci
**Decyzja.** Każde polecenie → łaty + łaty odwrotne; operacja złożona = jeden krok; historia nie jest zapisywana w pliku.
**Alternatywy.** Migawki całego stanu — odrzucone (koszt pamięci); persystowana historia — odłożone.


## ADR-016 — Stos: rdzeń TypeScript + React + własny Canvas 2D + Tauri 2 (bramka PoC-3, awaryjnie Electron) ⚑
**Decyzja.** Zob. ARCHITECTURE §2.3. Powłoka za interfejsem `Platform`.
**Alternatywy.** T2–T6 (ARCHITECTURE §2).
**Konsekwencje.** Testowalność, pula współtwórców, droga do serwera; ryzyko WebKitGTK na Linuxie.
**Warunek rewizji.** Wyniki PoC-2/PoC-3.

## ADR-017 — Jedna `DrawList` dla ekranu i eksportu; wybór renderera ekranowego po PoC-2
**Decyzja.** Czysta funkcja `model + widok → DrawList`; Canvas 2D rysuje, eksport PDF/SVG tłumaczy; wybór między Canvas a wirtualizowanym SVG według PoC-2.
**Alternatywy.** Eksport z DOM — odrzucone (raster, rozjazd).


## ADR-018 — Raporty jako zapytania nad znormalizowanym modelem; grupowanie po definicji
**Decyzja.** Raporty wyliczane, nie przechowywane; packlista grupuje po `definitionId` (nie po nazwie).
**Alternatywy.** Arkusze nad zdenormalizowanymi polami — odrzucone; grupowanie po nazwie — odrzucone.


## ADR-019 — Licencja kodu ⚑
**Kontekst.** Wymagania: darmowy, open source, z licencją „dobraną świadomie"; możliwy przyszły self-hosting i integracje (np. BIMCraft jest na Apache-2.0).
**Opcje.**

| Licencja | Zalety | Wady |
|---|---|---|
| Apache-2.0 | Maksymalna swoboda, zgodność z BIMCraft, wkład firm | Brak ochrony przed zamkniętymi forkami/SaaS |
| **MPL-2.0 (propozycja)** | Copyleft na poziomie pliku: zmiany w plikach projektu wracają, ale można łączyć z innym kodem; zgodna z Apache/GPL | Mniej znana; część firm unika |
| GPL-3.0 | Silny copyleft | Utrudnia osadzanie rdzenia w innych narzędziach, w tym przy integracjach |
| AGPL-3.0 | Chroni przed zamkniętym SaaS | Zniechęca do wkładu firm i integracji; niepotrzebna w jednoosobowym narzędziu desktopowym |

**Propozycja.** Kod aplikacji i rdzenia: **MPL-2.0**. Specyfikacja formatu i schematy JSON: **Apache-2.0 lub CC0**, aby każdy mógł implementować. Dane bibliotek: **CC0** (lub CC-BY-4.0, jeśli wymagane przypisanie). Wkład: DCO (bez CLA), chyba że właściciel potrzebuje relicencjonowania.
**Uwaga.** To wybór prawny wymagający decyzji właściciela, nie porada prawna. Zależności muszą być zgodne z wybraną licencją (audyt w Etapie 0).

## ADR-020 — Higiena własności intelektualnej: bez kopiowania cudzych baz, kodu i zasobów ⚑
**Kontekst.** Wnioski o mechanizmach pochodzą z przeglądu istniejących narzędzi; cudze pliki, bazy i biblioteki nie są własnością projektu.
**Decyzja.** (1) Wnioski o mechanizmach — dozwolone; kod, dane urządzeń, ikony, napisy i pliki — niedozwolone. (2) Biblioteka startowa tworzona od zera lub z oficjalnych kart katalogowych, z zapisem źródła. (3) Brak importerów formatów innych narzędzi w planie. (4) Repozytorium publiczne zakładamy od czystej historii, bez plików osób trzecich. (5) Nazwy z innych narzędzi nie są podstawą nazewnictwa naszego modelu; nasze nazwy powstały niezależnie. (6) Przed publikacją przegląd prawny (Q-07).
**Konsekwencje.** Koszt tworzenia biblioteki; czysta pozycja prawna.

## ADR-021 — Lokalizacja PL/EN od początku
**Decyzja.** Napisy w plikach tłumaczeń; czcionki do PDF z Latin Extended-A; formatowanie wg `locale`.


## ADR-022 — Brak synchronizacji w MVP; model przyjazny synchronizacji
**Decyzja.** Stabilne ID, kolekcje jako mapy, dziennik łat, rozdzielone dane widoków; bez CRDT i serwera w MVP.
**Alternatywy.** Wbudowanie CRDT od początku — odrzucone (koszt, niepewne wymagania).


## ADR-023 — Lokalne wyszukiwanie biblioteki
**Decyzja.** Indeks w pamięci (MiniSearch lub podobny) z fasetami; brak usługi wyszukiwania.
**Alternatywy.** Zewnętrzny silnik (Typesense/Algolia) — odrzucone (infrastruktura, offline).


## ADR-024 — Packlista grupuje po definicji; brak ukrytej kategorii „Unknown"
**Decyzja.** Pozycje bez typu są jawnie oznaczone i zliczane; stan „spakowane" w modelu jako dane użytkownika.


## ADR-025 — Układ portów: wejścia lewo, wyjścia prawo, `side` nadpisywalne
**Decyzja.** Domyślny przepływ lewo→prawo; `side` w definicji i nadpisanie w widoku.


## ADR-026 — Jednostki i układ współrzędnych
**Decyzja.** mm, float64, prawoskrętny (X wschód, Y północ, Z góra), kąty w stopniach CCW; diagram w osobnych jednostkach.
**Uzasadnienie.** Jednoznaczność, brak przeliczeń przy eksporcie, zgodność z konwencjami CAD.

## ADR-027 — Silnik edytora własny (z bramką)
**Decyzja.** Własny, wąski silnik edytora dla planu i diagramu; React Flow jako alternatywa tylko dla diagramu, jeśli koszt własnego przekroczy budżet ×1,5 (ARCHITECTURE §7.3).


## ADR-028 — Zakres MVP ograniczony do jednego scenariusza referencyjnego
**Decyzja.** Funkcje [S] wycinane w kolejności odwrotnej do numeru; mechanizmy odłożone zgodnie z zakresem MVP.


## ADR-029 — Zgodność fizyczna przez końcówki kabla (`endPairs`), wynik trójwartościowy
**Kontekst.** Audyt P0-02: reguła „złącza portów łączą się bezpośrednio" była błędna, bo porty łączy kabel. Dwa gniazda BNC łączy przewód z końcówkami BNC.
**Decyzja.** Typ kabla ma `endPairs` (pary kluczy złączy portów, w które wpinają się końce) i `carriesSignals`. V-011/V-013 zwracają: zgodne, niezgodne (warning) albo „nie da się ocenić" (info, gdy brak danych). Walidator nie twierdzi „potrzebny adapter". `gender` pozostaje rezerwą: w MVP płeć jest zakodowana w kluczu złącza portu.
**Alternatywy.** (A) pełny model płci i końcówek (kosztowny, trudne dane); (B) walidacja wyłącznie deklaratywna na rodzinach (zbyt słabe twierdzenia).
**Konsekwencje.** Biblioteka kabli wymaga `endPairs`; brak danych daje info zamiast fałszywego alarmu.
**Warunek rewizji.** Jeśli autorstwo danych `endPairs` okaże się zbyt kosztowne w M3, ograniczyć do kabli scenariusza referencyjnego (Q-21).

## ADR-030 — Profil Core MVP i warunkowe testy [S]
**Kontekst.** Audyt P0-04.
**Decyzja.** TS-01 przechodzi bez funkcji [S]; testy zaawansowane mają osobne warianty (TS-01+, TS-06+, TS-13b). Długość ręczna jest [M]; podkład PNG/JPG (F-15a) awansowany do [M] (propozycja, Q-10).

## ADR-031 — Długość wymagana a przydzielona; packlista kabli oznacza propozycje
**Kontekst.** Reaudyt N-04: jedno pole długości mieszało wymaganą trasę z długością fizycznego przewodu.
**Decyzja.** `Cable.lengthMm` = wymagana długość projektowa; `Cable.stockLengthMm?` = przydzielona długość przewodu (dowolna, także przycięta). Bez przydziału packlista pokazuje propozycję z `stockCableLengthsMm`, wyraźnie oznaczoną „do weryfikacji". Liczniki spakowania są trwale przycinane przy zmianie liczby pozycji; zmiana klucza (supply, długość) zeruje licznik.
**Alternatywy.** Jedno pole (ryzyko błędnego BOM); pełna gospodarka magazynowa (poza zakresem).


## ADR-032 — Licencja początkowa PolyForm Shield 1.0.0 (aktualizacja ADR-019) ⚑
**Kontekst.** Właściciel wybrał (2026-11-01) PolyForm Shield 1.0.0, zgodnie z praktyką w rodzinie GreenCrew Tools (wzmianka dla StageCalc w `GREENCREW_BRANDING.md`), z możliwością późniejszego otwarcia licencji.
**Decyzja.** Kod StageWire: PolyForm Shield 1.0.0. Wymagany plik `LICENSE`, `LICENSING.md` oraz wykaz licencji zależności (`THIRD_PARTY_LICENSES`), generowany i sprawdzany przy wydaniu. Zależności wyłącznie o licencjach zgodnych z dystrybucją na takich warunkach (MIT, BSD, Apache-2.0, OFL, MPL-2.0 z zachowaniem warunków); unikać GPL/AGPL oraz LGPL linkowanego statycznie.
**Uwagi.**
- PolyForm Shield jest licencją **source-available**: pozwala na użycie, modyfikację i rozpowszechnianie, ale zabrania dostarczania produktu konkurencyjnego wobec licencjodawcy. Nie spełnia definicji open source OSI, więc zapisy „open source" w dokumentacji (PRODUCT-VISION, ADR-019, README) należy czytać jako „source-available, z zamiarem możliwego otwarcia".
- Późniejsza zmiana licencji wymaga praw autorskich do całego kodu: wkłady zewnętrzne przyjmować tylko z CLA (Q-24); DCO nie wystarcza do relicencjonowania.
- Dane bibliotek i specyfikacja formatu: licencja do osobnej decyzji (rekomendacja CC0/Apache-2.0 pozostaje, jeśli chcemy interoperacyjność).
- Licencje produktów rodziny są ustalane osobno; w repozytorium wspólnych standardów `BRANDING_STAGECALC.md` podaje MIT, a `GREENCREW_BRANDING.md` PolyForm Shield dla StageCalc. To niespójność po stronie tamtego repozytorium do wyjaśnienia przez właściciela.
**To nie jest porada prawna.**

## ADR-033 — Zgodność ze standardami rodziny GreenCrew Tools: propozycja i otwarta decyzja stosu
**Kontekst.** Repozytorium `GreenCrew_Tools_Docs` jest kanonicznym źródłem zasad rodziny (branding, design system, architektura, standardy Flutter). Dokumenty wspólne mają `RIGHTS.md` „wszelkie prawa zastrzeżone": nie kopiujemy ich do repozytorium produktu, tylko do nich odsyłamy i trzymamy własny krótki `BRANDING.md`.
**Zgodne bez zmian:** offline first; lokalne dane jako źródło prawdy; eksport PDF/CSV/JSON/ZIP jako backup; migracje zamiast resetu; logika techniczna testowalna bez UI; walidacja przy modelu; metryczne jednostki; autozapis, cofanie, potwierdzenie usuwania; wyszukiwanie w listach > ~20 pozycji; komunikaty „co się stało, co zostało"; zasada dwóch kliknięć; dark mode domyślnie, paleta GreenCrew, Roboto, ikony Material, obszar dotyku ≥ 44 px.
**Do uzgodnienia:** (1) stos — standard rodziny to Flutter/Dart; ADR-016 jest odstępstwem i wymaga decyzji (Q-23): Flutter Desktop (Windows/Linux) jest realną alternatywą, bo nie zależy od WebKitGTK i daje wspólne komponenty rodziny, a rdzeń (model, schemat, fixtures, testy) jest opisem niezależnym od języka i można go przenieść; (2) platforma referencyjna telefon vs desktop (Q-26); (3) statusy synchronizacji rodziny (`localOnly`, `pendingSync`, `synced`, `syncError`, `conflict`) przejąć jako nazwy w przyszłej warstwie sync; (4) konwencja pracy: etapy jako `MASTER:` issue z sub-issues, PR zamyka etap.
**Konsekwencje.** PoC-2 (renderer) nie powinien się zaczynać, dopóki Q-23 nie jest rozstrzygnięte. PoC-1 w TypeScript pozostaje wartościowy jako wykonywalna specyfikacja modelu, schematu i fixtures.

## ADR-034 — Stos TypeScript + React jako udokumentowany wyjątek od standardów rodziny; laptop platformą główną
**Kontekst.** Q-23 i Q-26 (ADR-033). Wspólne standardy GreenCrew Tools zakładają Flutter i telefon jako platformę referencyjną, ale `AGENTS.md` repozytorium standardów dopuszcza udokumentowane wyjątki produktowe.
**Decyzja (2026-11-01).** (1) StageWire pozostaje przy TypeScript i React (ADR-016 potwierdzone); porównanie z Flutter Desktop w ARCHITECTURE, Dodatek A. (2) Platforma główna: laptop (Windows, Linux); platforma dodatkowa: telefon, w pierwszym kroku tylko podgląd i raporty. (3) Zgodność z rodziną w zakresie, który nie zależy od frameworka: paleta, dark mode, Roboto (dołączony jako zasób), ikony Material, obszar dotyku ≥ 44 px, komunikaty i nazewnictwo wg zasad pisania, ekran "O aplikacji", statusy synchronizacji rodziny w przyszłej warstwie sync. (4) Produkt ma własny krótki `BRANDING.md` (`stagewire/BRANDING.md`) odsyłający do wspólnych standardów i zapisujący wyjątki.
**Alternatywy.** Flutter Desktop (Dodatek A), pozostałe z ARCHITECTURE §2.
**Warunek rewizji.** Trzy warunki z Dodatku A.

## ADR-035 — Podział odpowiedzialności w rodzinie GreenCrew Tools; synchronizacja później
**Kontekst.** Wyjaśnienie właściciela (2026-11-01): CableListTool służy do inwentaryzacji istniejącej instalacji, StageCalc do predykcji obciążeń elektrycznych i konstrukcji scenicznych; synchronizacja z nimi możliwa później.
**Decyzja.** StageWire odpowiada za **projekt** (stan planowany): plan sali, urządzenia i porty, połączenia, kable, dokumentacja. Zasilanie i rigging **pozostają w zakresie produktu** (poza MVP, kandydaci na v1.0 i później). StageCalc już liczy obciążenia elektryczne i konstrukcji, więc przed ich budową ustalamy podział: własny moduł w StageWire, współdzielone dane albo synchronizacja, żeby nie dublować obliczeń. Stan faktyczny instalacji (as-built) należy do CableListTool; **porównanie planu z inwentaryzacją** jest naturalnym zastosowaniem późniejszej synchronizacji (domyka lukę G7, porównanie wersji).
**Co robimy teraz (bez synchronizacji):** zachować stabilne ID i pola `powerW`, `weightKg` w definicji urządzenia (już w modelu); zachować przestrzeń `ext` na dane zewnętrzne; wymiana danych przez eksport JSON/CSV; nie zakładać wspólnej bazy ani serwera.
**Co ustalić przed synchronizacją (Q-25):** wspólna tożsamość urządzenia i kabla między aplikacjami (mapowanie ID), format wymiany, kierunek (jednokierunkowy eksport czy dwukierunkowy), nazwy statusów synchronizacji z standardu rodziny (`localOnly`, `pendingSync`, `synced`, `syncError`, `conflict`) oraz fakt, że CableListTool i StageCalc są aplikacjami Flutter/mobilnymi z własnymi lokalnymi bazami, więc wymiana powinna być oparta na formacie pośrednim, nie na wspólnym kodzie.
**Konsekwencje.** Zakres produktu bez zmian; ryzyko duplikacji obliczeń z StageCalc zarządzane decyzją przed v1.0; wymaga uzgodnienia formatu wymiany z autorami pozostałych aplikacji (tu: właścicielem).

## ADR-017 — aktualizacja po PoC-2 (2026-11-01)
**Status: potwierdzone pomiarem dla Chromium (Edge/WebView2).** Canvas 2D + R-drzewo + LOD osiągnął mediana 60 fps we wszystkich scenariuszach, także z 41 000 prymitywów i z CPU spowolnionym 4×; naiwny DOM+SVG spadł do 30 fps już przy 1000 urządzeń na planie i do 2,5 fps na diagramie 2000 urządzeń; SVG z wirtualizacją zawodzi przy ciągłym panoramowaniu dużych diagramów (5,5 fps, CPU 4×). **Decyzja:** Canvas 2D dla ekranu, SVG tylko jako format eksportu. Dokładność skali eksportu zweryfikowana (8000 mm → 80 mm w 1:100). Nadal niezmierzone: WebKitGTK/Linux (PoC-3), HiDPI, interakcje edytora. Szczegóły: `POC2-RESULTS.md`.

## ADR-016 — aktualizacja po PoC-3 (2026-11-01)
**Status: potwierdzone warunkowo.** Tauri 2 zdał próbę na Windows (WebView2: 60 fps, plik 9,5 MB, zapis atomowy odporny na 350 zabić procesu). Na Linuxie (WSL2, WebKitGTK 2.52.6) ustawienia domyślne dały ok. 11 fps niezależnie od złożoności sceny; po `WEBKIT_DISABLE_DMABUF_RENDERER=1` 58,8 fps (98% wyniku Chromium). Obejście jest wbudowane w aplikację (ADR-036). **Electron pozostaje planem awaryjnym** do czasu pomiaru na natywnym Linuxie, bo wynik WSLg nie jest dowodem dla prawdziwego sterownika GPU. Szczegóły: `POC3-RESULTS.md`.

## ADR-036 — Procedura zapisu atomowego i obejście DMA-BUF na Linuxie
**Decyzja.** (1) Zapis projektu w powłoce Rust: plik tymczasowy w tym samym katalogu → `fsync` → weryfikacja SHA-256 po ponownym odczycie → kopia poprzedniej wersji (rotacja, domyślnie 5) → zamiana z ponowieniami (antywirus na Windows) → `fsync` katalogu (POSIX). Poprzedni plik pozostaje nietknięty do chwili zamiany. Blokada doradcza i skan osieroconych plików tymczasowych przy starcie. (2) Na Linuxie aplikacja ustawia `WEBKIT_DISABLE_DMABUF_RENDERER=1`, jeśli użytkownik nie ustawił własnej wartości.

**Ograniczenia.** Gwarancje dotyczą awarii procesu, nie utraty zasilania; autozapis i odzyskiwanie w UI nie są zbudowane; obejście wymaga ponownej weryfikacji na natywnym Linuxie (może być zbędne albo niewystarczające).

## ADR-037 — Gest „port → port" jako podstawowy sposób łączenia; miękka walidacja w gestach
**Kontekst.** Ryzyko R2 (własny silnik edytora) i pytanie o koszt interakcji. Prototyp PoC-3b (`POC3B-RESULTS.md`).
**Decyzja.** (1) Połączenie tworzy jedno przeciągnięcie z portu na port; wariant „klik, klik" jako równoważny. (2) Podczas gestu widoczne porty są oznaczone poziomem zgodności (`ok` / `warn` / `no`) wyliczonym raz na początku gestu; przyczyna widoczna przed puszczeniem. (3) Walidacja pozostaje miękka (DOMAIN-MODEL §7): gest nie blokuje niezgodności kierunku, sygnału ani pojemności, tylko je oznacza; blokuje wyłącznie to samo urządzenie i parę portów już połączoną. (4) Kierunek jest normalizowany (wyjście → wejście) niezależnie od kierunku przeciągania. (5) Upuszczenie na korpus urządzenia wybiera pierwszy zgodny wolny port. (6) Logika gestu to czysta funkcja rdzenia (`src/editor/connect.ts`), bez zależności od DOM.

**Warunki i ograniczenia.** Przeciąganie węzła jest przyrostowe (0,7 ms na klatkę przy 2000 urządzeń). Zatwierdzenie połączenia jest przyrostowe (19 ms przy 2000 urządzeń, POC3B §9); pozostaje pełna walidacja (9 ms, M5) i pełna przebudowa przy cofnięciu. Trafność spada poniżej ok. 13 px na wiersz portu; magnes do portu tego nie naprawił (POC3B §8), więc potrzebny próg powiększenia lub inny mechanizm. Rozstrzygnięcia właściciela: przesuwanie węzłów w historii cofania (Q-28), niezgodne połączenie powstaje z uwagą bez potwierdzenia (Q-29). Brak badań z użytkownikami; hipoteza, że gest jest tańszy od ścieżki przez okno dialogowe, nie jest zmierzona.
**Warunek rewizji.** Badanie z użytkownikami wykaże, że gest powoduje częste błędne połączenia, albo aktualizacja przyrostowa nie zejdzie poniżej ok. 16 ms na klatkę przy 2000 urządzeniach.

## ADR-038 — Autozapis i odzyskiwanie: osobny plik, nigdy nadpisanie projektu
**Decyzja.** (1) Autozapis trafia do `<projekt>.autosave` (ten sam format i atomowa procedura zapisu co projekt, ADR-036); plik projektu zmienia tylko zapis użytkownika. (2) Zapis po 5 s bezczynności, najpóźniej 30 s od pierwszej niezapisanej zmiany (wartości początkowe do strojenia). (3) Zapis użytkownika kasuje autozapis. (4) Przy otwarciu: autozapis poprawny i nowszy niż projekt (albo projekt nie istnieje) = oferta odzyskania; uszkodzony, identyczny lub starszy = pomijany bez kasowania i bez pytania. (5) Błąd zapisu autozapisu nie przerywa pracy; jest raportowany użytkownikowi. (6) Licznik zmian w `Store` (`version`, także cofanie i ponawianie) wyznacza stan niezapisany.

**Weryfikacja w aplikacji (2026-11-01).** `format.ts` nie zależy już od `node:*` (SHA-256 z `@noble/hashes`, MIT, synchroniczny; schemat importowany jako JSON), a wejście/wyjście autozapisu jest asynchroniczne (polecenia Tauri `save_autosave`, `read_file`, `remove_file`). Scenariusz `scripts/poc3-autosave.mjs` w prawdziwej aplikacji: edycja, autozapis, zabicie procesu, ponowne uruchomienie daje ofertę odzyskania (11 połączeń), przyjęcie zapisuje projekt i kasuje autozapis, kolejne otwarcie bez oferty, uszkodzony autozapis pominięty. **8/8 kontroli na Windows (WebView2) i na Linuxie (WSL2, WebKitGTK).**
**Okno odzyskiwania (2026-11-01).** Edytor (`web/editor.ts`, parametr `?project=`) przy otwarciu wywołuje `checkRecovery` i pokazuje okno z trzema wyborami: Przywróć (stan z autozapisu, oznaczony jako niezapisany), Otwórz zapisany i zachowaj autozapis, Odrzuć autozapis (jedyna droga, którą autozapis jest kasowany bez zapisu użytkownika). Ctrl+S zapisuje projekt i kasuje autozapis; pasek stanu pokazuje „● niezapisane". Test interfejsu `bench/test-recovery-ui.mjs` (Edge, prawdziwe kliknięcia): **12/12**, w tym przyciski okna o wysokości 44 px.
**Menu plików i start aplikacji (2026-11-01).** Edytor jest stroną startową aplikacji Tauri (samotest uruchamia się, gdy ustawiono `STAGEWIRE_SELFTEST`). Przyciski i skróty: Nowy (Ctrl+N), Otwórz… (Ctrl+O), Zapisz (Ctrl+S), Zapisz jako… (Ctrl+Shift+S), systemowe okna plików przez `tauri-plugin-dialog` (uprawnienia tylko `dialog:allow-open` i `allow-save`), ochrona niezapisanych zmian (Zapisz / Nie zapisuj / Anuluj), plik z wiersza poleceń lub `STAGEWIRE_PROJECT`, minimalna paleta „+ model" z definicji projektu. Plik istniejący, lecz nieotwieralny (uszkodzony, nowszy MAJOR) nigdy nie jest nadpisywany: komunikat, pusty projekt bez ścieżki. Ścieżka do nieistniejącego pliku daje pusty projekt. Test `bench/test-file-menu.mjs`: **15/15**; po zmianach nadal 12/12 (okno odzyskiwania) i 8/8 (awaria w Tauri). W prawdziwej aplikacji Windows (WebView2, sterowanej przez CDP) potwierdzono start z plikiem z wiersza poleceń, dodanie urządzenia i Ctrl+S zapisujący plik.
**Czego nie ma.** Natywnych okien plików nie da się tu zautomatyzować: w testach to atrapa zwracająca ścieżkę, więc **prawdziwe okno „Zapisz jako/Otwórz" nie zostało nigdy otwarte przeze mnie**. Nowy, jeszcze niezapisany projekt nie ma autozapisu (brak ścieżki, więc go nie chroni). Brak listy ostatnich plików i skojarzenia rozszerzenia `.sw` z aplikacją (instalator, M7). Test okna odzyskiwania działa w Chromium z atrapą poleceń Tauri opartą o system plików Node, **nie** w oknie aplikacji Tauri (tam sprawdzono samą logikę i polecenia, 8/8). Strona startowa aplikacji nadal jest samotestem, nie edytorem, więc użytkownik nie ma jeszcze drogi „Plik → Otwórz"; brak ręcznego usuwanie osieroconych plików, test utraty zasilania i pełnego dysku, pomiar kosztu `packProject` przy dużych projektach. **Ajv kompiluje schemat przez `new Function`, co wymaga `unsafe-eval` w CSP**; przed zaostrzeniem CSP (obecnie wyłączony w PoC) trzeba przejść na walidator generowany w czasie budowania albo inny, bez `eval`.
**Warunek rewizji.** Badanie użytkowników wykaże, że oferta odzyskania przeszkadza, albo pomiar kosztu `packProject` pokaże, że zapis co kilka sekund jest zauważalny przy dużych projektach (nie mierzone).

## ADR-039 — Katalog urządzeń: pakiet startowy własny, dodawanie jedną transakcją
**Decyzja.** (1) Pakiet `stagewire-starter` (14 ogólnych urządzeń: kamery, źródła, mikser wizji, konwertery, wyświetlacze, procesor LED, switch, pulpit i oprawa DMX, mikser audio) jest napisany na potrzeby projektu; producent „Generic”, pochodzenie `custom` z `packId` i licencją własną. **Nie zawiera danych skopiowanych z innych narzędzi** (ADR-020); liczby portów i wymiary są przykładowe i mają być edytowane, nie traktowane jako dane produktów. (2) Dodanie urządzenia to jedna transakcja (jeden krok cofania): brakujące wpisy rejestrów (złącza, sygnały, typy kabli), definicja (jeśli jej jeszcze nie ma w projekcie) i instancja przypięta do najnowszej rewizji. Wpisów rejestru już obecnych w projekcie nie nadpisujemy. (3) Identyfikatory definicji i portów są deterministyczne i spełniają wzorzec formatu (`prefiks_alfanumeryczne`, bez dodatkowych podkreślników). (4) Wyszukiwanie bez rozróżniania wielkości liter i polskich znaków, wszystkie słowa muszą pasować. (5) Panel katalogu w edytorze po lewej; definicje własne projektu w sekcji „W tym projekcie”.

**Czego nie ma.** Edycji definicji w interfejsie (jest polecenie `editDefinition` z rewizjami, brak formularza portów), importu i eksportu własnych pakietów, rozszerzenia katalogu o zasilanie i rigging (poza MVP), weryfikacji, że 14 urządzeń pokrywa realne projekty (to założenie do sprawdzenia na przypadkach TS-01…TS-15), wyszukiwania po aliasach i producentach (brak producentów w pakiecie), ikon i kształtów symboli.
**Warunek rewizji.** Użytkownicy wskażą, że ogólne urządzenia są mniej użyteczne niż dane konkretnych modeli; wtedy decyzja o źródle danych (własne wpisy, import użytkownika, pakiety społeczności) wymaga osobnego ADR i oceny licencji.

## ADR-040 — Edycja definicji urządzeń: nowa rewizja, jawny wpływ, aktualizacja instancji na żądanie
**Decyzja.** (1) Zapis edycji definicji zawsze tworzy nową niemutowalną rewizję (ADR-004); klasa zmiany (`cosmetic` / `structural`) jest wyliczana z porównania zbioru portów, złączy, sygnałów, kierunków i pojemności. Identyfikatory portów są stabilne: zmiana nazwy lub kolejności nie zrywa połączeń. (2) Formularz pokazuje przed zapisem wpływ: ile urządzeń używa definicji i ile połączeń zerwie aktualizacja po usunięciu portów. (3) Aktualizacja instancji jest wyborem użytkownika: w jednej transakcji z zapisem rewizji („zaktualizuj wszystkie”) albo później dla pojedynczego urządzenia z potwierdzeniem, gdy zerwie połączenia. Instancja bez aktualizacji zostaje przypięta do swojej rewizji i działa jak dotąd. (4) Brakujące wpisy rejestrów dla nowych złączy i sygnałów są dopisywane z pakietu startowego. (5) Zmiana nazwy i usunięcie urządzenia (z oknem skutków) są poleceniami cofalnymi; zaznaczenie urządzenia klikiem w nagłówek lub korpus, panel właściwości po prawej.

**Ograniczenia.** Brak mapowania portów przy aktualizacji (usunięty port = usunięte połączenia; zmiana złącza zostawia połączenie i oznacza je walidacją miękką); brak porównania rewizji obok siebie i scalania (ADR-004: tylko rewizje podstawowe); definicja jest wspólna dla projektu, brak „zapisz jako nową definicję” (fork) ani eksportu do własnego pakietu; edytor nie obsługuje wymiarów, symbolu, jednostek rack ani notatek; pola wymagane sprawdza tylko rdzeń (komunikat w pasku stanu, nie przy polu). Nazwa portu jest wyłącznie etykietą: zmiana etykiety nie zmienia identyfikatora.
**Warunek rewizji.** Badanie z użytkownikami wykaże, że brak forka definicji („ten mikser, ale z innymi portami tylko w tym projekcie”) blokuje typowe przypadki; wtedy fork wchodzi do MVP.

## ADR-041: Układ diagramu zapisany w projekcie i objęty cofaniem (Q-28)

**Status:** przyjęta (implementacja w prototypie). **Kontekst:** właściciel zdecydował (Q-28), że przesuwanie węzłów wchodzi do historii cofania. Do tej pory układ był poza `Store` i ginął przy zapisie (po otwarciu projekt wracał do siatki).

**Decyzja:** pozycje węzłów są częścią projektu: `views.viw_main.nodes[nod_*] = {instanceId, x, y}` (kontener `views` istniał już w formacie 1.0.0-draft, schemat bez zmian). Przesunięcie jest zwykłą transakcją modelu (`setNodePositions`), więc korzysta z istniejącego cofania, zapisu i autozapisu. Dodanie urządzenia zapisuje jego pozycję w tej samej transakcji (jeden krok cofania). Usunięcie urządzenia kasuje węzeł (istniejąca kaskada). Urządzenia bez zapisanej pozycji dostają pozycję z siatki.

**Odstępstwo od rekomendacji Q-28:** zamiast osobnej transakcji widoku poza modelem — jedna wspólna historia (prostsze i spójne z zapisem). Nie ma łączenia kolejnych przesunięć tego samego węzła w jeden wpis; każde puszczenie węzła to osobny krok.

**Konsekwencje:** każdy ruch zmienia plik projektu (dirty, autozapis). Pomiar: przeciąganie węzła nadal 0,7–0,8 ms/klatka przy 2000 urządzeń (zapis następuje po puszczeniu). **Weryfikacja:** 2 testy jednostkowe (cofanie, zapis/odczyt, schemat, niezmienniki) + 5/5 w interfejsie.

## ADR-042: Plan sali w edytorze (widok skalowany, sala prostokątna, rozmieszczanie)

**Status:** przyjęta (implementacja w prototypie). **Kontekst:** plan sali do skali jest wymagany w scenariuszu MVP (urządzenia z realnymi wymiarami na planie). Model (`spaces`, `placements`) i renderer planu (`planDrawList`, PoC-2) już istniały; brakowało edycji w interfejsie.

**Decyzja:** drugi widok w tym samym edytorze („Plan sali” / „Schemat”), wspólny `Store`, wspólne cofanie i zapis. Jednostki: mm, oś Y w górę. Sala to na razie prostokąt (róg w 0,0; wymiary w metrach, 1–500 m). Urządzenie ma co najwyżej jedno rozmieszczenie (klucz wynika z ID instancji); pozycja przyciągana do siatki 100 mm; obrót o 90° (klawisz R); pozycja także wpisywana liczbowo (X, Y w metrach). „Rozmieść brakujące” układa w rzędach urządzenia spoza planu według ich wymiarów z definicji. Urządzenie dodane z katalogu w widoku planu od razu trafia na środek widoku (jeden krok cofania). Rysowane są: obrys sali z nazwą i wymiarami, siatka 1 m i 5 m, podziałka, zaznaczenie; opcjonalnie trasy kabli (linie Manhattan między środkami).

**Konsekwencje i ograniczenia:** brak sal wielokątnych, wielu sal w widoku (używana pierwsza), kondygnacji, rack-ów, obiektów scenicznych, importu podkładu (DXF/PDF/obraz), wymiarowania i pomiaru odległości, długości kabli z planu (nadal ręczne), kontroli kolizji i wyjścia poza salę. Przeciąganie przesuwa tylko urządzenie (trasy kabli odświeżają się po puszczeniu). Etykiety urządzeń mają stały rozmiar w mm (przy małym zoomie mało czytelne). **Weryfikacja:** 4 testy jednostkowe + 17/17 w interfejsie; pozostałe testy bez regresji.

## ADR-043: Długości kabli oszacowane z planu

**Status:** przyjęta (implementacja w prototypie). **Kontekst:** długość kabla jest potrzebna do listy kabli i zamówienia, a wpisywanie jej ręcznie dla każdego kabla jest pracochłonne; plan sali (ADR-042) zna położenie urządzeń.

**Decyzja:** na żądanie (przycisk „Długości kabli…” w widoku planu) liczona jest długość każdego fizycznego kabla, którego oba końce stoją na planie w tej samej sali: odległość prostopadła (Manhattan) między środkami urządzeń + różnica wysokości + zapas, zaokrąglona w górę do 0,1 m. Zapas jest ustawieniem projektu (`settings.defaultCableSlackMm`, wartość startowa 1 m **[HIPOTEZA]**, do potwierdzenia na realnych projektach). Wynik zapisuje się z `lengthSource = estimated`. **Długości wpisane ręcznie (`manual`) nigdy nie są nadpisywane**; wpisanie własnej długości w panelu kabla lub w liście kabli zamienia oszacowanie na ręczną. Liczenie nie jest automatyczne (brak niespodzianek po przesunięciu urządzenia): po zmianie planu użytkownik liczy ponownie; to jeden krok cofania. Lista kabli oznacza oszacowane długości znakiem „~”, a panel kabla opisuje ich pochodzenie.

**Ograniczenia:** oszacowanie jest orientacyjne: środki urządzeń zamiast konkretnych gniazd, brak tras kablowych, kanałów, trasowania wokół przeszkód i wysokości montażu (oś Z bierze tylko to, co jest w rozmieszczeniu). Kable między salami pomijane. Przydział długości z magazynu (`stockLengthMm`) nadal osobno. **Weryfikacja:** 2 testy jednostkowe + 7/7 w interfejsie.

## ADR-044: Trasy kablowe na planie i długości kabli po trasach

**Status:** przyjęta (implementacja w prototypie); uzupełnia ADR-043. **Kontekst:** oszacowanie z ADR-043 liczyło odległość prostopadłą między urządzeniami, czyli pomijało korytka, drabinki i ścieżki, którymi kable faktycznie idą (zgłoszenie właściciela).

**Decyzja:** w widoku planu można rysować trasy kablowe jako łamane (przycisk „Rysuj trasę”: kliknięcia kolejnych punktów, siatka 100 mm, przyciąganie do istniejących wierzchołków w promieniu 12 px, Shift = oś prostopadła, Backspace = cofnij punkt, Enter = zakończ, Esc = anuluj). Trasy są częścią sali (`spaces[id].cableRoutes`, bez zmiany schematu), mają nazwę, można je zaznaczać, usuwać (Delete) i cofać. Długość kabla: dojście prostopadłe od środka urządzenia do najbliższego punktu trasy + najkrótsza ścieżka po sieci tras (Dijkstra) + dojście do drugiego urządzenia + zapas; koniec jednej trasy leżący do 200 mm od innej trasy łączy je. Urządzenie dalej niż 10 m od jakiejkolwiek trasy albo brak połączenia między trasami = awaryjnie odległość prostopadła (ADR-043). Zapisywane jest `estimateBasis` (`route` z listą tras albo `direct`). Wybór „prosto czy trasą” jest automatyczny: gdy trasy istnieją i obejmują oba końce, kabel idzie trasą nawet jeśli bezpośrednio byłoby krócej (kabel ma iść korytkiem).

**Uzupełnienie (edycja punktów):** zaznaczona trasa pokazuje uchwyty: kwadraty na wierzchołkach (przeciągnięcie przesuwa punkt z przyciąganiem do siatki 100 mm i do wierzchołków innych tras) i kółka na środkach odcinków (klik dodaje punkt). Zaznaczony punkt usuwa Delete (trasa musi mieć co najmniej 2 punkty); Delete bez zaznaczonego punktu usuwa całą trasę. Każda zmiana to jeden krok cofania (`setRoutePoints`); wysokość punktów jest zachowana. **Ograniczenia:** brak pojemności korytek i obsadzenia (ile kabli w trasie), brak wysokości tras (oś Z tylko z rozmieszczenia urządzeń), brak ręcznego wyboru trasy dla pojedynczego kabla, brak podświetlenia ścieżki kabla na planie; zmiana tras nie przelicza długości automatycznie (trzeba kliknąć „Długości kabli…”). Zapas i próg 200 mm / 10 m to **[HIPOTEZY]** do sprawdzenia na realnych projektach. **Weryfikacja:** 3 testy jednostkowe (trasa, złącze, awaryjne, polecenia) + 10/10 w interfejsie.

## ADR-045: Trzeci wymiar (z) w danych planu od początku

**Status:** przyjęta (implementacja w prototypie). **Kontekst:** właściciel chce uniknąć przebudowy danych przy późniejszym widoku 3D. Model domeny (DOMAIN-MODEL §5) już definiuje układ prawoskrętny z osią Z w górę i `position {x,y,z}`; prototyp planu (ADR-042) używał jednak tylko x/y, trasy kablowe (ADR-044) były płaskie.

**Decyzja:** cała geometria planu jest 3D w mm, Z w górę, podłoga sali na z = 0. (1) **Urządzenie:** `placement.position.z` = wysokość podstawy nad podłogą, edytowalna w panelu (pole Z [m]); przeciąganie na planie zachowuje z. (2) **Trasa kablowa:** punkty `[x, y, z]`; dane z dwoma współrzędnymi czytane jako z = 0 (zgodność wstecz bez migracji); trasa ma wysokość ustawianą w panelu (nowe trasy dziedziczą ostatnio ustawioną). (3) **Sala:** opcjonalne `ceilingHeightMm` (pole z DOMAIN-MODEL) ustawiane w oknie sali. (4) **Długości kabli:** sieć tras jest 3D (długości odcinków, złącza do 200 mm w 3D, dojście = poziomo prostopadle + pion), więc trasy na różnych wysokościach **nie** łączą się bez jawnego pionowego odcinka; kabel z podłogi do kratownicy na 5 m liczy pion dwa razy (do trasy i z powrotem).

**Nie zmienia się:** obrót pozostaje wokół osi Z (`rotationDeg`); pochylenie i przechył (obrót w 3D) można dodać później jako opcjonalne pola bez zmiany istniejących plików. Widok planu nadal jest rzutem z góry (3D tylko w danych i obliczeniach); wysokości są widoczne w panelach, nie na rysunku. Brak kontroli kolizji i zgodności z wysokością sali. **Hipotezy:** semantyka `z` jako wysokość podstawy (nie środka) jest wygodna do wpisywania, do potwierdzenia przy rigging/zasilaniu. **Weryfikacja:** 5 testów jednostkowych + testy interfejsu (Z urządzenia 18/18, trasy 11/11).

## ADR-046: Uwagi z pierwszych prób użycia (projekt1): zajęty port, niezgodne połączenia, trasy 3D, czytelność

**Status:** przyjęta (implementacja w prototypie). Zmienia ADR-037 i rozstrzygnięcie Q-29 na podstawie pierwszego użycia przez właściciela (2026-11-02).

**Decyzje:**
1. **Zajęty port = twarda blokada** (poprzednio uwaga V-002). Jedno gniazdo przyjmuje jeden kabel (`capacity`); gest nie utworzy drugiego połączenia, a komunikat podaje urządzenie i port. Przy upuszczeniu na nagłówek urządzenia wybierany jest inny wolny port. Starsze pliki z przeciążonym portem otwierają się, a oba kable są zaznaczone na czerwono.
2. **Niezgodne połączenie (kierunek V-001, sygnał V-010, różne złącza V-011) = potwierdzenie** w oknie z powodami („Anuluj” jest domyślne). Po potwierdzeniu połączenie jest **kolorowane na schemacie** (błąd czerwony, ostrzeżenie żółty), a licznik „uwagi walidacji” na pasku jest klikalny i otwiera listę uwag (reguła, urządzenia, opis; klik przenosi do elementu). To zastępuje „bez potwierdzenia” z Q-29, bo uwaga w pasku stanu była łatwa do przeoczenia.
3. **Usuwanie urządzenia zawsze pyta** (dotąd tylko przy połączeniach); można cofnąć.
4. **Połączenie bez kabla** (brak typu kabla pasującego do obu złączy) ma panel z wyborem typu i przypisaniem kabla; lista kabli pokazuje „brak kabla” zamiast pustego pola. Typ kabla istniejącego połączenia można zmienić w panelu (najpierw typy pasujące do obu złączy). Prawdopodobna przyczyna zgłoszenia „nie da się wpisać długości” (zgłoszenie nr 7): połączenie utworzone między niezgodnymi złączami nie dostawało kabla, więc nie miało numeru ani długości. Nie odtworzono przypadku zmiany typu kabla po narysowaniu (taka zmiana nie była wcześniej możliwa w interfejsie).
5. **Plan: kable po trasach.** Przełącznik „Kable” rysuje przebieg kabla tą samą logiką co obliczenie długości (dojście do trasy, trasa, dojście); kable bez trasy rysowane są prosto kolorem ostrzegawczym (dotąd zawsze prosto między środkami urządzeń).
6. **Plan: etykiety urządzeń** w stałym rozmiarze ekranu z unikaniem nakładania (zaznaczone mają pierwszeństwo, ukryte są liczone i podawane; przybliżenie je odsłania). **Schemat:** nazwy urządzeń i portów są skracane z wielokropkiem do szerokości bloku.
7. **Trasy na różnych poziomach:** podczas rysowania pole „Wysokość [m]” i przycisk „Pion ↕” dodają odcinek pionowy w ostatnim punkcie; kliknięcie początku na istniejącej trasie przejmuje jej wysokość.

**Ograniczenia:** brak ręcznego odpinania kabla z poziomu portu (odpinanie przez zaznaczenie kabla + Delete); etykiety kabli i tras na planie nie mają unikania nakładania; kable i trasy na planie mają podobne kolory (do poprawy). **Weryfikacja:** 124 testy jednostkowe (5 nowych w feedback.test.ts) + 16/16 w interfejsie; plik projekt1.sw otwarty (kopia) w zbudowanej aplikacji.

## ADR-047: Eksport planu sali do PDF w skali

**Status:** przyjęta (implementacja w prototypie); wykorzystuje eksport wektorowy z PoC-3 (ADR-016/017, pdf-lib + Roboto).

**Decyzja:** w widoku planu przycisk „Eksport PDF…” otwiera okno z wyborem papieru (A4/A3/A2/A1, poziomo), skali (Auto lub standardowy mianownik 1:20…1:2000) i rysowania kabli. Skala Auto to najmniejszy standardowy mianownik, przy którym sala mieści się na papierze z marginesem 10 mm i miejscem na tabliczkę; okno ostrzega, gdy wybrana skala nie mieści sali. PDF jest wektorowy (1 mm na papierze = 1 mm w skali), z prawdziwym tekstem i polskimi znakami (czcionki z pakietu aplikacji, bez sieci), jedna strona. Zawartość: obrys sali, urządzenia (z obrotem), trasy kablowe, kable po trasach (opcjonalnie), etykiety urządzeń o stałej wielkości ok. 6 pt **bez nakładania** (pominięte są zliczane w tabliczce), tabliczka: projekt, sala, skala, papier, wymiary, liczba urządzeń i tras, data. Zapis przez okno „Zapisz jako”, atomowo.

**Ograniczenia:** jedna sala i jedna strona (brak dzielenia na arkusze), wszystko czarne (bez kolorów i grubości linii z ekranu), brak legendy, wymiarowania i podziałki graficznej, brak numerów kabli i etykiet połączeń na rysunku, brak eksportu schematu blokowego i listy kabli do PDF (lista: CSV). Porównanie z wymaganiami profesjonalnych tabliczek rysunkowych nie było robione. **Weryfikacja:** 3 testy jednostkowe (skala, rozmiar strony, polskie znaki odczytane z PDF, nakładanie etykiet) + 5/5 w interfejsie (budowa PDF w przeglądarce z czcionkami pakietu); okna zapisu w prawdziwej aplikacji nie sprawdzano ręcznie.

## ADR-048: Eksport listy kabli i schematu blokowego do PDF

**Status:** przyjęta (implementacja w prototypie); uzupełnia ADR-047.

**Decyzja:** (1) **Lista kabli do PDF** (przycisk w oknie „Lista kabli”): A4 poziomo, tabela z kolumnami numer, typ kabla, z/do (urządzenie · port), sygnał, długość [m], uwagi; wiele stron z powtarzanym nagłówkiem; długości oszacowane z planu oznaczone „~”, w uwagach „brak kabla” / „brak długości” / „ręcznie” / „~ z planu”; na końcu podsumowanie wg typu kabla (sztuki, łączna znana długość, liczba kabli bez długości). (2) **Schemat blokowy do PDF** (przycisk „Schemat PDF…” w widoku schematu): wektorowy, jedna strona na najmniejszym papierze A4…A1 poziomo, na którym mieści się cały schemat przy skali bazowej 4,6 jednostki diagramu na 1 mm (nazwa urządzenia ok. 8 pt); gdy nie mieści się nawet na A1, skala jest zmniejszana. Oś Y diagramu odwracana do układu PDF. Te same zasady co w ADR-047: czcionki z pakietu (offline), prawdziwy tekst z polskimi znakami, zapis atomowy przez okno „Zapisz jako”.

**Ograniczenia:** PDF czarno-biały; schemat bez tabliczki dopasowanej do rysunku technicznego i bez dzielenia na arkusze; lista kabli bez grupowania i filtrów (te same wiersze co CSV); brak numerów stron „x z y” i eksportu zestawu (plan + schemat + lista) jednym plikiem. Pogrubienia nie ma celowo: podwójne rysowanie tekstu dublowałoby go przy kopiowaniu i wyszukiwaniu. **Weryfikacja:** 6 testów jednostkowych (strony, polskie znaki, powtarzany nagłówek, „~”, tekst na stronie, pusty projekt) + 8/8 w interfejsie (PDF budowany w przeglądarce); wyglądu PDF nie oceniano wzrokowo w przeglądarce PDF, a okien zapisu w aplikacji nie sprawdzano ręcznie.

## ADR-049: Pakiety urządzeń jako baza urządzeń; rozszerzona edycja definicji; biblioteka użytkownika

**Status:** przyjęta (implementacja w prototypie). **Kontekst:** właściciel chce równolegle z rozwojem programu budować bazę urządzeń. Do tej pory katalog był zaszyty w kodzie (14 urządzeń ogólnych), a okno definicji edytowało tylko model i porty.

**Decyzje:**
1. **Format pakietu `stagewire-pack/1`** (plik `*.swpack.json`, schemat pomocniczy `schema/pack.schema.json`, opis: DEVICE-DB.md): urządzenia z portami (klucze stabilne), własne wpisy rejestrów, pochodzenie. Każde urządzenie wymaga źródła danych (`datasheet`/`manual`/`measured`/`estimated`/`generic`/`custom`; dla `datasheet` i `manual` odnośnik do dokumentu), opis do 400 znaków własnymi słowami (ADR-020). Walidacja (`validatePack`) zwraca polskie komunikaty ze ścieżką do błędu i ostrzeżenia; pakiety z błędami nie są wczytywane.
2. **Katalog = suma pakietów.** Pakiet startowy (14 urządzeń) przeniesiono do pliku danych zachowując identyfikatory definicji i portów (test zgodności z migawką poprzedniej wersji), więc istniejące projekty nie wymagają migracji. Dodano wbudowany pakiet rejestrów (złącza USB/Speakon/SFP/LC…, sygnały Dante/NDI/Art-Net/MIDI…, kable) oraz możliwość pakietów samych rejestrów. Pakiety wbudowane są zastrzeżone.
3. **Identyfikatory:** definicja `eqd_<pakiet><urządzenie>`, port `prt_<klucz>` (znaki specjalne usuwane; kolizje wykrywa walidacja); `rewizja.key = pakiet/urządzenie`, `origin {packId, packVersion, license, source}`. Dodanie z katalogu nie nadpisuje definicji już obecnej w projekcie (rewizje niemutowalne, ADR-004).
4. **Biblioteka użytkownika:** aplikacja wczytuje `*.swpack.json` z folderu `Dokumenty\StageWire\Biblioteka` (zmienna `STAGEWIRE_LIBRARY` zmienia folder) przy starcie; błędne pliki są raportowane w oknie „Biblioteka urządzeń…” i nie blokują startu. Okno pozwala importować pakiet (z walidacją i potwierdzeniem zastąpienia) oraz eksportować zmienione/własne definicje projektu do pakietu.
5. **Edycja definicji:** okno pozwala zmieniać producenta, kategorię, tagi, opis, wymiary, masę, moc, rack, źródło danych (zmiany opisowe = rewizja kosmetyczna), **zapisać jako nowe urządzenie** (fork: nowa definicja z `origin.derivedFrom`, przepięcie zaznaczonej instancji, te same identyfikatory portów) i **zapisać do biblioteki użytkownika** (pakiet „Moje urządzenia”). Dodatkowe sygnały portu z pliku pakietu są zachowywane przy edycji.
6. **CLI** (`packs validate|new|list`, `npm run packs:validate`): walidacja katalogu pakietów z wzajemnym korzystaniem z rejestrów, kod wyjścia ≠ 0 przy błędach: do pracy zespołowej i automatyzacji.

**Ograniczenia:** brak automatycznej aktualizacji definicji w projekcie po nowej wersji pakietu (wybór „zaktualizuj z biblioteki” do zrobienia), brak edycji wielu sygnałów na port w oknie, brak zasilania/riggingu w pakietach (pola `powerW`, `weightKg` zapisywane na przyszłość), brak podpisów pakietów i sporów o identyfikatory między autorami (identyfikator pakietu jest globalnie unikalny z konwencji), brak importu z formatów innych programów (świadomie, ADR-020). **Weryfikacja:** 30 nowych testów jednostkowych (walidacja, migawka zgodności, eksport/import, meta, fork) + testy interfejsu urządzeń; folder biblioteki w prawdziwej aplikacji: patrz IMPLEMENTATION-PLAN.

## ADR-050: Dopracowanie formatu pakietów: identyfikacja, aktualizacja, rejestry, wiarygodność danych

**Status:** przyjęta (implementacja w prototypie); rozszerza ADR-049 po zewnętrznym przeglądzie formatu (propozycje wybrano selektywnie, bez zmiany architektury).

**Kontekst:** `stagewire-pack/1` miał już id pakietu, wersję, klucze urządzeń i portów, rejestry i źródło danych. Przegląd wykazał luki: (1) wczytanie pakietu dopisywało rejestry po cichu metodą „pierwszy wygrywa”, więc dwa pakiety z różnymi definicjami tego samego klucza nie dawały błędu; (2) brak statusu ponownego importu (identyczny, nowszy, starszy) i brak informacji o zmianach łamiących zgodność; (3) brak wykrywania i wykonywania aktualizacji definicji w projekcie; (4) źródło danych nie odróżniało danych zweryfikowanych od wygenerowanych; (5) zasilanie i grupy portów nie miały miejsca w formacie; (6) ścieżka `$schema` w pakiecie była względna do repozytorium.

**Decyzje:**
1. **Identyfikacja bez nowego mechanizmu.** Zostaje `eqd_<pakiet><urządzenie>` i rewizje definicji projektu (ADR-004/-029) jako jedyny mechanizm wersjonowania w projekcie; wersja pakietu służy do rozpoznania „nowszy”. Kolizje identyfikatorów powstałe po usunięciu myślników są wykrywane między pakietami i blokują drugi pakiet.
2. **Instalacja atomowa z planem.** `planInstall` sprawdza pakiet bez zmian (status new/identical/upgrade/downgrade/changed-same-version, listy dodanych/zmienionych/usuniętych urządzeń, zmiany łamiące zgodność, nowe i współdzielone wpisy rejestrów); `installPack` zmienia katalog dopiero po pełnym sprawdzeniu. Ponowny import identycznego pakietu nic nie zmienia. Błędy blokują, ostrzeżenia nie.
3. **Rejestry bez cichego nadpisywania.** Wpis o tym samym kluczu i innej treści niż w innym wczytanym pakiecie jest błędem blokującym (z nazwą pakietu); identyczny wpis jest współdzielony. Brakujące złącza i sygnały: jedna zbiorcza lista. Zależności wynikają z użytych kluczy (bez jawnej listy zależności); w folderze biblioteki kolejność plików nie ma znaczenia. Dodano słownik zasilania: złącza IEC C13/C14, Schuko, DC, sygnały `std/power-ac`, `std/power-dc`, `std/poe`, kable zasilające.
4. **Aktualizacja jest jawna.** `libraryUpdates` wykrywa definicje projektu starsze niż pakiet (po kluczu i wersji, z różnicą portów i liczbą użyć), a `updateFromCatalog` tworzy nową rewizję tylko na polecenie, z przepięciem instancji lub bez. Sam import pakietu nigdy nie zmienia projektu (test). Interfejs: okno „Biblioteka urządzeń…”, sekcja „Aktualizacje w projekcie”.
5. **Źródło danych (P1).** Dodano `url`, `hardwareRevision`, `generated`. Wiarygodność (zweryfikowane/niezweryfikowane/szacunkowe/ogólne) wynika z pól źródła; dane `generated` nigdy nie są zweryfikowane same z siebie; katalog oznacza dane niezweryfikowane i szacunkowe.
6. **Zasilanie i grupy (P1) w istniejącym modelu portów.** `powerMaxW` na urządzeniu, `group` i `electrical` (`voltageMinV/MaxV`, `maxW`) na porcie. Zasilanie, redundancja i PoE to zwykłe porty i połączenia, bez osobnego modelu elektrycznego.
7. **Przenośność i zgodność.** Pakiet nie zawiera ścieżek do plików; `$schema` jest ignorowane; mapowanie schematu robi lokalna konfiguracja edytora. Format rozszerzany addytywnie; nieznane pola to ostrzeżenia (wychwytują literówki); zmiana łamiąca dostanie `stagewire-pack/2` z jawną migracją.

**Poza zakresem (P2, opisane w DEVICE-DB.md §14):** moduły i karty rozszerzeń, porty rekonfigurowalne, geometria złączy, modele 3D, pobieranie danych od producentów. Okno definicji nie edytuje jeszcze nowych pól (są zachowywane przy edycji).

**Konsekwencje:** format jest gotowy do generowania pakietów skryptem (stabilne klucze, jawne statusy wiarygodności, walidacja z kodem wyjścia); wiarygodność danych zależy od przeglądu człowieka, bo program nie weryfikuje faktów, tylko spójność i pochodzenie.

## ADR-051: Widok racka (elewacja), montaż urządzeń i raport

**Status:** przyjęta (implementacja w prototypie); realizuje model z DOMAIN-MODEL §5.10 i regułę V-003, które do tej pory istniały tylko w dokumentacji.

**Decyzja:**
1. **Model.** Rack to obiekt `racks[rck_*]` (`name`, `units` 1–60, `widthIn` 19, `depthMm?`, `notes?`; nazwy unikalne). Pozycja urządzenia to wartość osadzona w instancji `mount = {rackId, uStart, face, slot}` (nie encja). U1 jest na dole; urządzenie zajmuje `uStart … uStart+heightU−1`. Wysokość i szerokość bierze z `rackUnits` aktualnej rewizji definicji; urządzenie bez `rackUnits` nie jest rackowe i nie da się go zamontować (komunikat z podpowiedzią, gdzie to ustawić).
2. **Miejsca w poziomie.** Szerokość 1 → `full`; 0,5 → `left` lub `right`; 0,33 → `left`, `center`, `right` (rozszerzenie względem DOMAIN-MODEL, który znał tylko full/left/right). Kolizja liczy się osobno dla przodu i tyłu, po nakładaniu się zakresów U i zakresów szerokości. Głębokość urządzenia nie blokuje montażu po drugiej stronie: sprawdza ją osobne ostrzeżenie.
3. **Polecenia w warstwie poleceń** (jeden krok cofania): `addRack`, `updateRack` (zmniejszenie racka poniżej zajętego U jest odrzucane), `removeRack` (zdejmuje urządzenia, kasuje położenie racka na planie), `mount` (odrzuca brak racka, brak wysokości w U, wyjście poza rack, złą szerokość i kolizję z nazwą zajmującego urządzenia), `unmount`. Twarda niezmienniczość: `mount.rackId` wskazuje istniejący rack.
4. **Walidacja miękka.** V-003 (błąd): nakładanie się urządzeń w racku albo wyjście poza rack (np. po ręcznej edycji pliku lub zmniejszeniu urządzenia w nowej rewizji); V-027 (ostrzeżenie): głębokość urządzenia większa niż głębokość racka.
5. **Widok.** Trzeci widok obok schematu i planu (przycisk „Rack”): elewacja przodu lub tyłu w stałej skali z numeracją U, przeciąganie z listy „Poza rackiem” i między pozycjami (podgląd zielony/czerwony), Delete zdejmuje, dodanie urządzenia z katalogu w tym widoku od razu montuje je w pierwszym wolnym miejscu, okna nowego/edycji/usuwania racka. Panel pokazuje zajęte i wolne U, masę i pobór (typowy i maksymalny) z definicji; urządzenia bez danych są liczone osobno, żeby suma nie udawała kompletnej.
6. **PDF.** `rackPdf`: A4 pionowo, strona na rack (przód i tył obok siebie, sumy, tabela zawartości od góry racka, ciąg dalszy na kolejnych stronach); prawdziwy tekst z osadzoną czcionką.

7. **Rack na planie sali (dodane po pierwszej implementacji).** Rack ma położenie `placements[plc_rck…] = {targetKind:'rack'}` (obrys 600 mm × głębokość racka, domyślnie 1000 mm; obrót, wysokość podstawy). Przycisk „Postaw rack”, przeciąganie (siatka 100 mm), panel X/Y/Z, R obraca, „Zdejmij z planu”. Urządzenie zamontowane w racku, który stoi na planie, **nie ma własnego punktu na planie**: `effectivePosition` daje pozycję racka, a wysokość z numeru U (środek urządzenia). Estymata i przebieg kabli (`estimateLengths`, `cablePaths`) oraz punkty sieci tras używają tej pozycji, więc kabel w obrębie jednego racka to głównie pion plus zapas. Rack bez położenia: urządzenie wraca do własnego punktu, jeśli go ma.

**Poza zakresem:** kolumny rackowe 2-słupkowe i półki, bilans mocy z rozdziałem na PDU, czytelniejsza reprezentacja urządzeń głębszych niż połowa racka z obu stron.

**Konsekwencje:** zasilanie z pakietów (`powerW`, `powerMaxW`) ma pierwsze zastosowanie (sumy w racku). Dane `rackUnits` w pakietach stały się krytyczne: urządzenie bez nich nie trafi do racka (DEVICE-DB.md §2).

## ADR-052: Szafy i rozdzielnice na szynę DIN (widok „Szafa”)

**Status:** przyjęta (implementacja w prototypie, etap 1 z 2). Dotyczy fizycznej szafy z osprzętem na szynach, nie bilansu obciążeń (bilans faz i obwodów zostaje na później; zasilanie i rigging pozostają w produkcie, poza MVP).

**Kontekst:** w teatrach peryferia sceniczne (sterowniki, zasilacze, bezpieczniki, przekaźniki) trafiają do szaf elektrycznych na szynach DIN, a nie do racków 19″. Rozdzielnice nie mają „U”: osprzęt jest modułowy (moduł = 17,5 mm). Często spotyka się też moduły 3U do racka z szyną DIN w środku.

**Decyzja:**
1. **Model.** `cabinets[cab_*] = {name (unikalna), widthMm, heightMm, depthMm?, rows 1–12, modules 1–72, notes?, terminals?}`. Osprzęt ma w rewizji definicji `dinModules` (1–72, całkowite); pozycja to wartość osadzona w instancji `din = {cabinetId, row (1 = górna szyna), at (1 = pierwszy moduł)}`, tak jak `mount` w racku. `mount` i `din` wykluczają się (montaż w jednym zdejmuje drugi). Moduł do racka 3U to preset obudowy (1 szyna × 24 mod., 482 × 133 mm); wstawianie takiej obudowy do racka jest poza zakresem etapu 1.
2. **Polecenia:** `addCabinet`, `updateCabinet` (nie pozwala zmniejszyć poniżej zajętych szyn i modułów), `removeCabinet` (zdejmuje osprzęt, połączenia zostają), `mount`, `unmount`, `setTerminal`. Niezmienniki twarde: `din.cabinetId` wskazuje istniejącą szafę; instancja nie jest jednocześnie w racku i na szynie.
3. **Walidacja miękka:** V-028 (błąd): osprzęt nakłada się na szynie albo wychodzi poza szyny; V-029 (ostrzeżenie): osprzęt głębszy niż szafa.
4. **Opinanie.** Połączenia między portami osprzętu są zwykłymi połączeniami modelu (`connections`), więc zasilacz → sterownik, bezpiecznik → zasilacz itd. nie wymagają osobnego modelu elektrycznego. Rejestry: złącze `std/din-terminal`, przewód `std/cable-wire` („Przewód w szafie”, zacisk–zacisk; nosi zasilanie AC/DC, DMX, 0–10 V, styk), sygnały `std/ctrl-0-10v`, `std/relay`. Kabel powstaje domyślnie przy opięciu.
5. **Terminale szafy.** Port osprzętu można oznaczyć jako wchodzący lub wychodzący z szafy (`terminals: [{instanceId, portId}]`). Tylko porty osprzętu z tej szafy; zdjęcie lub usunięcie osprzętu zdejmuje oznaczenie.
6. **Widok.** Przycisk „Szafa”: elewacja ze skalą modułów, szynami DIN, przeciąganiem z listy „Poza szafą” i między pozycjami (zielony/czerwony podgląd), portami jako kropkami (wejścia u góry, wyjścia u dołu), opinaniem przez klik w dwa porty (kierunek, wspólny sygnał i pojemność portu sprawdzane od razu), zaznaczaniem i usuwaniem przewodów oraz terminalami (żółty pierścień). Okno definicji urządzenia ma pole „Moduły DIN”.

7. **Szafa jako blok na schemacie (etap 2, zrobiony).** Flaga `cabinets[id].asBlock` (przycisk „Schemat: blok/osprzęt” w widoku Szafa; domyślnie wyłączona, więc istniejące schematy się nie zmieniają). Gdy włączona: osprzęt szafy znika ze schematu, a w jego miejscu jest jeden węzeł `cab_*` (obwódka żółta) z portami = oznaczone terminale (etykieta „urządzenie · port”). Warstwa tłumacząca w rysowaniu (`outerRef`/`innerRef`): połączenia z zewnątrz do terminala biegną do bloku, połączenia wewnątrz szafy i do nieoznaczonych portów są ukryte. Dane się nie zmieniają: połączenie nadal wskazuje prawdziwy port osprzętu, więc listy kabli, walidacja i eksport działają jak dotąd. Łączenie przeciąganiem na port bloku tworzy połączenie z prawdziwym portem. Pozycja bloku zapisuje się w widoku (`views`), a klik w blok pokazuje panel z przyciskiem „Rozwiń na schemacie”.

8. **PDF szafy (zrobiony).** `cabinetPdf`: A4 poziomo, strona na szafę z elewacją (szyny, osprzęt w modułach, żółta kropka nad blokiem z terminalem), sumami i tabelami: osprzęt, terminale (kierunek, sygnał, do czego podłączone) i okablowanie wewnętrzne (od → do, sygnał, przewód); długie tabele przechodzą na kolejne strony. Przycisk „PDF…” w widoku Szafa.

9. **Grupy terminali (wielobiegunowe wyjścia/wejścia szafy).** Jeden sygnał bywa kilkoma zaciskami, także na różnych urządzeniach (230 V = bezpiecznik L + blok N + szyna PE; DMX = A, B, GND jednego sterownika). Terminal ma opcjonalną `group` (nazwa do 40 znaków, ustawiana w panelu osprzętu). Terminale o tej samej grupie są na schemacie **jednym portem bloku** („230 V (L, N, PE)”). Połączenie wskazujące którykolwiek biegun grupy rysuje się jako jedna kreska do tego portu; połączenie wykonane na schemacie na port grupy trafia do pierwszego terminala grupy (pozostałe bieguny są w grupie „objęte”, bez osobnych połączeń). Pełne rozdzielenie na bieguny (każdy z własnym przewodem) robi się w widoku Szafa. PDF grupuje terminale wg grupy.

10. **Moduł DIN do racka (np. 3U z szyną).** Szafa może mieć `rackUnits.heightU` (wzory „Moduł 3U/6U do racka” ustawiają to same) i wtedy ma `mount` w racku jak urządzenie rackowe (cała szerokość). `rackContents`, kolizje, `firstFree`, sumy, raport, PDF racka i walidacja (V-003, V-027) traktują ją jak element racka; masa i pobór szafy to suma osprzętu w środku (brakujące dane liczone osobno). W widoku Rack moduł jest na liście „Poza rackiem” i przeciąga się jak urządzenie. Niezmienniki: `mount` szafy wskazuje istniejący rack i wymaga `rackUnits`; zdjęcie wysokości lub jej zwiększenie ponad rack jest odrzucane, gdy szafa stoi w racku. Nie zrobione: położenie urządzeń z takiej szafy na planie sali liczone od pozycji racka (estymata kabli bierze je dziś z własnych położeń).

11. **Szafa DIN na planie sali.** Położenie `placements[plc_cab…] = {targetKind:'cabinet'}` (obrys z wymiarów szafy: szerokość × głębokość, domyślnie 300 mm; obrót, wysokość podstawy), ustawiane jak dla racka (przycisk „Postaw rack/szafę”, przeciąganie, panel X/Y/Z, R, „Zdejmij z planu”). Szafa zamontowana w racku nie ma własnego położenia (wynika z racka; komenda to odrzuca). Osprzęt na szynach stoi w miejscu szafy, a wysokość = podstawa + wysokość szafy − (numer szyny − 0,5) × wysokość szyny; moduł w racku: środek modułu. Estymata i przebieg kabli korzystają z tego (`effectivePosition`), osprzęt w racku/szafie na planie nie ma własnego punktu i nie jest rysowany ani etykietowany; PDF planu rysuje i podpisuje rack/szafę zamiast osprzętu w środku. Usunięcie szafy kasuje jej położenie.

12. **Okno definicji urządzenia: pola z pakietów (dopięte).** Moduły DIN, moc maksymalna, adres źródła (`https://`), rewizja sprzętu, flaga „dane wygenerowane”, a przy portach: grupa portów i drugi sygnał (np. PoE na RJ45). Zapis waliduje moc maksymalną względem typowej i adres; pola z pakietów, których okno nie edytuje (np. `electrical` portu), zapis nie gubi. Pola trafiają do pakietu przy „Zapisz w mojej bibliotece”. Przy porcie dochodzą też napięcie minimalne i maksymalne oraz moc maksymalna (`electrical`), **pokazywane tylko dla portów z sygnałem zasilającym** (PoE, zasilanie AC/DC; to obejmuje też wyjścia dimmerów i zasilaczy), a wiersz zostaje widoczny, gdy port ma już zapisane wartości, a liczba sygnałów nie jest ograniczona (przycisk „+ sygnał”, „usuń sygnał” zdejmuje dodatkowy). Zapis odrzuca napięcie minimalne większe od maksymalnego, wartości spoza 0–100000, grupę dłuższą niż 40 znaków i powtórzony sygnał.

**Poza zakresem:** połączenie na sam blok bez wskazania portu (blok nie ma „najlepszego portu”), szersza ramka bloku dla długich etykiet (szerokość węzła jest stała), szafa na planie sali, moduł 3U jako obiekt montowany w racku, bilans obciążeń i faz.

**Konsekwencje:** pakiety urządzeń mogą deklarować `dinModules` (DEVICE-DB §2), urządzenia bez tego pola nie trafią na szynę.

## ADR-053: Widok 3D sali (prosta wizualizacja)

**Status:** przyjęta (implementacja w prototypie). Dane do niej już były w modelu (położenia z wysokością, wymiary urządzeń, racki, szafy, trasy kablowe z poziomami), brakowało tylko wizualizacji.

**Decyzja:**
1. **Technika.** Rzutowanie perspektywiczne i rysowanie ścian na Canvas 2D (algorytm malarza: ściany posortowane od najdalszej, tylko zwrócone do kamery, proste oświetlenie). Bez nowej zależności i bez WebGL, więc działa offline i tak samo w WebView2 oraz na WSL2/Linuksie. Logika (scena, kamera, rzutowanie, wybór bryły) jest w czystych funkcjach `src/view3d.ts`, rysowanie i mysz w `web/view3d.ts`.
2. **Zawartość sceny.** Obrys sali z podłogą, siatką 1 m i (gdy podano) wysokością do sufitu jako linie przerywane; bryły urządzeń z `dimensionsMm` na swoich położeniach (x, y, wysokość podstawy z, obrót), racki (U × 44,45 mm + ramka 60 mm, głębokość z racka, szerokość 600 mm), szafy DIN (z wymiarów) i obiekty sceniczne; trasy kablowe jako łamane 3D; opcjonalnie połączenia jako proste linie między położeniami urządzeń. Osprzęt w racku lub szafie, które stoją na planie, nie jest osobną bryłą (rack i szafa jej zastępują); urządzenia bez wymiarów dostają bryłę 0,4 × 0,3 × 0,1 m.
3. **Sterowanie.** Przeciągnięcie = obrót (yaw/pitch), Shift lub prawy przycisk = przesuwanie po podłodze, kółko = zoom, klik = zaznaczenie z panelem (nazwa, rodzaj, wymiary, położenie, wysokość podstawy, obrót), Esc = zdjęcie zaznaczenia; przyciski „Dopasuj”, „Z góry”, „Izometria” oraz przełączniki Trasy / Połączenia / Etykiety. Etykiety unikają nakładania, a racki, szafy i zaznaczony element mają pierwszeństwo.
4. **Miejsce w interfejsie.** Przycisk „Widok 3D” w pasku planu (przełącza się na „Widok 2D”); widok przykrywa plan, klawisze planu są wstrzymane, a przejście na Schemat, Rack lub Szafę zamyka go.5. **Połączenia po trasach.** Przełącznik „Połączenia” rysuje kable tak, jak liczy je szacowanie długości (`cablePaths3d` w `src/lengths.ts`): poziomo do trasy, pion na jej wysokość, po trasach, zejście do drugiego urządzenia; bez trasy prosta przerywana linia.
6. **Łączenie tras na różnych wysokościach.** Trasy na różnych wysokościach nadal łączą się tylko jawnie (test `plan3d`). Przycisk „Połącz trasy” w widoku 3D: klik w punkt jednej trasy (przyciąganie do wierzchołków), klik w punkt drugiej; powstaje zwykła trasa „Pion N” z dwóch punktów (bez zmian formatu), którą siatka tras łączy z oboje. Wybór punktu: `pickRoutePoint` (`src/view3d.ts`). Esc anuluje.

**Ograniczenia (świadome):** widok jest tylko do odczytu poza łączeniem tras (położenia zmienia się na planie); bryły to prostopadłościany bez geometrii złączy i bez wnętrza racka; trasy i połączenia rysują się na wierzchu brył (bez ukrywania za nimi); algorytm malarza bywa niedokładny przy brył przenikających się lub bardzo różnej wielkości; brak widoku w PDF.

## ADR-054: Ścisła polityka CSP, walidator generowany z wyprzedzeniem i instalator Windows

**Status:** przyjęta (implementacja w prototypie).

**Kontekst:** okno aplikacji miało `csp: null` (PoC). Produkt działa wyłącznie offline i nie ładuje niczego z sieci, więc polityka może być ścisła. Przeszkodą był Ajv, który kompilował walidator schematu projektu w locie przez `new Function` (wymaga `unsafe-eval`).

**Decyzja:**
1. **CSP w `tauri.conf.json`:** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Bez `unsafe-eval` i bez zewnętrznych źródeł; `unsafe-inline` tylko dla stylów (atrybuty `style` w interfejsie), nie dla skryptów. Zdalnych połączeń nie ma (zgodnie z zasadą „bez telemetrii, offline”).
2. **Walidator generowany z wyprzedzeniem.** `scripts/gen-validator.mjs` buduje z `schema/project.schema.json` gotowy kod (Ajv standalone, ESM) do `src/generated/projectValidator.js`; generator wstawia własną funkcję zamiast `require()` z Ajv, żeby kod działał w przeglądarce i w Node. `format.ts` używa tego pliku; Ajv zostaje tylko jako zależność deweloperska generatora. Plik odświeżają `npm test` (`pretest`) i `npm run build:web`, a test `validator-fresh` pilnuje, że jest aktualny względem schematu i nie zawiera `eval`, `new Function` ani `require`.
3. **Test CSP** (`bench/test-csp.mjs`): zbudowany front serwowany z nagłówkiem CSP wzięty z `tauri.conf.json`; przejście przez katalog, okno definicji, plan, widok 3D, PDF planu, rack i szafę musi dać zero zdarzeń `securitypolicyviolation`, a wstrzyknięty skrypt inline i połączenie z zewnętrznym adresem muszą być zablokowane.
4. **Instalator Windows:** `bundle.active` z celem NSIS, instalacja per użytkownik (bez uprawnień administratora), język polski, osadzony bootstrapper WebView2 (potrzebny tylko, gdy systemowego brakuje). Budowa: `npm run tauri -- build --bundles nsis` (pierwsza budowa pobiera NSIS). Instalator nie jest podpisany certyfikatem, więc SmartScreen może ostrzegać (podpisanie to osobna decyzja i koszt). Pakiety `.deb`/AppImage dla Linuksa wymagają budowy na Linuksie (WSL2), poza zakresem tej decyzji (Q-27).

**Konsekwencje:** każda przyszła zależność używająca `eval` lub `new Function` złamie test CSP, co jest zamierzone. Zmiana schematu wymaga `npm run gen:validator` (robi to `pretest`/`build:web`).


## ADR-055: Sala o dowolnym kształcie i obiekty sceniczne (bryły)

**Status:** przyjęta. **Kontekst:** sale bywają nieprostokątne (L, U, trapez, sale z wcięciami), a plan i widok 3D potrzebują scenografii: scen, podestów, ścian, stołów, filarów i kostek, na których da się ustawić sprzęt.

1. **Kształt sali.** `spaces[id].boundary` jest wielokątem prostym (3–200 wierzchołków, mm); prostokąt to szczególny przypadek. Polecenia `plan.addSpaceShape` i `plan.setSpaceShape` walidują obrys (`polygonProblem`): brak krzyżujących się i nakładających boków, brak powtórzonych wierzchołków, pole ≥ 1 m², ramka ≤ 500 × 500 m. Obrys jest przesuwany tak, by lewy dolny róg ramki leżał w 0,0 (reszta aplikacji liczy od tego rogu); przy zmianie kształtu istniejącej sali urządzenia, racki, szafy, obiekty i trasy przesuwają się o to samo, więc zostają w tych samych miejscach sali. Format pliku się nie zmienia.
2. **Interfejs.** Okno „Sala…”: Prostokąt albo „Dowolny kształt”: wierzchołki wpisywane tekstem (`x; y` w metrach, jeden w linii), gotowe wzory (L, U, trapez, ośmiokąt) i „Rysuj na planie…” (klik = wierzchołek, klik w pierwszy punkt lub Enter = zamknięcie, Backspace, Shift = oś, Esc). Okno na bieżąco pokazuje liczbę wierzchołków, pole i błędy.
3. **Plan i 3D.** Siatka i delikatne wypełnienie są przycięte do obrysu; etykieta sali podaje wymiary ramki i pole. Widok 3D rysuje podłogę, siatkę i obrys sufitu z słupkami w wierzchołkach wg wielokąta.
4. **V-030 (ostrzeżenie).** Środek urządzenia, racka, szafy lub bryły leżący poza obrysem sali (np. we wcięciu litery L) jest zgłaszany.
5. **Obiekty sceniczne.** `stageObjects[sob_*] = {name, footprint:{widthMm, depthMm, heightMm}, color?, notes?}` (`src/stage.ts`: `addObject`, `updateObject`, `removeObject`, `duplicateObject`). Położenie to zwykły placement `targetKind: 'stageObject'` (x, y, z = wysokość podstawy, obrót), więc bryły można piętrzyć (kostka na podeście). Przycisk „Obiekt…” w pasku planu: gotowe wzory (kostka 1 m, podest, scena, ściana/ekran, stół, filar) lub własne wymiary i kolor. Obiekt przeciąga się, obraca (R), edytuje w panelu (nazwa, wymiary, kolor, X/Y/Z), powiela i usuwa (Delete); wszystko jest cofalne. Na planie to prostokąt w kolorze obiektu z etykietą, w 3D prostopadłościan w tym kolorze.
6. **Kształty obiektów: schody i walec.** `shape: 'box' | 'stairs' | 'cylinder'`. **Schody / widownia** (`steps` 2–60, domyślnie 6): stopnie rosną w głąb obiektu (lokalny +Y = strona najwyższa; wysokość obiektu to wysokość ostatniego stopnia), w 3D to N osobnych brył o tym samym id (obrót liczony wokół środka całego obiektu), na planie kreski stopni i strzałka w stronę najwyższego stopnia; obracanie (R) ustawia widownię w stronę sceny. **Walec:** szerokość i głębokość to średnice (różne = elipsa); w 3D podstawa to 28-kąt, na planie elipsa (`round` w prymitywie prostokąta; obsługiwana w Canvas, SVG i PDF). Gotowe wzory: widownia 8 × 5 m z 8 stopniami, schody 1,2 × 2 m, kolumna Ø 0,6 m, okrągły stół Ø 1,8 m.

**Ograniczenia (świadome):** brak klinów, ramp i brył o dowolnym kształcie (poza prostopadłościanem, schodami i walcem); schody mają równe stopnie, bez spocznika; brak wypukłości/otworów w sali (jeden obrys bez dziur); bryły sceniczne nie wchodzą do zestawień ani list kabli; kolizje brył (nakładanie) nie są wykrywane.


## ADR-056: Trasa kablowa „po bryle”

**Status:** przyjęta. **Kontekst:** po dodaniu schodów, podestów i kostek trasa musi dać się ułożyć na nich (kabel po widowni, po scenie), a nie tylko nad nimi.

1. **Wysokość powierzchni.** `src/surface.ts`: `topAt(boxes, x, y)` zwraca wysokość górnej powierzchni najwyższej bryły pod punktem (urządzenia, racki, szafy, obiekty sceniczne; stopnie schodów to osobne bryły, walec jest elipsą). Bryły pochodzą z `buildScene` (te same co w widoku 3D).
2. **Profil trasy.** `followSurface` prowadzi trasę od ostatniego punktu do nowego, próbkując odcinek co 25 mm; na krawędziach brył (wejście na stopień, zejście z kostki) wstawia pionowe odcinki (bisekcja krawędzi). Wysokość w polu „Wysokość” staje się najniższą wysokością trasy (`max(wysokość, powierzchnia)`).
3. **Interfejs.** Przycisk „Po bryle” w pasku rysowania trasy (domyślnie wyłączony, żeby trasy sufitowe nie wspinały się po wysokich bryłach). Wynik to zwykła trasa z punktami 3D, więc długości kabli, widok 3D i „Połącz trasy” działają bez zmian; kabel idący po stopniach jest dłuższy o piony.
4. **Ograniczenia:** trasa nie podąża za bryłą po jej późniejszym przesunięciu, bez wykrywania kolizji; przejście przez bryłę węższą niż 25 mm może zostać pominięte.

## ADR-057: Wiele pomieszczeń (sal) i układ budynku

**Status:** przyjęta. **Kontekst:** budynek ma kilka pomieszczeń (scena, foyer, garderoby) rysowanych na jednym podkładzie.

1. **Położenie sali.** `spaces[id].origin = [x, y]` (mm) to położenie lokalnego 0,0 sali we wspólnym układzie budynku; brak pola = 0,0. Współrzędne urządzeń, tras i obiektów pozostają lokalne dla sali, więc przesunięcie sali (`plan.setSpaceOrigin`) przenosi całą zawartość. Nowa sala bez wskazanego miejsca trafia na prawo od istniejących z odstępem 2 m (`nextFreeOrigin`); narysowana na planie dostaje `origin` względem sali aktywnej. Zmiana obrysu sali przesuwa jej `origin` razem z obrysem, więc zawartość zostaje w tym samym miejscu budynku.
2. **Aktywna sala.** Plan ma jedną aktywną salę (lista w pasku, klik w obrys innej sali, „+ Sala”); edycja, zaznaczanie, trasy i widok 3D dotyczą aktywnej sali. Kamera jest we współrzędnych aktywnej sali, a pozostałe sale rysują się z przesunięciem wynikającym z `origin` (`planDrawList` z `relativeTo`), z podpisem i przyciemnionym obrysem. „Cały budynek” pokazuje wszystkie sale i podkłady.
3. **Usuwanie.** `plan.removeSpace` kasuje salę, jej trasy, położenia oraz obiekty sceniczne z niej; urządzenia, racki i szafy zostają w projekcie bez położenia (w UI wymaga potwierdzenia).
4. **PDF.** Eksport planu dotyczy jednej sali (`planDrawList` z `spaceId`, jej własne współrzędne).
5. **Ograniczenia:** kable między salami nie są liczone z planu (jak dotąd: pomijane); brak automatycznego wykrywania nakładania się sal; widok 3D pokazuje jedną salę naraz.

## ADR-058: Podkład z pliku (PDF, SVG, DXF, obraz)

**Status:** przyjęta. **Kontekst:** salę trzeba narysować na rzucie budynku o znanej skali.

1. **Model.** Pole `underlays[und_*]` w `project.json`: `name`, `kind` (`pdf|svg|dxf|image`), `source` (nazwa pliku), `image` (data URL PNG/JPEG), `widthPx`, `heightPx`, `x`, `y` (lewy dolny róg w mm w układzie budynku), `mmPerPx`, `rotationDeg`, `opacity`, `invert`, `visible`, `locked`, `scaleKnown`. Obraz siedzi w `project.json` (limit 24 MB po zakodowaniu), więc format ZIP się nie zmienia; osobne pliki `assets/` w kontenerze zostają na później.
2. **Import (offline).** Wszystko zamieniane jest na raster przy imporcie (rozdzielczość 2048/4096/8192 px dłuższego boku): PDF przez pdf.js (wybór strony, lokalny worker, bez sieci), SVG przez `<img>` (pliki ze skryptami są odrzucane), DXF własnym parserem tekstowym (LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC; skala z `$INSUNITS`, więc podkład DXF jest od razu w skali 1:1), PNG/JPG/WebP. Dla PDF i SVG można podać skalę rysunku 1:N; inaczej skala jest nieznana (`scaleKnown: false`, ostrzeżenie na liście). **DWG nie jest obsługiwany** (format zamknięty): komunikat każe zapisać rysunek jako DXF lub PDF.
3. **Ustawianie.** „Wyskaluj (2 punkty)”: dwa kliknięcia i rzeczywista odległość; skala zmienia się wokół pierwszego punktu (`underlayCmd.scaleByPoints`). „Wyprostuj (2 punkty)”: odcinek ma stać się poziomy lub pionowy (`rotateAbout`). „Przesuń na planie” (przeciąganie), pola X/Y/obrót, przezroczystość, odwrócenie kolorów (domyślne dla rysunków czarnych na białym), widoczność i blokada.
4. **Rysowanie.** Podkład jest rysowany pod planem w układzie budynku; sala narysowana na nim („+ Sala” → „Rysuj na planie…”) dostaje `origin` zgodny z podkładem (ADR-057). Wszystkie zmiany są cofalne.
5. **Ograniczenia:** raster (przy dużym zbliżeniu rozmywa się; zwiększ rozdzielczość importu), DXF tylko tekstowy bez bloków (INSERT), tekstów, splajnów i kresków warstw; podkład nie jest drukowany w PDF planu i nie ma go w widoku 3D; jeden obraz na jeden import (wielostronicowy PDF = osobne importy stron).

## ADR-059: Przejścia kablowe między salami (FOH ↔ scena)

**Status:** przyjęta. **Kontekst:** wiele sal (ADR-057) służy m.in. do rozdzielenia fizycznie osobnych miejsc, jak w teatrze: reżyseria/FOH i sala widowiskowa lub scena. Kable między takimi salami idą korytarzem, multicorem albo kanałem, a nie prostą linią przez ścianę, więc potrzebny jest jawny element łączący sale.

1. **Model.** Pole `passages[pas_*] = { name, a: {spaceId, x, y, z}, b: {spaceId, x, y, z}, lengthMm? }` w `project.json` (schemat: `passages: idMap_any`). Końce są w lokalnych współrzędnych swoich sal (jak urządzenia i trasy), więc przesunięcie sali przenosi także przejście; zmiana obrysu sali przesuwa jej końce (`shiftPassagesOf`), usunięcie sali kasuje jej przejścia (`dropPassagesOf`). Dwa końce muszą leżeć w różnych, istniejących salach.
2. **Długość przejścia.** Bez `lengthMm`: odległość prostopadła między końcami we wspólnym układzie budynku plus różnica wysokości. `lengthMm` pozwala wpisać rzeczywistą długość (kręty korytarz, zapas multicore’a); pusta wartość wraca do wyliczenia z planu.
3. **Długość kabla.** Dla połączenia między salami: dojście w sali A (po trasach, jeśli oba punkty da się podpiąć, inaczej Manhattan) + przejście + dojście w sali B + zapas. Gdy między salami jest kilka przejść, wybierane jest to, które daje najkrótszy kabel (orientacja końców nie ma znaczenia). Końce przejść są dodatkowymi punktami podpięcia do tras w swoich salach. `estimateBasis` zapisuje `{method, routes?, passage}`. Połączenie między salami bez przejścia jest pomijane (`EstimateReport.otherSpace`), a okno „Długości kabli…” i okno „Przejścia…” ostrzegają o tym.
4. **Plan.** W widoku budynku przejście jest rysowane fioletową linią między końcami z podpisem (nazwa i długość); kabel między salami rysuje się jako dwa odcinki, każdy w swojej sali (`cablePaths` zwraca po jednym wpisie na salę). PDF jednej sali nie zawiera przejść.
5. **Interfejs.** Przycisk „Przejścia…” (grupa „Sala”): lista z nazwą, wysokością i długością oraz „+ Wskaż przejście na planie”: dwa kliknięcia w dwóch różnych salach (widok przełącza się na cały budynek). Po drugim kliknięciu okno otwiera się ponownie do nadania nazwy.
6. **Ograniczenia:** widok 3D pokazuje jedną salę, więc przejścia nie są w nim rysowane; przejście ma jedną wysokość na obu końcach; kable przez kilka sal po kolei (A → B → C) nie są łączone; brak automatycznego proponowania przejść.

## ADR-060: Układ pasków narzędzi

**Status:** przyjęta. **Kontekst:** po dodaniu sal, podkładów, brył i 3D pasek planu liczył 17 przycisków w nierównych, zawijających się rzędach obok menu.

1. **Grupy z podpisami.** Górny pasek ma grupy z małym podpisem: „Plik” (Nowy, Otwórz, Zapisz, Zapisz jako), „Tryb” (Plan sali, Rack, Szafa), „Dokumenty” (Lista kabli, Schemat PDF) oraz, tylko w planie, po prawej „Widok” (Dopasuj, Cały budynek, Widok 3D, Eksport PDF). Pasek planu pod nim ma grupy „Sala” (lista sal, Sala…, + Sala, Podkład…, Przejścia…), „Wstaw” (Rozmieść brakujące, Postaw rack/szafę, Obiekt…) i „Kable” (Pokaż kable, Rysuj trasę z polem wysokości, Długości kabli…).
2. **Układ.** Oba paski są pełnej szerokości, na stałym tle, i zawijają się grupami. Zmienna CSS `--top` (ustawiana w `editor.ts` na podstawie rzeczywistej wysokości pasków) wyznacza początek katalogu, paneli właściwości, rack/szafa/3D oraz margines kamery planu (`topInset`), więc nic się nie nakłada także po zawinięciu w wąskim oknie. Podpowiedź skrótów przeniesiono do prawego dolnego rogu.
3. **Zgodność.** Identyfikatory przycisków są bez zmian (testy i skrypty działają dalej); przyciski „Widok” planu pokazuje klasa `body.plan-on`.

## ADR-061: Uwagi z testów w oknie (sesja 2026-11-02/03)

Kontekst: pierwsze testy właściciela na prawdziwym projekcie (`projekt2.sw`) wykazały siedem problemów. Decyzje:

1. **Wydajność podkładu**: podkład rysowany z mipmap (połowa rozmiaru na poziom, liczone raz, osobno wersja z odwróconymi kolorami), poziom dobierany do bieżącego powiększenia, jakość wygładzania „medium”. Pomiar na podkładzie 8192 × 5120 px: klatka planu 361 ms → 16,7 ms (limit odświeżania). Skrypt: `bench/test-perf-underlay.mjs`.
2. **Rozmieszczanie na wybranej sali**: panel „Przeciągnij…” (`web/unplacedUi.ts`) z listą urządzeń, racków i szaf spoza planu; pozycję przeciąga się na plan aktywnej sali (zdarzenia wskaźnika, nie HTML5 drag&drop, bo ten bywa przechwytywany w oknie Tauri) albo zaznacza kilka i rozmieszcza w rzędach (`plan.placeMissing(sala, ids)`). Stary przycisk „Rozmieść brakujące” zostaje.
3. **Blokada położenia**: flaga `locked` na położeniu (`plan.setLocked`). Zablokowany obiekt nie da się przesunąć, obrócić, zdjąć z planu ani usunąć (komendy rzucają błąd, więc blokada działa też z pól we właściwościach); przeciągnięcie przesuwa wtedy tylko widok. Przycisk „Zablokuj / Odblokuj” dla wszystkich brył scenicznych sali oraz pole w panelach właściwości.
4. **Poziom podłogi sali**: `spaces[id].floorLevelMm` (względem pierwszej sali, może być ujemny), ustawiany w oknie sali. Wlicza się w długość przejść kablowych między salami (ADR-059). Wysokości w obrębie sali zostają lokalne.
5. **Nazwy plików eksportu**: `<projekt>-<rodzaj>[-<obiekt>].<rozszerzenie>` (`web/exportName.ts`): plan z nazwą sali, rack i szafa z nazwą obiektu, schemat, lista kabli (PDF i CSV).
6. **Grupy i porządek schematu**: `groups[grp_*] = { name, members[], color?, auto? }` (`src/groups.ts`); urządzenie w jednej grupie; ramka z nazwą pod kablami i urządzeniami (także w PDF schematu); „Grupy wg sal”; „Uporządkuj” układa od źródeł do odbiorników (kolumny wg najdłuższej ścieżki, kolejność wg sąsiadów), a każda grupa dostaje własny pas.
7. **Eksport planu**: każdy element sali dostaje numer (wg nazwy, naturalna kolejność); przy urządzeniu „n nazwa”, a gdy nazwa się nie mieści, sam numer w środku (żadne urządzenie nie zostaje bez oznaczenia). Druga i kolejne strony PDF: spis (nr, nazwa, rodzaj, producent i model, zamontowane w), także dla urządzeń schowanych w rackach i szafach.
8. **Pasek narzędzi (uzupełnienie ADR-060)**: rzadko używane rzeczy w menu ☰ (Nowy, Otwórz, Zapisz, Zapisz jako, Lista kabli, Schemat PDF, O programie); górny pasek: Tryb, Schemat (tylko schemat), Kable i Widok (tylko plan); drugi pasek planu: Sala i Wstaw. „O programie”: wersja z `package.json`, licencja, prywatność, składniki.

## ADR-062: Druga seria uwag z testów (2026-11-03)

1. **Zmiana rozmiaru okna**: schemat, plan, rack, szafa i 3D dopasowują płótna do okna po jego powiększeniu (wcześniej rozmiar był stały od startu; po rozwinięciu na pełny ekran rysunek kończył się w starym prostokącie).
2. **Kolory kabli wg rodzaju sygnału**: rodziny (SDI/IP, HDMI/DVI, DisplayPort, VGA, NDI, sieć/USB, audio, światło/sterowanie, zasilanie, światłowód, timecode/serial, inne) → kolor; krawędzie z uwagami walidacji nadal czerwone/żółte. Legenda na schemacie (ukryta w innych trybach).
3. **Eksport w kolorze (opcja)**: PDF planu (pole w oknie eksportu) i schematu; kolory ekranu przyciemniane pod biały papier, wypełnienia brył i ramek grup jako jasne odcienie; kable na planie wg sygnału. **Legenda kolorów kabli** w tabliczce planu i nad schematem. Rack, szafa i lista kabli zostają czarno-białe.
4. **Ustawienia** (menu ☰ → „Ustawienia…”, `web/settings.ts`): własne kolory kabli z przywracaniem domyślnych, domyślny kolor eksportów. Zapis lokalny (localStorage), poza plikiem projektu, bez sieci.
5. **Panel właściwości** ma maksymalną wysokość okna i przewijanie (panel bryły scenicznej, np. schodów, wychodził poza ekran); to samo dla panelu widoku 3D.
6. **Kolejność rysowania i klikania na planie** nie zależy od kolejności dodania: bryły sceniczne na spodzie, nad nimi racki i szafy, na wierzchu urządzenia (w obrębie rodzaju wg wysokości). Naprawia „zapadanie się” urządzeń pod bryły.

## ADR-063: Biblioteka: przeglądarka z filtrami, kreator urządzenia, pojedyncze urządzenia (2026-11-03)

1. **Przeglądarka biblioteki** (`web/libBrowser.ts`, skrót G albo „Przeglądaj i filtruj…” w panelu katalogu): wyszukiwarka tekstowa i filtry fasetowe z licznikami: kategoria, producent, wejścia, wyjścia (sygnały wg kierunku portów), wiarygodność danych, pakiet. W filtrze wartości łączą się przez LUB, między filtrami przez I; licznik wartości pokazuje, ile wyników dałby jej wybór przy pozostałych filtrach (`src/libraryIndex.ts`). Karta urządzenia: porty, wymiary, źródło danych; dwuklik albo „Dodaj do projektu”.
2. **Pojedyncze urządzenia bez mielenia bazy**: własne urządzenia trafiają do jednego małego pakietu „Moje urządzenia” (`src/deviceBuild.ts: mergeIntoMine`), zapisywanego samodzielnie; reszta biblioteki nie jest dotykana. Identyczne urządzenie jest pomijane, a przy konflikcie klucza użytkownik wybiera: zachowaj oba / podmień / pomiń. **Eksport jednego urządzenia** tworzy samowystarczalny plik (z potrzebnymi złączami i sygnałami, autorem i licencją), **„Importuj urządzenie z pliku…”** dopisuje wybrane urządzenia z pliku (jednego lub kilku) do Moich, z oceną nowe / już masz / inne niż u Ciebie. „Usuń z moich” zdejmuje urządzenie z biblioteki (projekty zachowują własne kopie definicji).
3. **Kreator urządzenia** (`web/deviceBuilder.ts`): „Nowe urządzenie…”, „Użyj jako wzoru…” (kopia istniejącego) i „Edytuj…” (własne). Gotowe zestawy portów („8 × XLR wejście”, numeracja ciągnie dalej), podgląd bloku na żywo, przesuwanie, powielanie i usuwanie portów, podpowiedzi walidatora w zwykłym języku, zapis do Moich albo „Zapisz i dodaj do projektu”. Dane źródła (rodzaj, dokument, adres, data sprawdzenia) są częścią kreatora; bez daty dane są niezweryfikowane (ADR-020).
4. Istniejące okno „Edytuj definicję…” (rewizje definicji w projekcie) zostaje bez zmian. Przycisk „Biblioteka urządzeń…” w panelu katalogu nazywa się teraz „Pakiety urządzeń…” (zarządzanie pakietami i aktualizacje).

## ADR-064: Topologia elektryczna, grzebienie i listwy (2026-11-03)

**Status:** przyjęta; zaimplementowane etapy E0–E5 (stan i różnice: ELECTRICAL-TOPOLOGY.md §9). Projekt w [ELECTRICAL-TOPOLOGY.md](ELECTRICAL-TOPOLOGY.md).

**Kontekst.** Pakiet aparatury modułowej pokazał, że model portów i połączeń punkt–punkt nie opisuje grzebieni, listew N/PE, złączek i bloków rozdzielczych (wiele zacisków o wspólnym potencjale, kilka niezależnych torów w jednym elemencie, styk zależny od stanu aparatu). Obudowa bez portów nie przechodzi walidacji pakietu. Problem dotyczy też instalacji scenicznych i sterowania, nie jednego producenta.

**Decyzja (rekomendacja).**
1. **Węzły elektryczne są wyliczane** (`electricalNets`, union-find) z połączeń, wewnętrznych połączeń definicji i styków geometrycznych. Nie są zapisywane (zasada Z10).
2. **Rozszerzenie `internalLinks`** o `bridge` (stały), `jumper` (konfigurowalny), `switched` (zależny od stanu, nigdy nie scala węzłów) i zapis grupowy `members`.
3. **Opcjonalny `terminal` w porcie**: tor (`track`), położenie (`at`, `side`), przewody (`wires`), rodzaj, zgodność (`fits`). Pojemność przewodów = istniejące `capacity`.
4. **Warstwa montażu `din.layer`** (`body`, `busbar`): zęby grzebienia styka się z zaciskami aparatów z położenia (wyliczane), więc przesunięcie aparatu przelicza węzły i walidację.
5. **Pakiet: `enclosures`** (szablony szaf) oraz `terminal`, `internalLinks`, `placementLayer`, `phaseOrder`. Starsze aplikacje pomijają nieznane pola z ostrzeżeniem.
6. **Montaż na płycie** `plate {cabinetId, x, y}` dla elementów bez DIN.
7. **Filtry widoczności**: osprzęt DIN domyślnie poza schematem blokowym (w nowych projektach), a w widoku szafy domyślnie tylko elementy DIN i zamontowane na płycie; zapis w `views.*.filters`.
8. **Walidacja V-040…V-051**: błędy tylko dla rzeczy jednoznacznych (zwarcie torów, pojemność), ostrzeżenia dla zgodności zależnej od danych producenta. Zgodność geometryczna nie oznacza dopuszczenia przez producenta.

**Alternatywy.** Zapisywana encja `nets` (odrzucona: niezmienniki do pilnowania, rozjazd po przesunięciu aparatu; możliwa później jako adnotacja); węzeł-pośrednik w `Connection` (odrzucone: zmienia wszystkie widoki); osobny silnik elektryczny (odrzucone: duplikuje model); spłaszczenie grzebienia 3P do jednego węzła (odrzucone: gubi tory); reguły zależne od producenta (odrzucone: mechanizm ma być uniwersalny).

**Konsekwencje.** Zmiany addytywne; stare projekty i pakiety działają bez zmian. Wymagane potwierdzenie round-trip nieznanych pól projektu (Z8) w pierwszym etapie. Poza zakresem MVP: symulacja stanów, obciążenia, selektywność, przekroje, zwarcia, cięcie grzebieni na miarę.

**Aktualizacja (2026-11-03): etap E0 zrobiony.** Ukrywanie realizuje ustawienie projektu `settings.hideMountedDin` (zamiast `views.*.filters`, bo wpływa też na układanie automatyczne, ramki grup, PDF schematu i dopasowanie widoku). Ukrywany jest osprzęt **zamontowany w szafie** (`din`); urządzenia niezamontowane zostają widoczne, żeby po dodaniu z katalogu na schemacie nie znikały. Połączenia ukrytego osprzętu nie są rysowane na schemacie (są w widoku szafy i zestawieniach); szafa pokazana jako blok działa jak dotąd. Nowy projekt ma ustawienie włączone, starszy dostaje ulepszenie `hide-mounted-din` w oknie „Aktualizacja projektu” (ADR-065). Filtr katalogu: w widoku szafy tylko osprzęt DIN, w widoku racka tylko urządzenia rackowe, z przełącznikiem „pokaż wszystko”.

## ADR-065: Wersjonowanie formatu, migracje i ulepszenia projektu do włączenia (2026-11-03)

**Status:** przyjęta (implementacja: `src/migrations.ts`, okno „Aktualizacja projektu” w menu ☰). Rozstrzyga Q-30.

**Kontekst.** Dziś nie ma użytkowników poza testami, ale po wydaniu nikt nie może usłyszeć, że żeby użyć funkcji z wersji 3.0, musi zbudować projekt z wersji 2.0 od nowa. Jednocześnie część nowych funkcji zmienia wygląd lub zachowanie istniejących danych (np. domyślne ukrywanie osprzętu DIN na schemacie, ADR-064), więc nie powinny włączać się po cichu w starych projektach.

**Decyzja.**
1. **Reguły wersjonowania** (komentarz w `src/migrations.ts`): zmiany w obrębie MAJOR są addytywne; nowa funkcja podnosi MINOR i dopisuje migrację (zwykle uzupełnienie wartości domyślnych); zmiana łamiąca podnosi MAJOR i **musi** mieć migrację ze wszystkich wcześniejszych wersji.
2. **Rejestr migracji** `MIGRATIONS`: czyste funkcje JSON → JSON, wołane łańcuchowo po `formatVersion` przy otwarciu pliku (`migrateProject`). Dopisuje się na końcu; istniejących nie zmienia się ani nie usuwa. Wynik otwarcia zawiera listę zastosowanych migracji; program informuje o tym po otwarciu, a poprzednia wersja pliku trafia do kopii zapasowej przy pierwszym zapisie (rotacja `.backups`).
3. **Plik z nowszą wersją drobną** otwiera się (`newerMinor`), a nieznane dane (w korzeniu projektu, w obiektach i w `ext`) **przeżywają zapis** (test). Plik z nowszym MAJOR pozostaje tylko do odczytu metadanych.
4. **Ulepszenia do włączenia** (`UPGRADES`): zmiany zachowania istniejących danych nie są migracjami formatu. Każde ma `id`, opis, warunek sensowności i polecenie (jedna transakcja, można cofnąć). Stan w `ext.upgrades {applied, dismissed}`. **Nowy projekt** ma wszystkie ulepszenia bieżącej wersji oznaczone jako zastosowane (rozstrzygnięcie Q-30: nowe zachowanie domyślnie tylko w projektach tworzonych od tej wersji); **starszy projekt** dostaje informację po otwarciu i decyduje w oknie „Aktualizacja projektu” (zastosuj / nie teraz).
5. **Korpus zgodności:** wszystkie pliki z `fixtures/` (także z formatu 0.x) muszą otwierać się w bieżącej wersji, przechodzić schemat i walidację oraz dawać identyczny wynik po zapisie i ponownym odczycie. Nowa wersja formatu dodaje do korpusu plik w swojej wersji.

**Alternatywy.** Brak migracji i prośba o odbudowę projektu (odrzucone: sprzeczne z zasadą „migracje zamiast resetu”); ciche stosowanie nowych zachowań po otwarciu (odrzucone: zmienia widok istniejącego projektu bez wiedzy użytkownika); jedna wielka funkcja „aktualizuj wszystko” (odrzucone: brak kontroli).

**Konsekwencje.** Każda przyszła zmiana formatu ma miejsce na migrację i test. Pierwsze realne ulepszenie (ukrywanie osprzętu DIN na schemacie) dopisze się do `UPGRADES` razem z etapem E0 (ADR-064). Rejestr `UPGRADES` jest dziś pusty, więc okno pokazuje „Projekt jest aktualny”.

## ADR-066: Interfejs: biblioteka komponentów React dla dialogów i paneli (pilotaż, 2026-11-03)

**Status:** pilotaż przyjęty; decyzja o migracji pozostałych okien po ocenie wyglądu w oknie Tauri.

**Kontekst.** ADR-016 i ADR-034 zakładały UI w React, ale kod rósł jako Canvas 2D plus dialogi składane przez `innerHTML` (inline `style=`), bez wspólnych komponentów. Okna wyglądają technicznie i niespójnie, a każdy nowy dialog powiela te same pomocnicze funkcje i ręczne odświeżanie widoku.

**Decyzja.**
1. React 19 (nie Preact) dla dialogów, paneli i kreatorów. Powód: docelowe narzędzia (Claude Design, skill design-sync) działają na prawdziwych komponentach React; rozmiar nie jest ograniczeniem.
2. Widoki na Canvas 2D (schemat, plan, rack, szafa, 3D) zostają bez zmian i bez frameworka.
3. Biblioteka `stagewire/ui/`: tokeny i style (`styles.css`, prefiks `.sw-`, paleta i zasady GreenCrew Tools) oraz komponenty z typowanymi `Props`: `Dialog`, `Button`, `Field`, `Input`, `Select`, `Checkbox`, `ChoiceCards`, `Chip`, `Panel`, `Notice`, `Row`, `Section`. Starsze okna i ich style działają bez zmian.
4. Pilotaż: kreator elementów elektrycznych (`web/electricalBuilder.tsx`) przepisany na komponenty; identyfikatory elementów zachowane, więc testy UI zostały te same (poza wyborem rodzaju: karty zamiast listy rozwijanej).
5. Migracja kolejnych okien jedna po drugiej, od przeglądarki biblioteki i kreatora urządzeń, z zachowaniem identyfikatorów i testów.

**Pomiary pilotażu.** Katalog `dist-web` 3,3 → 3,6 MB; instalator NSIS 4,71 → 4,79 MiB; otwarcie kreatora ok. 90 ms w przeglądarce testowej; 347 testów jednostkowych i wszystkie zestawy UI przechodzą (w tym CSP).

**Konsekwencje.** Okna zyskują jedno źródło wyglądu, spójne stany i dostępność (fokus, Esc, role ARIA). Do sprawdzenia w oknie Tauri przy ścisłej CSP: style ustawiane przez React (CSSOM). Docelowo `ui/` może stać się osobnym pakietem do synchronizacji z Claude Design.

**Aktualizacja (2026-11-03): migracja okien.** Na komponentach `ui/` działają teraz także przeglądarka biblioteki (`web/libBrowser.tsx`, z zapamiętywaniem filtrów między otwarciami) i kreator urządzenia (`web/deviceBuilder.tsx`). Identyfikatory elementów i testy UI (20 + 15 + 17 kontroli) zostały bez zmian; dodano ciemne paski przewijania i wiersz portu w siatce. Pozostałe okna starego typu: biblioteka pakietów, edycja definicji, ustawienia, grupy, raporty, O programie, okna szafy i racka.

**Aktualizacja (2026-11-03): wspólny design system.** Tokeny i komponenty wspólne dla GreenCrew Tools mają źródło w repozytorium `GreenCrew_Tools_Docs` (`tokens/`, `assets/fonts/`, `ui/` jako `@greencrew/ui`, zob. jego `development/UI_COMPONENTS.md`). StageWire trzyma wersjonowaną kopię w `stagewire/ui/greencrew/` (skrypt `scripts/sync-greencrew-ui.mjs`, plik `VERSION`) i nie powiela wartości: `ui/styles.css` aliasuje `--sw-*` na wspólne tokeny (poprawione m.in. kolor błędu `#FF5252`, Primary Light, Surface Variant, cel dotykowy 44 px). W `ui/` zostają komponenty specyficzne dla desktopowego edytora (okno z podglądem, karty wyboru rodzaju, lista filtrów, wiersz portu); prymitywy wspólne (przycisk, pole, checkbox, chip, karta) zostaną przeniesione na `GreenCrew*` razem z wariantem gęstym. Synchronizacja do Claude Design: zestaw StageWire jako `ui_kits/stagewire/` w istniejącym projekcie „GreenCrew Tools”, a nie osobny projekt.
