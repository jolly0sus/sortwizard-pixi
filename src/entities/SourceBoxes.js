// Port of the original Box.ts + BoxManager.ts.
//
// Three slots: slot 0 is the CENTRE pipe (starts pink), slot 1 the LEFT
// (orange), slot 2 the RIGHT (blue). Each pipe can deliver 7 replacement
// boxes; the figure on the pipe is that counter. Replacement colours come
// from one global blue→pink→orange cycle indexed by boxes emptied so far,
// regardless of which pipe they came out of.
import { Container, Sprite, Text } from "pixi.js";
import { LAYOUT, ECONOMY } from "../config.js";
import { Ball } from "./Ball.js";
import { audio } from "../audio.js";
import { tweenTo, ease, delay, stopTweensOf } from "../tween.js";

const B = () => LAYOUT.sourceBox;

class Box {
  constructor(manager, slotIndex) {
    this.manager = manager;
    this.slotIndex = slotIndex;
    this.world = manager.world;

    const container = new Container();
    this.container = container;
    container.eventMode = "static";
    container.cursor = "pointer";
    container.on("pointertap", () => this._onTouched());

    const t = this.world.textures;
    this.shadow = new Sprite(t.trayShadow);
    this.shadow.anchor.set(0.5);
    this.cup = new Sprite();
    this.cup.anchor.set(0.5);
    this.marbles = new Sprite();
    this.marbles.anchor.set(0.5);
    this.lid = new Sprite();
    this.lid.anchor.set(0.5);
    container.addChild(this.shadow, this.cup, this.marbles, this.lid);

    const s = B();
    this.shadow.position.set(0, s.shadow.dy);
    this.shadow.width = s.shadow.w;
    this.shadow.height = s.shadow.h;
    this.cup.position.set(0, s.cup.dy);
    this.marbles.position.set(0, s.marbles.dy);
    this.lid.position.set(0, s.lid.dy);

    this.color = null;
    this.isAnimating = false;
    this.ballsLaunched = 0;
    this.alive = false;

    this.world.boxLayer.addChild(container);
  }

  _applyColor(color) {
    const t = this.world.textures;
    const s = B();
    this.color = color;
    this.cup.texture = t.trayEmpty[color];
    this.cup.width = s.cup.w;
    this.cup.height = s.cup.h;
    this.marbles.texture = t.trayMarbles[color];
    this.marbles.width = s.marbles.w;
    this.marbles.height = s.marbles.h;
    this.lid.texture = t.trayInactive[color];
    this.lid.width = s.lid.w;
    this.lid.height = s.lid.h;
    this._lidScaleX = this.lid.scale.x;
    this._lidScaleY = this.lid.scale.y;
  }

  placeInstant(color) {
    this._applyColor(color);
    const s = B();
    this.container.position.set(s.slotXs[this.slotIndex], s.slotY);
    this.container.scale.set(1);
    this.container.rotation = 0;
    this.container.visible = true;
    this.lid.visible = false;
    this.marbles.visible = true;
    this.marbles.alpha = 1;
    this.isAnimating = false;
    this.ballsLaunched = 0;
    this.alive = true;
  }

  playEntryAnimation(color) {
    this._applyColor(color);
    const s = B();
    audio.playBoxAppear();
    this.lid.visible = true;
    this.lid.scale.set(this._lidScaleX, this._lidScaleY);
    this.marbles.visible = true;
    this.marbles.alpha = 1;
    const targetY = s.slotY;
    this.container.visible = true;
    this.container.rotation = 0;
    this.container.position.set(
      s.slotXs[this.slotIndex],
      targetY - s.entryDrop,
    );
    this.container.scale.set(0.5);
    this.isAnimating = true;
    this.ballsLaunched = 0;
    tweenTo(this.container, { y: targetY }, 0.35, ease.bounceOut);
    tweenTo(this.container.scale, { x: 1, y: 1 }, 0.35, ease.bounceOut, () => {
      this.isAnimating = false;
      this.alive = true;
      this._popLidOff();
    });
  }

  _popLidOff() {
    if (!this.lid.visible) return;
    tweenTo(
      this.lid.scale,
      { x: this._lidScaleX * 1.05, y: this._lidScaleY * 1.05 },
      0.1,
      ease.linear,
      () =>
        tweenTo(this.lid.scale, { x: 0, y: 0 }, 0.12, ease.inQuad, () => {
          this.lid.visible = false;
        }),
    );
  }

  _onTouched() {
    // Taps still count towards the store redirect after the run is decided,
    // but they must not put balls back on a board that has just been cleared.
    // The ending backdrop swallows real taps, so this only catches one already
    // on its way — and anything driving a box directly.
    this.manager.tapCounter?.registerTap();
    if (this.manager.isRunOver()) return;
    if (this.isAnimating || this.ballsLaunched > 0 || !this.alive) return;
    if (this.manager.canLaunchBalls()) {
      audio.playBoxTap();
      this.manager.tutorialHand?.onBoxTapped();
      this._launchBalls();
    } else {
      this._playShake();
    }
  }

  _playShake() {
    if (this._isShaking) return;
    this._isShaking = true;
    audio.playBoxTapBlocked();
    const deg = (d) => (d * Math.PI) / 180;
    const c = this.container;
    tweenTo(c, { rotation: deg(-12) }, 0.07, ease.outQuad, () =>
      tweenTo(c, { rotation: deg(12) }, 0.07, ease.sineInOut, () =>
        tweenTo(c, { rotation: deg(-7.2) }, 0.07, ease.sineInOut, () =>
          tweenTo(c, { rotation: deg(7.2) }, 0.07, ease.sineInOut, () =>
            tweenTo(c, { rotation: 0 }, 0.06, ease.outQuad, () => {
              this._isShaking = false;
            }),
          ),
        ),
      ),
    );
  }

  _spawnWorldPositions() {
    const s = B();
    const cx = this.container.x;
    const cy = this.container.y;
    // P1..P9 of the prefab: rows top/middle/bottom, third row right-to-left
    const dx = s.spawnDX;
    const rows = s.spawnRowDY;
    const pts = [
      [-dx, rows[0]],
      [0, rows[0]],
      [dx, rows[0]],
      [-dx, rows[1]],
      [0, rows[1]],
      [dx, rows[1]],
      [dx, rows[2]],
      [0, rows[2]],
      [-dx, rows[2]],
    ];
    return pts.map(([x, y]) => [cx + x, cy + y]);
  }

  _launchBalls() {
    this.isAnimating = true;
    this.ballsLaunched = 0;
    const positions = this._spawnWorldPositions();
    const total = ECONOMY.ballsPerBox;
    // the box starts squashing 0.07 s before the last ball emerges
    delay(Math.max(0, 0.08 * (total - 1) - 0.07), () => this._disappear());
    for (let d = 0; d < total; d++) {
      delay(0.08 * d, () => {
        if (this.container.destroyed) return;
        // a launch in flight when the run ends must not drip fresh balls
        // onto the board the ending sweep has just cleared
        if (this.manager.isRunOver()) return;
        const ball = Ball.spawn(this.world.textures, this.world.ballLayer);
        ball.setColor(this.color);
        ball.initPhysics();
        this.world.physics.add(ball);
        ball.playLaunchAnimation(positions[d][0], positions[d][1]);
        this.ballsLaunched++;
        if (this.ballsLaunched === total) this.marbles.visible = false;
      });
    }
  }

  _disappear() {
    const c = this.container;
    tweenTo(c.scale, { x: 1.1, y: 0.8 }, 0.15, ease.outQuad, () =>
      tweenTo(c.scale, { x: 0, y: 0 }, 0.2, ease.inQuad, () => {
        c.visible = false;
        this.alive = false;
        this.manager._onBoxEmpty(this.slotIndex);
      }),
    );
  }

  // wand support in the original; unused here but kept for parity of API
  forceReplace() {
    if (this.isAnimating) return;
    this.isAnimating = true;
    this._disappear();
  }
}

export class SourceBoxManager {
  constructor(world) {
    this.world = world;
    this.tapCounter = null; // wired by Game after construction
    this.tutorialHand = world.tutorialHand;

    this._buildPipes();

    this.pipeCharges = [...ECONOMY.pipeCharges];
    // Each slot is one colour for the whole run — see slotColors in
    // config.js: this is what lets careful play always answer the tape.
    this.boxes = [];
    for (let i = 0; i < 3; i++) {
      const box = new Box(this, i);
      box.placeInstant(ECONOMY.slotColors[i]);
      this.boxes.push(box);
      this._updatePipeLabel(i);
    }

    this._failTriggered = false;
    this._victoryTriggered = false;
    this._allBoxesFilled = false;
    this._failCheckTimer = 0;
    this._idleTimer = 0;
    this._stallTimer = 0;
    this._lastUnsorted = -1;
  }

  // Balls that do not exist yet: what the standing boxes still hold plus every
  // box the pipes can still deliver. Balls already launched are in Ball.all
  // instead, so the two counts never overlap.
  ballsPending() {
    let n = 0;
    for (const box of this.boxes) {
      if (box.alive || box.isAnimating) {
        n += Math.max(0, ECONOMY.ballsPerBox - box.ballsLaunched);
      }
    }
    for (const charge of this.pipeCharges) n += charge * ECONOMY.ballsPerBox;
    return n;
  }

  _buildPipes() {
    const P = LAYOUT.pipes;
    const t = this.world.textures;
    this.pipeLabels = [];
    // pipes at [left, centre, right]; slots are [centre, left, right]
    for (let i = 0; i < 3; i++) {
      const pipe = new Sprite(t.pipe);
      pipe.anchor.set(0.5);
      pipe.position.set(P.xs[i], P.spriteY);
      pipe.width = P.w;
      pipe.height = P.h;
      this.world.pipeLayer.addChild(pipe);

      const label = new Text({
        text: "",
        style: {
          fontFamily: "Azeret Mono",
          fontWeight: "900",
          fontSize: P.labelSize,
          fill: 0xffffff,
          stroke: { color: 0x000000, width: P.labelStroke, join: "round" },
        },
      });
      label.anchor.set(0.5);
      label.position.set(P.xs[i], P.labelY);
      this.world.pipeLayer.addChild(label);
      this.pipeLabels.push(label);
    }
  }

  // slot index -> pipe visual index (slot0 = centre pipe)
  _pipeForSlot(slot) {
    return [1, 0, 2][slot];
  }

  _updatePipeLabel(slot) {
    this.pipeLabels[this._pipeForSlot(slot)].text = String(
      this.pipeCharges[slot],
    );
  }

  isRunOver() {
    return this._failTriggered || this._victoryTriggered;
  }

  canLaunchBalls() {
    return (
      ECONOMY.maxFreeBalls <= 0 ||
      Ball.getFreeBallCount() < ECONOMY.maxFreeBalls
    );
  }

  getActiveBoxes() {
    return this.boxes.filter((b) => b.alive);
  }

  _onBoxEmpty(slotIndex) {
    if (this.pipeCharges[slotIndex] > 0) {
      this.pipeCharges[slotIndex]--;
      this._updatePipeLabel(slotIndex);
      const color = ECONOMY.slotColors[slotIndex];
      delay(0.2, () => this.boxes[slotIndex].playEntryAnimation(color));
    } else {
      delay(0.5, () => this._checkVictory());
    }
  }

  onAllBoxesFilled() {
    this._allBoxesFilled = true;
    this._checkVictory();
  }

  update(dt) {
    if (this._failTriggered || this._victoryTriggered) return;
    this._failCheckTimer += dt;
    if (this._failCheckTimer >= 0.5) {
      this._failCheckTimer = 0;
      this._checkFail();
      this._checkVictory();
    }
    this._checkEndOfSupply(dt);
  }

  _checkVictory() {
    if (!this._allBoxesFilled) return;
    if (this._victoryTriggered || this._failTriggered) return;
    // Balls a tray is still swallowing hold the win back; leftovers loose on
    // the belt do not. Waiting for the board to empty outright, as this used
    // to, would hang the win forever now that the grid can drain with balls
    // still riding around.
    if (Ball.getUnsortedCount() < Ball.getTotalBallCount()) return;
    this._victoryTriggered = true;
    this._endRun(this.world.victoryWindow);
  }

  // Every ending goes through here. The receiver grid comes off the board
  // first: rows the run can no longer touch, sitting under the ending screen,
  // read as a game still waiting to be played.
  _endRun(win) {
    this._sweepBalls();
    this.world.fillBoxManager.clearAll();
    win.show();
  }

  // Nothing is left rolling under the ending screen. Balls that never made it
  // into a tray — riding the belt, mid-fall, or resting on the floor below it
  // where nothing could ever pick them up — shrink away with the grid.
  //
  // Balls a tray already holds are skipped: they belong to that tray and go
  // when it does, and despawning them twice would hand the same ball out of
  // the pool to two spawns.
  _sweepBalls() {
    for (const cell of this.world.conveyor.cells) cell.forceTakeBall();
    let n = 0;
    for (const ball of [...Ball.all]) {
      if (ball.destroyed || ball.takenByBox) continue;
      ball.physicsActive = false;
      stopTweensOf(ball);
      stopTweensOf(ball.scale);
      delay(0.015 * n++, () => {
        if (ball.destroyed) return;
        tweenTo(ball.scale, { x: 0, y: 0 }, 0.16, ease.inBack, () => {
          if (!ball.destroyed) this.world.despawnBall(ball);
        });
      });
    }
  }

  // The tape can also lock the board with boxes still to deliver: the fronts
  // want colours that neither the riding balls nor any remaining box can
  // supply, and the riders' colours have no open tray. No tap changes any of
  // that — a burst of a colour with no open front just rides — so the run is
  // provably lost while the game sits waiting for input forever. The
  // reference does sit forever; this ends it as the loss it already is.
  // Settled balls only (free == 0): balls still falling can land in a tray
  // and advance a column, which reopens everything.
  _checkColorDeadlock(dt) {
    if (Ball.getFreeBallCount() > 0) {
      this._deadlockTimer = 0;
      return;
    }
    const open = this.world.fillBoxManager.getOpenBoxColors();
    let anyMove = false;
    for (const color of Ball.getUnsortedColors()) {
      if (open.has(color)) anyMove = true;
    }
    if (!anyMove) {
      for (const box of this.boxes) {
        if ((box.alive || box.isAnimating) && open.has(box.color))
          anyMove = true;
      }
      // a charged pipe refills its slot with the slot's own colour
      for (let slot = 0; slot < 3; slot++) {
        if (this.pipeCharges[slot] > 0 && open.has(ECONOMY.slotColors[slot])) {
          anyMove = true;
        }
      }
    }
    if (anyMove) {
      this._deadlockTimer = 0;
      return;
    }
    this._deadlockTimer = (this._deadlockTimer ?? 0) + dt;
    if (this._deadlockTimer < ECONOMY.outOfBallsStall) return;
    this._failTriggered = true;
    this._endRun(this.world.failWindow);
  }

  // Nothing new enters the board once the pipes are dry, so the run lives or
  // dies on the balls already out. It can still advance as long as one of them
  // matches a tray that is open right now; if none does, no front tray can
  // fill, so nothing behind it can ever open either and the board is locked
  // whatever the balls do next. That is the same deadlock _checkFail looks
  // for, minus its requirement that the belt be full — with the pipes dry a
  // half-empty belt is just as final.
  //
  // The short delay covers the one way out: a tray already swallowing a ball
  // can finish and open the next one, which may take a colour that is waiting.
  _checkEndOfSupply(dt) {
    if (this._failTriggered || this._victoryTriggered) return;
    if (this.ballsPending() > 0) {
      this._checkColorDeadlock(dt);
      this._idleTimer = 0;
      this._stallTimer = 0;
      this._lastUnsorted = -1;
      return;
    }

    // Going nowhere, whatever the board looks like. Not every ball that
    // matches an open tray can actually get to one: a ball that missed the
    // belt comes to rest on the floor below it, where nothing ever picks it
    // up, and the colour test below reads it as a run still in progress.
    const unsorted = Ball.getUnsortedCount();
    if (unsorted !== this._lastUnsorted) {
      this._lastUnsorted = unsorted;
      this._stallTimer = 0;
    } else {
      this._stallTimer += dt;
    }

    const open = this.world.fillBoxManager.getOpenBoxColors();
    let reachable = false;
    for (const color of Ball.getUnsortedColors()) {
      if (open.has(color)) {
        reachable = true;
        break;
      }
    }
    this._idleTimer = reachable ? 0 : this._idleTimer + dt;

    if (
      this._idleTimer < ECONOMY.outOfBallsGrace &&
      this._stallTimer < ECONOMY.outOfBallsStall
    )
      return;
    // Reference semantics: running out of balls is only the win if the job
    // is done. Leftover balls facing trays nothing can fill any more is a
    // loss, and with the counts exact (216 trays for 216 box-balls) it is a
    // loss the player earned — a clean run drains the grid to nothing and
    // takes the victory branch through _checkVictory above. The blanket
    // "supply spent = win" this replaces dated from the mismatched economy,
    // where no run could ever finish.
    this._checkVictory();
    if (this._victoryTriggered) return;
    this._failTriggered = true;
    this._endRun(this.world.failWindow);
  }

  // Fail: the belt is completely full and none of the colours riding it can
  // go into any currently open receiver box.
  _checkFail() {
    if (this._failTriggered || this._victoryTriggered) return;
    const conveyor = this.world.conveyor;
    if (!conveyor.cells.length) return;
    if (!conveyor.isFull()) return;
    const ridingColors = new Set();
    for (const cell of conveyor.cells) {
      const c = cell.getBallColor();
      if (c) ridingColors.add(c);
    }
    const open = this.world.fillBoxManager.getOpenBoxColors();
    for (const c of ridingColors) {
      if (open.has(c)) return;
    }
    this._failTriggered = true;
    this._endRun(this.world.failWindow);
  }
}
