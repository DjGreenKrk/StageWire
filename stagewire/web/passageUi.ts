// Okno „Przejścia…”: kable między salami (np. FOH ↔ scena) idą przez przejście kablowe: multicore, kanał, przepust w ścianie.
import type { Store } from '../src/store.ts';
import { passageCmd, passagesOf, passageLength, DEFAULT_PASSAGE_Z } from '../src/passage.ts';
import { estimateLengths } from '../src/lengths.ts';

export interface PassageUiCtx {
  store: Store; say(m: string): void; changed(): void; refresh(): void;
  /** Tryb wskazywania dwóch końców przejścia na planie (po dwóch kliknięciach okno otwiera się ponownie). */
  startPick(): void;
  showAll(): void;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmtM = (mm: number) => String(Math.round(mm / 10) / 100).replace('.', ',');
const parseM = (s: string) => Number(s.replace(',', '.')) * 1000;
export { DEFAULT_PASSAGE_Z };

export function createPassageUi(c: PassageUiCtx) {
  const { store } = c;
  function open() {
    document.getElementById('passdialog')?.remove();
    const o = document.createElement('div'); o.id = 'passdialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    o.innerHTML = `<div class="dlg" style="width:640px;max-height:88vh;overflow:auto"><h2>Przejścia kablowe między salami</h2>
      <p class="imp">Kabel między urządzeniami w różnych salach (np. konsoleta na FOH i stage box na scenie) idzie przez przejście: multicore, kanał kablowy albo przepust w ścianie. Długość kabla = dojście w pierwszej sali (po trasach, jeśli są) + przejście + dojście w drugiej sali + zapas. Przejście ma dwa końce, po jednym w każdej sali.</p>
      <div id="pa-warn" class="imp"></div>
      <div class="btns" style="justify-content:flex-start;margin:8px 0"><button id="pa-new" class="primary">+ Wskaż przejście na planie</button></div>
      <div id="pa-list"></div><div class="btns"><button id="pa-close">Zamknij</button></div></div>`;
    document.body.appendChild(o);
    const q = <T extends HTMLElement>(s: string, root: ParentNode = o) => root.querySelector(s) as T;
    q('#pa-close').addEventListener('click', () => o.remove());
    q('#pa-new').addEventListener('click', () => {
      if (Object.keys(store.state.spaces ?? {}).length < 2) { c.say('Najpierw dodaj drugą salę („+ Sala”): przejście łączy dwie sale'); return; }
      o.remove(); c.startPick();
    });
    const run = (label: string, m: ReturnType<typeof passageCmd.update>) => { try { store.dispatch(label, m); c.changed(); c.refresh(); } catch (err) { c.say(String((err as Error).message)); } list(); };
    function list() {
      const S = store.state, nameOfSpace = (id: string) => (S.spaces?.[id] as any)?.name ?? id, items = passagesOf(S);
      const missing = estimateLengths(S).otherSpace;
      q('#pa-warn').innerHTML = missing ? `<b class="warn">${missing} ${missing === 1 ? 'kabel łączy' : 'kabli łączy'} urządzenia z różnych sal bez przejścia: ${missing === 1 ? 'nie zostanie policzony' : 'nie zostaną policzone'}.</b>` : '';
      q('#pa-list').innerHTML = items.length ? items.map(([id, ps]) => `<div class="pc" data-id="${id}" style="border:1px solid #2A2A2A;border-radius:8px;padding:10px;margin:8px 0">
        <div style="display:flex;gap:8px;align-items:center"><input class="pa-name" value="${esc(ps.name)}" style="flex:1"><span class="meta" style="white-space:nowrap">${esc(nameOfSpace(ps.a.spaceId))} ↔ ${esc(nameOfSpace(ps.b.spaceId))}</span></div>
        <div style="display:flex;gap:8px;margin-top:6px"><label style="flex:1">Wysokość przejścia [m]<input class="pa-z" value="${fmtM(ps.a.z)}" style="display:block;width:100%"></label>
        <label style="flex:2">Długość przejścia [m] (puste = z planu: ${fmtM(passageLength(S, { ...ps, lengthMm: undefined }))} m)<input class="pa-len" value="${ps.lengthMm !== undefined ? fmtM(ps.lengthMm) : ''}" placeholder="z planu" style="display:block;width:100%"></label></div>
        <div style="display:flex;gap:6px;margin-top:8px"><button class="pa-show">Pokaż cały budynek</button><button class="pa-del danger">Usuń</button></div></div>`).join('')
        : '<div class="meta">Brak przejść.</div>';
      q('#pa-list').querySelectorAll<HTMLElement>('.pc').forEach((card) => {
        const id = card.dataset.id!, g = <T extends HTMLElement>(s: string) => q<T>(s, card);
        for (const i of card.querySelectorAll('input')) i.addEventListener('keydown', (ev) => { ev.stopPropagation(); if ((ev as KeyboardEvent).key === 'Enter') (ev.target as HTMLElement).blur(); });
        g('.pa-name').addEventListener('change', () => run('Nazwa przejścia', passageCmd.update(id, { name: (g('.pa-name') as HTMLInputElement).value })));
        g('.pa-z').addEventListener('change', () => run('Wysokość przejścia', passageCmd.update(id, { z: parseM((g('.pa-z') as HTMLInputElement).value) })));
        g('.pa-len').addEventListener('change', () => { const v = (g('.pa-len') as HTMLInputElement).value.trim(); run('Długość przejścia', passageCmd.update(id, { lengthMm: v ? parseM(v) : null })); });
        g('.pa-show').addEventListener('click', () => { o.remove(); c.showAll(); });
        g('.pa-del').addEventListener('click', () => run('Usuń przejście', passageCmd.remove(id)));
      });
    }
    list();
  }
  return { open };
}
