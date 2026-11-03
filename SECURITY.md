# Polityka bezpieczeństwa

## Obsługiwane wersje

StageWire jest wersją roboczą. Poprawki otrzymuje najnowszy kod gałęzi `main` i najnowsze wydanie.

## Zgłaszanie podatności

Użyj funkcji **Report a vulnerability** w zakładce Security repozytorium na GitHubie. Nie publikuj szczegółów podatności w zwykłym issue.

W zgłoszeniu podaj wersję, system, kroki odtworzenia i oczekiwany wpływ. Zwykłe błędy funkcjonalne zgłaszaj jako publiczne issue.

## Zakres

Program działa lokalnie i offline, bez kont i bez komunikacji sieciowej. Najbardziej istotne są:

- złośliwe pliki wejściowe: projekt `.sw`, pakiet urządzeń `.swpack.json`, podkład (PDF, DXF, obraz),
- ucieczka z ograniczeń CSP lub wykonanie kodu z pliku projektu,
- niebezpieczny zapis plików poza wskazanym miejscem.

## Znane ograniczenia

- instalator i plik wykonywalny nie są podpisane certyfikatem; sumy SHA-256 podajemy w opisie wydania,
- format projektu `1.0.0-draft` nie ma jeszcze zewnętrznego audytu bezpieczeństwa.
