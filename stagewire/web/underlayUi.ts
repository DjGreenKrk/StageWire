// Okno „Podkład…”: import PDF/SVG/DXF/obrazu, lista podkładów z ustawieniami (widoczność, blokada, kolory, przezroczystość, położenie, obrót), wyskalowanie i przesuwanie.
import type { Store } from '../src/store.ts';
import { underlayCmd, underlaysOf, type Underlay } from '../src/underlay.ts';
import { newId } from '../src/ids.ts';
import { importUnderlayFile } from './underlayImport.ts';

export interface UnderlayUiCtx {
  store: Store; say(m: string): void; changed(): void; refresh(): void;
  /** Tryb wskazywania dwóch punktów na planie: wyskalowanie (odległość rzeczywista) albo wyprostowanie (odcinek ma być poziomy). */
  startPick(id: string, kind: 'scale' | 'level'): void;
  startMove(id: string): void;
  focus(id: string): void;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmtM = (mm: number) => String(Math.round(mm / 10) / 100).replace('.', ',');
const parseM = (s: string) => Number(s.replace(',', '.')) * 1000;
const KIND_PL: Record<string, string> = { pdf: 'PDF', svg: 'SVG', dxf: 'DXF', image: 'obraz' };

export function createUnderlayUi(c: UnderlayUiCtx) {
  const { store } = c;
  function open() {
    document.getElementById('underdialog')?.remove();
    const o = document.createElement('div'); o.id = 'underdialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    o.innerHTML = `<div class="dlg" style="width:640px;max-height:88vh;overflow:auto"><h2>Podkład (rzut budynku)</h2>
      <p class="imp">Wczytaj rzut budynku jako podkład pod planem, wyskaluj go dwoma punktami i narysuj na nim salę („+ Sala” → „Rysuj na planie”). PDF, SVG, DXF (tekstowy) i obrazy działają offline; DWG zapisz w programie CAD jako DXF lub PDF.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:8px 0">
        <label style="flex:3;min-width:220px">Plik<input id="u-file" type="file" accept=".pdf,.svg,.dxf,.dwg,.png,.jpg,.jpeg,.webp" style="display:block;width:100%;margin-top:4px"></label>
        <label style="flex:1;min-width:110px">Rozdzielczość<select id="u-res" style="display:block;width:100%;margin-top:4px"><option value="2048">2048 px</option><option value="4096" selected>4096 px</option><option value="8192">8192 px</option></select></label>
        <label style="flex:1;min-width:80px">Strona PDF<input id="u-page" value="1" style="display:block;width:100%;margin-top:4px"></label>
        <label style="flex:1;min-width:110px">Skala rysunku 1:<input id="u-den" placeholder="np. 100" style="display:block;width:100%;margin-top:4px" title="Dla PDF/SVG z CAD: skala wydruku. Puste = wyskalujesz dwoma punktami."></label>
        <button id="u-import" class="primary">Importuj</button></div>
      <div class="imp" id="u-info"></div><div id="u-list"></div><div class="btns"><button id="u-close">Zamknij</button></div></div>`;
    document.body.appendChild(o);
    const q = <T extends HTMLElement>(s: string, root: ParentNode = o) => root.querySelector(s) as T;
    o.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (ev) => ev.stopPropagation()));
    q('#u-close').addEventListener('click', () => o.remove());
    const run = (label: string, m: ReturnType<typeof underlayCmd.update>) => { try { store.dispatch(label, m); c.changed(); c.refresh(); } catch (err) { c.say(String((err as Error).message)); } };

    function list() {
      const box = q('#u-list'); const items = underlaysOf(store.state);
      box.innerHTML = items.length ? items.map(([id, u]) => `<div class="uc" data-id="${id}" style="border:1px solid #2A2A2A;border-radius:8px;padding:10px;margin:8px 0">
        <div style="display:flex;gap:8px;align-items:center"><input class="u-name" value="${esc(u.name)}" style="flex:1"><span class="meta" style="white-space:nowrap">${KIND_PL[u.kind]} · ${u.widthPx} × ${u.heightPx} px · ${fmtM(u.widthPx * u.mmPerPx)} × ${fmtM(u.heightPx * u.mmPerPx)} m</span></div>
        ${u.scaleKnown ? '' : '<div class="meta warn">Skala nieznana: wyskaluj podkład dwoma punktami („Wyskaluj”).</div>'}
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin:6px 0;align-items:center">
          <label class="chk"><input type="checkbox" class="u-vis"${u.visible ? ' checked' : ''}> Widoczny</label><label class="chk"><input type="checkbox" class="u-lock"${u.locked ? ' checked' : ''}> Zablokowany</label><label class="chk"><input type="checkbox" class="u-inv"${u.invert ? ' checked' : ''}> Odwróć kolory</label>
          <label>Przezroczystość <input type="range" class="u-op" min="5" max="100" value="${Math.round(u.opacity * 100)}" style="vertical-align:middle;width:120px"></label></div>
        <div style="display:flex;gap:8px"><label style="flex:1">X [m]<input class="u-x" value="${fmtM(u.x)}" style="display:block;width:100%"></label><label style="flex:1">Y [m]<input class="u-y" value="${fmtM(u.y)}" style="display:block;width:100%"></label><label style="flex:1">Obrót [°]<input class="u-rot" value="${String(Math.round(u.rotationDeg * 100) / 100).replace('.', ',')}" style="display:block;width:100%"></label></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="u-scale"${u.locked ? ' disabled' : ''}>Wyskaluj (2 punkty)</button><button class="u-level"${u.locked ? ' disabled' : ''}>Wyprostuj (2 punkty)</button><button class="u-move"${u.locked ? ' disabled' : ''}>Przesuń na planie</button><button class="u-show">Pokaż na planie</button><button class="u-del danger">Usuń</button></div></div>`).join('')
        : '<div class="meta">Brak podkładów.</div>';
      box.querySelectorAll<HTMLElement>('.uc').forEach((card) => {
        const id = card.dataset.id!, g = <T extends HTMLElement>(s: string) => q<T>(s, card);
        for (const i of card.querySelectorAll('input')) i.addEventListener('keydown', (ev) => { ev.stopPropagation(); if ((ev as KeyboardEvent).key === 'Enter') (ev.target as HTMLElement).blur(); });
        g('.u-name').addEventListener('change', () => run('Nazwa podkładu', underlayCmd.update(id, { name: (g('.u-name') as HTMLInputElement).value })));
        g('.u-vis').addEventListener('change', () => { run('Widoczność podkładu', underlayCmd.update(id, { visible: (g('.u-vis') as HTMLInputElement).checked })); });
        g('.u-lock').addEventListener('change', () => { run('Blokada podkładu', underlayCmd.update(id, { locked: (g('.u-lock') as HTMLInputElement).checked })); list(); });
        g('.u-inv').addEventListener('change', () => run('Kolory podkładu', underlayCmd.update(id, { invert: (g('.u-inv') as HTMLInputElement).checked })));
        g('.u-op').addEventListener('input', () => run('Przezroczystość podkładu', underlayCmd.update(id, { opacity: Number((g('.u-op') as HTMLInputElement).value) / 100 })));
        const pos = () => { const u = (store.state as any).underlays[id] as Underlay; run('Położenie podkładu', underlayCmd.update(id, { x: parseM((g('.u-x') as HTMLInputElement).value), y: parseM((g('.u-y') as HTMLInputElement).value), rotationDeg: Number((g('.u-rot') as HTMLInputElement).value.replace(',', '.')) })); void u; };
        for (const s of ['.u-x', '.u-y', '.u-rot']) g(s).addEventListener('change', pos);
        g('.u-scale').addEventListener('click', () => { o.remove(); c.startPick(id, 'scale'); });
        g('.u-level').addEventListener('click', () => { o.remove(); c.startPick(id, 'level'); });
        g('.u-move').addEventListener('click', () => { o.remove(); c.startMove(id); });
        g('.u-show').addEventListener('click', () => { o.remove(); c.focus(id); });
        g('.u-del').addEventListener('click', () => { run('Usuń podkład', underlayCmd.remove(id)); list(); });
      });
    }
    list();

    q('#u-import').addEventListener('click', async () => {
      const f = (q('#u-file') as HTMLInputElement).files?.[0], info = q('#u-info');
      if (!f) { info.innerHTML = '<b class="warn">Wybierz plik.</b>'; return; }
      info.textContent = 'Importuję…'; (q('#u-import') as HTMLButtonElement).disabled = true;
      try {
        const r = await importUnderlayFile(f, { maxSide: Number((q('#u-res') as HTMLSelectElement).value), page: Number((q('#u-page') as HTMLInputElement).value) || 1, scaleDenominator: Number((q('#u-den') as HTMLInputElement).value.replace(',', '.')) || undefined });
        const id = newId('und');
        store.dispatch('Importuj podkład', underlayCmd.add(id, { name: f.name.replace(/\.[^.]+$/, ''), kind: r.kind, source: f.name, mime: r.mime, image: r.image, widthPx: r.widthPx, heightPx: r.heightPx, x: r.x, y: r.y, mmPerPx: r.mmPerPx, rotationDeg: 0, opacity: r.invert ? 0.45 : 0.7, invert: r.invert, visible: true, locked: false, scaleKnown: r.scaleKnown }));
        c.changed(); c.refresh(); info.innerHTML = esc(r.note); list(); c.focus(id);
        o.remove(); c.say(r.note + (r.scaleKnown ? '' : ' Użyj „Podkład…” → „Wyskaluj (2 punkty)”.'));
      } catch (err) { info.innerHTML = `<b class="warn">${esc((err as Error).message)}</b>`; }
      finally { const b = document.getElementById('u-import') as HTMLButtonElement | null; if (b) b.disabled = false; }
    });
  }
  return { open };
}
