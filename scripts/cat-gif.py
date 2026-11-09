"""Draw docs/cat.gif, the README's and release page's cat: the sidebar cat at
its telescope under a night sky. It watches, flicks its tail, sees a
shooting star, sits up for a look, and goes back to the glass. The pixel art
comes from src/components/petFrames.ts (the cat from pixel-pets, the
telescope from here), read through Node, so the GIF is the cat the app draws.

    python3 scripts/cat-gif.py   # after changing the cat's frames"""

import math
import os
import random
import json
import subprocess

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "docs", "cat.gif")

W, H = 108, 45  # the scene, in the sprite's pixels (27×18 frames)
SCALE = 4
GROUND = 37  # the row the cat and the tripod stand on
CAT_X = 33
SCOPE_X = CAT_X + 15  # SCOPE_AT in petBrain.ts (EYE_COL), in sprite pixels
TICK = 140  # ms a frame, as in the app

NIGHT = (19, 26, 42)  # --night
HILL = (33, 43, 67)  # --raised
STAR = (230, 233, 242)  # --text
DIM = (92, 102, 130)  # --faint
SCOPE = {
    "T": (157, 180, 255),  # --accent
    "H": (157, 180, 255),
    "B": (92, 102, 130),  # --faint
    "E": (138, 147, 171),  # --muted
    "L": (138, 147, 171),
}


# The frames, the telescope and the cat's colors, as the app has them.
ART = json.loads(
    subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--no-warnings",
            "--input-type=module",
            "-e",
            'import * as f from "./src/components/petFrames.ts";'
            'import * as p from "./src/vendor/pixel-pets/frames.ts";'
            "const c = f.COAT;"
            "console.log(JSON.stringify({ frames: f.FRAMES, telescope: f.TELESCOPE,"
            " colors: { O: c.O, D: c.D, W: c.W, S: c.S, X: c.X, K: p.EYE, H: p.SHINE, P: p.NOSE, E: p.EAR } }));",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
)
CAT = {k: tuple(int(v[i : i + 2], 16) for i in (1, 3, 5)) for k, v in ART["colors"].items()}


def art(name):
    return ART["telescope"] if name == "TELESCOPE" else ART["frames"][name]


def sprite(draw, rows, x0, y0, colors):
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c != ".":
                draw.point((x0 + x, y0 + y), colors[c])


random.seed(7)
STARS = [
    (x, y, random.random())
    for x, y in ((random.randrange(W), random.randrange(GROUND - 9)) for _ in range(60))
    if not (4 <= x <= 21 and y <= 15)  # clear of the moon
]

# The story, one entry a tick: the cat's frame, and what's in the sky.
STORY = (
    ["gazeA"] * 12 + ["gazeB"] * 2 + ["gazeA"] * 6  # watching
    + ["gazeA"] * 10  # a shooting star crosses
    + ["lookUp"] * 14  # sits up to see where it went
    + ["sit", "blink", "sit"] + ["sit"] * 4  # a blink
    + ["gazeA"] * 6 + ["gazeB"] * 2 + ["gazeA"] * 4  # back to the glass
)
METEOR_AT, METEOR_LEN = 20, 12
SPARKLE_AT = 34


def frame(t):
    img = Image.new("RGB", (W, H), NIGHT)
    d = ImageDraw.Draw(img)

    # Twinkling stars, a moon, and a low hill to stand on.
    for x, y, phase in STARS:
        lit = math.sin(t / 3 + phase * 6.3) > -0.2
        d.point((x, y), STAR if lit and phase > 0.5 else DIM)
    d.ellipse((7, 4, 16, 13), fill=(245, 236, 210))
    d.ellipse((10, 3, 19, 12), fill=NIGHT)
    d.rectangle((0, GROUND + 1, W, H), fill=HILL)
    for x in range(0, W, 13):
        d.point((x + 4, GROUND + 4), NIGHT)

    # A shooting star across the telescope's patch of sky, falling left,
    # its tail fading behind it.
    if METEOR_AT <= t < METEOR_AT + METEOR_LEN:
        k = t - METEOR_AT
        hx, hy = W - 2 - k * 4, 1 + k * 2
        for i in range(15, -1, -1):
            a = 1 - i / 16
            d.point((hx + i, hy - i // 2), tuple(int(NIGHT[j] + (STAR[j] - NIGHT[j]) * a) for j in range(3)))

    # Where it went: a star twinkling over the cat's head.
    if SPARKLE_AT <= t < SPARKLE_AT + 12:
        cx, cy = CAT_X + 13, GROUND - 22
        r = 2 if (t - SPARKLE_AT) % 4 < 2 else 1
        gold = (255, 214, 102)
        for i in range(-r, r + 1):
            d.point((cx + i, cy), gold)
            d.point((cx, cy + i), gold)

    # The telescope goes over the cat, its eyepiece on the cat's eye.
    sprite(d, art(STORY[t]), CAT_X, GROUND - 17, CAT)
    sprite(d, art("TELESCOPE"), SCOPE_X, GROUND - 17, SCOPE)
    return img.resize((W * SCALE, H * SCALE), Image.NEAREST)


frames = [frame(t) for t in range(len(STORY))]
frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=TICK, loop=0, optimize=True)
print(f"{OUT}: {len(frames)} frames, {W * SCALE}x{H * SCALE}")
