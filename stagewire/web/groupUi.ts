// Okno „Grupy…”: ramki z nazwą wokół urządzeń na schemacie (np. FOH, Scena). Urządzenie należy do jednej grupy; „Grupy wg sal” tworzy je z rozmieszczenia na planie.
import type { Store } from '../src/store.ts';
import { groupCmd, groupsOf, GROUP_COLORS } from '../src/groups.ts';
import { newId } from '../src/ids.ts';

export interface GroupUiCtx { store: Store; say(m: string): void; changed(): void }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function createGroupUi(c: GroupUiCtx) {
  const { store } = c;
  let sel: string | undefined;
  function open() {
    document.getElementById('grpdialog')?.remove();
    const o = document.createElement('div'); o.id = 'grpdialog';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10';
    o.innerHTML = `<div class="dlg" style="width:720px;max-height:88vh;display:flex;flex-direction:column"><h2>Grupy na schemacie</h2>
      <p class="imp">Grupa rysuje ramkę z nazwą wokół swoich urządzeń. „Uporządkuj” układa każdą grupę w osobnym pasie. Urządzenie może być tylko w jednej grupie.</p>
      <div class="btns" style="justify-content:flex-start;margin:0 0 8px"><button id="g-new" class="primary">+ Nowa grupa</button><button id="g-rooms" title="Jedna grupa na każdą salę, w której stoją urządzenia">Grupy wg sal</button></div>
      <div style="display:flex;gap:12px;min-height:260px;flex:1;overflow:hidden"><div id="g-list" style="width:230px;overflow:auto"></div><div id="g-det" style="flex:1;overflow:auto"></div></div>
      <div class="btns"><button id="g-close">Zamknij</button></div></div>`;
    document.body.appendChild(o);
    const q = <T extends HTMLElement>(s: string, root: ParentNode = o) => root.querySelector(s) as T;
    q('#g-close').addEventListener('click', () => o.remove());
    const run = (label: string, m: Parameters<Store['dispatch']>[1]) => { try { store.dispatch(label, m); c.changed(); render(); return true; } catch (err) { c.say(String((err as Error).message)); return false; } };
    q('#g-new').addEventListener('click', () => {
      const names = new Set(groupsOf(store.state).map(([, g]) => g.name)); let n = names.size + 1, nm = `Grupa ${n}`; while (names.has(nm)) nm = `Grupa ${++n}`;
      const id = newId('grp'); if (run('Dodaj grupę', groupCmd.add(id, nm, [], GROUP_COLORS[names.size % GROUP_COLORS.length]))) { sel = id; render(); }
    });
    q('#g-rooms').addEventListener('click', () => { if (run('Grupy wg sal', groupCmd.fromRooms((n) => Array.from({ length: n }, () => newId('grp'))))) { sel = groupsOf(store.state)[0]?.[0]; render(); c.say('Utworzono grupy z sal'); } });
    function render() {
      const gs = groupsOf(store.state); if (sel && !gs.some(([id]) => id === sel)) sel = undefined; sel ??= gs[0]?.[0];
      q('#g-list').innerHTML = gs.length ? gs.map(([id, g]) => `<div class="pc g-card" data-id="${id}" style="cursor:pointer;margin:0 0 6px;${id === sel ? 'outline:2px solid #00C853' : ''}"><b style="color:${g.color ?? '#64B5F6'}">■</b> ${esc(g.name)} <span class="imp">(${g.members.filter((m) => store.state.equipment[m] || store.state.cabinets?.[m]).length})</span></div>`).join('') : '<div class="imp">Brak grup</div>';
      q('#g-list').querySelectorAll<HTMLElement>('.g-card').forEach((e) => e.addEventListener('click', () => { sel = e.dataset.id; render(); }));
      const g = sel ? (store.state as any).groups?.[sel] : undefined, det = q('#g-det');
      if (!g || !sel) { det.innerHTML = ''; return; }
      const gid = sel, rows = Object.entries<any>(store.state.equipment).sort((a, b) => a[1].name.localeCompare(b[1].name, 'pl', { numeric: true }));
      const owner = (id: string) => groupsOf(store.state).find(([k, x]) => k !== gid && x.members.includes(id))?.[1].name;
      det.innerHTML = `<div style="display:flex;gap:8px;align-items:end"><label style="flex:1">Nazwa<input id="g-name" style="display:block;width:100%;margin-top:4px" value="${esc(g.name)}"></label><label>Kolor<input id="g-col" type="color" value="${g.color ?? '#64b5f6'}" style="display:block;margin-top:4px;width:56px;height:34px;background:none;border:0"></label><button id="g-del" class="danger">Usuń grupę</button></div>
        <div class="imp" style="margin:8px 0 4px">Urządzenia w grupie (zaznacz; te z innej grupy zostaną do niej przeniesione):</div>
        <div id="g-dev">${rows.map(([id, i]) => `<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" data-id="${id}"${g.members.includes(id) ? ' checked' : ''} style="width:18px;height:18px">${esc(i.name)}${owner(id) ? ` <span class="imp">(teraz: ${esc(owner(id)!)})</span>` : ''}</label>`).join('') || '<div class="imp">Brak urządzeń</div>'}</div>`;
      det.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (ev) => ev.stopPropagation()));
      q('#g-name', det).addEventListener('change', (ev) => run('Nazwa grupy', groupCmd.update(gid, { name: (ev.target as HTMLInputElement).value })));
      q('#g-col', det).addEventListener('change', (ev) => run('Kolor grupy', groupCmd.update(gid, { color: (ev.target as HTMLInputElement).value })));
      q('#g-del', det).addEventListener('click', () => { if (run('Usuń grupę', groupCmd.remove(gid))) { sel = undefined; render(); } });
      q('#g-dev', det).addEventListener('change', () => { const ids = [...det.querySelectorAll<HTMLInputElement>('#g-dev input:checked')].map((x) => x.dataset.id!); run('Skład grupy', groupCmd.update(gid, { members: ids })); });
    }
    render();
  }
  return { open };
}
