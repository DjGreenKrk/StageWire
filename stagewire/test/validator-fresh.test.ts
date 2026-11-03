import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error moduł .mjs bez typów
import { generate } from '../scripts/gen-validator.mjs';

describe('walidator schematu (generowany)', () => {
  it('plik src/generated/projectValidator.js jest aktualny względem schema/project.schema.json (uruchom npm run gen:validator)', () => {
    const file = readFileSync(fileURLToPath(new URL('../src/generated/projectValidator.js', import.meta.url)), 'utf8');
    expect(file).toBe(generate());
  });
  it('wygenerowany kod nie używa eval, new Function ani require (ścisła CSP)', () => {
    const file = readFileSync(fileURLToPath(new URL('../src/generated/projectValidator.js', import.meta.url)), 'utf8');
    expect(file).not.toMatch(/\bnew Function\b|\beval\(|\brequire\(/);
  });
});
