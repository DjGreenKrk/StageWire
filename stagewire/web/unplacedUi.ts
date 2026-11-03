// Panel „Do rozmieszczenia”: lista urządzeń, racków i szaf, których nie ma jeszcze na żadnym planie. Każdą pozycję można przeciągnąć na wybrane miejsce aktywnej sali
// (przeciąganie na wskaźniku myszy, bez HTML5 drag&drop, żeby działało też w oknie Tauri) albo zaznaczyć i rozmieścić w rzędach.
export interface UnplacedItem { id: string; name: string; sub: string; kind: 'device' | 'rack' | 'cabinet' }
export interface UnplacedCtx {
  items(): UnplacedItem[];
  roomName(): string | undefined;
  /** Upuszczenie pozycji w punkcie okna (clientX, clientY); zwraca true, gdy położono na planie. */
  drop(id: string, clientX: number, clientY: number): boolean;
  /** Zaznaczone pozycje rozmieszczone w rzędach. */
  batch(ids: string[]): void;
  isOverPlan(clientX: number, clientY: number): boolean;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function createUnplacedUi(c: UnplacedCtx) {
  let el: HTMLElement | undefined, filter = '';
  const checked = new Set<string>();
  const isOpen = () => !!el;

  function render() {
    if (!el) return;
    const all = c.items(), f = filter.trim().toLowerCase(), items = f ? all.filter((i) => (i.name + ' ' + i.sub).toLowerCase().includes(f)) : all;
    for (const id of [...checked]) if (!all.some((i) => i.id === id)) checked.delete(id);
    const sec = (title: string, list: UnplacedItem[]) => list.length ? `<div class="up-h">${title} (${list.length})</div>${list.map((i) => `<div class="up-i" data-id="${i.id}"><input type="checkbox" class="up-c"${checked.has(i.id) ? ' checked' : ''} aria-label="Zaznacz"><span class="up-n" title="Przeciągnij na plan">${esc(i.name)}<small>${esc(i.sub)}</small></span></div>`).join('')}` : '';
    el.querySelector('#up-room')!.textContent = c.roomName() ? `Aktywna sala: ${c.roomName()}` : 'Najpierw dodaj salę';
    el.querySelector('#up-list')!.innerHTML = all.length
      ? sec('Urządzenia', items.filter((i) => i.kind === 'device')) + sec('Racki i szafy', items.filter((i) => i.kind !== 'device')) || '<div class="none">Brak wyników</div>'
      : '<div class="none">Wszystko jest już na planie</div>';
    (el.querySelector('#up-go') as HTMLButtonElement).textContent = checked.size ? `Rozmieść zaznaczone (${checked.size})` : 'Rozmieść zaznaczone';
    (el.querySelector('#up-go') as HTMLButtonElement).disabled = !checked.size || !c.roomName();
  }

  function startDrag(row: HTMLElement, ev: PointerEvent) {
    const id = row.dataset.id!, label = row.querySelector('.up-n')!.firstChild!.textContent ?? id;
    const ghost = document.createElement('div'); ghost.className = 'up-ghost'; ghost.textContent = label; ghost.style.display = 'none'; document.body.appendChild(ghost);
    const sx = ev.clientX, sy = ev.clientY; let moved = false;
    const mv = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
      moved = true; ghost.style.display = 'block'; ghost.style.left = e.clientX + 10 + 'px'; ghost.style.top = e.clientY + 10 + 'px';
      ghost.classList.toggle('ok', c.isOverPlan(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); ghost.remove();
      if (moved && c.isOverPlan(e.clientX, e.clientY)) { c.drop(id, e.clientX, e.clientY); render(); }
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  function open() {
    if (el) { render(); return; }
    el = document.createElement('div'); el.id = 'unpl';
    el.innerHTML = `<h3>Do rozmieszczenia</h3><div class="meta" id="up-room"></div>
      <div class="meta">Przeciągnij pozycję na plan albo zaznacz kilka i rozmieść je w rzędach.</div>
      <input id="up-f" type="search" placeholder="Szukaj…" aria-label="Szukaj"><div id="up-list"></div>
      <div class="btns"><button id="up-all">Zaznacz wszystkie</button><button id="up-go" class="primary">Rozmieść zaznaczone</button><button id="up-x">Zamknij</button></div>`;
    document.body.appendChild(el);
    el.querySelector('#up-x')!.addEventListener('click', close);
    el.querySelector('#up-f')!.addEventListener('input', (e) => { filter = (e.target as HTMLInputElement).value; render(); });
    el.querySelector('#up-f')!.addEventListener('keydown', (e) => e.stopPropagation());
    el.querySelector('#up-all')!.addEventListener('click', () => { const shown = [...el!.querySelectorAll<HTMLElement>('.up-i')].map((r) => r.dataset.id!), every = shown.every((i) => checked.has(i)); shown.forEach((i) => every ? checked.delete(i) : checked.add(i)); render(); });
    el.querySelector('#up-go')!.addEventListener('click', () => { const ids = [...checked]; checked.clear(); c.batch(ids); render(); });
    el.querySelector('#up-list')!.addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (!t.classList.contains('up-c')) return; const id = (t.closest('.up-i') as HTMLElement).dataset.id!; t.checked ? checked.add(id) : checked.delete(id); render(); });
    el.querySelector('#up-list')!.addEventListener('pointerdown', (e) => { const t = e.target as HTMLElement, row = t.closest('.up-i') as HTMLElement | null; if (!row || t.classList.contains('up-c')) return; e.preventDefault(); startDrag(row, e as PointerEvent); });
    render();
  }
  function close() { el?.remove(); el = undefined; }
  return { open, close, toggle: () => (el ? close() : open()), refresh: render, isOpen };
}
