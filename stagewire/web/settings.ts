// Ustawienia programu (osobiste, nie część projektu): własne kolory kabli i domyślny kolor eksportów. Zapis lokalny w przeglądarce okna (localStorage), bez sieci.
import { SIGNAL_FAMILY_DEFAULTS, setSignalColors } from '../src/render/drawlist.ts';

export interface Settings { signalColors: Record<string, string>; exportColor: boolean }
const KEY = 'stagewire.settings.v1', HEX = /^#[0-9a-f]{6}$/i;
const defaults = (): Settings => ({ signalColors: {}, exportColor: false });

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}'), s = defaults();
    if (raw && typeof raw === 'object') {
      s.exportColor = raw.exportColor === true;
      for (const f of SIGNAL_FAMILY_DEFAULTS) { const v = raw.signalColors?.[f.label]; if (typeof v === 'string' && HEX.test(v) && v.toLowerCase() !== f.color.toLowerCase()) s.signalColors[f.label] = v.toLowerCase(); }
    }
    return s;
  } catch { return defaults(); }
}

export const settings: Settings = load();
setSignalColors(settings.signalColors);
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* brak miejsca: ustawienia obowiązują do zamknięcia */ } setSignalColors(settings.signalColors); }

/** Okno „Ustawienia…”; `changed` wołane po zmianie kolorów (przerysowanie schematu). */
export function openSettings(changed: () => void) {
  document.getElementById('setdialog')?.remove();
  const o = document.createElement('div'); o.id = 'setdialog';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
  o.innerHTML = `<div class="dlg" style="width:560px;max-height:88vh;overflow:auto"><h2>Ustawienia</h2>
    <h3 style="margin:8px 0 4px;font-size:14px;font-weight:500">Kolory kabli na schemacie</h3>
    <p class="imp">Kolor zależy od rodzaju sygnału. Domyślne kolory są dobrane do czarnego tła; w kolorowych eksportach PDF są przyciemniane pod biały papier.</p>
    <div id="st-rows"></div>
    <div class="btns" style="justify-content:flex-start"><button id="st-reset">Przywróć domyślne kolory</button></div>
    <h3 style="margin:14px 0 4px;font-size:14px;font-weight:500">Eksporty</h3>
    <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="st-color" style="width:18px;height:18px"${settings.exportColor ? ' checked' : ''}> Eksporty PDF (plan, schemat) domyślnie w kolorze</label>
    <p class="imp">Ustawienia są zapamiętywane na tym komputerze i nie trafiają do pliku projektu.</p>
    <div class="btns"><button id="st-close" class="primary">Zamknij</button></div></div>`;
  document.body.appendChild(o);
  const rows = o.querySelector('#st-rows')!;
  const render = () => {
    rows.innerHTML = SIGNAL_FAMILY_DEFAULTS.map((f) => {
      const cur = settings.signalColors[f.label] ?? f.color;
      return `<div style="display:flex;align-items:center;gap:10px;margin:4px 0"><input type="color" data-l="${f.label}" value="${cur}" style="width:48px;height:32px;background:none;border:0;padding:0"><span style="flex:1">${f.label}</span>${settings.signalColors[f.label] ? `<button data-r="${f.label}" style="min-height:32px">Domyślny</button>` : '<span class="imp">domyślny</span>'}</div>`;
    }).join('');
    rows.querySelectorAll<HTMLInputElement>('input[type=color]').forEach((i) => i.addEventListener('change', () => {
      const l = i.dataset.l!, def = SIGNAL_FAMILY_DEFAULTS.find((x) => x.label === l)!.color;
      if (i.value.toLowerCase() === def.toLowerCase()) delete settings.signalColors[l]; else settings.signalColors[l] = i.value.toLowerCase();
      saveSettings(); render(); changed();
    }));
    rows.querySelectorAll<HTMLElement>('button[data-r]').forEach((b) => b.addEventListener('click', () => { delete settings.signalColors[b.dataset.r!]; saveSettings(); render(); changed(); }));
  };
  render();
  o.querySelector('#st-reset')!.addEventListener('click', () => { settings.signalColors = {}; saveSettings(); render(); changed(); });
  o.querySelector('#st-color')!.addEventListener('change', (e) => { settings.exportColor = (e.target as HTMLInputElement).checked; saveSettings(); });
  o.querySelector('#st-close')!.addEventListener('click', () => o.remove());
  o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
}
