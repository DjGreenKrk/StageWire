# OPEN-QUESTIONS — problemy wymagające decyzji lub dalszych badań

Status: wersja 0.1 do audytu · 2026-10-31

Typ: **D** = decyzja właściciela projektu, **B** = badanie/ustalenie faktów. „Blokuje" wskazuje najwcześniejszy etap, który nie może ruszyć bez odpowiedzi. Rekomendacja to moja propozycja domyślna, nie rozstrzygnięcie.

## 1. Decyzje właściciela projektu

| ID | Pytanie | Typ | Blokuje | Rekomendacja |
|---|---|---|---|---|
| **Q-01** | Nazwa produktu. „Stagewire" jest placeholderem; wymaga sprawdzenia kolizji znaków towarowych, domen i nazw pakietów oraz rozszerzenia pliku | D/B | PoC-1 (nazwa robocza wystarczy) | Zachować nazwę roboczą do wydania publicznego |
| **Q-02** | Priorytet person: P1 (freelancer eventowy) vs P2 (integrator/instalator) | D | zatwierdzenie zakresu MVP | P1 jako główna; model wystarcza dla P2 |
| **Q-03** | Licencja kodu (ADR-019): MPL-2.0 / Apache-2.0 / GPL / AGPL | D | PoC-1 (robocza), wydanie (ostateczna) | MPL-2.0; spec i schematy Apache-2.0/CC0 |
| **Q-04** | Licencja danych bibliotek i zasady wkładu (CC0/CC-BY; DCO vs CLA) | D | M3 | CC0 + DCO |
| **Q-05** | Czy akceptujemy plan T1 z bramką PoC-3 i możliwością zmiany na Electron (ADR-016)? | D | PoC-3 | Tak |
| **Q-06** | Języki UI w MVP | D | M1 | PL + EN |
| **Q-07** | Polityka źródeł danych biblioteki: kto tworzy i weryfikuje definicje, czy wolno korzystać z oficjalnych kart katalogowych producentów, jak postępować z prawami do baz danych; potrzebna konsultacja prawna | D/B | M3 | Generyki + dane z kart katalogowych z zapisem źródła; brak kopiowania cudzych baz |
| **Q-08** | Skład zespołu i dostępność czasowa (determinuje harmonogram; szacunki w planie to 1 osoba pełny etat) | D | Etap 0 | Ustalić przed PoC-1 |
| **Q-09** | Maszyna referencyjna i platformy docelowe. Propozycja po audycie: Windows 10 22H2/11 (WebView2); Ubuntu 22.04/24.04 LTS (`webkit2gtk-4.1`); laptop ~2016, 8 GB RAM, iGPU Intel. Potrzebny konkretny sprzęt testowy właściciela | D | PoC-2 | Zatwierdzić listę lub podać własną |
| **Q-10** | Czy funkcje [S] są „obowiązkowe" czy „jeśli starczy czasu"? **Czy zatwierdzić awans F-15a (podkład PNG/JPG z kalibracją) do [M]** (propozycja audytu P1-04)? Kolejność ważności pozostałych: F-16, F-14, F-15b | D | M2 | F-15a do [M]; reszta wg wywiadów (B1) |
| **Q-11** | Czy MVP ma obejmować jednostki imperialne (stopy/cale) i szablony arkuszy ANSI | D | M2 | Nie w MVP (mm + A-formaty) |

## 2. Pytania modelu danych (do rozstrzygnięcia w PoC-1)

| ID | Pytanie | Typ | Blokuje | Rekomendacja |
|---|---|---|---|---|
| **Q-12** | ~~Mapy czy tablice~~ **Rozstrzygnięte warunkowo: mapy `Record<ID,T>`** na dysku i w pamięci (wyjątki tablicowe wymienione w DOMAIN-MODEL §5.1); weryfikacja pomiarem w PoC-1 | D | PoC-1 | ADR-014 |
| **Q-13** | ~~Gender i końce kabla~~ **Rozstrzygnięte propozycją (ADR-029):** `endPairs` w MVP, `gender` rezerwą; do potwierdzenia po wycenie danych kabli w M3 | D | M3 | ADR-029 |
| **Q-14** | Granularność rewizji definicji: kiedy zmiana jest „kosmetyczna" a kiedy nowa rewizja; czy w MVP wystarczy fork bez rewizji (F-19 opcjonalne)? | D/B | PoC-1 | Rewizje; plan awaryjny fork-only |
| **Q-15** | ~~Połączenia bez kabla~~ **Rozstrzygnięte propozycją (ADR-006):** `Connection.medium`; wireless/virtual w patchliście, nie w liście brakujących kabli | D | M4 | ADR-006 |
| **Q-16** | Czy stan „spakowane" (packlista) ma być częścią pliku projektu czy osobnym plikiem stanu | D | M6 | W pliku projektu (`packing`) |
| **Q-17** | Sposób reprezentacji kratownic i podestów wielopoziomowych (wysokość podłoża dla obiektów stojących na scenie): czy `z` ustawiane ręcznie, czy podpowiadane z obiektu pod spodem | D/B | M2 | Podpowiedź, nie automat |
| **Q-18** | Jak traktować sieć IT: czy w MVP wystarczą `attrs` tekstowe (IP, VLAN, kanał), czy potrzebna jest encja urządzenia sieciowego z tablicą portów i VLAN-ami | D/B | M5 | `attrs` tekstowe (F-21) |

## 3. Luki badawcze i badania do wykonania

Numeracja `B-xx` tutaj grupuje luki `B1…B10` z wewnętrzne materiały badawcze w działania: B-01 = B1; B-02 = B2; B-03 i B-09 = B3, B7; B-04 = B4; B-06 = B5, B6; B-07 = B10; B-08 = B8; B-11 = B9. B-05 i B-10 dotyczą platformy i dystrybucji i nie mają odpowiednika w syntezie.

| ID | Temat | Typ | Blokuje | Działanie |
|---|---|---|---|---|
| **B-01** | **Badania użytkowników**: wywiady z 3–5 technikami/realizatorami, obserwacja obecnego procesu (Excel, rysunki, packlisty), weryfikacja person, priorytetów i hipotez UX (U1–U6) | B | zakres MVP | Etap 0 |
| **B-02** | **Plan sali / Spotlight**: wymiarowanie, symbole, kratownice, arkusze, tabliczka — istniejące narzędzia CAD tego nie obejmują | B | M2 (szczegóły) | Krótka analiza (w granicach prawnych) lub konsultacja z użytkownikiem Spotlight |
| **B-03** | Format patchlisty i konwencje dokumentacji w praktyce (5–10 prawdziwych dokumentów, rider, stage plot, patchlisty) | B | M6 | Etap 0 |
| **B-04** | Własne pomiary wydajności: DOM+SVG vs Canvas, rozmiar i czas ładowania JSON | B | M1/M2 | PoC-1, PoC-2 |
| **B-05** | Zachowanie Tauri/WebKitGTK na starszych Linuxach i sterownikach | B | M1 | PoC-3 |
| **B-06** | Uzupełnienie przeglądu istniejących narzędzi: raporty, etykiety, multicore, trasa cross-rack | B | nie blokuje | Opcjonalnie, jeśli właściciel zechce |
| **B-07** | Zasilanie i rigging: zakres potrzeb, normy, wzorce (poza obiema analizami) | B | v1.0 | Osobna analiza |
| **B-08** | Inne narzędzia jako wzorce (nieanalizowane w materiale): np. mechanizm ERC w KiCadzie jako model walidacji (macierz typów pinów), narzędzia AV do projektowania systemów | B | nie blokuje | Przegląd literatury i dokumentacji publicznej **[HIPOTEZA: warto]** |
| **B-09** | Standardy znakowania kabli, symbole graficzne, formaty dokumentacji w branży | B | M6 | Wraz z B-03 |
| **B-10** | Dostępność kanałów dystrybucji na Linuxie (AppImage/deb/rpm/Flatpak) i polityka aktualizacji bez telemetrii | B | M7 | Przed wydaniem |
| **B-11** | Prawne: status praw do danych parametrów sprzętu (karty katalogowe), znaków towarowych w nazwach urządzeń, rozpoznawalność nazwy produktu | B | M3, wydanie | Konsultacja prawna |

## 4. Ryzyka wymagające decyzji w czasie

| ID | Ryzyko | Decyzja do podjęcia | Kiedy |
|---|---|---|---|
| **RK-01** | Własny silnik edytora zbyt kosztowny | Wejść w React Flow dla diagramu / zawęzić funkcje | Po PoC-2 |
| **RK-02** | Linux/WebKitGTK niewydolny | Electron | Po PoC-3 |
| **RK-03** | Biblioteka startowa nieosiągalna w zakładanym zakresie | Zmniejszyć zakres do generyków / otworzyć dla wkładu społeczności | W M3 |
| **RK-04** | Pliki osób trzecich w repozytorium | Wykluczyć z publikacji (ADR-020) | Przed pierwszą publikacją repo |
| **RK-05** | Cele wydajności niedostępne | Zmienić wymagania lub technologię | Bramka PoC |

## 5. Co przyjęto bez pytania właściciela (ostrożne wartości domyślne)

Poniższe założenia są w dokumentach i mogą zostać odwrócone na wniosek właściciela:

- Plik projektu: ZIP + JSON, rozszerzenie robocze `.stagewire`.
- Jednostki: milimetry.
- Układ portów: wejścia lewo, wyjścia prawo.
- Brak telemetrii; brak aktualizacji sieciowych w MVP.
- Cel „≤ 60 min" dla scenariusza referencyjnego jest hipotezą do kalibracji.

## 6. Nowe pytania po audycie z 2026-10-31

| ID | Pytanie | Typ | Blokuje | Rekomendacja |
|---|---|---|---|---|
| **Q-19** | Czy zatwierdzamy profil Core MVP (TS-01 bez [S]) jako definicję „skończone"? | D | zatwierdzenie zakresu | Tak |
| **Q-20** | Czy mini-test oświetleniowy TS-15 wystarcza, czy właściciel chce jakąkolwiek funkcję oświetleniową w MVP? | D | M3 | Tylko test modelu |
| **Q-21** | Skąd pozyskać dane `endPairs` kabli i czy ograniczyć je do kabli scenariusza referencyjnego | D/B | M3 | Ograniczyć do scenariusza |
| **Q-22** | Struktura repozytoriów: prywatne na materiały badawcze, publiczne od czystej historii | D | pierwsza publikacja | Tak (ADR-020) |

## 7. Decyzje właściciela z 2026-11-01

| ID | Decyzja | Skutek |
|---|---|---|
| **Q-01** | Nazwa **StageWire** zostaje (w rodzinie GreenCrew Tools; zapis „StageWire" z dużym W). Identyfikator pakietu zgodnie z wzorcem rodziny: `pl.greencrew.tools.stagewire` | Rozszerzenie pliku i nazwy pakietów do potwierdzenia po sprawdzeniu kolizji (nie blokuje) |
| **Q-03** | Licencja początkowa: **PolyForm Shield 1.0.0** z jawnym wykazem licencji użytych pakietów; ewentualne otwarcie licencji później | **To licencja source-available, nie open source w rozumieniu OSI.** Zmienia zapis „open source" w PRODUCT-VISION i ADR-019; zob. ADR-032 i pytania Q-23, Q-24 |
| **Q-09** | Maszyna referencyjna: laptop właściciela (Intel i7-1260P, 12 rdz./16 wątków, 15,7 GB RAM, Intel UHD, Windows 11, WebView2 156). Linux: **WSL2** jako pierwsza referencja | Pomiary na tej maszynie nie dowodzą wydajności na starszym sprzęcie; próg „starszy sprzęt" mierzymy spowolnieniem CPU/ograniczeniem zasobów. WSL2 (WSLg) nie odzwierciedla natywnej ścieżki grafiki Linuxa, więc wyniki Linux są orientacyjne |

## 8. Nowe pytania po zapoznaniu się z repozytorium GreenCrew_Tools_Docs

| ID | Pytanie | Typ | Blokuje | Rekomendacja |
|---|---|---|---|---|
| **Q-23** | **Stos technologiczny a standardy rodziny GreenCrew Tools.** Wspólne standardy zakładają Flutter/Dart (Android jako platforma referencyjna, Windows/Web dalej), dark mode, Roboto, wspólne komponenty `GreenCrew*`, lokalną bazę (Drift/Isar/SQLite). ADR-016 (TypeScript + React + Canvas + Tauri) jest odstępstwem. Czy StageWire (a) przyjmuje Flutter Desktop (Windows/Linux) i port rdzenia na Dart, czy (b) zostaje przy TS/Tauri jako udokumentowany wyjątek produktowy? | D | PoC-2 | Rozstrzygnąć przed PoC-2 (renderer zależy od stosu); zob. ADR-033 |
| **Q-24** | Skoro licencja ma być możliwa do późniejszego otwarcia: czy wkłady zewnętrzne wymagają CLA (a nie DCO), czy na razie bez wkładu zewnętrznego? | D | pierwszy zewnętrzny wkład | CLA lub brak wkładów, do czasu decyzji o licencji |
| **Q-25** | **Doprecyzowane 2026-11-01:** CableListTool = inwentaryzacja istniejącej instalacji (stan faktyczny); StageCalc = predykcja obciążeń elektrycznych i konstrukcji scenicznych. Produkty są komplementarne, nie dublują się. Synchronizacja możliwa później (ADR-035). Zasilanie i rigging pozostają w zakresie StageWire (właściciel, 2026-11-01). Do ustalenia: podział z StageCalc (własny moduł, współdzielone dane, synchronizacja) oraz wspólny format wymiany (identyfikatory urządzeń, kable, moc/masa) i kiedy | D/B | po MVP | Rozłączne w MVP; format wymiany projektować z dwiema rodzinami aplikacji przed v1.0 |
| **Q-26** | Platforma referencyjna rodziny to telefon; plan sali i schemat są z natury desktopowe. Zapisać StageWire jako jawny wyjątek (desktop/laptop jako platforma główna, telefon tylko podgląd/raporty)? | D | zakres MVP | Tak, jako wyjątek produktowy w `BRANDING.md` produktu |

## 9. Rozstrzygnięcia z 2026-11-01 (wieczór)

| ID | Rozstrzygnięcie |
|---|---|
| **Q-23** | **Zamknięte:** TypeScript + React zostaje jako wyjątek produktowy; porównanie z Flutter w ARCHITECTURE, Dodatek A; ADR-034. PoC-2 można planować w stosie TS |
| **Q-26** | **Zamknięte:** laptop platformą główną, telefon dodatkową (podgląd i raporty), ADR-034 |
| **Q-24, Q-25** | Nadal otwarte (CLA a relicencjonowanie; relacja do CableListTool i StageCalc) |

## 10. Po PoC-3 (2026-11-01)

| ID | Stan |
|---|---|
| **Q-05** | Potwierdzone warunkowo (ADR-016, ADR-036): Tauri 2, Electron jako plan awaryjny do pomiaru na natywnym Linuxie |
| **Q-09** | Windows 11 na laptopie właściciela: użyty. Linux: WSL2/WSLg użyty jako pierwsza referencja. **Brakuje natywnego Linuxa** (drugi komputer lub live USB) do weryfikacji stosu graficznego |
| **Q-27 (nowe)** | Czy właściciel ma drugi komputer lub może uruchomić Ubuntu z pendrive'a do pomiaru na natywnym Linuxie? Najlepiej sprzęt starszy lub z innym GPU niż Intel UHD |

## 11. Po PoC-3b (gest „port → port", 2026-11-01)

| ID | Stan |
|---|---|
| **R2 (ryzyko)** | Obniżone dla samego gestu (ADR-037). Pozostaje koszt przebudowy listy rysowania przy dużych projektach (M3: aktualizacja przyrostowa) |
| **Q-28 (nowe)** | Czy przesuwanie węzłów na diagramie ma być w historii cofania (dane widoku, obecnie poza `Store`)? Rekomendacja: tak, jako osobna transakcja widoku z łączeniem kolejnych ruchów w jeden wpis |
| **Q-29 (nowe)** | Czy niezgodne połączenie (kierunek, sygnał, zajęty port) ma powstawać po prostu z uwagą (obecny prototyp), czy po dodatkowym potwierdzeniu? Rekomendacja: z uwagą, bez potwierdzenia; sprawdzić w badaniu z użytkownikami |

**Rozstrzygnięcie właściciela (2026-11-01):** Q-28 i Q-29 zgodnie z rekomendacją: przesuwanie węzłów wchodzi do historii cofania (osobna transakcja widoku, ruchy łączone w jeden wpis); niezgodne połączenie powstaje z uwagą, bez potwierdzenia. Implementacja cofania układu: M3.
