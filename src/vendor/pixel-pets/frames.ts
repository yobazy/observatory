// Copied from pixel-pets (github.com/yobazy/pixel-pets/src/frames.ts). Don't edit here: change pixel-pets, then run its sync.sh.
/**
 * The chiller's pixel art (2026-10-23 redraw, owner picked "pixel, upgraded"):
 * each frame is 27 by 18, facing right, one letter a pixel, drawn at 4/3 pt a
 * pixel so it takes the same 36×24 pt as the first 18×12 cat. "." is nothing;
 * the letters are palette slots so one drawing wears many coats: O fur,
 * D markings (stripes, patches), W muzzle/chest/paws, S shade (belly, cheeks),
 * X outline; K eyes, H the light in them, P nose, E inner ears are the same
 * for everyone. Heads face you; bodies walk sideways. The sit frame faces
 * front (owner, 2026-10-23).
 */

export const FRAME_W = 27;
export const FRAME_H = 18;

export type Px = '.' | 'O' | 'D' | 'W' | 'S' | 'X' | 'K' | 'H' | 'P' | 'E';

export type FrameName =
  | 'stand'
  | 'walkA'
  | 'walkB'
  | 'sit'
  | 'blink'
  | 'pounce'
  | 'sleep'
  | 'groomA'
  | 'groomB'
  | 'stretch'
  | 'lookUp';

export type FrameSet = Record<FrameName, string[]>;

export const CAT: FrameSet = {
  stand: [
    '................X.....X....',
    '...............XOX...XOX...',
    '..............XOEOXXXOEOX..',
    '....X.........XOOODODOOOX..',
    '...XOX........XOOOOOOOOOX..',
    '..XOX.........XOKKOOOKKOX..',
    '..XOX.........XOKHOOOKHOX..',
    '..XOX.........XOOOWPWOOOX..',
    '..XOXXXXXXXXXXXSOOWWWOOSX..',
    '...XOOOODOODOOOOSOOWOOSX...',
    '...XOOOODOODOOOOOWWXXXX....',
    '...XOOOODOODOOOOOWWX.......',
    '...XOOOOOOOOOOOOOWWX.......',
    '...XSSSSSSSSSSSSSSSX.......',
    '....XOOXOOXXXXXOOXOOX......',
    '....XOOXOOX...XOOXOOX......',
    '....XWWXWWX...XWWXWWX......',
    '.....XX.XX.....XX.XX.......',
  ],
  walkA: [
    '................X.....X....',
    '...............XOX...XOX...',
    '..............XOEOXXXOEOX..',
    '....X.........XOOODODOOOX..',
    '...XOX........XOOOOOOOOOX..',
    '..XOX.........XOKKOOOKKOX..',
    '..XOX.........XOKHOOOKHOX..',
    '..XOX.........XOOOWPWOOOX..',
    '..XOXXXXXXXXXXXSOOWWWOOSX..',
    '...XOOOODOODOOOOSOOWOOSX...',
    '...XOOOODOODOOOOOWWXXXX....',
    '...XOOOODOODOOOOOWWX.......',
    '...XOOOOOOOOOOOOOWWX.......',
    '...XSSSSSSSSSSSSSSSX.......',
    '....XOOXOOXXXXXOOXOOX......',
    '...XOOX.XOOX.XOOX.XOOX.....',
    '..XWWX...XWWXWWX...XWWX....',
    '...XX.....XX.XX.....XX.....',
  ],
  walkB: [
    '................X.....X....',
    '...............XOX...XOX...',
    '....X.........XOEOXXXOEOX..',
    '...XOX........XOOODODOOOX..',
    '..XOX.........XOOOOOOOOOX..',
    '..XOX.........XOKKOOOKKOX..',
    '..XOX.........XOKHOOOKHOX..',
    '..XOXXXXXXXXXXXOOOWPWOOOX..',
    '...XOOOODOODOOOSOOWWWOOSX..',
    '...XOOOODOODOOOOSOOWOOSX...',
    '...XOOOODOODOOOOOWWXXXX....',
    '...XOOOOOOOOOOOOOWWX.......',
    '...XSSSSSSSSSSSSSSSX.......',
    '....XXOOXOOXXXXOOXOOX......',
    '.....XOOXOOX..XOOXOOX......',
    '.....XOOXOOX..XOOXOOX......',
    '.....XWWXWWX..XWWXWWX......',
    '......XX.XX....XX.XX.......',
  ],
  sit: [
    '...........................',
    '..........X.....X..........',
    '.........XOX...XOX.........',
    '........XOEOXXXOEOX........',
    '........XOOODODOOOX........',
    '........XOOOOOOOOOX........',
    '........XOKKOOOKKOX........',
    '........XOKHOOOKHOX........',
    '........XOOOWPWOOOX........',
    '........XSOOWWWOOSX........',
    '.........XSOOWOOSX.........',
    '.....X..XODOWWWODOX........',
    '....XOX.XOOOWWWOOOX........',
    '...XOX.XODOOWWWOODOX.......',
    '...XOX.XOOOOWWWOOOOX.......',
    '...XOXXXOOOOOWOOOOSX.......',
    '....XOOOOWWOOOOOWWSX.......',
    '.....XXXXXXXXXXXXXX........',
  ],
  blink: [
    '...........................',
    '..........X.....X..........',
    '.........XOX...XOX.........',
    '........XOEOXXXOEOX........',
    '........XOOODODOOOX........',
    '........XOOOOOOOOOX........',
    '........XOOOOOOOOOX........',
    '........XOKKOOOKKOX........',
    '........XOOOWPWOOOX........',
    '........XSOOWWWOOSX........',
    '.........XSOOWOOSX.........',
    '.....X..XODOWWWODOX........',
    '....XOX.XOOOWWWOOOX........',
    '...XOX.XODOOWWWOODOX.......',
    '...XOX.XOOOOWWWOOOOX.......',
    '...XOXXXOOOOOWOOOOSX.......',
    '....XOOOOWWOOOOOWWSX.......',
    '.....XXXXXXXXXXXXXX........',
  ],
  pounce: [
    '................X.....X....',
    '...............XOX...XOX...',
    '..............XOEOXXXOEOX..',
    '....X.........XOOODODOOOX..',
    '...XOX........XOOOOOOOOOX..',
    '..XOX.........XOKKOOOKKOX..',
    '..XOX.........XOKHOOOKHOX..',
    '..XOX.........XOOOWPWOOOX..',
    '..XOXXXXXXXXXXXSOOWWWOOSX..',
    '...XOOOODOODOOOOSOOWOOSX...',
    '...XOOOODOODOOOOOWWXXXXX...',
    '...XOOOODOODOOOOOWWXXOOWX..',
    '...XOOOOOOOOOOOOOWWOOXXX...',
    '...XSSSSSSSSSSSSSSSOOOWX...',
    '....XOOXOOXXXXXXXXXXXXX....',
    '....XOOXOOX................',
    '....XWWXWWX................',
    '.....XX.XX.................',
  ],
  sleep: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '................X...X......',
    '......XXXXXXXXXXOXXXOX.....',
    '....XXOODOODOOOOEOOOEOX....',
    '...XOOODOODOOOOOOOOOOOOX...',
    '..XOOOODOODOOOOOOOOOOOOX...',
    '.XOOOOOOOOOOOOOOKKOOOKKOX..',
    '.XOOOOOOOOOOOOOOOOOOWPWOX..',
    '.XSSSSSSSSSSSSSSSSSSWWWSX..',
    'XOOOOOOOOOOOOOOOOOOOOOXX...',
    '.XXXXXXXXXXXXXXXXXXXXX.....',
  ],
  groomA: [
    '...........................',
    '..........X.....X..........',
    '.........XOX...XOX.........',
    '........XOEOXXXOEOX........',
    '........XOOODODOOOX........',
    '........XOOOOOOOOOX........',
    '........XOOOOOOOOOX........',
    '........XOKKOOOKKOX........',
    '........XOOOWPWOOOX........',
    '........XSOOWWPOOSX........',
    '.........XSOOWOWWX.........',
    '.....X..XODOWWWWWOX........',
    '....XOX.XOOOWWWOOOX........',
    '...XOX.XODOOWWWOODOX.......',
    '...XOX.XOOOOWWWOOOOX.......',
    '...XOXXXOOOOOWOOOOSX.......',
    '....XOOOOWWOOOOOWWSX.......',
    '.....XXXXXXXXXXXXXX........',
  ],
  groomB: [
    '...........................',
    '..........X.....X..........',
    '.........XOX...XOX.........',
    '........XOEOXXXOEOX........',
    '........XOOODODOOOX........',
    '........XOOOOOOOOOX........',
    '........XOOOOOOOOOX........',
    '........XOKKOOOKKOX........',
    '........XOOOWPWOOOX........',
    '........XSOOWWWOOSX........',
    '.........XSOOWOOSX.........',
    '.....X..XODOWWWODOX........',
    '....XOX.XOOOWWWWWOX........',
    '...XOX.XODOOWWWWWDOX.......',
    '...XOX.XOOOOWWWOOOOX.......',
    '...XOXXXOOOOOWOOOOSX.......',
    '....XOOOOWWOOOOOWWSX.......',
    '.....XXXXXXXXXXXXXX........',
  ],
  stretch: [
    '...........................',
    '...........................',
    '...........................',
    '.X.........................',
    'XOX........................',
    'XOX........................',
    '.XOXXXXX...................',
    '.XOOOOOOXXX................',
    '.XODOODOOOOXX.....X.....X..',
    '.XOOODOODOOOOXX..XOX...XOX.',
    '.XOOOOODOODOOOOXXOEOXXXOEOX',
    '.XOOXSSSOOOOOOOOOOOODODOOOX',
    '.XOOXXXXSSSOOOOOOOOOOOOOOOX',
    '.XOOX...XXXSSOOOOOOKKOOOKKX',
    '.XOOX......XXSOOOOOKHOOOKHX',
    '.XOOX.......XXOOOOOOOOWPWOX',
    '.XWWX......XWWWWWWWSOWWWOSX',
    '..XX........XXXXXXXXXXXXXX.',
  ],
  lookUp: [
    '...........................',
    '..........X.....X..........',
    '.........XOX...XOX.........',
    '........XOEOXXXOEOX........',
    '........XOOODODOOOX........',
    '........XOKKOOOKKOX........',
    '........XOKHOOOKHOX........',
    '........XOOOOOOOOOX........',
    '........XOOOWPWOOOX........',
    '........XSOOWWWOOSX........',
    '.........XSOOWOOSX.........',
    '.....X..XODOWWWODOX........',
    '....XOX.XOOOWWWOOOX........',
    '...XOX.XODOOWWWOODOX.......',
    '...XOX.XOOOOWWWOOOOX.......',
    '...XOXXXOOOOOWOOOOSX.......',
    '....XOOOOWWOOOOOWWSX.......',
    '.....XXXXXXXXXXXXXX........',
  ],
};

/** The dog: floppy ears (D) down the sides of the head, a patch (D) on the back, a short tail that wags. */
export const DOG: FrameSet = {
  stand: [
    '...........................',
    '.................XXXXXX....',
    '................XOOOOOOX...',
    '...............XOOOOOOOOX..',
    '..............XDDOOOOOODDX.',
    '.X............XDDKKOOKKDDX.',
    'XOX...........XDDKHOOKHDDX.',
    '.XOX..........XDDOWWWWODDX.',
    '.XOXXXXXXXXXXXXXDWWPPWWDX..',
    '..XOOOOOODDOOOOOOOWWWWOX...',
    '...XOOOODDDDOOOOOWSOOSX....',
    '...XOOOOODDOOOOOOWWXXX.....',
    '...XOOOOOOOOOOOOOWWX.......',
    '...XSSSSSSSSSSSSSSSX.......',
    '....XOOXOOXXXXXOOXOOX......',
    '....XOOXOOX...XOOXOOX......',
    '....XWWXWWX...XWWXWWX......',
    '.....XX.XX.....XX.XX.......',
  ],
  walkA: [
    '...........................',
    '.................XXXXXX....',
    '................XOOOOOOX...',
    '...............XOOOOOOOOX..',
    '..............XDDOOOOOODDX.',
    '.X............XDDKKOOKKDDX.',
    'XOX...........XDDKHOOKHDDX.',
    '.XOX..........XDDOWWWWODDX.',
    '.XOXXXXXXXXXXXXXDWWPPWWDX..',
    '..XOOOOOODDOOOOOOOWWWWOX...',
    '...XOOOODDDDOOOOOWSOOSX....',
    '...XOOOOODDOOOOOOWWXXX.....',
    '...XOOOOOOOOOOOOOWWX.......',
    '...XSSSSSSSSSSSSSSSX.......',
    '....XOOXOOXXXXXOOXOOX......',
    '...XOOX.XOOX.XOOX.XOOX.....',
    '..XWWX...XWWXWWX...XWWX....',
    '...XX.....XX.XX.....XX.....',
  ],
  walkB: [
    '.................XXXXXX....',
    '................XOOOOOOX...',
    '...............XOOOOOOOOX..',
    '..............XDDOOOOOODDX.',
    '....X.........XDDKKOOKKDDX.',
    '...XOX........XDDKHOOKHDDX.',
    '..XOX.........XDDOWWWWODDX.',
    '..XOXXXXXXXXXXXXDWWPPWWDX..',
    '..XOOOOOODDOOOOOOOWWWWOX...',
    '...XOOOODDDDOOOOOWSOOSX....',
    '...XOOOOODDOOOOOOWWXXX.....',
    '...XOOOOOOOOOOOOOWWX.......',
    '...XSSSSSSSSSSSSSSSX.......',
    '....XXOOXOOXXXXOOXOOX......',
    '.....XOOXOOX..XOOXOOX......',
    '.....XOOXOOX..XOOXOOX......',
    '.....XWWXWWX..XWWXWWX......',
    '......XX.XX....XX.XX.......',
  ],
  sit: [
    '...........................',
    '..........XXXXXX...........',
    '.........XOOOOOOX..........',
    '........XOOOOOOOOX.........',
    '.......XDDOOOOOODDX........',
    '.......XDDKKOOKKDDX........',
    '.......XDDKHOOKHDDX........',
    '.......XDDOWWWWODDX........',
    '........XDWWPPWWDX.........',
    '.........XOWWWWOX..........',
    '.........XOSOOSOXX.........',
    '........XOOOWWOOOOX........',
    '....X...XODDWWOOOOX........',
    '...XOX.XOODDWWOOOOOX.......',
    '...XOX.XOOOOWWOOOOOX.......',
    '....XOXXOOOOOOOOOOSX.......',
    '.....XOOOWWOOOOOWWSX.......',
    '......XXXXXXXXXXXXX........',
  ],
  blink: [
    '...........................',
    '..........XXXXXX...........',
    '.........XOOOOOOX..........',
    '........XOOOOOOOOX.........',
    '.......XDDOOOOOODDX........',
    '.......XDDOOOOOODDX........',
    '.......XDDKKOOKKDDX........',
    '.......XDDOWWWWODDX........',
    '........XDWWPPWWDX.........',
    '.........XOWWWWOX..........',
    '.........XOSOOSOXX.........',
    '........XOOOWWOOOOX........',
    '....X...XODDWWOOOOX........',
    '...XOX.XOODDWWOOOOOX.......',
    '...XOX.XOOOOWWOOOOOX.......',
    '....XOXXOOOOOOOOOOSX.......',
    '.....XOOOWWOOOOOWWSX.......',
    '......XXXXXXXXXXXXX........',
  ],
  pounce: [
    '.................XXXXXX....',
    '................XOOOOOOX...',
    '...............XOOOOOOOOX..',
    '..............XDDOOOOOODDX.',
    '..............XDDKKOOKKDDX.',
    '....X.........XDDKHOOKHDDX.',
    '...XOX........XDDOWWWWODDX.',
    '..XOX..........XDWWPPWWDX..',
    '..XOXXXXXXXXXXXXXOWWWWOX...',
    '..XOOOOOODDOOOOOOOSOOSX....',
    '...XOOOODDDDOOOOOWWXXXXX...',
    '...XOOOOODDOOOOOOWWXXOOWX..',
    '...XOOOOOOOOOOOOOWWOOXXX...',
    '...XSSSSSSSSSSSSSSSOOOWX...',
    '....XOOXOOXXXXXXXXXXXXX....',
    '....XOOXOOX................',
    '....XWWXWWX................',
    '.....XX.XX.................',
  ],
  sleep: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '................XXXXXX.....',
    '......XXXXXXXXXXOOOOOOX....',
    '....XXOOOODDOOOOOOOOOOOXX..',
    '...XOOOODDDDOOOODDOOOOODDX.',
    '..XOOOOOODDOOOOODDKKOOKKDX.',
    '.XOOOOOOOOOOOOOODDOWWWWODX.',
    '.XOOOOOOOOOOOOOOODWWPPWDX..',
    '.XSSSSSSSSSSSSSSSSSWWWWSX..',
    '..XOOOOOOOOOOOOOOOOOOOXX...',
    '...XXXXXXXXXXXXXXXXXXX.....',
  ],
  groomA: [
    '...........................',
    '..........XXXXXX...........',
    '.........XOOOOOOX..........',
    '........XOOOOOOOOX.........',
    '.......XDDOOOOOODDXX.......',
    '.......XDDOOOOOODDWWX......',
    '.......XDDKKOOKKDDWWX......',
    '.......XDDOWWWWODDOX.......',
    '........XDWWPPWWDXOX.......',
    '.........XOWWWWOXXOX.......',
    '.........XOSOOSOXXX........',
    '........XOOOWWOOOOX........',
    '....X...XODDWWOOOOX........',
    '...XOX.XOODDWWOOOOOX.......',
    '...XOX.XOOOOWWOOOOOX.......',
    '....XOXXOOOOOOOOOOSX.......',
    '.....XOOOWWOOOOOWWSX.......',
    '......XXXXXXXXXXXXX........',
  ],
  groomB: [
    '...........................',
    '..........XXXXXX...........',
    '.........XOOOOOOX..........',
    '........XOOOOOOOOX.........',
    '.......XDDOOOOOODDX........',
    '.......XDDOOOOOODDX........',
    '.......XDDKKOOKKDDXX.......',
    '.......XDDOWWWWODDWWX......',
    '........XDWWPPWWDXWWX......',
    '.........XOWWWWOXXOX.......',
    '.........XOSOOSOXXX........',
    '........XOOOWWOOOOX........',
    '....X...XODDWWOOOOX........',
    '...XOX.XOODDWWOOOOOX.......',
    '...XOX.XOOOOWWOOOOOX.......',
    '....XOXXOOOOOOOOOOSX.......',
    '.....XOOOWWOOOOOWWSX.......',
    '......XXXXXXXXXXXXX........',
  ],
  stretch: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.X.........................',
    'XOX........................',
    '.XOXXXXX...................',
    '.XOOOOOOXXX................',
    '.XOOODDOOOOXX.....XXXXXX...',
    '.XOODDDDOOOOOXX..XOOOOOOX..',
    '.XOOODDOOOOOOOOXXOOOOOOOOX.',
    '.XOOXSSSOOOOOOOODDOOOOOODDX',
    '.XOOXXXXSSSOOOOODDKKOOKKDDX',
    '.XOOX...XXXSSOOODDKHOOKHDDX',
    '.XOOX......XXSOODDOWWWWODDX',
    '.XOOX.......XXOOXDWWPPWWDX.',
    '.XWWX......XWWWWWWSOWWWWOSX',
    '..XX........XXXXXXXXXXXXXX.',
  ],
  lookUp: [
    '...........................',
    '..........XXXXXX...........',
    '.........XOOOOOOX..........',
    '........XOOOOOOOOX.........',
    '.......XDDKKOOKKDDX........',
    '.......XDDKHOOKHDDX........',
    '.......XDDOOOOOODDX........',
    '.......XDDOWWWWODDX........',
    '........XDWWPPWWDX.........',
    '.........XOWWWWOX..........',
    '.........XOSOOSOXX.........',
    '........XOOOWWOOOOX........',
    '....X...XODDWWOOOOX........',
    '...XOX.XOODDWWOOOOOX.......',
    '...XOX.XOOOOWWOOOOOX.......',
    '....XOXXOOOOOOOOOOSX.......',
    '.....XOOOWWOOOOOWWSX.......',
    '......XXXXXXXXXXXXX........',
  ],
};

/**
 * The turtle (2026-10-20): slower than the others, head out to the right. O is
 * the shell, D the scutes on it, W the skin (head, legs, tail); no nose.
 */
export const TURTLE: FrameSet = {
  stand: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.......XXXXXXXX............',
    '.....XXOOOOOOOOXX....XXX...',
    '....XOODDOODDOODOX..XWWWX..',
    '...XODDOODDOODDOOOXXWWWKHX.',
    '..XODOODDOODDOODDOOWWWWWWX.',
    '..XOOOOOOOOOOOOOOOOWWWWWX..',
    '.XWSSSSSSSSSSSSSSSSXXXXX...',
    'XWXXWWXXWWXXXWWXWWX........',
    '.X.XWWXXWWX.XWWXWWX........',
    '....XX..XX...XX.XX.........',
  ],
  walkA: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.......XXXXXXXX............',
    '.....XXOOOOOOOOXX....XXX...',
    '....XOODDOODDOODOX..XWWWX..',
    '...XODDOODDOODDOOOXXWWWKHX.',
    '..XODOODDOODDOODDOOWWWWWWX.',
    '..XOOOOOOOOOOOOOOOOWWWWWX..',
    '.XWSSSSSSSSSSSSSSSSXXXXX...',
    'XWXWWXXXXWWXWWXXXWWX.......',
    '.XXWWX..XWWXWWX.XWWX.......',
    '...XX....XX.XX...XX........',
  ],
  walkB: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.......XXXXXXXX............',
    '.....XXOOOOOOOOXX.....XXX..',
    '....XOODDOODDOODOX...XWWWX.',
    '...XODDOODDOODDOOOXXXWWWKHX',
    '..XODOODDOODDOODDOOWWWWWWWX',
    '..XOOOOOOOOOOOOOOOOWWWWWWX.',
    '.XWSSSSSSSSSSSSSSSSXXXXXX..',
    'XWXXXWWWWXXXXXWWWXX........',
    '.X..XWWWWX...XWWWX.........',
    '.....XXXX.....XXX..........',
  ],
  sit: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.......XXXXXXXX............',
    '.....XXOOOOOOOOXX....XXX...',
    '....XOODDOODDOODOX..XWWWX..',
    '...XODDOODDOODDOOOXXWWWKHX.',
    '..XODOODDOODDOODDOOXWWWWWX.',
    '..XOOOOOOOOOOOOOOOOWWWWWX..',
    '.XWSSSSSSSSSSSSSSSSXXXXX...',
    'XWXXWWXXWWXXXWWXWWX........',
    '.X..XX..XX...XX.XX.........',
  ],
  blink: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.......XXXXXXXX............',
    '.....XXOOOOOOOOXX....XXX...',
    '....XOODDOODDOODOX..XWWWX..',
    '...XODDOODDOODDOOOXXWWWWWX.',
    '..XODOODDOODDOODDOOXWWWKKX.',
    '..XOOOOOOOOOOOOOOOOWWWWWX..',
    '.XWSSSSSSSSSSSSSSSSXXXXX...',
    'XWXXWWXXWWXXXWWXWWX........',
    '.X..XX..XX...XX.XX.........',
  ],
  pounce: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '......................XXX..',
    '.....................XWWWX.',
    '....................XWWWKHX',
    '.......XXXXXXXX.....XWWWWWX',
    '.....XXOOOOOOOOXX...XWWWWX.',
    '....XOODDOODDOODOX..XWWXX..',
    '...XODDOODDOODDOOOXXWXX....',
    '..XODOODDOODDOODDOOWWX.....',
    '..XOOOOOOOOOOOOOOOOXX......',
    '.XWSSSSSSSSSSSSSSSSX.......',
    'XWXXWWXXWWXXXWWXWWX........',
    '.X.XWWXXWWX.XWWXWWX........',
    '....XX..XX...XX.XX.........',
  ],
  sleep: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.......XXXXXXXX............',
    '.....XXOOOOOOOOXX..........',
    '....XOODDOODDOODOX.XX......',
    '...XODDOODDOODDOOOXKWX.....',
    '..XODOODDOODDOODDOOXX......',
    '..XOOOOOOOOOOOOOOOOX.......',
    '.XWSSSSSSSSSSSSSSSSX.......',
    'XWXXWWXXWWXXXWWXWWX........',
    '.X..XX..XX...XX.XX.........',
  ],
  groomA: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.......XXXXXXXX............',
    '.....XXOOOOOOOOXX..........',
    '....XOODDOODDOODOX.........',
    '...XODDOODDOODDOOOX...XXX..',
    '..XODOODDOODDOODDOOXXXWWWX.',
    '..XOOOOOOOOOOOOOOOOWWWWWWWX',
    '.XWSSSSSSSSSSSSSSSSXXWWWKKX',
    'XWXXWWXXWWXXXWWXWWX..XWWWX.',
    '.X.XWWXXWWX.XWWXWWX...XXX..',
    '....XX..XX...XX.XX.........',
  ],
  groomB: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.......XXXXXXXX............',
    '.....XXOOOOOOOOXX..........',
    '....XOODDOODDOODOX.........',
    '...XODDOODDOODDOOOX........',
    '..XODOODDOODDOODDOOX..XXX..',
    '..XOOOOOOOOOOOOOOOOXXXWWWX.',
    '.XWSSSSSSSSSSSSSSSSWWWWWKHX',
    'XWXXWWXXWWXXXWWXXXXXXWWWWWX',
    '.X.XWWXXWWX.XWWX.....XWWWX.',
    '....XX..XX...XX.......XXX..',
  ],
  stretch: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.......XXXXXXXX............',
    '.....XXOOOOOOOOXX.....XXX..',
    '....XOODDOODDOODOX...XWWWX.',
    '...XODDOODDOODDOOOXXXWWWKHX',
    '..XODOODDOODDOODDOOWWWWWWWX',
    '..XOOOOOOOOOOOOOOOOWWWWWWX.',
    '.XWSSSSSSSSSSSSSSSSXXXXXX..',
    'XWXWWXXXWWXXXWWXXXWWX......',
    '.XXWWX.XWWX.XWWX.XWWX......',
    '...XX...XX...XX...XX.......',
  ],
  lookUp: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '.....................XXX...',
    '....................XWWWX..',
    '.......XXXXXXXX....XWWWKHX.',
    '.....XXOOOOOOOOXX..XWWWWWX.',
    '....XOODDOODDOODOX..XWWWX..',
    '...XODDOODDOODDOOOXXWWXX...',
    '..XODOODDOODDOODDOOWWX.....',
    '..XOOOOOOOOOOOOOOOOXX......',
    '.XWSSSSSSSSSSSSSSSSX.......',
    'XWXXWWXXWWXXXWWXWWX........',
    '.X.XWWXXWWX.XWWXWWX........',
    '....XX..XX...XX.XX.........',
  ],
};

/**
 * The frog (2026-10-25): sits facing you like the cat, hops side-on to get
 * about, and flicks its tongue (P) at the ball. O is its skin, D the spots,
 * W the belly and feet, E the blush on its cheeks.
 */
export const FROG: FrameSet = {
  stand: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '..............XXXX.........',
    '.............XOOOOX........',
    '.............XOKKOX........',
    '..........XXXXOKHOOX.......',
    '.......XXXOODOOOOOOX.......',
    '.....XXOODOOOOOOOEOOX......',
    '....XODOOOOOOOOXXXXXXX.....',
    '....XOOOOXXXXOOSWWWWX......',
    '...XOOOXOOOODXOSSWWX.......',
    '...XOOXOODOOOXOOXWWX.......',
    '...XSSXSSSSSXWWXXWWX.......',
    '..XWWWWWWXXXXXXXWWWWX......',
    '...XXXXXX.......XXXX.......',
  ],
  walkA: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '..............XXXX.........',
    '.............XOOOOX........',
    '.............XOKKOX........',
    '..........XXXXOKHOOX.......',
    '.......XXXOODOOOOOOX.......',
    '.....XXOODOOOOOOOEOOX......',
    '....XODOOOOOOOOXXXXXXX.....',
    '....XOOOOXXXXOOSWWWWX......',
    '...XOOOXOOOODXOSSWWX.......',
    '...XOOXOODOOOXOOXWWX.......',
    '...XSSXSSSSSXWWXXWWX.......',
    '..XWWWWWWXXXXXXXWWWWX......',
    '...XXXXXX.......XXXX.......',
  ],
  walkB: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '..............XXXX.........',
    '.............XOOOOX........',
    '.............XOKKOX........',
    '..........XXXXOKHOOX.......',
    '.......XXXOODOOOOOOX.......',
    '.....XXOODOOOOOOOEOOX......',
    '....XODOOOOOOOOXXXXXXX.....',
    '....XOOOOXXXXOOSWWWWX......',
    '...XOOOOOOOOOOOSSWWX.......',
    '..XSSSSSSSSSSXXXXWWWX......',
    '.XWWXXXXXXXXX....XWWX......',
    'XWWX..............XX.......',
    'XWX........................',
    '.X.........................',
  ],
  sit: [
    '...........................',
    '...........................',
    '......XXXX.......XXXX......',
    '.....XOOOOX.....XOOOOX.....',
    '.....XOKKOX.....XOKKOX.....',
    '.....XOKHOXXXXXXXOKHOX.....',
    '....XOOOOOOOOOOOOOOOOOX....',
    '....XOEEXOOOOOOOOOXEEOX....',
    '....XSOOOXXXXXXXXXOOOSX....',
    '....XSOOOOOWWWWWOOOOOSX....',
    '...XOOOOOWWWWWWWWWOOOOOX...',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XOOOOXOWWWWWWWWWOXOOOOX..',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XSOOOXOSWWWWWWWSOXOOOSX..',
    '..XSSSOXWWXSSSSSXWWXOSSSX..',
    '.XWWWXXXWWXXXXXXXWWXXXWWWX.',
    '..XXX..XXX.......XXX..XXX..',
  ],
  blink: [
    '...........................',
    '...........................',
    '......XXXX.......XXXX......',
    '.....XOOOOX.....XOOOOX.....',
    '.....XOOOOX.....XOOOOX.....',
    '.....XKKKKXXXXXXXKKKKX.....',
    '....XOOOOOOOOOOOOOOOOOX....',
    '....XOEEXOOOOOOOOOXEEOX....',
    '....XSOOOXXXXXXXXXOOOSX....',
    '....XSOOOOOWWWWWOOOOOSX....',
    '...XOOOOOWWWWWWWWWOOOOOX...',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XOOOOXOWWWWWWWWWOXOOOOX..',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XSOOOXOSWWWWWWWSOXOOOSX..',
    '..XSSSOXWWXSSSSSXWWXOSSSX..',
    '.XWWWXXXWWXXXXXXXWWXXXWWWX.',
    '..XXX..XXX.......XXX..XXX..',
  ],
  pounce: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '..............XXXX.........',
    '.............XOOOOX........',
    '.............XOKKOX........',
    '..........XXXXOKHOOX.......',
    '.......XXXOODOOOOOOX.......',
    '.....XXOODOOOOOOOEOOXXXXXX.',
    '....XODOOOOOOOOXXXXXXXPPPPX',
    '....XOOOOXXXXOOSWWWWX.XXXX.',
    '...XOOOXOOOODXOSSWWX.......',
    '...XOOXOODOOOXOOXWWX.......',
    '...XSSXSSSSSXWWXXWWX.......',
    '..XWWWWWWXXXXXXXWWWWX......',
    '...XXXXXX.......XXXX.......',
  ],
  sleep: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '..............XXXX.........',
    '.............XOOOOX........',
    '.............XOOOOX........',
    '..........XXXXOKKKOX.......',
    '.......XXXOODOOOOOOX.......',
    '.....XXOODOOOOOOOEOOX......',
    '....XODOOOOOOOOXXXXXXX.....',
    '....XOOOOXXXXOOSWWWWX......',
    '...XOOOXOOOODXOSSWWX.......',
    '...XOOXOODOOOXOOXWWX.......',
    '...XSSXSSSSSXWWXXWWX.......',
    '..XWWWWWWXXXXXXXWWWWX......',
    '...XXXXXX.......XXXX.......',
  ],
  groomA: [
    '...........................',
    '...........................',
    '......XXXX.......XXXX......',
    '.....XOOOOX.....XOOOOX.....',
    '.....XOKKOX.....XOKKOX.....',
    '.....XOKHOXXXXXXXOKHOX.....',
    '....XOOOOOOOOOOOOOOOOOX....',
    '....XOEEXOOOOOOOOOXEEOX....',
    '....XSOOOXXXXPXXXXOOOSX....',
    '....XSOOOOOWWPWWOOOOOSX....',
    '...XOOOOOWWWWWWWWWOOOOOX...',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XOOOOXOWWWWWWWWWOXOOOOX..',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XSOOOXOSWWWWWWWSOXOOOSX..',
    '..XSSSOXWWXSSSSSXWWXOSSSX..',
    '.XWWWXXXWWXXXXXXXWWXXXWWWX.',
    '..XXX..XXX.......XXX..XXX..',
  ],
  groomB: [
    '...........................',
    '...........................',
    '......XXXX.......XXXX......',
    '.....XOOOOX.....XOOOOX.....',
    '.....XOKKOX.....XOKKOX.....',
    '.....XOKHOXXXXXXXOKHOX.....',
    '....XOOOOOOOOOOOOOOOOOX....',
    '....XOEEXOOOOOOOOOXEEOX....',
    '....XSOOOXXXXXXXXXPPOSX....',
    '....XSOOOOOWWWWWOOOOOSX....',
    '...XOOOOOWWWWWWWWWOOOOOX...',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XOOOOXOWWWWWWWWWOXOOOOX..',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XSOOOXOSWWWWWWWSOXOOOSX..',
    '..XSSSOXWWXSSSSSXWWXOSSSX..',
    '.XWWWXXXWWXXXXXXXWWXXXWWWX.',
    '..XXX..XXX.......XXX..XXX..',
  ],
  stretch: [
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '...........................',
    '..............XXXX.........',
    '.............XOOOOX........',
    '.............XOOOOX........',
    '..........XXXXOKKKOX.......',
    '.......XXXOODOOOOOOX.......',
    '.....XXOODOOOOOOOEOOX......',
    '....XODOOOOOOOOXXXXXXX.....',
    '....XOOOOXXXXOOSWWWWX......',
    '...XOOOXOOOOOOOSSWWX.......',
    '..XXXXXXSSSSSXOOXWWX.......',
    'XXWWWWWWXXXXXXWWXWWX.......',
    '.XXXXXXX......XXXXXX.......',
  ],
  lookUp: [
    '...........................',
    '...........................',
    '......XXXX.......XXXX......',
    '.....XOKKOX.....XOKKOX.....',
    '.....XOKHOX.....XOKHOX.....',
    '.....XOOOOXXXXXXXOOOOX.....',
    '....XOOOOOOOOOOOOOOOOOX....',
    '....XOEEXOOOOOOOOOXEEOX....',
    '....XSOOOXXXXXXXXXOOOSX....',
    '....XSOOOOOWWWWWOOOOOSX....',
    '...XOOOOOWWWWWWWWWOOOOOX...',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XOOOOXOWWWWWWWWWOXOOOOX..',
    '..XODOOXOWWWWWWWWWOXOODOX..',
    '..XSOOOXOSWWWWWWWSOXOOOSX..',
    '..XSSSOXWWXSSSSSXWWXOSSSX..',
    '.XWWWXXXWWXXXXXXXWWXXXWWWX.',
    '..XXX..XXX.......XXX..XXX..',
  ],
};

type Grid = string[][];

/**
 * Scatter dark spots over a cat's fur, tabby stripes gone. `pairs` makes each spot two
 * pixels wide (the jaguar's heavier rosettes); `every` sets how sparse they are.
 */
function spots(rows: string[], { every = 5, pairs = false }: { every?: number; pairs?: boolean } = {}): Grid {
  const out = rows.map((row) => [...row.replace(/D/g, 'O')]);
  // The back and tail bob a row on some walk frames while the head stays put, so the
  // spots there are placed from the back line, not the frame; otherwise they hold still
  // while the body slides under them (owner, 2026-10-28: "the leopard walking is really
  // weird"). Legs get none, since theirs would jump about every step.
  const back = rows.findIndex((row) => /X{8,}/.test(row));
  const belly = rows.findIndex((row) => /S{8,}/.test(row));
  const isSpot = (y: number, x: number) => out[y]?.[x] === 'D';
  // Scattered dark pixels (a fixed hash, so every frame matches), never touching
  // another spot, so the coat reads as spotted rather than striped.
  out.forEach((row, y) =>
    row.forEach((px, x) => {
      if (belly >= 0 && y >= belly) return;
      const py = back >= 0 && x < 15 ? y - back + 8 : y;
      if (px !== 'O' || (x * 7 + py * 11 + ((x * py) % 5)) % every !== 0) return;
      const wide = pairs && row[x + 1] === 'O';
      for (const dx of wide ? [-1, 0, 1, 2] : [-1, 0, 1]) {
        if (isSpot(y - 1, x + dx) || (dx !== 0 && dx !== 1 && isSpot(y, x + dx))) return;
      }
      row[x] = 'D';
      if (wide) row[x + 1] = 'D';
    }),
  );
  return out;
}

/** A pointed tip: a lone outline pixel with fur (or inner ear) right under it. Ears sit right of x 8, the tail left of it. */
function eachTip(out: Grid, minX: number, fn: (y: number, x: number) => void) {
  const tips: [number, number][] = [];
  out.forEach((row, y) =>
    row.forEach((px, x) => {
      if (x < minX || px !== 'X' || row[x - 1] !== '.' || row[x + 1] !== '.' || out[y - 1]?.[x] === 'X') return;
      const below = out[y + 1]?.[x];
      if (below === 'O' || below === 'E') tips.push([y, x]);
    }),
  );
  tips.forEach(([y, x]) => fn(y, x));
}

/** Small rounded ears: drop each pointed tip and close the ear off flat just under it. */
function roundEars(out: Grid): Grid {
  // From x 0, so the tail's tip is softened too (as the leopard always had it).
  eachTip(out, 0, (y, x) => {
    out[y][x] = '.';
    out[y + 1][x] = 'X';
  });
  return out;
}

/** The bobcat's tufted ears: a dark tip, and a tuft above it where the frame has room. */
function tuftEars(out: Grid): Grid {
  eachTip(out, 8, (y, x) => {
    out[y + 1][x] = 'D';
    if (y > 0) out[y - 1][x] = 'X';
  });
  return out;
}

const FRONT_FACING: FrameName[] = ['sit', 'blink', 'groomA', 'groomB', 'lookUp'];

/** A bobbed tail: the cat's tail cut down to a two-pixel stub with a rounded end. */
function bobTail(name: FrameName, out: Grid): Grid {
  const clear = (y0: number, y1: number, x1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = 0; x < x1; x++) if (out[y]) out[y][x] = '.';
  };
  if (FRONT_FACING.includes(name)) {
    // The tail curls up the left side, rows 11 to 16; keep the bottom two rows.
    clear(11, 13, 7);
    out[13][4] = 'X';
  } else if (name === 'stretch') {
    clear(3, 4, 3);
    out[4][1] = 'X';
  } else if (name !== 'sleep') {
    // Standing: the tail rises from the back line; keep the two rows above it.
    const back = out.findIndex((row) => /X{8,}/.test(row.join('')));
    if (back >= 3) {
      clear(0, back - 3, 6);
      out[back - 3][3] = 'X';
    }
  }
  return out;
}

const join = (out: Grid) => out.map((row) => row.join(''));

function eachFrame(set: FrameSet, fn: (name: FrameName, rows: string[]) => string[]): FrameSet {
  return Object.fromEntries(Object.entries(set).map(([name, rows]) => [name, fn(name as FrameName, rows)])) as FrameSet;
}

/**
 * The leopard (2026-10-26, owner's at first; a big cat for the first hundred since
 * 2026-11-03): the cat's poses with its tabby stripes swapped for spots and its ears
 * rounded off, drawn bigger (see SIZE).
 */
export const LEOPARD: FrameSet = eachFrame(CAT, (_, rows) => join(roundEars(spots(rows))));

/** The bobcat (2026-11-03): spotted, with tufted ears and a bobbed tail. */
export const BOBCAT: FrameSet = eachFrame(CAT, (name, rows) => join(tuftEars(bobTail(name, spots(rows, { every: 6 })))));

/** The jaguar (2026-11-03): heavier, paired spots, rounded ears, the biggest cat (see SIZE). */
export const JAGUAR: FrameSet = eachFrame(CAT, (_, rows) => join(roundEars(spots(rows, { every: 6, pairs: true }))));

/** The wild cats: premium chillers, for app admins and the first hundred people to join (`set_pet` checks). */
export const BIG_CATS = ['leopard', 'bobcat', 'jaguar'] as const;

export type CritterKind = 'cat' | 'dog' | 'turtle' | 'frog' | 'leopard' | 'bobcat' | 'jaguar';

export const FRAMES: Record<CritterKind, FrameSet> = { cat: CAT, dog: DOG, turtle: TURTLE, frog: FROG, leopard: LEOPARD, bobcat: BOBCAT, jaguar: JAGUAR };

/**
 * How big each animal draws, relative to the frame (owner, 2026-10-26: "the frog is huge,
 * it's bigger than the cat and dog"; the leopard should read bigger than a house cat).
 * It grows or shrinks from the feet up, inside the same footprint, so yards and walks
 * don't change.
 */
export const SIZE: Record<CritterKind, number> = { cat: 1, dog: 1, turtle: 1, frog: 0.78, leopard: 1.22, bobcat: 1.08, jaguar: 1.3 };

/** The scale an animal actually draws at, and how far to shift it so its feet stay put. */
export function spriteBox(kind: CritterKind, scale: number) {
  const s = scale * SIZE[kind];
  return { s, dx: (FRAME_W * (scale - s)) / 2, dy: FRAME_H * (scale - s) };
}

/** How fast each animal gets about, relative to the cat. */
export const PACE: Record<CritterKind, number> = { cat: 1, dog: 1.1, turtle: 0.4, frog: 1.3, leopard: 1.15, bobcat: 1.1, jaguar: 1.05 };

/** A coat: the fur slots, plus its shade and outline (worked out from the fur once, then written down). Eyes, nose and ears are the same for everyone. */
export type Coat = { id: string; label: string; O: string; D: string; W: string; S: string; X: string };

export const COATS: Record<CritterKind, Coat[]> = {
  cat: [
    { id: 'orange', label: 'Orange tabby', O: '#F2A65A', D: '#C8742F', W: '#FFF1DE', S: '#CB8B4C', X: '#5A3415' },
    { id: 'grey', label: 'Grey tabby', O: '#9AA3AD', D: '#6B737C', W: '#F2F4F6', S: '#818991', X: '#303438' },
    { id: 'brown', label: 'Brown tabby', O: '#8A6A4A', D: '#5C4330', W: '#E8D8C4', S: '#74593E', X: '#291E16' },
    { id: 'tuxedo', label: 'Tuxedo', O: '#2B2B33', D: '#1A1A20', W: '#FFF6EC', S: '#494950', X: '#0B0B0E' },
    { id: 'black', label: 'Black', O: '#1F1F26', D: '#15151B', W: '#4A4A55', S: '#3E3E44', X: '#0B0B0E' },
    { id: 'white', label: 'White', O: '#F7F7F2', D: '#E4E4DC', W: '#FFFFFF', S: '#CFCFCB', X: '#676763' },
    { id: 'cream', label: 'Cream', O: '#EFDFC4', D: '#CDB08A', W: '#FFFBF4', S: '#C9BBA5', X: '#5C4F3E' },
    { id: 'calico', label: 'Calico', O: '#F5EBDD', D: '#E08A3C', W: '#FFFFFF', S: '#CEC5BA', X: '#653E1B' },
    { id: 'tortie', label: 'Tortoiseshell', O: '#3B2A24', D: '#C8762F', W: '#E9C9A8', S: '#564843', X: '#0B0B0E' },
    { id: 'siamese', label: 'Siamese', O: '#E8DCC8', D: '#6B4A3A', W: '#F7F0E4', S: '#C3B9A8', X: '#30211A' },
    { id: 'blue', label: 'Blue', O: '#6E7C8C', D: '#525E6B', W: '#DDE3EA', S: '#5C6876', X: '#252A30' },
    { id: 'ginger_white', label: 'Ginger and white', O: '#F0A860', D: '#FFF4E6', W: '#FFFFFF', S: '#CA8D51', X: '#6C4C2B' },
  ],
  dog: [
    { id: 'golden', label: 'Golden', O: '#E0B36A', D: '#B8863F', W: '#FFF1DE', S: '#BC9659', X: '#533C1C' },
    { id: 'chocolate', label: 'Chocolate', O: '#6B4423', D: '#4A2D15', W: '#D9B99B', S: '#5A391D', X: '#211409' },
    { id: 'black_lab', label: 'Black lab', O: '#23232B', D: '#15151B', W: '#3C3C46', S: '#424249', X: '#0B0B0E' },
    { id: 'spotted', label: 'Dalmatian', O: '#FFFFFF', D: '#2B2B33', W: '#F2F2F2', S: '#D6D6D6', X: '#131317' },
    { id: 'husky', label: 'Husky', O: '#8D97A3', D: '#4D5661', W: '#FFFFFF', S: '#767F89', X: '#23272C' },
    { id: 'tan', label: 'Black and tan', O: '#2B2B33', D: '#8B5A2B', W: '#C9A06E', S: '#494950', X: '#0B0B0E' },
    { id: 'corgi', label: 'Corgi', O: '#E39B4A', D: '#C97A2E', W: '#FFF6EC', S: '#BF823E', X: '#5A3715' },
    { id: 'beagle', label: 'Beagle', O: '#D9A066', D: '#2B2B33', W: '#FFFFFF', S: '#B68656', X: '#131317' },
    { id: 'apricot', label: 'Apricot', O: '#E8C39E', D: '#D4A574', W: '#F7E8D6', S: '#C3A485', X: '#5F4A34' },
    { id: 'grey_dog', label: 'Grey', O: '#7E8690', D: '#5A616B', W: '#D5D9DE', S: '#6A7179', X: '#282C30' },
    { id: 'white_dog', label: 'White', O: '#FFFFFF', D: '#EDEDE6', W: '#FFF8EE', S: '#D6D6D6', X: '#6B6B67' },
    { id: 'red', label: 'Red setter', O: '#A14A22', D: '#7A3516', W: '#D28A62', S: '#873E1D', X: '#37180A' },
  ],
  turtle: [
    { id: 'green', label: 'Green', O: '#5E9A5A', D: '#3F7A3E', W: '#8FBF6A', S: '#4F814C', X: '#1C371C' },
    { id: 'olive', label: 'Olive', O: '#7A8B3A', D: '#566327', W: '#A9B86A', S: '#667531', X: '#272D12' },
    { id: 'box', label: 'Box turtle', O: '#8B5E34', D: '#E0A040', W: '#C9A06E', S: '#754F2C', X: '#3F2A17' },
    { id: 'slider', label: 'Slider', O: '#4F7F4A', D: '#2F5A2E', W: '#9FD37A', S: '#426B3E', X: '#152815' },
    { id: 'sea', label: 'Sea turtle', O: '#4C7E8A', D: '#2F5660', W: '#9CC7CF', S: '#406A74', X: '#15272B' },
    { id: 'sandy', label: 'Sandy', O: '#C9A96E', D: '#9C7B46', W: '#E6D3A8', S: '#A98E5C', X: '#46371F' },
  ],
  frog: [
    { id: 'tree', label: 'Tree frog', O: '#6DBE5A', D: '#4A9A3E', W: '#EAF5C8', S: '#5CA14C', X: '#1D3A17' },
    { id: 'bull', label: 'Bullfrog', O: '#7F8A45', D: '#5A6430', W: '#F0E6C0', S: '#6C753B', X: '#2A2E14' },
    { id: 'blue_dart', label: 'Blue dart frog', O: '#3D7FD1', D: '#13213A', W: '#9CC8F2', S: '#346CB2', X: '#0E1A2C' },
    { id: 'strawberry', label: 'Strawberry', O: '#D9453A', D: '#7A1E18', W: '#F7A08A', S: '#B83B31', X: '#3E1210' },
    { id: 'golden', label: 'Golden', O: '#F2C230', D: '#D99A1E', W: '#FFF2B8', S: '#CEA529', X: '#5A420C' },
    { id: 'bubblegum', label: 'Bubblegum', O: '#F4A7B9', D: '#E57E98', W: '#FFE6EC', S: '#CF8E9D', X: '#5E2E3A' },
    { id: 'sandy_toad', label: 'Sandy toad', O: '#C9A66F', D: '#8E6A3C', W: '#F1E3C2', S: '#AA8B5C', X: '#4A3518' },
  ],
  leopard: [
    { id: 'snow_leopard', label: 'Snow leopard', O: '#DDDAD2', D: '#4B4C53', W: '#F7F5F0', S: '#BDB8AD', X: '#2D2E33' },
    { id: 'leopard', label: 'Leopard', O: '#E3A94F', D: '#3F2B19', W: '#FFF1DE', S: '#BD8A40', X: '#3A2614' },
  ],
  bobcat: [
    { id: 'tawny', label: 'Tawny', O: '#C99A66', D: '#5A3D24', W: '#F6EBDD', S: '#A88056', X: '#3E2A18' },
    { id: 'grey_bobcat', label: 'Grey', O: '#A69C8E', D: '#4E463D', W: '#F1EDE6', S: '#8A8173', X: '#2F2A24' },
  ],
  jaguar: [
    { id: 'jaguar', label: 'Golden', O: '#E0A445', D: '#2E2014', W: '#FBEBD2', S: '#B9863A', X: '#33230F' },
    { id: 'black_jaguar', label: 'Black jaguar', O: '#2A2A30', D: '#151519', W: '#45454E', S: '#3C3C43', X: '#0B0B0E' },
  ],
};

export const EYE = '#1B2233';
export const NOSE = '#FF9EB5';
export const SHINE = '#FFFFFF';
export const EAR = '#F6A9B8';

export function coatFor(kind: CritterKind, coatId: string | null | undefined): Coat {
  return COATS[kind].find((c) => c.id === coatId) ?? COATS[kind][0];
}

/**
 * SVG path data per palette slot for a frame, so a sprite is five <Path>s
 * instead of a couple of hundred <Rect>s. Each pixel is a square a hair over 1 wide, so
 * neighbours overlap and no seams show between them.
 */
export function framePaths(frame: string[]): Partial<Record<Exclude<Px, '.'>, string>> {
  const out: Partial<Record<Exclude<Px, '.'>, string>> = {};
  frame.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const key = ch as Exclude<Px, '.'>;
      out[key] = `${out[key] ?? ''}M${x} ${y}h1.03v1.03h-1.03z`;
    });
  });
  return out;
}

/**
 * Poses for a cat at work (Observatory, 2026-11-08): at a telescope, typing at
 * a laptop, reading a book. Cat only for now. They're the sitting frame with
 * the eyes moved and a paw out; the props themselves (telescope, laptop, book)
 * are each app's to draw, to its right. The telescope's eyepiece covers the
 * right eye (frame columns 15 to 17, rows 6 and 7), so gazing shuts the left.
 */
export type PoseName = 'gazeA' | 'gazeB' | 'typeA' | 'typeB' | 'readA' | 'readB';

/** Where the sitting cat's eyes are (rows 6 and 7) and its body's right edge (column 19). */
const EYE_ROWS = [6, 7] as const;
const SIDE = 19;

function sitWith(eyes: [string, string], change: (out: Grid) => void = () => {}): string[] {
  const out = CAT.sit.map((row) => [...row]);
  EYE_ROWS.forEach((y, i) => out[y].splice(8, 11, ...eyes[i]));
  change(out);
  return join(out);
}

/** A front paw reached out to the right at row `y`, outlined. */
function pawOut(out: Grid, y: number) {
  out[y][SIDE] = 'O';
  out[y][SIDE + 1] = 'W';
  out[y][SIDE + 2] = 'W';
  out[y][SIDE + 3] = 'X';
  for (const dy of [-1, 1]) {
    out[y + dy][SIDE + 1] = 'X';
    out[y + dy][SIDE + 2] = 'X';
  }
}

/** The tail's tip leaning out a pixel: a flick. */
function tailFlick(out: Grid) {
  out[11][5] = '.';
  out[11][4] = 'X';
  out[12].splice(3, 4, 'X', 'O', 'X', '.');
}

const GAZE_EYES: [string, string] = ['XOOOOOOKKOX', 'XOKKOOOKHOX'];
const TYPE_EYES: [string, string] = ['XOOKKOOOKKX', 'XOOKHOOOKHX'];

export const CAT_POSES: Record<PoseName, string[]> = {
  gazeA: sitWith(GAZE_EYES),
  gazeB: sitWith(GAZE_EYES, tailFlick),
  typeA: sitWith(TYPE_EYES, (out) => pawOut(out, 15)),
  typeB: sitWith(TYPE_EYES, (out) => pawOut(out, 14)),
  readA: sitWith(['XOOOOOOOOOX', 'XOKHOOOKHOX']),
  readB: sitWith(['XOOOOOOOOOX', 'XOOKHOOOKHX']),
};
