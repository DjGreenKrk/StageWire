import type { Project } from './types.ts';

export interface CableRow {
  /** Kabel powiązany z wierszem (brak dla połączeń bez kabla, np. bezprzewodowych). */
  cableId?: string;
  number: string;
  cableType: string;
  fromDevice: string;
  fromPort: string;
  toDevice: string;
  toPort: string;
  signal: string;
  medium: string;
  lengthMm?: number;
  /** Skąd długość: ręcznie, oszacowana z planu, nieznana. */
  lengthSource?: 'manual' | 'estimated' | 'unknown';
  stockLengthMm?: number;
  /** Propozycja z settings.stockCableLengthsMm, gdy brak przydziału; null gdy brak długości. */
  suggestedStockMm?: number;
  lengthState: 'allocated' | 'suggested' | 'unknown';
}

function portLabel(p: Project, ref: { instanceId: string; portId: string }): string {
  const inst = p.equipment[ref.instanceId];
  const override = inst.portOverrides?.[ref.portId]?.label;
  return override ?? p.definitions[inst.definitionId].revisions[String(inst.definitionRevision)].ports[ref.portId].label;
}

/** Patchlista: wiersz na KAŻDE połączenie (także wireless/virtual). */
export function patchList(p: Project): CableRow[] {
  const stock = [...(p.settings.stockCableLengthsMm ?? [])].sort((a, b) => a - b);
  const rows: CableRow[] = [];
  for (const c of Object.values(p.connections)) {
    const cab = c.cableId ? p.cables[c.cableId] : undefined;
    const suggested = cab?.lengthMm !== undefined ? stock.find((s) => s >= cab.lengthMm!) : undefined;
    rows.push({
      cableId: c.cableId ?? undefined,
      number: cab?.number ?? '',
      cableType: cab?.cableTypeKey ?? '',
      fromDevice: p.equipment[c.from.instanceId].name,
      fromPort: portLabel(p, c.from),
      toDevice: p.equipment[c.to.instanceId].name,
      toPort: portLabel(p, c.to),
      signal: c.signalKey,
      medium: c.medium,
      lengthMm: cab?.lengthMm,
      lengthSource: cab?.lengthSource,
      stockLengthMm: cab?.stockLengthMm,
      suggestedStockMm: cab?.stockLengthMm === undefined ? suggested : undefined,
      lengthState: cab?.stockLengthMm !== undefined ? 'allocated' : suggested !== undefined ? 'suggested' : 'unknown',
    });
  }
  return rows.sort((a, b) => (a.number || '~').localeCompare(b.number || '~') || a.fromDevice.localeCompare(b.fromDevice));
}

/** Lista kabli: tylko połączenia fizyczne z przypisanym kablem (wireless/virtual i kabel nieprzypisany pomijane). */
export function cableList(p: Project): CableRow[] {
  return patchList(p).filter((r) => r.medium === 'physical' && r.cableType !== '');
}

const csvCell = (v: unknown): string => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** CSV w UTF-8 z BOM (Excel + polskie znaki), separator średnik. */
export function toCsv(rows: CableRow[]): string {
  const head = ['Numer', 'Typ kabla', 'Z urządzenia', 'Z portu', 'Do urządzenia', 'Do portu', 'Sygnał', 'Medium', 'Wymagana długość [mm]', 'Przydział [mm]', 'Propozycja [mm] (do weryfikacji)', 'Stan długości'];
  const lines = [head.join(';')];
  for (const r of rows) {
    lines.push([r.number, r.cableType, r.fromDevice, r.fromPort, r.toDevice, r.toPort, r.signal, r.medium, r.lengthMm, r.stockLengthMm, r.suggestedStockMm, r.lengthState].map(csvCell).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
