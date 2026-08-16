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
import { tweenTo, ease, delay } from "../tween.js";

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
    this.manager.tapCounter?.registerTap();
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
    this.colorCycleIndex = 0;
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
    this._sortedSeen = 0;
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

  canLaunchBalls() {
    return (
      ECONOMY.maxFreeBalls <= 0 ||
      Ball.getFreeBallCount() < ECONOMY.maxFreeBalls
    );
  }

  getActiveBoxes() {
    return this.boxes.filter((b) => b.alive);
  }

  _pickNextBoxColor() {
    const seq = ECONOMY.spawnSequence;
    const color = seq[this.colorCycleIndex % seq.length];
    this.colorCycleIndex++;
    return color;
  }

  _onBoxEmpty(slotIndex) {
    if (this.pipeCharges[slotIndex] > 0) {
      this.pipeCharges[slotIndex]--;
      this._updatePipeLabel(slotIndex);
      const color = this._pickNextBoxColor();
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
    this.world.victoryWindow.show();
  }

  // Nothing new enters the board once the pipes are dry, so from then on the
  // run can only advance while trays keep taking the balls that are left. When
  // that stops the leftovers are colours no reachable tray wants, and the
  // level is over.
  //
  // This is a stall timer rather than a colour test on purpose: a tray several
  // rows back can only ever open if the ones in front of it fill first, so
  // whether a leftover ball has a future is not something a snapshot of the
  // board can answer. Balls still falling keep it reset — they have not had
  // their chance yet.
  _checkEndOfSupply(dt) {
    if (this._failTriggered || this._victoryTriggered) return;
    if (this.ballsPending() > 0) {
      this._idleTimer = 0;
      return;
    }
    const sorted = this.world.fillBoxManager.ballsSorted;
    if (sorted !== this._sortedSeen || Ball.getFreeBallCount() > 0) {
      this._sortedSeen = sorted;
      this._idleTimer = 0;
      return;
    }
    this._idleTimer += dt;
    if (this._idleTimer < ECONOMY.outOfBallsGrace) return;
    this._checkVictory();
    if (this._victoryTriggered) return;
    this._failTriggered = true;
    this.world.failWindow.show();
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
    this.world.failWindow.show();
  }
}
