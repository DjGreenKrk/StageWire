// Nazwy plików eksportu: „<projekt>-<rodzaj>[-<obiekt>].<rozszerzenie>”, bez znaków niedozwolonych w nazwach plików.
const clean = (s: string) => s.replace(/[\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^[-. ]+|[-. ]+$/g, '');
export function exportName(project: string | undefined, kind: string, object: string | undefined, ext: string): string {
  const parts = [project || 'projekt', kind, object].map((x) => (x ? clean(x) : '')).filter(Boolean);
  return `${parts.join('-')}.${ext}`;
}
