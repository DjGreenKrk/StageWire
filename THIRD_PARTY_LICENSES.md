# Składniki zewnętrzne

StageWire korzysta z poniższych składników. Każdy pozostaje na własnej licencji; pełne teksty licencji są dołączone do pakietów w `node_modules` i w crates Rust. Pełny, aktualny wykaz z zależnościami pośrednimi: `npm ls --all` w katalogu `stagewire/` oraz `cargo tree` w `stagewire/src-tauri/`.

## Dołączane do aplikacji

| Składnik | Wersja | Licencja | Zastosowanie |
|---|---|---|---|
| Roboto (`@fontsource/roboto`) | 5.3.0 | OFL-1.1 (czcionka Roboto: Apache-2.0) | czcionka interfejsu i PDF |
| pdf-lib | 1.17.1 | MIT | generowanie PDF |
| @pdf-lib/fontkit | 1.1.1 | MIT | osadzanie czcionek w PDF |
| pdf.js (`pdfjs-dist`) | 6.4.299 | Apache-2.0 | podkład z pliku PDF |
| Immer | 10.2.0 | MIT | stan i cofanie zmian |
| Ajv | 8.20.0 | MIT | walidacja projektów i pakietów |
| fflate | 0.8.3 | MIT | pakowanie plików projektu (ZIP) |
| rbush | 4.0.1 | MIT | indeks przestrzenny planu |
| @noble/hashes | 2.4.0 | MIT | sumy kontrolne |
| @tauri-apps/api, @tauri-apps/plugin-dialog | 2.x | MIT lub Apache-2.0 | most do powłoki Tauri |
| Tauri, tauri-plugin-dialog (Rust) | 2.x | MIT lub Apache-2.0 | powłoka aplikacji |
| serde, serde_json, sha2 (Rust) | 1.x, 0.10 | MIT lub Apache-2.0 | zapis i sumy kontrolne |

## Tylko do budowy i testów

TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), fast-check (MIT), Playwright Core (Apache-2.0), @tauri-apps/cli (MIT lub Apache-2.0), @types/node i @types/rbush (MIT).

## Dane

Opisy urządzeń w katalogu i w `stagewire/packs/` są własnymi opisami na podstawie dokumentacji producentów. Nazwy producentów i modeli są znakami ich właścicieli.
