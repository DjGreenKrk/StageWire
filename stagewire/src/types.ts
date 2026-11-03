// Typy modelu wg docs/mvp/DOMAIN-MODEL.md (format 1.0.0-draft).
// Format dyskowy: identyfikator = klucz mapy (S-01); pola id/revision/key nie występują w obiektach.

export type Id = string;
export type Direction = 'in' | 'out' | 'io' | 'loop';
export type Medium = 'physical' | 'wireless' | 'virtual';
export type Supply = 'owned' | 'rental' | 'client' | 'unknown';

export interface RegistryEntry {
  kind: 'connector' | 'signal' | 'cable';
  name: string;
  shortName?: string;
  family?: string;
  domain?: string;
  color?: string;
  prefix?: string;
  carriesSignals?: string[];
  endPairs?: [string, string][];
  maxLengthMm?: number;
  [k: string]: unknown;
}

/** Opis zacisku (ADR-064): tor, położenie na aparacie, dopuszczalne przewody, zgodność mechaniczna. Wszystkie pola opcjonalne. */
export interface TerminalSpec {
  /** Tor elektryczny: L1, L2, L3, N, PE albo dowolny napis (np. A, COM). */
  track?: string;
  /** Położenie w modułach DIN od lewej krawędzi aparatu (0 = pierwszy moduł). */
  at?: number;
  side?: 'top' | 'bottom';
  wires?: { minMm2?: number; maxMm2?: number; ferrule?: 'allowed' | 'required' | 'forbidden' };
  kind?: 'screw' | 'push-in' | 'spring' | 'comb-slot';
  /** Tagi zgodności mechanicznej (np. rozstaw grzebienia); styk wymaga wspólnego tagu. */
  fits?: string[];
}
export type InternalLinkKind = 'passthrough' | 'loopthrough' | 'bridge' | 'jumper' | 'switched';
/** Połączenie wewnętrzne definicji: para `a`/`b` albo grupa `members` (wszystkie porty grupy w jednym węźle). */
export interface InternalLink { kind: InternalLinkKind; a?: Id; b?: Id; members?: Id[]; contact?: string; bidirectional?: boolean }

export interface PortDefinition {
  label: string;
  group?: string;
  order: number;
  connectorKey: string;
  signalKeys: string[];
  direction: Direction;
  side?: 'left' | 'right' | 'top' | 'bottom' | 'auto';
  capacity: number;
  notes?: string;
  terminal?: TerminalSpec;
  [k: string]: unknown;
}

export interface DefinitionRevision {
  manufacturer: string;
  model: string;
  category: string;
  kind: 'physical' | 'virtual';
  changeClass?: 'cosmetic' | 'structural';
  dimensionsMm?: { width: number; depth: number; height: number };
  rackUnits?: { heightU: number; widthFraction: number };
  /** Szerokość na szynie DIN w modułach po 17,5 mm (ADR-052). */
  dinModules?: number;
  symbol?: { icon: string; color: string };
  /** Odnośnik do biblioteki `pakiet/urządzenie` (DOMAIN-MODEL §5.3). */
  key?: string;
  tags?: string[];
  weightKg?: number;
  powerW?: number;
  notes?: string;
  origin?: { custom?: boolean; packId?: string; packVersion?: string; license?: string; source?: string; derivedFrom?: { definitionId: string; revision: number } };
  ports: Record<Id, PortDefinition>;
  internalLinks?: InternalLink[];
  /** Warstwa montażu na szynie: `busbar` = grzebień/mostek leżący na zaciskach aparatów (domyślnie `body`). */
  placementLayer?: 'body' | 'busbar';
  /** Oczekiwana kolejność torów grzebienia (np. L1, L2, L3). */
  phaseOrder?: string[];
  [k: string]: unknown;
}

export interface Definition {
  latestRevision: number;
  revisions: Record<string, DefinitionRevision>;
}

export interface PortRef {
  instanceId: Id;
  portId: Id;
}

export interface EquipmentInstance {
  definitionId: Id;
  definitionRevision: number;
  name: string;
  tag?: string;
  zoneId?: Id | null;
  supply?: Supply;
  portOverrides?: Record<Id, { label?: string; notes?: string; attrs?: Record<string, string> }>;
  /** Pozycja w racku (ADR-051); wartość osadzona, nie encja. */
  /** Pozycja na szynie DIN w szafie/rozdzielnicy (ADR-052); wykluczająca się z `mount`. */
  din?: { cabinetId: Id; row: number; at: number; layer?: 'body' | 'busbar' };
  /** Montaż na płycie montażowej szafy (element bez DIN przykręcony do obudowy), mm od lewego górnego rogu; wyklucza się z `din` i `mount`. */
  plate?: { cabinetId: Id; x: number; y: number };
  /** Indeksy włączonych mostków konfigurowalnych (`internalLinks` rodzaju `jumper`). */
  jumpers?: number[];
  mount?: { rackId: Id; uStart: number; face: 'front' | 'rear'; slot: 'full' | 'left' | 'center' | 'right' };
  notes?: string;
  [k: string]: unknown;
}

export interface Connection {
  from: PortRef;
  to: PortRef;
  signalKey: string;
  medium: Medium;
  cableId?: Id | null;
  label?: string;
  notes?: string;
  [k: string]: unknown;
}

export interface Cable {
  cableTypeKey: string;
  number?: string;
  lengthMm?: number;
  stockLengthMm?: number;
  lengthSource: 'manual' | 'estimated' | 'unknown';
  [k: string]: unknown;
}

export interface Project {
  formatVersion: string;
  id: Id;
  name: string;
  meta?: Record<string, unknown>;
  settings: {
    defaultCableSlackMm?: number;
    stockCableLengthsMm?: number[];
    [k: string]: unknown;
  };
  registries: Record<string, RegistryEntry>;
  definitions: Record<Id, Definition>;
  spaces?: Record<Id, any>;
  zones?: Record<Id, any>;
  racks?: Record<Id, any>;
  cabinets?: Record<Id, any>;
  stageObjects?: Record<Id, any>;
  equipment: Record<Id, EquipmentInstance>;
  placements?: Record<Id, any>;
  connections: Record<Id, Connection>;
  cables: Record<Id, Cable>;
  views?: Record<Id, any>;
  reportDefinitions?: Record<Id, any>;
  suppressions?: { ruleId: string; subject: string; reason: string }[];
  packing?: { rows: Record<string, number>; extras: { id: Id; text: string; packed: boolean }[] };
  ext?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Issue {
  ruleId: string;
  level: 'error' | 'warning' | 'info';
  subject: string; // id obiektu
  message: string;
}
