# POC3-RESULTS — PoC-3: powłoka Tauri, zapis atomowy, PDF, Windows i Linux

Status: wyniki z 2026-11-01 · kod: `stagewire/src-tauri/`, `stagewire/scripts/poc3-*.mjs`, `stagewire/src/render/pdfExport.ts` · maszyna: laptop właściciela (i7-1260P, 15,7 GB RAM, Intel UHD, Windows 11); Linux: **WSL2 z Ubuntu 24.04** (WSLg, GPU przez `/dev/dxg`), Rust 1.99.1, Tauri 2, WebView2 156 (Windows), WebKitGTK 2.52.6 (Linux)

Cel: potwierdzić powłokę Tauri 2 na Windows i Linuxie, zapis atomowy i odporność na awarię, eksport PDF z polskimi znakami oraz wydajność tego samego renderera w WebView2 i WebKitGTK (ryzyko R1, ADR-016).

## 1. Co zbudowano

| Element | Gdzie |
|---|---|
| Aplikacja Tauri 2 (okno, polecenia Rust, uprawnienia minimalne, CSP wyłączone tylko w PoC) | `src-tauri/` |
| Zapis atomowy: plik tymczasowy → `fsync` → weryfikacja SHA-256 po ponownym odczycie → kopia poprzedniej wersji (rotacja N) → zamiana z ponowieniami → `fsync` katalogu (POSIX) | `src-tauri/src/persist.rs` |
| Blokada doradcza (użytkownik, komputer, PID, czas) i skan odzyskiwania (osierocone pliki tymczasowe, kopie) | j.w. |
| Hak awarii (`--crash-at=`) do testów: przerwanie procesu w czterech punktach zapisu | j.w. |
| Wektorowy eksport PDF w skali z osadzonym Roboto (latin + latin-ext), działa w Node i w WebView | `src/render/pdfExport.ts` |
| Samotest w oknie aplikacji (benchmark renderera, PDF przez polecenie Rust) | `web/selftest.ts`, `scripts/poc3-app.mjs` |
| Testy odpornościowe zapisu (zabijanie procesu, awarie, równoległość, uprawnienia) | `scripts/poc3-persist.mjs` |
| Kontrola WebKitGTK (warianty zmiennych środowiskowych) | `scripts/poc3-linux-control.mjs` |
| Testy jednostkowe Rust (4) i PDF w Vitest (2) | `persist.rs`, `test/pdf.test.ts` |

Rozmiary i czasy budowy: Windows `stagewire.exe` **9,5 MB**, pierwsza budowa 6 min 21 s; Linux **12,2 MB**, pierwsza budowa 4 min 4 s, przyrostowa 2 min 14 s. Electron nie był budowany ani mierzony, więc porównania rozmiaru nie ma.

## 2. Zapis atomowy i odporność na awarię (część TS-04)

Wszystkie testy to uruchomienia prawdziwej binarki w trybie `--cli`; proces jest przerywany sygnałem (`SIGKILL`/`TerminateProcess`) lub `abort()` w wybranym punkcie.

| Test | Windows (NTFS) | Linux ext4 (WSL) | Linux DrvFS (`/mnt/c`) |
|---|---|---|---|
| Awaria w `mid_write`, `after_tmp_write`, `after_verify`, `before_rename`: plik docelowy nadal poprzednią wersją, osierocony plik tymczasowy wykrywalny przez skan odzyskiwania | OK (4/4) | OK (4/4) | OK (4/4) |
| Awaria po zamianie: plik == nowa, kompletna wersja | OK | OK | OK |
| Kopia zapasowa powstaje przed zamianą; najnowsza kopia == poprzednia wersja | OK | OK | OK |
| Zabicie procesu w losowych momentach zapisu 0,1–8 MB | **350** zabić (150 + 200), **0 uszkodzonych** | **200**, **0** | **60**, **0** |
| 20 par równoległych zapisów różnych wersji: wynik zawsze == jedna z nich | OK | OK | OK |
| Plik tylko do odczytu: kontrolowany błąd (`Odmowa dostępu`), plik nietknięty | OK | pominięty (patrz ograniczenia) | pominięty |
| Blokada doradcza: druga próba widzi poprzednią | OK | OK | OK |

Rozkład wyników zabijania (okno zabicia 0–250 ms): Windows 47 starych / 153 nowych zatwierdzonych; ext4 45 / 155; DrvFS (okno 0–4000 ms, wolniejszy zapis) 5 / 55. W obu stanach plik jest **kompletną** wersją: starą albo nową. Pierwszy bieg na Windows (okno 0–40 ms) zabijał niemal wszystko przed zapisem (148 starych / 2 nowe), dlatego powtórzyłem go z szerszym oknem; wynik 0 uszkodzonych nie zmienił się.

Testy jednostkowe Rust: 4/4 (zapis, rotacja kopii, blokada, tworzenie katalogu).

## 3. Wydajność renderera w powłoce

Canvas 2D (renderer z PoC-2), 4 s ciągłego przesuwania i zoomu, viewport 1366×768. Mediana fps / p95 czasu klatki.

| Scena (prymitywy) | Edge (PoC-2) | **Tauri/WebView2 (Windows)** | **Tauri/WebKitGTK, ustawienia domyślne (WSLg)** | **Tauri/WebKitGTK z obejściem (WSLg)** |
|---|---|---|---|---|
| plan 1000 (4 501) | 60 / 17 ms | 60 / 17 ms | **11,1** / 107 ms | 58,8 / 27 ms |
| plan 2000 (9 001) | 60 / 17 ms | 60 / 17 ms | **12,2** / 107 ms | 58,8 / 38 ms |
| diagram 1000 (20 500) | 60 / 17 ms | 60 / 17 ms | **12,5** / 96 ms | 58,8 / 33 ms |
| diagram 2000 (41 000) | 60 / 33 ms | 60 / 33 ms | **9,7** / 145 ms | 58,8 / 44 ms |

### 3.1 Kontrola przyczyny na Linuksie

Domyślne 10–12 fps pojawia się **także dla sceny z 20 urządzeniami** (11,9 fps), a czas JS wynosi 0,4 ms. Przyczyną nie jest więc nasz renderer, tylko ścieżka prezentacji klatek WebKitGTK w tym środowisku.

| Ustawienie WebKit/Mesa | plan 20 | plan 1000 | diagram 1000 |
|---|---|---|---|
| domyślne | 11,9 | 11,5 | 10,2 |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | **58,8** | **58,8** | **58,8** |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | 58,8 | 58,8 | 58,8 |
| obie powyższe | 58,8 | 58,8 | 58,8 |
| `LIBGL_ALWAYS_SOFTWARE=1` | 11,9 | 10,3 | 12,3 |
| `GDK_BACKEND=x11` | 30,3 | 27,8 | 26,3 |

**Obejście wdrożone w aplikacji:** `src-tauri/src/main.rs` ustawia `WEBKIT_DISABLE_DMABUF_RENDERER=1` na Linuxie przed utworzeniem okna, o ile użytkownik nie ustawił własnej wartości. Aplikacja zbudowana z obejściem osiąga wyniki z ostatniej kolumny tabeli bez żadnych ręcznych zmiennych.

## 4. Eksport PDF (TS-14, część TS-07)

| Kryterium | Windows | Linux |
|---|---|---|
| PDF wygenerowany wewnątrz aplikacji i zapisany atomowo przez polecenie Rust | 25 540 B, 286 ms | 25 540 B (identyczny rozmiar), 421–473 ms |
| Format A3 (420 × 297 mm), 1 strona | tak | tak |
| „Zażółć gęślą jaźń — StageWire” jako wyszukiwalny tekst (pdf.js) | tak | tak |
| Czcionka osadzona (Roboto, podzbiory), brak bitmap | tak (test Vitest) | ta sama ścieżka kodu |
| Znak spoza obu podzbiorów → „?” zamiast zepsucia pliku | tak (test) | — |

## 5. Ocena względem kryteriów PoC-3 (IMPLEMENTATION-PLAN §4)

| Kryterium | Wynik |
|---|---|
| TS-04 (zapis atomowy, odzyskiwanie) przechodzi na obu systemach | **Częściowo.** Zapis atomowy, kopie, blokada i wykrywanie osieroconych plików: tak, na obu systemach. **Nie zbudowano:** autozapisu do katalogu odzyskiwania i interfejsu odzyskiwania. **Nie przetestowano:** pełnego dysku, utraty zasilania, udziału sieciowego, uprawnień na Linuxie |
| TS-14 (PDF, polskie znaki) przechodzi na obu systemach | **Tak** dla PDF. CSV (BOM) przetestowany wcześniej w PoC-1; przełączanie PL/EN w UI nie należało do PoC-3 |
| fps na Linuxie ≥ 70% wyniku w Chromium **albo** decyzja o Electronie | **Spełnione z obejściem:** 58,8 / 59,9 = **98%**. Bez obejścia: 16–21% (niespełnione) |
| Rezultat do pokazania: instalatory / wersje przenośne | Pliki wykonywalne gotowe (`target/release/stagewire[.exe]`); **instalatorów (MSI/NSIS, deb, AppImage) nie budowano** |

## 6. Wnioski

1. **Tauri 2 przechodzi próbę na Windows bez zastrzeżeń** [FAKT]: ta sama wydajność co w Edge, mały plik wykonywalny (9,5 MB), polecenia Rust do zapisu atomowego działają.
2. **Ryzyko R1 (WebKitGTK) zmaterializowało się, ale dało się je zdiagnozować i obejść** [FAKT dla WSLg]. Domyślnie renderer WebKitGTK w WSLg dawał ok. 11 fps niezależnie od złożoności sceny. Jedna zmienna środowiskowa przywraca 58,8 fps. Samo ryzyko jest więc realne: zachowanie Linuxa **zależy od stosu graficznego**, a nie tylko od naszego kodu.
3. **Wyniku z WSL2 nie wolno uogólniać na natywny Linux** [OGRANICZENIE]. WSLg pokazuje okna przez warstwę Wayland/RDP i sterownik GPU przez `/dev/dxg`; natywny Linux z prawdziwym sterownikiem może zachować się inaczej (lepiej lub gorzej). Obejście DMA-BUF jest znane w społeczności Tauri/WebKitGTK jako zalecenie dla problemów ze sterownikami (**to moja wiedza ogólna, nie zmierzona tutaj**). Dlatego Electron pozostaje planem awaryjnym do czasu pomiaru na natywnym Linuxie.
4. **Zapis atomowy jest odporny** w testach, które da się wykonać na tym sprzęcie: 610 zabić procesu w losowych momentach na trzech systemach plików, 0 uszkodzonych plików. Gwarancje dotyczą **awarii procesu**, nie utraty zasilania (zależy od `fsync` i dysku).
5. **PDF wektorowy z polskimi znakami działa** i daje bajt w bajt ten sam rozmiar na obu systemach.

## 7. Ograniczenia

- **WSL2/WSLg, nie natywny Linux.** Jedyny sprzęt graficzny to Intel UHD widziany przez warstwę wirtualizacji.
- **Brak autozapisu i interfejsu odzyskiwania** w PoC-3 (jest skan i kopie).
- **Nie testowano:** pełnego dysku, odcięcia zasilania, udziałów sieciowych, interferencji antywirusa, uprawnień na Linuxie (test pominięty przez skrypt: nie udało mi się ustalić przyczyny pominięcia na ext4 poza tym, że środowisko nie zaprezentowało odmowy; wymaga osobnego sprawdzenia), HiDPI, innych dystrybucji i wersji WebKitGTK.
- **Instalatory i aktualizacje** nie były budowane.
- CSP wyłączone w konfiguracji PoC; w produkcie musi być ścisła (ARCHITECTURE §10).
- Na środowisku zainstalowano Rust (Windows i WSL) oraz pakiety systemowe Tauri w WSL; na prośbę właściciela zamknięto Chrome i Mailbird na czas budowy.

## 8. Zmiany środowiska na maszynie właściciela (do wiadomości)

- Rust 1.99.1 (`rustup`, profil minimalny, tylko użytkownik) w Windows i w WSL; usunięcie: `rustup self uninstall`.
- WSL Ubuntu 24.04: pakiety `build-essential`, `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libssl-dev`, `libxdo-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `nodejs` (18), `rsync` oraz katalog `~/stagewire-linux`.

## 9. Decyzje i następne kroki

1. **ADR-016: potwierdzone warunkowo.** Tauri 2 pozostaje wyborem; Electron jako plan awaryjny do czasu pomiaru na natywnym Linuxie (ADR-036).
2. **Pomiar na natywnym Linuxie** (drugi komputer lub live USB): domyślne zachowanie WebKitGTK z obejściem i bez, na sterowniku Intel/AMD/NVIDIA. Potrzebny sprzęt właściciela (Q-09).
3. **Autozapis i odzyskiwanie** (M1): katalog odzyskiwania w danych aplikacji, wykrywanie przy starcie, interfejs; test utraty zasilania na sprzęcie, który to umożliwia.
4. **Instalatory** (M7): MSI/NSIS, deb/AppImage/Flatpak i politykę aktualizacji bez telemetrii (B-10).
5. **Ścisłe CSP** i przegląd uprawnień Tauri przed pierwszym wydaniem.
6. Prototyp gestu „port → port” (nakład interakcji edytora, ryzyko R2) może teraz iść w tej samej aplikacji.
