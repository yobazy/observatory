// The sidebar cat's pixel art (Pet.tsx draws it). The cat itself comes from
// pixel-pets (src/vendor/pixel-pets, shared with any chills): 27 by 18
// frames, facing right, one letter a pixel, "." for none; its poses at work
// (telescope, laptop, book) are there too. The props are Observatory's own,
// drawn here at the same pixel size, in the theme's colors.
import { CAT_POSES, COATS, FRAMES as PETS, type FrameName, type PoseName } from "../vendor/pixel-pets/frames.ts";

export type Frame = FrameName | PoseName;

export const FRAMES: Record<Frame, string[]> = { ...PETS.cat, ...CAT_POSES };

/** The orange tabby, the cat Observatory has always had. */
export const COAT = COATS.cat.find((c) => c.id === "orange") ?? COATS.cat[0];

/** The telescope the cat looks through: 24 by 18, its eyepiece (E) at the
 *  left, over the cat's right eye (rows 6 and 7), the tube pointing right,
 *  toward the terminal, the hood (H) at its far end raised a little. B is a
 *  band on the tube, L the tripod. The tube is the top nine rows. */
export const TELESCOPE = [
  "........................",
  "........................",
  "........................",
  "...................HHHHH",
  "........TTTTTTTTTTTTTTTH",
  "....TTTTTTTTTTTTTTTTTTTH",
  "EEETTTTTTTTBTTTTTTTTTTTH",
  "EEETTTTTTTTBTTTTTTTTTHHH",
  "....TTTTTTTTTTTTTTTT....",
  "..........L.............",
  "..........L.............",
  ".........L.L............",
  ".........L.L............",
  "........L...L...........",
  "........L...L...........",
  ".......L.....L..........",
  ".......L.....L..........",
  "......L.......L.........",
];
export const TELESCOPE_W = 24;
/** The sitting cat's right eye starts at this frame column; the eyepiece covers it. */
export const EYE_COL = 15;

/** The working line's props, 15 by 18, bottoms on the ground. The laptop is
 *  open toward the cat: its lid (M) at the right with the screen's glow (S)
 *  on the cat's side, the keys (M) under its paw. */
export const LAPTOP = [
  "...............",
  "...............",
  "...............",
  "...............",
  "............M..",
  "...........SM..",
  "...........SM..",
  "...........SM..",
  "...........SM..",
  "...........SM..",
  "...........SM..",
  "...........SM..",
  "...........SM..",
  "............M..",
  "............M..",
  "............M..",
  "MMMMMMMMMMMMM..",
  ".M.........M...",
];
/** An open book on the ground: pages (W) up from a spine (A). */
export const BOOK = [
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "W..........W...",
  "WWWW.....WWW...",
  ".WWWWWWWWWW....",
  "...AAAAAA......",
];
export const PROP_W = 15;
