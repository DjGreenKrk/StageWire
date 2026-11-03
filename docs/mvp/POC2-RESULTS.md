# POC2-RESULTS — PoC-2: renderer planu i diagramu

Status: wyniki z 2026-11-01 · kod: `stagewire/src/render/`, `stagewire/web/`, `stagewire/bench/` · przeglądarka: Microsoft Edge 156.0.4314.58 (silnik Chromium, ten sam co WebView2 w Tauri na Windows) · maszyna: laptop właściciela (i7-1260P, Intel UHD, Windows 11, viewport 1366×768, DPR 1)

Cel: sprawdzić, czy własny renderer Canvas 2D spełnia cele wydajności (ARCHITECTURE §8), porównać go z DOM+SVG (podejście DOM+SVG), zweryfikować dokładność skali eksportu i oszacować nakład pracy na silnik (ryzyko R2).

## 1. Co zbudowano

| Element | Plik | Linie |
|---|---|---|
| `DrawList` (prymitywy), budowa planu (mm) i diagramu, trasowanie ortogonalne, kotwice portów | `src/render/drawlist.ts` | 152 |
| Indeks przestrzenny (R-drzewo): okno, trafienia (obrócone prostokąty, linie, punkty), przesunięcia | `src/render/spatial.ts` | 63 |
| Eksport SVG planu w skali (1 jedn. = 1 mm na papierze) | `src/render/svgExport.ts` | 50 |
| Renderer Canvas 2D (R-drzewo, LOD, kamera, odwrócenie osi Y planu) | `web/canvasBackend.ts` | 72 |
| Renderer SVG: naiwny (wszystko w DOM, jak w narzędziach webowych) i z wirtualizacją | `web/svgBackend.ts` | 120 |
| Harness pomiarowy (kamera, klatki, scenariusze) i runner (Playwright + Edge, CPU throttling) | `web/main.ts`, `bench/run-browser.mjs` | 152 |
| Testy | `test/render.test.ts` | 117 |

**Nakład pracy:** ok. 740 linii (w tym ok. 430 linii kodu samego silnika renderowania i indeksu) na renderer dwóch widoków z kamerą, LOD, trafieniami, przeciąganiem, eksportem i harnessem. Silnik edytora w PoC-2 **nie** zawiera interakcji (zaznaczanie, tworzenie połączeń, edycja tekstu, undo w UI); pełny edytor to wielokrotność tego kodu. Wynik **nie potwierdza** budżetu całego edytora (R2), tylko to, że rdzeń renderowania jest mały i prosty.

## 2. Scenariusze pomiaru

Model syntetyczny „lokalny” (połączenia między sąsiadami, jak w prawdziwych schematach), 200 / 1000 / 2000 urządzeń, 2,5 połączenia na urządzenie.

- **Plan:** obrysy w mm (z rotacją), etykiety, nakładka kabli (trasa Manhattan). 901 / 4 501 / 9 001 prymitywów.
- **Diagram:** węzły z portami (po 8 wejść i 8 wyjść z etykietami), krawędzie ortogonalne. 4 100 / 20 500 / **41 000** prymitywów.
- **pan:** 4 s ciągłego przesuwania i zoomu od „całość” do 20× (kamera zmienia się co klatkę).
- **drag:** 4 s przeciągania 100 obiektów (przesunięcie co klatkę, z aktualizacją indeksu / atrybutów DOM).
- Mierzone: mediana klatek na sekundę (z odstępów `requestAnimationFrame`), p95 czasu klatki, średni czas JS renderowania.
- Rendery: **canvas** (Canvas 2D + R-drzewo + LOD), **svg-naive** (wszystkie elementy w DOM, kamera = `transform` na `<g>`), **svg-culled** (w DOM okno 1,6× widoku, przebudowa po wyjściu z okna).

## 3. Wyniki, CPU bez ograniczeń (laptop właściciela)

Mediana fps / p95 czasu klatki. 60 fps to sufit odświeżania ekranu.

| Widok, rozmiar | Scenariusz | canvas | svg-culled | svg-naive |
|---|---|---|---|---|
| plan 200 | pan | 60 / 17 ms | 60 / 17 ms | 60 / 17 ms |
| plan 1000 | pan | 60 / 17 ms | 60 / 17 ms | **30** / 50 ms |
| plan 2000 | pan | 60 / 17 ms | 60 / 34 ms | **15** / 117 ms |
| diagram 200 | pan | 60 / 17 ms | 60 / 17 ms | **30** / 67 ms |
| diagram 1000 | pan | 60 / 17 ms | 60 / 34 ms | **5** / 584 ms |
| diagram 2000 | pan | 60 / **33 ms** | 60 / 67 ms | **2,5** / 1033 ms |
| diagram 1000 / 2000 | drag | 60 / 17 ms | 60 / 17 ms | 30 / 67 ms · **15** / 400 ms |
| plan, dowolny | drag | 60 / 17 ms | 60 / 17 ms | 60 / 17 ms |

## 4. Wyniki, CPU spowolniony 4× (przybliżenie starszego sprzętu)

Spowolnienie CPU przez Chrome DevTools Protocol (`Emulation.setCPUThrottlingRate`). **Nie spowalnia GPU i rasteryzacji**, więc to przybliżenie, nie symulacja starego komputera. Mierzone tylko canvas i svg-culled (naiwny SVG był już nieużyteczny).

| Widok, rozmiar | Scenariusz | canvas | svg-culled |
|---|---|---|---|
| plan 1000 | pan | 60 / 33 ms | 60 / **133 ms** |
| plan 2000 | pan | 60 / 50 ms | **30** / 250 ms |
| diagram 1000 | pan | 60 / 34 ms | **20** / 433 ms |
| diagram 2000 (41 000 prym.) | pan | 60 / **60 ms** | **5,5** / 817 ms |
| diagram 1000 / 2000 | drag | 60 / 17 ms · 60 / 33 ms | 60 / 17 ms |
| plan 2000 | drag | 60 / 17 ms | 60 / 17 ms |

Dodatkowo: czas wczytania do renderera (`load`): canvas 17–65 ms (bez CPU throttle) i 90–317 ms (z 4×); SVG-culled 1–10 ms (leniwie), SVG-naive 10–132 ms.

## 5. Dokładność skali i trasowanie (testy jednostkowe)

| Kryterium z MVP-SCOPE / TS-07 | Wynik |
|---|---|
| Podest 8000×4000 mm w skali 1:100 = 80×40 mm w SVG | **spełnione** (dokładnie, tolerancja wymagana 0,5 mm) |
| Sala 20×15 m w skali 1:100 = 200×150 mm; papier A3 jako `420mm` | spełnione |
| Przesunięcie 1000 mm w świecie = 10 mm na papierze, oś Y odwrócona | spełnione |
| Wszystkie krawędzie diagramu są ortogonalne, także gdy cel jest „za” źródłem (obejście) | spełnione |
| Krawędź rysowana tylko gdy oba końce mają węzły w widoku (pochodna, brak wiszących krawędzi) | spełnione |
| Zmiana etykiety portu nie zmienia geometrii krawędzi (tożsamość po ID) | spełnione |
| R-drzewo: zapytanie o okno zwraca dokładnie prymitywy przecinające okno, w kolejności rysowania | spełnione |
| Trafienia (obrócony prostokąt, pusty obszar) i aktualizacja indeksu po przesunięciu | spełnione |

Łącznie 58 testów w repozytorium przechodzi, `tsc --noEmit` bez błędów. Hit-test: 2000 losowych trafień w R-drzewie w projekcie 2000 urządzeń mieści się w pojedynczych milisekundach (pole `hit2000Ms` w `bench/results/*.json`).

## 6. Wnioski

1. **Canvas 2D osiąga cele wydajności z zapasem** [FAKT dla tej maszyny]. Mediana 60 fps we wszystkich scenariuszach, także z 41 000 prymitywów (2000 urządzeń, 16 000 portów z etykietami) i z CPU spowolnionym 4×. Cel z MVP-SCOPE (≥ 60 fps do 1000 widocznych obiektów, ≥ 30 fps przy 5000) jest spełniony. Najgorszy p95 to 60 ms (największy diagram, CPU 4×), czyli sporadyczne gubienie klatek, nie ciągła zacinka.
2. **DOM+SVG w naiwnym wariancie załamuje się wcześnie.** Naiwny SVG: 30 fps już przy 1000 urządzeń na planie, 5 fps na diagramie 1000 urządzeń, 2,5 fps na diagramie 2000. To potwierdza hipotezę W-01 (DOM+SVG ma sufit wydajności), dotąd niezmierzoną w dostępnych materiałach. Pomiar dotyczy **naszej** implementacji, nie aplikacji inne narzędzia, którą nie badano pod tym kątem.
3. **SVG z wirtualizacją jest dobry przy samym przeciąganiu** (60 fps przy 100 przesuwanych obiektach, bo w DOM jest tylko okno), ale **zawodzi przy ciągłym panoramowaniu/zoomie** dużych diagramów (5,5 fps, p95 817 ms przy CPU 4×), bo przebudowa DOM okna jest kosztowna. Dalsze strojenie (większe okno, rzadsze przebudowy) poprawiłoby wynik, ale kosztem złożoności, której Canvas nie wymaga.
4. **Rekomendacja (ADR-017 potwierdzone):** Canvas 2D dla ekranu, SVG tylko jako format eksportu. Wirtualizowany SVG odrzucony jako renderer ekranowy.
5. **Cena Canvas:** brak darmowej dostępności i trafień z DOM. Trafienia są własne (R-drzewo, sprawdzone testami), dostępność wymaga panelu struktury (ARCHITECTURE §9). To koszt zaplanowany, nie niespodzianka.
6. **Koszt rdzenia renderowania jest mały** (ok. 430 linii kodu), co obniża ryzyko R2 dla samego rysowania. Ryzyko edytora jako całości (interakcje, tekst, kopiuj/wklej, gesty) pozostaje i wymaga osobnego pomiaru w M2/M4. React Flow (alternatywa dla diagramu w ADR-027) nie został zmierzony.

## 7. Ograniczenia pomiaru (czego PoC-2 nie dowodzi)

- **Jedna maszyna, jedna przeglądarka** (Edge/Chromium na Windows, szybki procesor, zintegrowane GPU). WebKitGTK na Linuxie (Tauri) **nie był mierzony**; to zadanie PoC-3 (WSL2 daje tylko orientacyjny obraz, bo nie odtwarza natywnej grafiki). Wynik nie dowodzi działania na starszym sprzęcie: spowolnienie CPU 4× nie spowalnia GPU ani rasteryzacji.
- **Brak pomiaru interakcji edytora** (tworzenie połączeń z podświetlaniem zgodnych portów, edycja tekstu w nakładce, zaznaczanie obszarem). PoC-2 mierzy renderowanie, kamerę, przeciąganie i trafienia.
- **Dane syntetyczne „lokalne”** (połączenia między sąsiadami). Przypadek najgorszy (losowe, bardzo długie krawędzie przez cały diagram) nie był mierzony w przeglądarce; zmniejsza skuteczność wirtualizacji i dotyczy wszystkich rendererów.
- **Nasz harness vs real app:** fps z `requestAnimationFrame` jest ograniczony do 60, więc nie pokazuje rezerwy powyżej 60. Średni czas JS renderowania w canvas to 0,4–13 ms, co jest lepszą miarą rezerwy.
- Okno przeglądarki było widoczne i na wierzchu podczas pomiaru (tryb z okienkiem, bez throttlingu w tle).
- DPR 1. Ekrany HiDPI (DPR 2) mają 4× więcej pikseli do rysowania; nie mierzono.

## 8. Następne kroki

1. **PoC-3** (powłoka): Tauri na Windows i Linuxie (WSL2), zapis atomowy i odzyskiwanie, PDF z polskimi znakami, pomiar tego samego renderera w WebKitGTK.
2. Powtórzenie pomiarów na DPR 2 i z długimi krawędziami (najgorszy przypadek).
3. Prototyp gestu połączenia (przeciągnięcie port → port z podświetleniem zgodnych) jako test kosztu interakcji i nakładu na silnik edytora (R2).
4. Zmiana statusu ADR-017 na „potwierdzone pomiarem PoC-2 (Chromium)”; ADR-027 (własny silnik) pozostaje z bramką na nakład interakcji.
