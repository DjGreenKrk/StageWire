import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Project } from '../src/types.ts';

export function fixture(name: string): Project {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8'));
}

export const FIXTURES = ['conference-mini.json', 'revisions-two.json', 'medium-variants.json', 'dmx-mini.json', 'lengths.json'];
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
