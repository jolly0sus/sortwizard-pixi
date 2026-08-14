import { Container, Sprite, Text, TextStyle } from "pixi.js";
import { LAYOUT, ECONOMY, PIPE_COLOR_BAGS } from "../config.js";
import { audio } from "../audio.js";
import { spawnFreeBall } from "./spawnBall.js";
import { tweenTo, ease, delay } from "../tween.js";

const numberStyle = new TextStyle({
  fontFamily: "Azeret Mono, monospace",
  fontWeight: "900",
  fontSize: 46,
  fill: 0xffffff,
  stroke: { color: 0x6a1a9a, width: 8, join: "round" },
});

// A source box is a square cup holding a 3x3 grid of marbles (= the 9 balls
// it launches), capped by a lid that pops off once it lands.
class SourceBoxSlot {
  constructor(index, world, initialColor) {
    this.index = index;
    this.world = world;
    this.x = LAYOUT.pipes.xs[index];
    // this pipe's whole stock of boxes; the number printed on it is how many
    // balls are still to come out of it
    this.bag = [...PIPE_COLOR_BAGS[index]];
    this.boxesLeft = this.bag.length;
    this.color = null;
    this.isAnimating = false;
    this.ballsLaunched = 0;
    this.totalBalls = ECONOMY.ballsPerBox;

    const box = LAYOUT.sourceBox;

    this.pipe = new Sprite(world.textures.pipe);
    this.pipe.anchor.set(0.5, 0);
    this.pipe.x = this.x;
    this.pipe.y = LAYOUT.pipes.topY;
    this.pipe.width = LAYOUT.pipes.width;
    this.pipe.height = LAYOUT.pipes.bottomY - LAYOUT.pipes.topY;
    world.boxLayer.addChild(this.pipe);

    this.container = new Container();
    this.container.x = this.x;
    this.container.y = box.centerY;
    this.container.eventMode = "static";
    this.container.cursor = "pointer";
    this.container.on("pointertap", () => this._onTap());

    // soft contact shadow so the box sits on the board rather than floating
    this.shadow = new Sprite(world.textures.trayShadow);
    this.shadow.anchor.set(0.5);
    this.shadow.width = box.w * 1.1;
    this.shadow.height = box.h * 1.1;
    this.shadow.y = 10;
    this.shadow.alpha = 0.32;
    this.container.addChild(this.shadow);

    this.cup = new Sprite(world.textures.trayEmpty[initialColor]);
    this.cup.anchor.set(0.5);
    this.cup.width = box.w;
    this.cup.height = box.h;
    this.container.addChild(this.cup);

    this.marbles = new Sprite(world.textures.trayMarbles[initialColor]);
    this.marbles.anchor.set(0.5);
    this.marbles.width = box.marbleW;
    this.marbles.height = box.marbleH;
    this.container.addChild(this.marbles);

    this.lid = new Sprite(world.textures.trayInactive[initialColor]);
    this.lid.anchor.set(0.5);
    this.lid.width = box.w;
    this.lid.height = box.h;
    this.container.addChild(this.lid);

    world.boxLayer.addChild(this.container);

    this.label = new Text({ text: "0", style: numberStyle });
    this.label.anchor.set(0.5);
    this.label.x = this.x;
    this.label.y = LAYOUT.pipes.labelY;
    world.pipeLabelLayer.addChild(this.label);
    this._updateLabel();

    this._spawnBox(initialColor);
  }

  // Balls this pipe has still to give: the boxes behind it plus whatever is
  // left in the one on screen. Counted per ball, so the figure ticks down as
  // they actually fly out instead of dropping a whole box at a time.
  _updateLabel() {
    const left = this.boxesLeft * ECONOMY.ballsPerBox - this.ballsLaunched;
    this.label.text = String(Math.max(0, left));
  }

  _spawnBox(color) {
    const box = LAYOUT.sourceBox;
    this.color = color;
    this.ballsLaunched = 0;
    this.isAnimating = false;

    this.cup.texture = this.world.textures.trayEmpty[color];
    this.marbles.texture = this.world.textures.trayMarbles[color];
    this.lid.texture = this.world.textures.trayInactive[color];

    this.marbles.visible = true;
    this.marbles.alpha = 1;
    this.marbles.width = box.marbleW;
    this.marbles.height = box.marbleH;
    this.lid.visible = true;
    this.lid.width = box.w;
    this.lid.height = box.h;
    this._lidScale = this.lid.scale.x;

    this.container.scale.set(0.5);
    this.container.alpha = 1;
    this.container.rotation = 0;
    audio.playBoxAppear();
    tweenTo(this.container.scale, { x: 1, y: 1 }, 0.35, ease.outBack, () =>
      this._popLid(),
    );
  }

  _onTap() {
    if (this.isAnimating || this.ballsLaunched > 0) return;
    if (!this.world.canLaunchBalls(this.color)) {
      this._shake();
      audio.playBoxTapBlocked();
      return;
    }
    audio.playBoxTap();
    this.world.tutorialHand?.onBoxTapped();
    this._launchBalls();
  }

  _shake() {
    if (this._shaking) return;
    this._shaking = true;
    const c = this.container;
    const angles = [12, -12, 7, -7, 0];
    let i = 0;
    const step = () => {
      tweenTo(
        c,
        { rotation: (angles[i] * Math.PI) / 180 },
        0.07,
        ease.sineInOut,
        () => {
          i++;
          if (i < angles.length) step();
          else this._shaking = false;
        },
      );
    };
    step();
  }

  _popLid() {
    if (!this.lid.visible) return;
    // the lid is sized via width/height, so its resting scale is not 1 —
    // the pop has to be expressed relative to that
    const s = this._lidScale;
    tweenTo(
      this.lid.scale,
      { x: s * 1.05, y: s * 1.05 },
      0.1,
      ease.outQuad,
      () => {
        tweenTo(
          this.lid.scale,
          { x: 0, y: 0 },
          0.12,
          ease.inQuad,
          () => (this.lid.visible = false),
        );
      },
    );
  }

  _launchBalls() {
    this.isAnimating = true;
    const world = this.world;
    for (let i = 0; i < this.totalBalls; i++) {
      delay(i * 0.08, () => {
        if (this.container.destroyed) return;
        spawnFreeBall(world, {
          x: this.container.x + (Math.random() - 0.5) * 20,
          y: this.container.y,
          color: this.color,
          vx: (Math.random() - 0.5) * 120,
          vy: -80 - Math.random() * 40,
          laneX: this.x,
        });
        this.ballsLaunched++;
        this._updateLabel();
        // The cup is drawn holding nine marbles — what the box is worth once
        // the x3 has done its work — so it empties a third at a time.
        this.marbles.alpha = 1 - this.ballsLaunched / this.totalBalls;
        if (this.ballsLaunched === this.totalBalls) {
          delay(0.06, () => this._disappear());
        }
      });
    }
  }

  _disappear() {
    tweenTo(
      this.container.scale,
      { x: 1.1, y: 0.8 },
      0.15,
      ease.outQuad,
      () => {
        tweenTo(this.container.scale, { x: 0, y: 0 }, 0.2, ease.inQuad, () => {
          this.container.visible = false;
          this._onEmpty();
        });
      },
    );
  }

  _onEmpty() {
    this.boxesLeft--;
    // the spent box's balls are already off the counter
    this.ballsLaunched = 0;
    this._updateLabel();
    if (this.boxesLeft > 0) {
      delay(0.2, () => {
        this.container.visible = true;
        this._spawnBox(this.takeFromBag());
      });
    } else {
      this.world.checkVictory();
    }
  }

  // Draw the next box out of this pipe's fixed stock, favouring whatever the
  // open trays are short of. Only the *order* is adaptive — the bag's contents
  // are fixed, so the per-colour balance with the trays is preserved.
  takeFromBag() {
    const demand = this.world.fillBoxManager?.getDemand() ?? new Map();
    let bestIdx = 0;
    let bestNeed = -1;
    for (let i = 0; i < this.bag.length; i++) {
      const need = demand.get(this.bag[i]) ?? 0;
      if (need > bestNeed) {
        bestNeed = need;
        bestIdx = i;
      }
    }
    return this.bag.splice(bestIdx, 1)[0];
  }
}

export class SourceBoxManager {
  constructor(world) {
    this.world = world;
    this.slots = [];
    for (let i = 0; i < ECONOMY.pipes; i++) {
      const slot = new SourceBoxSlot(i, world, PIPE_COLOR_BAGS[i][0]);
      slot.bag.splice(0, 1);
      this.slots.push(slot);
    }
  }

  ballsLeft() {
    return this.slots.reduce(
      (n, s) => n + s.boxesLeft * ECONOMY.ballsPerBox,
      0,
    );
  }

  allExhausted() {
    return this.slots.every((s) => s.boxesLeft <= 0);
  }

  // Balls a tapped box has not spat out yet, as {color, count}. They are
  // already spoken for — the tap has happened and they are on their way to the
  // belt — so the deadlock check counts them instead of waiting out the drop
  // and the x3 animation before admitting the run is over.
  pendingByColor() {
    const pending = new Map();
    for (const s of this.slots) {
      if (s.ballsLaunched <= 0 || s.ballsLaunched >= s.totalBalls) continue;
      const owed = (s.totalBalls - s.ballsLaunched) * ECONOMY.multiplier;
      pending.set(s.color, (pending.get(s.color) ?? 0) + owed);
    }
    return pending;
  }
}
