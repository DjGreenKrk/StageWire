# BRANDING — StageWire

Produkt rodziny **GreenCrew Tools**. Zasady wspólne (marka, design system, ikonografia, zasady pisania, architektura) znajdują się w repozytorium
https://github.com/DjGreenKrk/GreenCrew_Tools_Docs i **nie są tu kopiowane**. Ten plik zapisuje tylko cechy produktu i odstępstwa.

## Produkt

- Nazwa: **StageWire** (rodzina: GreenCrew Tools). Identyfikator pakietu: `pl.greencrew.tools.stagewire`.
- Opis: narzędzie do projektowania technicznego wydarzeń: plan sali w skali, urządzenia z portami, schematy połączeń, kable, racki i dokumentacja.
- Przesłanie: projekt techniczny wydarzenia od planu sali do patchlisty.
- Repozytorium: <https://github.com/DjGreenKrk/StageWire> · Strona: https://greencrew.pl
- Autor: Julian Szymański · Organizacja: GreenCrew · © Julian Szymański / GreenCrew.
- Licencja: PolyForm Shield 1.0.0 (source-available), wykaz składników zewnętrznych w [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), omówienie w [LICENSING.md](LICENSING.md). Zob. [docs/mvp/DECISIONS.md](docs/mvp/DECISIONS.md), ADR-032.

## Odstępstwa od standardów rodziny (ADR-034)

| Obszar | Standard rodziny | StageWire | Powód |
|---|---|---|---|
| Technologia | Flutter/Dart | TypeScript, React, Tauri | Decyzja właściciela; rdzeń niezależny od UI, testowalny w Node; porównanie w `docs/mvp/ARCHITECTURE.md`, Dodatek A |
| Platforma referencyjna | telefon | **laptop (Windows, Linux)**; telefon dodatkowo: podgląd i raporty | Edycja planu sali i schematów wymaga dużego ekranu i klawiatury |
| Układ | jedna kolumna na telefonie | edytor + panel właściwości + panel problemów na desktopie; na telefonie tylko widoki odczytu | j.w. |

## Zgodne z rodziną

Dark mode domyślnie; paleta GreenCrew (`#00C853` akcent, tło `#000000`, powierzchnie `#121212`/`#1E1E1E`); Roboto dołączony jako zasób; ikony Material; obszar dotyku ≥ 44 px; komunikaty „co się stało, co zostało"; offline first; eksport PDF/CSV/JSON; migracje danych zamiast resetu; ekran „O aplikacji".

## Logo i ikona

Logo: `docs/media/StageWire_logo.svg` i `.png` (wersjonowana kopia). Ikona aplikacji w `stagewire/src-tauri/icons` jest tymczasowa i wymaga wygenerowania z logo (`npx tauri icon`).
