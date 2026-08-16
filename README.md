# Sort Wizard — PixiJS

A PixiJS v8 rebuild of the "Sort Wizard" playable ad, reproduced 1:1 from the
original at `playbox.play.plbx.ai/sortwizard/c1`.

> **Assets.** The artwork, audio and fonts under `public/assets/` are taken
> from the original playable and belong to its authors. They are included here
> only so the reconstruction runs; no licence to them is granted by this
> repository. The code is mine, the art is not.

## Running it

```bash
npm install
npm run dev      # vite dev server
npm run build    # lint + production build into dist/
npm run build:single   # everything baked into single/sortwizard.html
npm run lint
```

## Where the numbers come from

The original is a Cocos Creator 3.8 build. Its scene graph was dumped at
runtime (node positions, sizes, component properties, collider shapes) and its
component scripts were read directly, so every number in
[`src/config.js`](src/config.js) is a converted original value, not a
measurement off a screenshot. The conversion is a single uniform factor:
the original's 720x1280 fixed-height world maps onto this project's 750x1624
design space as `design = 1.26875 * world` (`* 0.9` more for anything under
the original's scaled Level node).

The board itself is three of the original's own renders — flat purple, the
wood sheet, and the big purple frame drawn *above* the gameplay, which is what
clips balls and trays at the board's edge. Nothing is drawn procedurally.

## How the game works (the original's rules)

Three pipes, each good for **7 replacement boxes** (the number printed on the
pipe). The starting boxes are pink (centre), orange (left), blue (right);
every replacement takes the next colour from one **global blue → pink →
orange cycle**, regardless of which pipe it comes out of.

A tap empties the box: 9 balls, one every 0.08 s, each tweened 30 px down and
then handed to a Box2D-style simulation (gravity ×10, restitution 0.45, the
original's invisible-wall colliders). Balls that cross the **x3 bar** spawn
two clones each. Everything funnels through the waist onto the belt shoulder,
where a sensor zone feeds the **27-cell conveyor**; captured balls snap onto a
cell in 0.15 s and then ride as a packed train behind the frontmost ball.
While 27 or more balls are loose on the board, taps are refused (the box
shakes).

The receiver grid is 4 columns × 4 rows following the colour tape
**blue, blue, pink, pink, orange, orange** — the four starting rows consume
the first four entries, then each column continues the tape at its own pace.
Only a column's front box is open; a conveyor ball of its colour within reach
is taken, flies a 0.22 s arc into a well, and on the third ball the box rises,
pops, and the column shifts up with a new closed box arriving from below.

You lose when the belt is completely full and none of the colours riding it
match any open box. There is no reachable win state: the tray supply
(9 cycles × 6 rows × 4 columns) far exceeds what 24 boxes of balls can fill,
so a run ends in a fail or simply runs the pipes dry — exactly like the
shipped playable. The FAIL screen is just the badge over the still-running
game (the original's fail window ships without a backdrop or CTA).

The tutorial hand points at the blue box 0.5 s in, replays a click on the
first tap, and after that re-appears every 10 idle seconds over a box whose
colour an open tray wants. The first tap anywhere reveals the "Play Now For
Free" button (the original's texture, anchored to the visible bottom-right).

## Scene editor

Press **E** in the browser (or load with `?edit=1`) to select objects and
adjust their size and position live. Changes are stored in `localStorage` and
can be exported as a minimal diff against the defaults. (The old board-contour
editor is gone — the board is the original's texture now.)
