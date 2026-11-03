// Okno „Aktualizacja projektu”: wersja formatu pliku, ulepszenia dostępne dla tego projektu (do włączenia świadomie), odłożone „na później”.
import type { Store } from '../src/store.ts';
import { pendingUpgrades, dismissedUpgrades, upgradeCmd, UPGRADES, type Upgrade } from '../src/migrations.ts';
import { CURRENT_FORMAT } from '../src/format.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function openUpgradeDialog(ctx: { store: Store; say: (m: string) => void; changed: () => void; registry?: Upgrade[] }) {
  const reg = ctx.registry ?? UPGRADES;
  document.getElementById('upgdialog')?.remove();
  const o = document.createElement('div'); o.id = 'upgdialog';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
  const render = () => {
    const p = ctx.store.state, pend = pendingUpgrades(p, reg), later = dismissedUpgrades(p, reg);
    const row = (u: Upgrade, checked: boolean) => `<label class="up-r" style="display:flex;gap:8px;align-items:flex-start;margin:8px 0"><input type="checkbox" data-up="${esc(u.id)}"${checked ? ' checked' : ''} style="min-height:0;width:auto;margin-top:4px"><span><b>${esc(u.title)}</b><br><small style="color:#B0B0B0">${esc(u.description)}</small></span></label>`;
    o.innerHTML = `<div class="dlg" style="width:560px;max-height:88vh;overflow:auto"><h2>Aktualizacja projektu</h2>
      <p class="imp">Format pliku: ${esc(String(p.formatVersion))} · format tej wersji programu: ${esc(CURRENT_FORMAT)}.<br>Starsze projekty otwierają się i działają bez zmian. Nowe funkcje, które zmieniają wygląd lub zachowanie istniejących danych, włączasz tutaj świadomie. Każdą zmianę można cofnąć.</p>
      ${pend.length ? `<h3>Dostępne ulepszenia (${pend.length})</h3>${pend.map((u) => row(u, true)).join('')}` : '<p>Projekt jest aktualny. Wszystkie funkcje tej wersji programu są w nim dostępne.</p>'}
      ${later.length ? `<h3>Odłożone (${later.length})</h3>${later.map((u) => row(u, false)).join('')}` : ''}
      <div class="btns">${pend.length || later.length ? '<button id="up-apply" class="primary">Zastosuj zaznaczone</button>' : ''}${pend.length ? '<button id="up-later">Nie teraz</button>' : ''}<button id="up-close">Zamknij</button></div></div>`;
    const ids = () => [...o.querySelectorAll<HTMLInputElement>('[data-up]')].filter((x) => x.checked).map((x) => x.dataset.up!);
    o.querySelector('#up-apply')?.addEventListener('click', () => { const sel = ids(); if (!sel.length) return; ctx.store.dispatch('Aktualizacja projektu', upgradeCmd.apply(sel, reg)); ctx.changed(); ctx.say(`Zastosowano ulepszenia: ${sel.length}`); render(); });
    o.querySelector('#up-later')?.addEventListener('click', () => { ctx.store.dispatch('Odłóż ulepszenia', upgradeCmd.dismiss(pend.map((u) => u.id))); ctx.changed(); render(); });
    o.querySelector('#up-close')!.addEventListener('click', () => o.remove());
  };
  render(); document.body.appendChild(o);
  o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
}
