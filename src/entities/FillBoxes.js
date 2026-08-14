import { Container, Graphics, Sprite } from "pixi.js";
import { LAYOUT, ALL_COLORS, ECONOMY } from "../config.js";
import { audio } from "../audio.js";
import { tweenTo, ease, delay } from "../tween.js";
import { Ball } from "./Ball.js";
import { buildTrayLayout } from "./trayLayout.js";

// read live so the editor can retune well spacing without a reload
const slotOffsets = () => LAYOUT.fillColumns.slotOffsets;
// Trays each column works through. Set by the closed economy in config, so
// the last tray is filled by the last ball.
const ROWS_TOTAL = ECONOMY.rowsPerColumn;
// How far above the trays the column mask reaches. Must clear the belt's
// lower slot row, otherwise a ball briefly vanishes between leaving the belt
// and entering the mask.
const MASK_HEADROOM = 100;

// One receiver tray. Closed it shows the plain lid bar; open it shows the
// base with three ball wells and sits slightly taller.
class Tile {
  constructor(column, color, world) {
    this.column = column;
    this.color = color;
    this.world = world;
    this.isOpen = false;
    this.filledCount = 0;
    this.landedCount = 0;
    this.reserved = false;
    this.slotTaken = [false, false, false];
    this.balls = [null, null, null];

    this.container = new Container();

    // contact shadow, so the stack of trays reads as stepped rather than flat
    this.shadow = new Sprite(world.textures.boxShadow);
    this.shadow.anchor.set(0.5);
    this.shadow.width = LAYOUT.fillColumns.tileW * 1.06;
    this.shadow.height = LAYOUT.fillColumns.closedH * 1.15;
    this.shadow.y = 7;
    this.shadow.alpha = 0.3;
    this.container.addChild(this.shadow);

    this.sprite = new Sprite(world.textures.boxLid[color]);
    this.sprite.anchor.set(0.5);
    this.container.addChild(this.sprite);

    // Balls are re-parented in here once they start dropping, so they ride
    // along with the tray. Clipping is done once per column (see FillColumn)
    // rather than per tray — a mask per tray churned GPU resources fast
    // enough to lose the WebGL context part-way through a game.
    this.ballHolder = new Container();
    this.container.addChild(this.ballHolder);

    this.close();
  }

  setY(y, animated) {
    if (animated) tweenTo(this.container, { y }, 0.18, ease.sineInOut);
    else this.container.y = y;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.sprite.texture = this.world.textures.boxBase[this.color];
    this.sprite.width = LAYOUT.fillColumns.tileW;
    this.sprite.height = LAYOUT.fillColumns.openH;
    this.container.zIndex = 10;
  }

  close() {
    this.isOpen = false;
    this.sprite.texture = this.world.textures.boxLid[this.color];
    this.sprite.width = LAYOUT.fillColumns.tileW;
    this.sprite.height = LAYOUT.fillColumns.closedH;
    this.container.zIndex = 0;
  }

  // Swap an untouched tray over to another colour. Used to break a deadlock
  // when the belt is jammed with something no open tray wants.
  recolor(color) {
    this.color = color;
    if (this.isOpen) {
      this.isOpen = false;
      this.open();
    } else {
      this.close();
    }
  }

  get isFilled() {
    return this.filledCount >= slotOffsets().length;
  }

  // Index of the free well nearest to world x, or -1 if none is close enough.
  // Picking the nearest (rather than filling strictly left to right) keeps the
  // sideways travel under half a well pitch, so the ball really does just drop.
  freeSlotNear(x, tolerance) {
    let best = -1;
    let bestDist = tolerance;
    for (let i = 0; i < slotOffsets().length; i++) {
      if (this.slotTaken[i]) continue;
      const d = Math.abs(x - (this.column.x + slotOffsets()[i]));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  tryTake(ball, slotIdx) {
    if (!this.isOpen || this.isFilled || ball.color !== this.color)
      return false;
    if (!ball.owningCell || this.slotTaken[slotIdx]) return false;

    const fc = LAYOUT.fillColumns;
    this.slotTaken[slotIdx] = true;
    this.filledCount++;
    ball.takenByBox = true;
    ball.capturedByCell = true;
    ball.owningCell.ball = null;
    ball.owningCell = null;
    this.world.freeBalls.delete(ball);

    // hand the ball over to the tray, preserving its on-screen position
    const localX = ball.x - this.column.x;
    const localY = ball.y - (fc.topY + this.container.y);
    this.ballHolder.addChild(ball);
    ball.x = localX;
    ball.y = localY;

    tweenTo(ball, { y: fc.slotY }, 0.2, ease.inQuad, () => {
      // A bloom rather than a bulb switching off: the ball flares, a ring of
      // light opens out of it and fades, and only then does the ball settle
      // back to its normal shade.
      ball.glow(true);
      const spark = new Graphics()
        .circle(0, 0, 26)
        .stroke({ color: 0xffffff, width: 7, alpha: 0.95 });
      spark.x = ball.x;
      spark.y = ball.y;
      this.ballHolder.addChild(spark);
      // Both tweens touch the same object, so only the one that finishes last
      // may destroy it — otherwise the survivor writes to a freed .scale on
      // its next frame and throws.
      let running = 2;
      const finished = () => {
        if (--running === 0 && !spark.destroyed) spark.destroy();
      };
      tweenTo(spark.scale, { x: 2.1, y: 2.1 }, 0.34, ease.outQuad, finished);
      tweenTo(spark, { alpha: 0 }, 0.34, ease.outQuad, finished);
      delay(0.45, () => ball.glow(false));
      audio.playBallInBox();
      this.balls[slotIdx] = ball;
      this.landedCount++;
      if (this.landedCount >= slotOffsets().length) this._onFilled();
    });
    tweenTo(ball, { x: slotOffsets()[slotIdx] }, 0.2, ease.sineOut);
    // shrink so it nests inside the moulded well instead of overflowing it
    tweenTo(
      ball.scale,
      { x: fc.ballScale, y: fc.ballScale },
      0.2,
      ease.sineOut,
    );
    return true;
  }

  _onFilled() {
    if (!this.reserved) {
      this.reserved = true;
      delay(0, () => this.column.onTileReserved());
    }
    audio.playBoxFilled();
    tweenTo(
      this.container,
      { y: this.container.y - 30 },
      0.09,
      ease.outBack,
      () => delay(0.05, () => this._disappear()),
    );
  }

  _disappear() {
    // The pop is a chain of delayed tweens, and the tray can be torn down in
    // between — a scene rebuild, or a second fill landing on the same tile.
    // A destroyed container has no .scale, so animating it throws.
    if (this.container.destroyed) return;
    tweenTo(
      this.container.scale,
      { x: 1.08, y: 1.08 },
      0.05,
      ease.outQuad,
      () => {
        if (this.container.destroyed) return;
        tweenTo(this.container.scale, { x: 0, y: 0 }, 0.1, ease.inBack, () => {
          // recycle everything still inside, including any ball that was
          // mid-drop when the tray filled — otherwise it gets destroyed
          // along with the tray instead of returning to the pool
          for (const child of [...this.ballHolder.children]) {
            if (child instanceof Ball) Ball.despawn(child);
          }
          this.balls = [null, null, null];
          this.column.onTileCleared(this);
        });
      },
    );
  }
}

class FillColumn {
  constructor(index, manager, world) {
    this.index = index;
    this.manager = manager;
    this.world = world;
    this.x = LAYOUT.fillColumns.xs[index];
    this.tiles = [];

    const fc = LAYOUT.fillColumns;
    this.container = new Container();
    this.container.x = this.x;
    this.container.y = fc.topY;
    this.container.sortableChildren = true;
    world.fillLayer.addChild(this.container);

    // One long-lived mask for the whole column: keeps balls inside the tray
    // stack, lets a filled tray pop upward, and hides the queued trays that
    // would otherwise stick out past the bottom of the board.
    //
    // The lower edge is the board's own inner rim, not a count of rows. Tying
    // it to rowsVisible let the last row finish clear of the frame and sit
    // there fully drawn, which reads as a stack that simply stops; the
    // original cuts that row against the woodwork so the column looks like it
    // continues underneath. FRAME_INNER_INSET is half the widest frame ring
    // (26px, centred on the board path in Board.js), which is where the gold
    // stops and the wood begins.
    const FRAME_INNER_INSET = 13;
    const top = -MASK_HEADROOM;
    const bottom = LAYOUT.board.bottom - FRAME_INNER_INSET - fc.topY;
    this.mask = new Graphics()
      .roundRect(-fc.tileW / 2 - 4, top, fc.tileW + 8, bottom - top, 16)
      .fill(0xffffff);
    this.container.addChild(this.mask);
    this.container.mask = this.mask;
  }

  addTile(tile, row) {
    tile.container.y = row * LAYOUT.fillColumns.rowStep;
    this.container.addChild(tile.container);
    this.tiles.push(tile);
  }

  // The top tray is full and rising: queue a fresh one at the bottom.
  onTileReserved() {
    const tile = this.manager.createTileForColumn(this.index);
    if (!tile) return;
    const lastY = this.tiles.length
      ? this.tiles[this.tiles.length - 1].container.y
      : 0;
    tile.container.y = lastY + LAYOUT.fillColumns.rowStep;
    this.container.addChild(tile.container);
    this.tiles.push(tile);
  }

  onTileCleared(tile) {
    const idx = this.tiles.indexOf(tile);
    if (idx >= 0) this.tiles.splice(idx, 1);
    // context:true frees the Graphics GPU buffers; texture stays false so the
    // shared tray artwork is not torn down with it
    tile.container.destroy({ children: true, context: true });
    for (let i = 0; i < this.tiles.length; i++) {
      this.tiles[i].setY(i * LAYOUT.fillColumns.rowStep, true);
    }
    this.refreshOpen();
    this.manager.onTileFullyCleared();
  }

  // The trays a ball can actually drop into right now. A tap loads 27 balls
  // (9 trays' worth) in one go, so a single open tray per column could never
  // absorb it — the belt jammed every time. Three deep gives 12 live trays.
  openTiles() {
    return this.tiles
      .slice(0, LAYOUT.fillColumns.openRows)
      .filter((t) => t.isOpen);
  }

  refreshOpen() {
    for (const tile of this.tiles.slice(0, LAYOUT.fillColumns.openRows)) {
      tile.open();
    }
  }
}

export class FillBoxManager {
  constructor(world) {
    this.world = world;
    this.totalCleared = 0;
    this.totalTilesPlanned = ROWS_TOTAL * LAYOUT.fillColumns.xs.length;

    // The whole board's colours are decided up front: exact per-colour totals
    // matching the pipes' stock, and no colour repeated down a column.
    this._layout = buildTrayLayout(
      LAYOUT.fillColumns.xs.length,
      ROWS_TOTAL,
      ALL_COLORS,
    );

    this.columns = LAYOUT.fillColumns.xs.map(
      (_, i) => new FillColumn(i, this, world),
    );

    for (let r = 0; r < LAYOUT.fillColumns.rowsVisible; r++) {
      for (const col of this.columns) {
        const tile = this._createTile(col);
        if (tile) col.addTile(tile, r);
      }
    }
    for (const col of this.columns) col.refreshOpen();
  }

  _createTile(column) {
    const queue = this._layout[this.columns.indexOf(column)];
    if (!queue.length) return null;
    return new Tile(column, queue.shift(), this.world);
  }

  createTileForColumn(colIdx) {
    return this._createTile(this.columns[colIdx]);
  }

  // Balls still wanted by the trays that are currently open, per colour.
  // The source boxes use this to decide what to hand the player next.
  getDemand() {
    const demand = new Map();
    for (const col of this.columns) {
      for (const t of col.openTiles()) {
        if (t.isFilled) continue;
        const need = slotOffsets().length - t.filledCount;
        demand.set(t.color, (demand.get(t.color) ?? 0) + need);
      }
    }
    return demand;
  }

  getOpenColors() {
    const s = new Set();
    for (const col of this.columns) {
      for (const tile of col.openTiles()) s.add(tile.color);
    }
    return s;
  }

  update() {
    const conveyor = this.world.conveyor;
    const cells = conveyor.getOccupiedCells();
    if (!cells.length) return;
    const tol = LAYOUT.fillColumns.catchTolerance;

    for (const cell of cells) {
      const ball = cell.ball;
      if (!ball || ball.takenByBox) continue;
      // only the underside run passes over the trays; anywhere else the ball
      // would have to be yanked sideways to reach one
      if (!conveyor.isBottomSegment(cell.curDist)) continue;

      let taken = false;
      for (const col of this.columns) {
        for (const tile of col.openTiles()) {
          if (tile.isFilled || tile.color !== ball.color) continue;
          const slot = tile.freeSlotNear(ball.x, tol);
          if (slot < 0) continue;
          tile.tryTake(ball, slot);
          taken = true;
          break;
        }
        if (taken) break;
      }
    }
  }

  onTileFullyCleared() {
    this.totalCleared++;
    this.world.checkVictory();
  }

  shuffle() {
    const pool = [];
    for (const col of this.columns) {
      for (let i = 1; i < col.tiles.length; i++) pool.push(col.tiles[i]);
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const ci = pool[i].color;
      pool[i].color = pool[j].color;
      pool[j].color = ci;
      pool[i].close();
      pool[j].close();
    }
  }
}
