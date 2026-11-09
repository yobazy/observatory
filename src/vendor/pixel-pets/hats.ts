// Copied from pixel-pets (github.com/yobazy/pixel-pets/src/hats.ts). Don't edit here: change pixel-pets, then run its sync.sh.
import { FRAME_W, spriteBox, type CritterKind } from './frames.ts';

/**
 * Hats and seasonal costumes (any chills, 2026-10-23 and 10-25): a pixel hat
 * on the pet's head, placed per animal. Which hat to wear for what is up to
 * each app (any chills picks from the plan's emoji and vibe).
 */

export type HatId =
  | 'party'
  | 'beret'
  | 'sweatband'
  | 'pirate'
  | 'crown'
  | 'tophat'
  | 'beanie'
  | 'helmet'
  | 'cowboy'
  | 'witch'
  | 'pumpkin'
  | 'horns';

/** A hat is a little pixel grid like the frames: "." is nothing, letters are its palette; X is its outline. */
export type Hat = { rows: string[]; palette: Record<string, string> };

const HAT_INK = '#2A2320';

export const HATS: Record<HatId, Hat> = {
  party: {
    rows: ['....X....', '...XWX...', '...XRX...', '..XRYRX..', '..XYRYX..', '.XRYRYRX.', '.XYRYRYX.', 'XRYRYRYRX'],
    palette: { X: HAT_INK, R: '#E0614F', Y: '#F6C445', W: '#FFF6EC' },
  },
  beret: {
    rows: ['.....X.....', '...XXBXX...', '..XBBBBBX..', '.XBBBBBBBX.', 'XBBBBBBBBBX'],
    palette: { X: HAT_INK, B: '#C0392B' },
  },
  sweatband: {
    rows: ['.XXXXXXXXX.', 'XRWRWRWRWRX', 'XRWRWRWRWRX'],
    palette: { X: HAT_INK, R: '#E0614F', W: '#FFF6EC' },
  },
  pirate: {
    rows: ['....XXXXX....', '...XKKKKKX...', '..XKKKWKKKX..', '.XKKKWKWKKKX.', 'XKKKKKKKKKKKX'],
    palette: { X: HAT_INK, K: '#2B2B2B', W: '#FFF6EC' },
  },
  crown: {
    rows: ['.X..X..X.', 'XYXXYXXYX', 'XYYXYXYYX', 'XYRYBYRYX', 'XYYYYYYYX'],
    palette: { X: HAT_INK, Y: '#F6C445', R: '#E0614F', B: '#4A7BD0' },
  },
  tophat: {
    rows: ['..XXXXXX..', '.XKKKKKKX.', '.XKKKKKKX.', '.XKKKKKKX.', '.XRRRRRRX.', 'XKKKKKKKKX'],
    palette: { X: HAT_INK, K: '#2B2B2B', R: '#C0392B' },
  },
  beanie: {
    rows: ['....X....', '...XWX...', '..XKKKX..', '.XKKKKKX.', 'XKKKKKKKX', 'XGGGGGGGX'],
    palette: { X: HAT_INK, K: '#2B2B2B', G: '#5A5A5A', W: '#DDDDDD' },
  },
  helmet: {
    rows: ['...XXXXX...', '..XGGGGGX..', '.XGGWWWGGX.', 'XGGWWWWWGGX', 'XGGGGGGGGGX'],
    palette: { X: HAT_INK, G: '#DADDE3', W: '#8FB8E8' },
  },
  cowboy: {
    rows: ['....XXXX....', '...XBBBBX...', '..XBBBBBBX..', '.XXBBBBBBXX.', 'XBBBBBBBBBBX'],
    palette: { X: HAT_INK, B: '#8B5A2B' },
  },
  witch: {
    rows: ['......XX...', '.....XKX...', '....XKKX...', '...XKKKKX..', '...XOOOOX..', '..XKKKKKKX.', 'XKKKKKKKKKX'],
    palette: { X: HAT_INK, K: '#3B2A4A', O: '#F08A2B' },
  },
  pumpkin: {
    rows: ['....G....', '...XGX...', '.XXODOXX.', 'XOODODOOX', 'XOODODOOX', '.XXXXXXX.'],
    palette: { X: HAT_INK, G: '#4E7A3A', O: '#F08A2B', D: '#C9661A' },
  },
  horns: {
    rows: ['X...........X', 'XRX.......XRX', '.XRX.....XRX.', '.XRRX...XRRX.', '..XRRX.XRRX..'],
    palette: { X: HAT_INK, R: '#D8433A' },
  },
};

/** What a pet wears: a hat on its head, and a prop (an emoji) at its paws. */
export type Outfit = { hat: HatId | null; prop: string | null };

/**
 * Seasons (2026-10-25, owner picked Halloween costumes from a personality
 * brainstorm): for a few days a year every pet wears a costume wherever it
 * sits, unless something already gave it a hat. Local dates, both ends in.
 */
export type Season = 'halloween';

export function seasonAt(now: Date = new Date()): Season | null {
  const month = now.getMonth();
  const day = now.getDate();
  if ((month === 9 && day >= 24) || (month === 10 && day === 1)) return 'halloween';
  return null;
}

const COSTUME: Record<Season, Record<CritterKind, HatId>> = {
  halloween: { cat: 'witch', dog: 'pumpkin', turtle: 'witch', frog: 'horns', leopard: 'horns', bobcat: 'witch', jaguar: 'horns' },
};

/** The season's costume, when the outfit doesn't already have a hat. */
export function withSeason(outfit: Outfit | null, kind: CritterKind, season: Season | null): Outfit | null {
  if (!season || outfit?.hat) return outfit;
  return { hat: COSTUME[season][kind], prop: outfit?.prop ?? null };
}

/** Just the costume, for a pet with no outfit of its own. */
export function seasonHat(kind: CritterKind, now: Date = new Date()): HatId | null {
  return withSeason(null, kind, seasonAt(now))?.hat ?? null;
}

/**
 * Where a hat sits on each animal's sitting frame (in frame pixels): the
 * column its centre lines up with, and the row the hat's brim rests on.
 */
export const HEAD: Record<CritterKind, { x: number; top: number }> = {
  cat: { x: 13.5, top: 4 },
  dog: { x: 13, top: 3 },
  turtle: { x: 22.5, top: 10 },
  frog: { x: 13.5, top: 2 },
  // Same head as the cat: the big cats are the cat's frames with spots.
  leopard: { x: 13.5, top: 4 },
  bobcat: { x: 13.5, top: 4 },
  jaguar: { x: 13.5, top: 4 },
};

/** SVG path per palette letter for a hat, the same way frames are drawn. */
export function hatPaths(hat: Hat): Record<string, string> {
  const out: Record<string, string> = {};
  hat.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      out[ch] = `${out[ch] ?? ''}M${x} ${y}h1.03v1.03h-1.03z`;
    });
  });
  return out;
}

export function hatSize(hat: Hat) {
  return { w: Math.max(...hat.rows.map((r) => r.length)), h: hat.rows.length };
}

/** Where a hat goes, in points from the sprite's top-left (top is negative when it pokes out above). */
export function hatPlacement(kind: CritterKind, hat: Hat, scale: number, facingLeft: boolean) {
  const size = hatSize(hat);
  const head = HEAD[kind];
  // Follow the animal's own size (a smaller frog, a bigger leopard), feet anchored.
  const { s, dx, dy } = spriteBox(kind, scale);
  return {
    left: dx + ((facingLeft ? FRAME_W - head.x : head.x) - size.w / 2) * s,
    top: dy + (head.top - (size.h - 1)) * s,
    width: size.w * s,
    height: size.h * s,
    unit: s,
  };
}
