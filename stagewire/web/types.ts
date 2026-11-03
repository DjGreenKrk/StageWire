import type { DrawList } from '../src/render/drawlist.ts';

export interface Camera { x: number; y: number; zoom: number; flipY: boolean }

export interface Backend {
  name: string;
  /** Liczba prymitywów faktycznie narysowanych/obecnych w DOM w ostatniej klatce. */
  drawn: number;
  load(dl: DrawList): void;
  render(cam: Camera): void;
  move(ids: number[], dx: number, dy: number): void;
}
