# Współpraca przy StageWire

Dziękujemy za zainteresowanie projektem. StageWire jest wczesną wersją roboczą, więc przed większą zmianą otwórz issue i opisz cel oraz sposób sprawdzenia. Błędy bezpieczeństwa zgłaszaj zgodnie z [SECURITY.md](SECURITY.md), bez publikowania danych w issue.

## Licencja wkładu

Projekt jest na licencji [PolyForm Shield 1.0.0](LICENSE). Wysyłając zmianę, potwierdzasz, że masz prawo ją przekazać i zgadzasz się, żeby właściciel praw (GreenCrew) udostępniał ją na warunkach tej licencji oraz, w razie potrzeby, na innych warunkach.

## Uruchomienie

Wymagane: Node.js 22. Rust i zależności Tauri tylko do budowy aplikacji.

```powershell
cd stagewire
npm ci
npm test
npm run typecheck
```

Zmiana interfejsu wymaga też przejścia odpowiednich testów `node bench/test-*-ui.mjs` (Microsoft Edge). Zmiana schematu projektu lub pakietu wymaga `npm run gen:validator`; test `validator-fresh` pilnuje aktualności.

## Zasady zmian

- Małe, logiczne zmiany. Bez wielkich refaktorów i bez nowych zależności bez uzasadnienia.
- Logika (model, obliczenia, eksporty, import) w `stagewire/src/`, bez zależności od UI i z testami jednostkowymi. Interfejs w `stagewire/web/`.
- Dane z plików (projekt, pakiet urządzeń, podkład) są niezaufane: waliduj przed zapisem.
- Zmiana formatu danych to migracja, nigdy reset. Nie usuwaj danych użytkownika.
- Offline first: żadnych wywołań sieciowych, telemetrii ani zewnętrznych zasobów (obowiązuje ścisłe CSP).
- Teksty interfejsu po polsku, zgodnie z [zasadami pisania GreenCrew Tools](https://github.com/DjGreenKrk/GreenCrew_Tools_Docs): konkretnie, bez marketingu, błąd mówi co się stało i co dalej. Wartości techniczne z jednostkami.
- Decyzje wpływające na architekturę lub format opisz jako nowy ADR w [docs/mvp/DECISIONS.md](docs/mvp/DECISIONS.md).
- Aktualizuj dokumentację i [CHANGELOG.md](CHANGELOG.md), gdy zmienia się zachowanie.
- Nie dodawaj `node_modules`, `target`, `dist-web`, plików instalatorów, własnych projektów `.sw` ani danych osobowych.

## Dane urządzeń

Dodając urządzenia do katalogu lub przykładowego pakietu:

- używaj własnych opisów na podstawie dokumentacji producenta, nie kopiuj cudzych baz,
- wskaż źródło danych (`source`) i jego wiarygodność,
- uruchom `npm run packs:validate`.

Szczegóły: [docs/mvp/DEVICE-DB.md](docs/mvp/DEVICE-DB.md).

## Pull requesty

Opisz zakres, sposób sprawdzenia (testy jednostkowe, interfejs, ręcznie w oknie Tauri) i znane ograniczenia. Odróżniaj to, co sprawdzono w przeglądarce, od tego, co sprawdzono w aplikacji.
