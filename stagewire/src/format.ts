import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import validateSchema from './generated/projectValidator.js';
import type { Project } from './types.ts';
import { migrateProject, compareFormat, majorOf } from './migrations.ts';

// Moduł działa w Node i w przeglądarce (bez node:*).
const sha256Hex = (text: string) => Array.from(sha256(strToU8(text)), (b) => b.toString(16).padStart(2, '0')).join('');

export const CURRENT_FORMAT = '1.0.0-draft';
export const CURRENT_MAJOR = 1;
const SIZE_LIMIT = 256 * 1024 * 1024; // ochrona przed bombami: limit po rozpakowaniu

// ---------- schemat ----------
// Walidator jest generowany z wyprzedzeniem (scripts/gen-validator.mjs), bez `new Function`: ścisła CSP (ADR-054).

export function schemaErrors(json: unknown): string[] {
  if (validateSchema(json)) return [];
  return (validateSchema.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

// ---------- serializacja kanoniczna ----------
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) o[k] = sortKeys((v as any)[k]);
    return o;
  }
  return v;
}

export function canonicalStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2) + '\n';
}

/** Widok pliku: bez nieprzypiętych starszych rewizji (model w pamięci zachowuje wszystkie – N-06). */
export function pruneForFile(p: Project): Project {
  const pinned = new Map<string, Set<number>>();
  for (const i of Object.values(p.equipment)) {
    if (!pinned.has(i.definitionId)) pinned.set(i.definitionId, new Set());
    pinned.get(i.definitionId)!.add(i.definitionRevision);
  }
  const definitions: Project['definitions'] = {};
  for (const [id, def] of Object.entries(p.definitions)) {
    const keep = new Set([...(pinned.get(id) ?? []), def.latestRevision].map(String));
    definitions[id] = { latestRevision: def.latestRevision, revisions: Object.fromEntries(Object.entries(def.revisions).filter(([n]) => keep.has(n))) };
  }
  return { ...p, definitions };
}

// ---------- kontener ZIP ----------
export interface Manifest { formatVersion: string; appVersion: string; sha256: string }

export function packProject(p: Project, opts: { prune?: boolean } = {}): Uint8Array {
  const body = canonicalStringify(opts.prune === false ? p : pruneForFile(p));
  const manifest: Manifest = { formatVersion: p.formatVersion, appVersion: 'poc1', sha256: sha256Hex(body) };
  const mtime = new Date('1980-01-01T00:00:00Z'); // deterministyczny zip
  return zipSync({ 'manifest.json': [strToU8(canonicalStringify(manifest)), { mtime }], 'project.json': [strToU8(body), { mtime }] }, { level: 6 });
}

export type OpenResult =
  | { status: 'ok'; project: Project; migratedFrom?: string; migrations?: string[]; /** plik z nowszą wersją drobną formatu: otwarty, nieznane pola zostają przy zapisie */ newerMinor?: string }
  | { status: 'newer-major'; manifest: Manifest }
  | { status: 'error'; errors: string[] };

export { majorOf, migrate0to1 } from './migrations.ts';

export function openProject(bytes: Uint8Array): OpenResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.originalSize <= SIZE_LIMIT });
  } catch (e) { return { status: 'error', errors: ['Nie można odczytać archiwum: ' + (e as Error).message] }; }
  if (!files['manifest.json'] || !files['project.json']) return { status: 'error', errors: ['Brak manifest.json lub project.json'] };
  let manifest: Manifest;
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])); } catch { return { status: 'error', errors: ['Uszkodzony manifest.json'] }; }
  // nowszy MAJOR: tylko metadane, bez migracji i zapisu
  if (majorOf(manifest.formatVersion) > CURRENT_MAJOR) return { status: 'newer-major', manifest };
  const text = strFromU8(files['project.json']);
  if (sha256Hex(text) !== manifest.sha256) return { status: 'error', errors: ['Suma kontrolna project.json niezgodna z manifestem'] };
  let json: any;
  try { json = JSON.parse(text); } catch { return { status: 'error', errors: ['Uszkodzony project.json'] }; }
  const mig = migrateProject(json); json = mig.json;
  const newerMinor = compareFormat(String(json.formatVersion), CURRENT_FORMAT) > 0 ? String(json.formatVersion) : undefined;
  const errs = schemaErrors(json);
  if (errs.length) return { status: 'error', errors: newerMinor ? [`Plik z nowszej wersji formatu (${newerMinor}) ma strukturę, której ta wersja programu nie rozpoznaje.`, ...errs] : errs };
  return { status: 'ok', project: json as Project, ...(mig.applied.length ? { migratedFrom: mig.from, migrations: mig.applied } : {}), ...(newerMinor ? { newerMinor } : {}) };
}
