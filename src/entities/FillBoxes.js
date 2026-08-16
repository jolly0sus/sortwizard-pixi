// Port of the original FillBox.ts + FillBoxManager.ts.
//
// A 4x4 grid of receiver boxes. Row colours follow one global tape
// (blue, blue, pink, pink, orange, orange, repeat); the four initial rows
// consume indices 0..3, and afterwards every column continues the same tape
// at its own pace. Only a column's front box is open; when its third ball
// lands the box rises, pops, and the column shifts up with a new closed box
// arriving from below.
import { Container, Sprite } from "pixi.js";
import { LAYOUT, ECONOMY, COLORS } from "../config.js";
import { Ball } from "./Ball.js";
import { audio } from "../audio.js";
import { tweenTo, ease, delay, stopTweensOf } from "../tween.js";

const F = () => LAYOUT.fill;

class FillBox {
  constructor(manager, color) {
    this.manager = manager;
    this.world = manager.world;
    this.color = color;

    const f = F();
    const t = this.world.textures;
    const container = new Container();
    this.container = container;

    this.shadow = new Sprite(t.boxShadow);
    this.shadow.anchor.set(0.5);
    this.shadow.position.set(0, f.shadow.dy);
    this.shadow.width = f.shadow.w;
    this.shadow.height = f.shadow.h;
    container.addChild(this.shadow);

    this.base = new Sprite(t.boxBase[color]);
    this.base.anchor.set(0.5);
    this.base.width = f.base.w;
    this.base.height = f.base.h;
    container.addChild(this.base);

    // The pink prefab carries an extra deep-wells overlay. It is built for
    // every colour and simply hidden, so a tray can change colour later
    // without rebuilding its children in the right z-order.
    this.trayPink = new Sprite(t.boxTrayPink);
    this.trayPink.anchor.set(0.5);
    this.trayPink.position.set(0, f.trayPink.dy);
    this.trayPink.width = f.trayPink.w;
    this.trayPink.height = f.trayPink.h;
    this.trayPink.visible = color === COLORS.PINK;
    container.addChild(this.trayPink);

    this.slots = f.slotDX.map((dx) => {
      const slot = new Container();
      slot.position.set(dx, f.slotDY);
      container.addChild(slot);
      return slot;
    });

    this.front = new Sprite(t.boxFront[color]);
    this.front.anchor.set(0.5);
    this.front.position.set(0, f.front.dy);
    this.front.width = f.front.w;
    this.front.height = f.front.h;
    container.addChild(this.front);

    this.lid = new Sprite(t.boxLid[color]);
    this.lid.anchor.set(0.5);
    this.lid.position.set(0, f.lid.dy);
    this.lid.width = f.lid.w;
    this.lid.height = f.lid.h;
    container.addChild(this.lid);
    this._lidScaleX = this.lid.scale.x;
    this._lidScaleY = this.lid.scale.y;

    this.onBoxReserved = null;
    this.onBoxFilled = null;
    this._isOpen = false;
    this._filledCount = 0;
    this._landedCount = 0;
    this._reservedFired = false;
    this._busy = false;
    this._slottedBalls = [];
    this._ballsInZone = new Set();
    this._glowTimers = new Map();
  }

  get isOpen() {
    return this._isOpen;
  }

  get isFilled() {
    return this._filledCount >= this.slots.length;
  }

  get openSlots() {
    return Math.max(0, this.slots.length - this._filledCount);
  }

  // Repaints an empty tray. Only ever used to hand the board a move again;
  // a tray holding balls keeps the colour those balls were sorted into.
  recolor(color) {
    if (!color || color === this.color || this._filledCount > 0) return;
    if (this.container.destroyed) return;
    const f = F();
    const t = this.world.textures;
    this.color = color;
    this.base.texture = t.boxBase[color];
    this.base.width = f.base.w;
    this.base.height = f.base.h;
    this.front.texture = t.boxFront[color];
    this.front.width = f.front.w;
    this.front.height = f.front.h;
    const lidVisible = this.lid.visible;
    this.lid.texture = t.boxLid[color];
    this.lid.width = f.lid.w;
    this.lid.height = f.lid.h;
    this._lidScaleX = this.lid.scale.x;
    this._lidScaleY = this.lid.scale.y;
    if (!lidVisible) this.lid.scale.set(0);
    this.lid.visible = lidVisible;
    this.trayPink.visible = color === COLORS.PINK;
  }

  setClosed() {
    this._isOpen = false;
    this.lid.visible = true;
    this.lid.scale.set(this._lidScaleX, this._lidScaleY);
  }

  openInstant() {
    this.lid.visible = false;
    this._isOpen = true;
  }

  open() {
    if (this._isOpen) return;
    this.lid.visible = true;
    tweenTo(
      this.lid.scale,
      { x: this._lidScaleX * 1.08, y: this._lidScaleY * 1.08 },
      0.1,
      ease.outQuad,
      () =>
        tweenTo(this.lid.scale, { x: 0, y: 0 }, 0.15, ease.inQuad, () => {
          this.lid.visible = false;
          this._isOpen = true;
        }),
    );
  }

  _triggerPos() {
    return {
      x: this.container.x,
      y: this.container.y + F().colliderDY,
    };
  }

  update() {
    const f = F();
    const trig = this._triggerPos();

    // prune the zone
    if (this._ballsInZone.size) {
      for (const ball of Array.from(this._ballsInZone)) {
        if (!ball || ball.destroyed || ball.takenByBox) {
          this._ballsInZone.delete(ball);
          continue;
        }
        if (ball.owningCell) {
          const dx = ball.x - trig.x;
          const dy = ball.y - trig.y;
          if (dx * dx + dy * dy > f.triggerRadius * f.triggerRadius) {
            this._ballsInZone.delete(ball);
          }
        }
      }
    }

    if (!this._isOpen || this._busy || this.isFilled) return;

    // swept recovery: fast conveyor balls the overlap test may have missed
    for (const ball of Ball.getConveyorBalls()) {
      if (this._ballsInZone.has(ball)) continue;
      if (ball.color !== this.color || !ball.owningCell) continue;
      const prevY = ball.hasPrevConveyorPos ? ball.prevConveyorY : ball.y;
      if (
        Math.min(Math.abs(ball.y - trig.y), Math.abs(prevY - trig.y)) >
        f.pickupHalfH
      )
        continue;
      const prevX = ball.hasPrevConveyorPos ? ball.prevConveyorX : ball.x;
      const maxX = Math.max(ball.x, prevX);
      const minX = Math.min(ball.x, prevX);
      if (maxX >= trig.x - f.pickupHalfW && minX <= trig.x + f.pickupHalfW) {
        this._ballsInZone.add(ball);
      }
    }
    // plain overlap contact with the collider box
    for (const ball of Ball.getConveyorBalls()) {
      if (this._ballsInZone.has(ball)) continue;
      if (
        Math.abs(ball.x - trig.x) <= f.colliderHalfW &&
        Math.abs(ball.y - trig.y) <= f.colliderHalfH
      ) {
        this._ballsInZone.add(ball);
      }
    }

    for (const ball of this._ballsInZone) {
      if (this._tryTakeBall(ball)) break; // at most one per frame
    }
  }

  _tryTakeBall(ball) {
    if (!this._isOpen || this.isFilled) return false;
    if (!ball || ball.destroyed) {
      this._ballsInZone.delete(ball);
      return false;
    }
    if (ball.takenByBox) {
      this._ballsInZone.delete(ball);
      return false;
    }
    if (ball.color !== this.color) return false;
    if (!ball.owningCell) return false;
    if (ball.owningCell.isSnapping) return false;
    const slotIndex = this._filledCount;
    this._filledCount++;
    this._busy = true;
    this._ballsInZone.delete(ball);
    this.manager.nextTick(() => this._captureAndMove(ball, slotIndex));
    return true;
  }

  _rollback() {
    this._filledCount = Math.max(0, this._filledCount - 1);
    this._busy = false;
    if (this._filledCount < this.slots.length) this._reservedFired = false;
  }

  _captureAndMove(ball, slotIndex) {
    if (!ball || ball.destroyed || ball.takenByBox) return this._rollback();
    if (ball.color !== this.color) return this._rollback();
    const cell = ball.owningCell;
    if (cell && cell.ball === ball) {
      if (cell.isSnapping) {
        this.manager.nextTick(() => this._captureAndMove(ball, slotIndex));
        return;
      }
      const taken = cell.takeBall();
      if (taken) return this._moveBallToSlot(taken, slotIndex);
      if (ball.capturedByCell && !ball.takenByBox) {
        this.manager.nextTick(() => this._captureAndMove(ball, slotIndex));
        return;
      }
      return this._rollback();
    }
    if (!ball.takenByBox && ball.capturedByCell) {
      this.manager.nextTick(() => this._captureAndMove(ball, slotIndex));
      return;
    }
    this._rollback();
  }

  _moveBallToSlot(ball, slotIndex) {
    if (!ball || ball.destroyed) return this._rollback();
    const slot = this.slots[slotIndex];
    if (!slot) {
      this._busy = false;
      return;
    }
    // reparent into the slot, keeping the on-screen position
    const global = ball.parent.toGlobal(ball.position);
    slot.addChild(ball);
    const local = slot.toLocal(global);
    ball.position.set(local.x, local.y);
    ball.scale.set(1);
    this._slottedBalls.push(ball);
    this._busy = false;

    // arced flight to the slot centre (all in slot-local space)
    const nx = ball.x;
    const ny = ball.y;
    const dxn = -nx;
    const dyn = -ny;
    const d = Math.hypot(dxn, dyn) || 1;
    const f = F().bulge * (nx >= 0 ? -1 : 1);
    const midX = nx / 2 + (dyn / d) * f;
    const midY = ny / 2 + (-dxn / d) * f;
    const seg1 = 0.22 * 0.45;
    const seg2 = 0.22 * 0.55;
    tweenTo(ball, { x: midX, y: midY }, seg1, ease.sineOut, () =>
      tweenTo(ball, { x: 0, y: 0 }, seg2, ease.sineIn, () =>
        this._onBallLanded(ball),
      ),
    );
    tweenTo(ball.scale, { x: 1.18, y: 1.18 }, seg1, ease.sineOut, () =>
      tweenTo(ball.scale, { x: 0.8, y: 0.8 }, seg2, ease.sineIn),
    );
  }

  _onBallLanded(ball) {
    if (ball.destroyed || this.container.destroyed) return;
    ball.scale.set(0.91, 0.69);
    tweenTo(ball.scale, { x: 0.8, y: 0.8 }, 0.1, ease.elasticOut);
    this._startBallGlow(ball, 0.2);
    const p = this.container.parent.toLocal(
      ball.parent.toGlobal(ball.position),
    );
    this.manager.spawnHitEffect(this.container.parent, p.x, p.y, 0.18);
    audio.playBallInBox();
    this._landedCount++;
    if (this._landedCount >= this.slots.length) this._onFilled();
  }

  _startBallGlow(ball, duration) {
    const old = this._glowTimers.get(ball);
    if (old) clearTimeout(old);
    ball.setGlowSprite(true);
    const id = delay(duration, () => {
      this._glowTimers.delete(ball);
      if (!ball.destroyed) ball.setGlowSprite(false);
    });
    this._glowTimers.set(ball, id);
  }

  _onFilled() {
    // snap all three balls into final slot state, killing in-flight tweens
    for (const ball of this._slottedBalls) {
      stopTweensOf(ball);
      stopTweensOf(ball.scale);
      ball.position.set(0, 0);
      ball.scale.set(0.8);
    }
    // rise above the other boxes
    const topLayer = this.world.topLayer;
    const global = this.container.parent.toGlobal(this.container.position);
    topLayer.addChild(this.container);
    const local = topLayer.toLocal(global);
    this.container.position.set(local.x, local.y);

    if (!this._reservedFired) {
      this._reservedFired = true;
      this.manager.nextTick(() => this.onBoxReserved?.());
    }
    audio.playBoxFilled();
    for (const ball of this._slottedBalls) {
      this._startBallGlow(ball, 0.25);
      const p = ball.parent.toGlobal(ball.position);
      const lp = this.container.toLocal(p);
      this.manager.spawnHitEffect(this.container, lp.x, lp.y, 0.15);
    }
    tweenTo(
      this.container,
      { y: this.container.y - F().rise },
      0.09,
      ease.outBack,
      () => delay(0.05, () => this._disappear()),
    );
  }

  // Leaves the board without being filled, for when the run is over. Unlike
  // _disappear this counts for nothing: onBoxFilled is dropped first so a tray
  // swept off at the end is not recorded as one the player completed.
  clearAway(after) {
    if (this.container.destroyed) return;
    this.onBoxFilled = null;
    this.onBoxReserved = null;
    this._isOpen = false;
    this._busy = true;
    stopTweensOf(this.container);
    stopTweensOf(this.container.scale);
    delay(after, () => {
      if (this.container.destroyed) return;
      tweenTo(this.container.scale, { x: 0, y: 0 }, 0.18, ease.inBack, () => {
        if (this.container.destroyed) return;
        for (const ball of this._slottedBalls) {
          stopTweensOf(ball);
          stopTweensOf(ball.scale);
          this.world.despawnBall(ball);
        }
        this._slottedBalls.length = 0;
        this.container.destroy({ children: true });
      });
    });
  }

  _disappear() {
    if (this.container.destroyed) return;
    tweenTo(
      this.container.scale,
      { x: 1.08, y: 1.08 },
      0.05,
      ease.outQuad,
      () =>
        tweenTo(this.container.scale, { x: 0, y: 0 }, 0.1, ease.inBack, () => {
          if (this.container.destroyed) return;
          for (const ball of this._slottedBalls) {
            stopTweensOf(ball);
            stopTweensOf(ball.scale);
            this.world.despawnBall(ball);
          }
          this._slottedBalls.length = 0;
          const cb = this.onBoxFilled;
          this.onBoxFilled = null;
          cb?.();
          this.container.destroy({ children: true });
        }),
    );
  }
}

export class FillBoxManager {
  constructor(world) {
    this.world = world;
    const f = F();

    // No "socket" sprites under the anchors. A tray covers its anchor exactly,
    // so a base drawn underneath is only ever visible where a tray is missing
    // — a column that has run out, or the half-second a row is mid-shift — and
    // the original leaves bare board there, not a ghost of a tray.

    this.columns = [[], [], [], []];
    this.columnBusy = [false, false, false, false];
    this.colConsumed = [0, 0, 0, 0];
    this.totalFilled = 0;
    this._jamTimer = 0;
    this.onAllBoxesFilled = null;
    this._queue = [];

    // initial rows: one shared row index per row — whole-board colour waves
    let nextRowIndex = 0;
    for (let r = 0; r < f.rowYs.length; r++) {
      const rowIndex = nextRowIndex++;
      for (let col = 0; col < 4; col++) {
        const box = this._createBox(col, rowIndex);
        if (!box) continue;
        box.container.position.set(f.xs[col], f.rowYs[r]);
        world.fillLayer.addChild(box.container);
        if (r === 0) box.openInstant();
        else box.setClosed();
        this.columns[col].push(box);
      }
    }
    this._nextRowIndex = nextRowIndex;
  }

  nextTick(fn) {
    this._queue.push(fn);
  }

  _colorForRowIndex(i) {
    const seq = ECONOMY.rowColorSequence;
    return seq[((i % seq.length) + seq.length) % seq.length];
  }

  // Unjams a board that has no move left.
  //
  // Trays open on a fixed colour tape, but a tap delivers nine balls of one
  // colour and the multipliers make that twenty-seven — the whole belt. Each
  // column walks the tape at its own pace, so what is open rarely matches what
  // arrived, and the surplus rides the belt with nowhere to go. Once nothing
  // waiting fits anything open, no tray can fill, so no tray can open, and the
  // belt silts up until the run is lost. Measured, a careful player still lost
  // inside 30 s with the grid full and eighteen box-loads still in the pipes.
  //
  // Colouring new trays by demand does not reach this: a replacement joins the
  // back of its column and only opens four fills later, by which time the belt
  // holds something else. The tray that has to change is the open one, so when
  // the board has been stuck for unjamDelay seconds the emptiest open tray is
  // repainted to whichever colour has the most balls waiting. That is the
  // smallest nudge that returns a move, and it leaves the tape in charge
  // everywhere else.
  _unjam(dt) {
    const waiting = new Map();
    for (const ball of Ball.all) {
      if (ball.destroyed || ball.takenByBox) continue;
      waiting.set(ball.color, (waiting.get(ball.color) ?? 0) + 1);
    }
    const fronts = [];
    for (const column of this.columns) {
      const front = column[0];
      if (front && !front.container.destroyed && front.isOpen)
        fronts.push(front);
    }
    const stuck =
      waiting.size > 0 &&
      fronts.length > 0 &&
      !fronts.some((box) => (waiting.get(box.color) ?? 0) > 0);
    if (!stuck) {
      this._jamTimer = 0;
      return;
    }
    this._jamTimer += dt;
    if (this._jamTimer < ECONOMY.unjamDelay) return;
    this._jamTimer = 0;

    let color = null;
    let most = 0;
    for (const [c, n] of waiting) {
      if (n > most) {
        most = n;
        color = c;
      }
    }
    const target = fronts.reduce((a, b) => (b.openSlots > a.openSlots ? b : a));
    target.recolor(color);
  }

  _createBox(colIndex, rowIndex) {
    if (
      ECONOMY.maxCycles > 0 &&
      rowIndex >= ECONOMY.maxCycles * ECONOMY.rowColorSequence.length
    ) {
      return null;
    }
    const box = new FillBox(this, this._colorForRowIndex(rowIndex));
    box.onBoxReserved = () => this._onBoxReserved(colIndex);
    box.onBoxFilled = () => {
      this.totalFilled++;
      this._checkAllFilled();
    };
    return box;
  }

  _onBoxReserved(col) {
    const f = F();
    const column = this.columns[col];
    column.shift(); // the consumed front box destroys itself
    this.columnBusy[col] = true;

    const rowIndex = this._nextRowIndex + this.colConsumed[col];
    this.colConsumed[col]++;
    const newBox = this._canAddBox() ? this._createBox(col, rowIndex) : null;
    if (newBox) {
      newBox.setClosed();
      newBox.container.position.set(
        f.xs[col],
        f.rowYs[f.rowYs.length - 1] + f.rowStep,
      );
      this.world.fillLayer.addChild(newBox.container);
      column.push(newBox);
    }

    if (column.length && !column[0].container.destroyed) column[0].open();

    let pending = 0;
    for (let r = 0; r < Math.min(column.length, f.rowYs.length); r++) {
      const box = column[r];
      if (!box || box.container.destroyed) continue;
      pending++;
      tweenTo(
        box.container,
        { x: f.xs[col], y: f.rowYs[r] },
        f.shiftDuration,
        ease.quadInOut,
        () => {
          if (--pending <= 0) this.columnBusy[col] = false;
        },
      );
    }
    if (pending === 0) this.columnBusy[col] = false;
  }

  // Slots the trays currently on the board are still waiting to be given.
  openSlotsRemaining() {
    let slots = 0;
    for (const column of this.columns) {
      for (const box of column) {
        if (!box.container.destroyed) slots += box.openSlots;
      }
    }
    return slots;
  }

  // A column only tops itself up while the balls left to sort — those in play
  // plus those the pipes have not delivered yet — could fill more than the
  // trays already standing. maxCycles alone cannot do this: its 216 trays are
  // 648 slots, which the 216 balls only reach if every single one is tripled
  // on a multiplier bar, so any real run left rows on the board that nothing
  // could ever fill and the level simply never ended. Asking the ball supply
  // instead makes the grid drain exactly as the balls do, and it self-corrects
  // — using the multipliers creates balls, which brings more trays with them.
  _canAddBox() {
    const source = this.world.sourceBoxManager;
    if (!source) return true;
    // While the pipes can still deliver, always top up. Thinning the grid
    // early is unrecoverable — a column only refills when one of its own trays
    // is consumed, so an empty one stays empty however many balls the
    // multipliers go on to make — and it starves the board of the open colours
    // that keep the belt moving. Measured, that left two dead columns facing
    // 21 balls with 18 still to come. The supply only shapes the endgame.
    if (source.ballsPending() > 0) return true;
    return Ball.getUnsortedCount() > this.openSlotsRemaining();
  }

  _checkAllFilled() {
    // Draining every column is a win in its own right now: the grid can empty
    // before the original's fixed quota is anywhere near reached.
    if (this.columns.every((column) => column.length === 0)) {
      this.onAllBoxesFilled?.();
      return;
    }
    if (ECONOMY.maxCycles <= 0) return;
    const needed = ECONOMY.maxCycles * ECONOMY.rowColorSequence.length * 4;
    if (this.totalFilled >= needed) this.onAllBoxesFilled?.();
  }

  // Takes the whole receiver grid off the board once the run is decided:
  // rows the run can no longer touch, sitting under the ending screen, read as
  // a board still waiting to be played.
  clearAll() {
    if (this._cleared) return;
    this._cleared = true;
    let n = 0;
    for (const column of this.columns) {
      for (const box of column) box.clearAway(0.035 * n++);
      column.length = 0;
    }
  }

  getOpenBoxColors() {
    const out = new Set();
    for (const column of this.columns) {
      const front = column[0];
      if (front && !front.container.destroyed && front.isOpen) {
        out.add(front.color);
      }
    }
    return out;
  }

  update(dt = 0) {
    this._unjam(dt);
    if (this._queue.length) {
      const jobs = this._queue;
      this._queue = [];
      for (const job of jobs) job();
    }
    for (const column of this.columns) {
      for (const box of column) {
        if (!box.container.destroyed) box.update();
      }
    }
  }

  // The landing light (the original's ParticleBallLitBeam): a narrow
  // vertical column rising from the ball, up past the tray's edge — the
  // anchor sits low so most of the beam stands above the ball.
  spawnHitEffect(parent, x, y, dur) {
    const fx = new Sprite(this.world.textures.beam);
    fx.anchor.set(0.5, 0.8);
    fx.position.set(x, y);
    fx.width = F().hitEffect.w;
    fx.height = F().hitEffect.h;
    fx.alpha = 0;
    parent.addChild(fx);
    tweenTo(fx, { alpha: 1 }, dur, ease.sineOut, () =>
      tweenTo(fx, { alpha: 0 }, dur, ease.sineIn, () => fx.destroy()),
    );
  }
}
