// Okno „O programie”: nazwa, wersja, licencja, zasady prywatności i użyte składniki. Całość offline.
import pkg from '../package.json' with { type: 'json' };

export function openAbout() {
  document.getElementById('aboutdialog')?.remove();
  const o = document.createElement('div'); o.id = 'aboutdialog';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
  o.innerHTML = `<div class="dlg" style="width:520px;max-height:88vh;overflow:auto"><h2>StageWire</h2>
    <p class="imp">Wersja ${pkg.version} (wersja robocza). Darmowe narzędzie do technicznego projektowania eventów: plan sali w skali, urządzenia z prawdziwymi portami, schemat blokowy, kable, racki, szafy i zestawienia.</p>
    <p><b>Autor:</b> Julian Szymański · <b>Organizacja:</b> GreenCrew · greencrew.pl<br><b>Repozytorium:</b> github.com/DjGreenKrk/StageWire<br>Część ekosystemu GreenCrew Tools. © Julian Szymański / GreenCrew.</p>
    <p><b>Licencja:</b> PolyForm Shield 1.0.0. Wolno używać i modyfikować na własne potrzeby, także komercyjnie przy projektowaniu eventów; nie wolno oferować konkurencyjnego produktu opartego na tym kodzie.</p>
    <p><b>Prywatność:</b> program działa w całości offline. Nie wysyła żadnych danych, nie ma telemetrii ani kont. Projekty są plikami .sw na Twoim dysku (kopie robocze obok pliku: .autosave).</p>
    <p class="imp"><b>Składniki:</b> czcionka Roboto (Apache-2.0), pdf.js (Apache-2.0), pdf-lib (MIT), Immer (MIT), Ajv (MIT), Tauri (MIT/Apache-2.0). Dane urządzeń w katalogu są własnymi opisami z dokumentacji producentów, bez kopiowania cudzych baz.</p>
    <div class="btns"><button id="ab-close" class="primary">Zamknij</button></div></div>`;
  document.body.appendChild(o);
  o.querySelector('#ab-close')!.addEventListener('click', () => o.remove());
  o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
}
