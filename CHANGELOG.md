# Historia zmian

Wszystkie istotne zmiany StageWire są dokumentowane w tym pliku. Format wzorowany na [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie [SemVer](https://semver.org/lang/pl/).

## [Niewydane]

### Dodano

- plan sali w skali: wiele sal, obrys, scena, widownia, schody, podkład (PDF, DXF, obraz), poziom podłogi sali, blokowanie obiektów,
- umieszczanie urządzeń i racków na wybranej sali przez przeciąganie z listy,
- urządzenia z rzeczywistymi portami, pakiety `stagewire-pack/1`, walidacja pakietów,
- przeglądarka biblioteki z filtrami (kategoria, producent, wejścia, wyjścia, wiarygodność, pakiet), kreator własnego urządzenia, eksport i import pojedynczych urządzeń,
- schemat blokowy z grupami w ramkach, automatycznym porządkowaniem i kolorami kabli według sygnału,
- racki oraz szafy i rozdzielnice na szynę DIN (rzędy szyn, moduły 17,5 mm, przewody, terminale, bilans modułów i poboru), widok 3D z trasami kabli, przejścia między salami,
- eksport PDF planu (numeracja i spis elementów), schematu, racków i szaf; wariant kolorowy z legendą kabli; lista kabli,
- menu ☰ (plik, eksporty, ustawienia, O programie), okno ustawień z własnymi kolorami kabli,
- zapis atomowy, kopie robocze `.autosave`, migracje formatu,
- instalator NSIS i wersja przenośna dla Windows (niepodpisane),
- budowanie rozdzielnicy i racka wprost z katalogu po lewej: przeciąganie pozycji na wskazane miejsce szyny lub U, filtr „tylko pasujące do widoku” (DIN / rack), skrót G w widokach szafy i racka,
- rejestr migracji formatu i okno „Aktualizacja projektu” (menu ☰): starsze projekty otwierają się i można je świadomie zaktualizować do nowszych funkcji; pliki z nowszą wersją drobną otwierają się, a nieznane dane zostają przy zapisie,
- wbudowany pakiet 8 urządzeń Blackmagic Design (dane niezweryfikowane pomiarami),
- logo StageWire w dokumentacji.

### Zmieniono

- podkład wysokiej rozdzielczości rysowany z poziomów mipmap (8192 × 5120 px: z ok. 361 ms do ok. 17 ms na klatkę),
- nazwy plików eksportu zawierają nazwę projektu i obiektu.

### Znane ograniczenia

- format projektu `1.0.0-draft` może się zmienić,
- PDF racków, szaf i listy kabli są czarno-białe,
- widok przejścia i 3D pokazują jedną salę,
- instalator nie jest podpisany certyfikatem.
