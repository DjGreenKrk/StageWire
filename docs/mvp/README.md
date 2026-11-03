# Dokumentacja MVP — narzędzie do projektowania technicznego wydarzeń (nazwa robocza: Stagewire)

Status: **wersja 0.1, gotowa do audytu** · 2026-10-31 · język: polski (nazwy techniczne po angielsku)

Darmowe, dostępne w kodzie źródłowym (PolyForm Shield), działające offline narzędzie do projektowania technicznego wydarzeń: plan sali w skali, urządzenia z rzeczywistymi portami, schematy połączeń, kable, racki i automatyczna dokumentacja. To **program do projektowania, nie wizualizator**. Dokumentacja powstała z przeglądu istniejących narzędzi do projektowania systemów AV. Kod aplikacji jest w katalogu `stagewire/`; stan prac: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

## Skrót projektu w 10 zdaniach

1. Rdzeniem jest **graf portów**: urządzenia mają porty o stabilnych ID, połączenia łączą porty, kable są osobnymi obiektami.
2. Jest **jeden model** i wiele widoków: plan sali (B), schemat (C), fizyczny (D); dokumentacja (E) jest wyliczana.
3. Położenie w przestrzeni (X/Y/Z, obrót) jest osobną, opcjonalną encją; 3D nie jest wymagane.
4. Urządzenie techniczne, obiekt sceny i element rysunkowy to trzy różne klasy.
5. Walidacja jest **nieblokująca**, wyliczana i wyjaśniająca; integralność strukturalna jest **twarda**.
6. Zmiana nazwy nie zrywa połączeń; usunięcie ma jedną, przewidywalną regułę (kaskada z potwierdzeniem i cofaniem).
7. Definicje urządzeń mają rewizje i są osadzone w projekcie; projekt to jeden przenośny plik.
8. MVP = jeden scenariusz referencyjny (konferencja 20 × 15 m) od pustego projektu do kompletu dokumentów.
9. Rekomendowany stos: **rdzeń TypeScript + UI React + własny Canvas 2D + Tauri 2**, z bramką PoC (awaryjnie Electron).
10. Realizacja: Etap 0 (decyzje) → trzy PoC → M1…M7 → wersja 1.0.

## Dokumenty

| # | Plik | Zawartość |
|---|---|---|
| 2 | [PRODUCT-VISION.md](PRODUCT-VISION.md) | Wizja, użytkownicy, zasady, granice, wskaźniki |
| 3 | [MVP-SCOPE.md](MVP-SCOPE.md) | Zakres MVP, funkcje F-01…F-24, kryteria akceptacji, scenariusze testowe TS-01…TS-15, profil Core MVP |
| 4 | [DOMAIN-MODEL.md](DOMAIN-MODEL.md) | Model danych, diagramy Mermaid, reguły integralności, katalog walidacji, przykładowy projekt |
| 5 | [ARCHITECTURE.md](ARCHITECTURE.md) | Porównanie technologii, rekomendowana architektura, format pliku, ryzyka |
| 6 | [UX-WORKFLOWS.md](UX-WORKFLOWS.md) | Struktura aplikacji, edytory, skróty, przepływy pracy |
| 7 | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | Etap 0, PoC-1…3, M1…M7, wersja 1.0, audyt spójności |
| 8 | [DECISIONS.md](DECISIONS.md) | Rejestr decyzji ADR-001…ADR-031 |
| 9 | [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) | Decyzje właściciela Q-01…Q-22, badania B-01…B-11 |
| — | [GreenCrew_Tools_Docs](https://github.com/DjGreenKrk/GreenCrew_Tools_Docs) | Zewnętrzne, kanoniczne standardy rodziny (branding, design system, architektura); nie kopiować (RIGHTS.md); zob. ADR-033 |
| — | [POC3-RESULTS.md](POC3-RESULTS.md) | Wyniki PoC-3 (Tauri na Windows i Linuxie, zapis atomowy, PDF): Tauri potwierdzony warunkowo |
| — | [POC3B-RESULTS.md](POC3B-RESULTS.md) | Wyniki prototypu gestu „port → port" (koszt interakcji edytora, ryzyko R2) |
| — | [DEVICE-DB.md](DEVICE-DB.md) | Jak tworzyć bazę urządzeń: format pakietu, identyfikacja i aktualizacje, rejestry, zasilanie, źródła i wiarygodność danych, generatory, zasady jakości i IP |
| — | [POC2-RESULTS.md](POC2-RESULTS.md) | Wyniki PoC-2 (renderer Canvas 2D vs SVG, skala eksportu, pomiary w Edge): Canvas potwierdzony |
| — | [POC1-RESULTS.md](POC1-RESULTS.md) | Wyniki PoC-1 (kod w `stagewire/`): 33 testy, pomiary, wnioski i korekty |

**Kolejność czytania:** README → PRODUCT-VISION → MVP-SCOPE → DOMAIN-MODEL → ARCHITECTURE → UX-WORKFLOWS → IMPLEMENTATION-PLAN. DECISIONS i OPEN-QUESTIONS służą jako odniesienie.

## Konwencje

- **Znaczniki pewności:** [FAKT], [WNIOSEK], [HIPOTEZA], [DECYZJA]. Hipotezy z raportów nie są traktowane jako fakty.
- **Identyfikatory:** `W-xx` wnioski, `F-xx` funkcje, `TS-xx` testy, `ADR-xxx` decyzje, `Q-xx` decyzje właściciela, `B-xx`/`B#` badania, `V-xxx` reguły walidacji, `R#` ryzyka techniczne, `G#` luki wspólne, `K#` konflikty, `U#` założenia UX.
- **Priorytety:** M (wymagane), S (pożądane), C (opcjonalne), D (odłożone), X (wykluczone).

## Materiały badawcze

Analizy porównawcze innych narzędzi (obserwacje zachowania, publiczna dokumentacja) i audyty robocze są materiałem wewnętrznym i **nie są częścią tego repozytorium**. Wnioski są zapisane w dokumentach powyżej i w [DECISIONS.md](DECISIONS.md). Kod, dane, ikony i bazy urządzeń cudzych produktów nie są używane (ADR-020).

## Czego ta dokumentacja nie robi

Nie zawiera kodu aplikacji, konfiguracji CI, założonego repozytorium ani pull requestów. Zmiany ograniczono do katalogu `docs/mvp/`; raporty badawcze pozostały bez zmian.

## Status audytu

Audyt z 2026-10-31 wykazał 4 P0 i 11 P1 (poprawki: IMPLEMENTATION-PLAN §8.3). Reaudyt z 2026-11-01 uznał P0 za naprawione koncepcyjnie i wskazał N-01…N-09 (poprawki: §8.4), które **nie zostały jeszcze ponownie zaudytowane**. Przed PoC-1 potrzebne są: ponowny przegląd, decyzje właściciela z OPEN-QUESTIONS (sekcje 1 i 6) oraz schemat JSON z fixtures.
