// Game simulation: a Matter.js world shaped like the Suika box, silhouette-polygon bodies for the
// characters, merge/cancel rules, Switch-style scoring and the rim-crossing game-over rule.
import Matter, {type IEventCollision, Bodies, Body, Composite, Engine, Events} from 'matter-js';
import decomp from 'poly-decomp';

import type {Vec} from './contour';
import {DROPPABLE_TIERS, LAST_TIER, MAMBO_CANCEL_POINTS, TIERS} from './roster';
import type {TierShape} from './shapes';

Matter.Common.setDecomp(decomp);

// World units. The inner box is 600 wide; the Switch front face is ≈ 0.88 W:H → 684 tall, and the
// watermelon spans ≈ 0.46 of the inner width (kairess/suika-game capture: 259 px of 560).
export const BOX_W = 600;
export const BOX_H = 684;
export const WALL = 20;
export const SIDE = 30;
export const TOP = 250;
export const BOTTOM = 40;
export const WORLD_W = BOX_W + 2 * (WALL + SIDE);
export const WORLD_H = TOP + BOX_H + WALL + BOTTOM;
export const BOX_LEFT = SIDE + WALL;
export const BOX_RIGHT = BOX_LEFT + BOX_W;
/** The top rim is the dead line, as on Switch. */
export const BOX_TOP = TOP;
export const BOX_BOTTOM = BOX_TOP + BOX_H;
const MAX_DIAMETER = 0.46 * BOX_W;
/** Polygon area of a character relative to the disc of its Suika counterpart. Irregular shapes pack worse than circles, so slightly under 1. */
const AREA_FILL = 0.8;
/** Gap between the bottom of the largest droppable character and the rim while it hangs from Poppy. */
const HANG_GAP = 8;

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 4;
/** Switch: A is ignored for a beat after a drop; the next character appears once the dropped one touches anything. */
const DROP_MIN_LOCK_MS = 250;
const DROP_MAX_LOCK_MS = 1000;
/** Time a landed character may sit above the rim before the game ends (Switch publishes no number; clones use 1–2.5 s). */
const OVER_DELAY_MS = 1000;
/** All characters weigh the same, as on Switch (a cherry can shove a watermelon). */
const PIECE_MASS = 10;

const PIECE_OPTIONS: Matter.IBodyDefinition = {
  friction: 0.1,
  frictionStatic: 0.5,
  frictionAir: 0.01,
  restitution: 0.15,
  slop: 0.05,
  label: 'piece',
};

export interface TierGeometry {
  /** Native px → world units. */
  scale: number;
  /** Outline in world units, relative to the sprite centre. */
  vertices: Vec[];
  /** Area centroid in world units, relative to the sprite centre. `body.position` sits here. */
  pivot: Vec;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  drawW: number;
  drawH: number;
}

export interface Piece {
  id: number;
  tier: number;
  body: Body;
  /** Consumed by a merge; the body is already out of the world. */
  dead: boolean;
  /** Has collided with anything since it was dropped. Merge-spawned pieces start touched. */
  touched: boolean;
  /** Simulation time when the top of the body rose above the rim, or -1 while below. */
  aboveSince: number;
}

export type Phase = 'ready' | 'paused' | 'over';

export interface EngineEvents {
  /** A merge happened at (x, y). `piece` is the new body, or null when two Mambos cancelled out. */
  merge: {tier: number; x: number; y: number; points: number; piece: Piece | null};
  drop: {tier: number};
  land: {tier: number};
  hold: {held: number | null; next: number};
  score: {score: number; best: number};
  over: {score: number; best: number};
  phase: {phase: Phase};
}

type Listener<K extends keyof EngineEvents> = (payload: EngineEvents[K]) => void;

export class MambokaEngine {
  readonly engine: Engine;
  readonly geometry: TierGeometry[];
  readonly pieces = new Map<number, Piece>();
  /** Bottom edge of Poppy; the held character hangs from here. */
  readonly cloudBottomY: number;

  phase: Phase = 'ready';
  score = 0;
  best: number;
  held: number | null = null;
  next = 0;
  /** Sprite-centre x of the held character (world units). */
  heldX = BOX_LEFT + BOX_W / 2;
  simTime = 0;
  /** True while some landed character pokes above the rim (the game-over countdown is running). */
  warning = false;

  private accumulator = 0;
  private readonly mergeQueue: Array<[Body, Body]> = [];
  private pendingUnlock: {pieceId: number; at: number} | null = null;
  private readonly listeners = new Map<keyof EngineEvents, Set<Listener<keyof EngineEvents>>>();
  private readonly collisionHandler: (event: IEventCollision<Engine>) => void;

  constructor(shapes: TierShape[], best: number) {
    this.best = best;
    this.geometry = shapes.map((shape, tier) => buildGeometry(shape, tier));
    const tallest = Math.max(...this.geometry.slice(0, DROPPABLE_TIERS).map(g => g.maxY - g.minY));
    this.cloudBottomY = BOX_TOP - HANG_GAP - tallest;

    this.engine = Engine.create({positionIterations: 8, velocityIterations: 6, enableSleeping: false});
    this.engine.gravity.y = 1;

    const thickness = 200;
    const wallHeight = WORLD_H + 4000;
    Composite.add(this.engine.world, [
      Bodies.rectangle(BOX_LEFT - thickness / 2, BOX_BOTTOM - wallHeight / 2, thickness, wallHeight, {
        isStatic: true,
        label: 'wall',
        friction: 0.2,
      }),
      Bodies.rectangle(BOX_RIGHT + thickness / 2, BOX_BOTTOM - wallHeight / 2, thickness, wallHeight, {
        isStatic: true,
        label: 'wall',
        friction: 0.2,
      }),
      Bodies.rectangle(BOX_LEFT + BOX_W / 2, BOX_BOTTOM + thickness / 2, BOX_W + 2 * thickness, thickness, {
        isStatic: true,
        label: 'floor',
        friction: 0.4,
      }),
    ]);

    this.collisionHandler = this.onCollision.bind(this);
    Events.on(this.engine, 'collisionStart', this.collisionHandler);
    Events.on(this.engine, 'collisionActive', this.collisionHandler);

    this.next = this.randomTier();
    this.rollHeld();
  }

  on<K extends keyof EngineEvents>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const entry = listener as Listener<keyof EngineEvents>;
    set.add(entry);
    return () => set.delete(entry);
  }

  destroy(): void {
    Events.off(this.engine, 'collisionStart', this.collisionHandler);
    Events.off(this.engine, 'collisionActive', this.collisionHandler);
    Engine.clear(this.engine);
  }

  reset(): void {
    for (const piece of this.pieces.values()) Composite.remove(this.engine.world, piece.body);
    this.pieces.clear();
    this.mergeQueue.length = 0;
    this.pendingUnlock = null;
    this.score = 0;
    this.simTime = 0;
    this.accumulator = 0;
    this.warning = false;
    this.heldX = BOX_LEFT + BOX_W / 2;
    this.next = this.randomTier();
    this.rollHeld();
    this.setPhase('ready');
    this.emit('score', {score: 0, best: this.best});
  }

  pause(): void {
    if (this.phase === 'ready') this.setPhase('paused');
  }

  resume(): void {
    if (this.phase === 'paused') {
      this.accumulator = 0;
      this.setPhase('ready');
    }
  }

  /** Moves Poppy so the held character's sprite centre sits at world `x` (clamped inside the walls). */
  moveTo(x: number): void {
    this.heldX = this.clampX(x, this.held ?? this.next);
  }

  /** Nudges the held character horizontally by `dx` world units (keyboard control). */
  nudge(dx: number): void {
    this.moveTo(this.heldX + dx);
  }

  clampX(x: number, tier: number): number {
    const g = this.geometry[tier];
    const lo = BOX_LEFT - g.minX + 1;
    const hi = BOX_RIGHT - g.maxX - 1;
    return Math.min(hi, Math.max(lo, x));
  }

  /** Sprite-centre position of the held character while it hangs from Poppy. */
  heldCentre(): Vec | null {
    if (this.held === null) return null;
    return {x: this.heldX, y: this.cloudBottomY - this.geometry[this.held].minY};
  }

  /** Releases the held character. Returns false when nothing can be dropped right now. */
  drop(): boolean {
    if (this.phase !== 'ready' || this.held === null) return false;
    const tier = this.held;
    const centre = this.heldCentre() as Vec;
    const piece = this.spawn(
      tier,
      centre.x + this.geometry[tier].pivot.x,
      centre.y + this.geometry[tier].pivot.y,
      false,
      0,
    );
    this.held = null;
    this.pendingUnlock = {pieceId: piece.id, at: this.simTime};
    this.emit('drop', {tier});
    this.emit('hold', {held: null, next: this.next});
    return true;
  }

  /** Advances the simulation by `dtMs` of wall-clock time using fixed 60 Hz steps. */
  update(dtMs: number): void {
    if (this.phase !== 'ready') return;
    this.accumulator += Math.min(dtMs, STEP_MS * MAX_STEPS_PER_FRAME);
    let steps = 0;
    while (this.accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      Engine.update(this.engine, STEP_MS);
      this.simTime += STEP_MS;
      this.accumulator -= STEP_MS;
      steps++;
      this.afterStep();
      if (this.phase !== 'ready') break;
    }
  }

  private onCollision(event: IEventCollision<Engine>): void {
    for (const pair of event.pairs) {
      const a = this.pieces.get(pair.bodyA.parent.id);
      const b = this.pieces.get(pair.bodyB.parent.id);
      if (a) a.touched = true;
      if (b) b.touched = true;
      if (a && b && a !== b && a.tier === b.tier && !a.dead && !b.dead) {
        this.mergeQueue.push([a.body, b.body]);
      }
    }
  }

  private emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): void {
    const set = this.listeners.get(event);
    if (set) for (const listener of set) (listener as Listener<K>)(payload);
  }

  private setPhase(phase: Phase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.emit('phase', {phase});
  }

  private afterStep(): void {
    this.processMerges();
    this.checkUnlock();
    this.checkGameOver();
  }

  private processMerges(): void {
    while (this.mergeQueue.length > 0) {
      const [bodyA, bodyB] = this.mergeQueue.shift() as [Body, Body];
      const a = this.pieces.get(bodyA.id);
      const b = this.pieces.get(bodyB.id);
      if (!a || !b || a.dead || b.dead || a.tier !== b.tier) continue;
      const tier = a.tier;
      const x = (a.body.position.x + b.body.position.x) / 2;
      const y = (a.body.position.y + b.body.position.y) / 2;
      // Circular mean of the parents' orientations: two characters lying flat evolve into one lying
      // flat, which keeps the new (taller) silhouette from being buried in the floor and launched.
      const angle = Math.atan2(
        Math.sin(a.body.angle) + Math.sin(b.body.angle),
        Math.cos(a.body.angle) + Math.cos(b.body.angle),
      );
      this.remove(a);
      this.remove(b);
      if (tier === LAST_TIER) {
        this.addScore(MAMBO_CANCEL_POINTS);
        this.emit('merge', {tier, x, y, points: MAMBO_CANCEL_POINTS, piece: null});
      } else {
        // Switch: the evolved fruit appears at the midpoint, at rest, and shoves its neighbours aside.
        const piece = this.spawn(tier + 1, x, y, true, angle);
        const points = TIERS[tier + 1].points;
        this.addScore(points);
        this.emit('merge', {tier: tier + 1, x, y, points, piece});
      }
    }
  }

  private checkUnlock(): void {
    if (this.held !== null) return;
    if (!this.pendingUnlock) {
      this.rollHeld();
      return;
    }
    const elapsed = this.simTime - this.pendingUnlock.at;
    if (elapsed < DROP_MIN_LOCK_MS) return;
    const dropped = this.pieces.get(this.pendingUnlock.pieceId);
    const landed = !dropped || dropped.dead || dropped.touched;
    if (landed || elapsed >= DROP_MAX_LOCK_MS) {
      if (dropped && !dropped.dead) this.emit('land', {tier: dropped.tier});
      this.pendingUnlock = null;
      this.rollHeld();
    }
  }

  private checkGameOver(): void {
    let warning = false;
    for (const piece of this.pieces.values()) {
      // A character still in free fall from Poppy cannot lose the game; a landed one above the rim can.
      if (!piece.touched || piece.body.bounds.min.y >= BOX_TOP) {
        piece.aboveSince = -1;
        continue;
      }
      if (piece.aboveSince < 0) piece.aboveSince = this.simTime;
      warning = true;
      if (this.simTime - piece.aboveSince >= OVER_DELAY_MS) {
        this.warning = false;
        this.held = null;
        this.setPhase('over');
        this.emit('over', {score: this.score, best: this.best});
        return;
      }
    }
    this.warning = warning;
  }

  private rollHeld(): void {
    this.held = this.next;
    this.next = this.randomTier();
    this.heldX = this.clampX(this.heldX, this.held);
    this.emit('hold', {held: this.held, next: this.next});
  }

  private randomTier(): number {
    return Math.floor(Math.random() * DROPPABLE_TIERS);
  }

  private addScore(points: number): void {
    this.score += points;
    if (this.score > this.best) this.best = this.score;
    this.emit('score', {score: this.score, best: this.best});
  }

  /** Creates a body whose centroid is at (x, y), rotated by `angle`. Vertices are copied: Matter sorts/mutates its input. */
  private spawn(tier: number, x: number, y: number, touched: boolean, angle: number): Piece {
    const g = this.geometry[tier];
    const vertices = g.vertices.map(v => ({x: v.x, y: v.y}));
    const minimumArea = polygonAreaOf(vertices) * 0.002;
    const body = Bodies.fromVertices(x, y, [vertices], PIECE_OPTIONS, false, 0.01, minimumArea, 0.01);
    Body.setMass(body, PIECE_MASS);
    if (angle !== 0) Body.setAngle(body, angle);
    const piece: Piece = {id: body.id, tier, body, dead: false, touched, aboveSince: -1};
    this.pieces.set(body.id, piece);
    Composite.add(this.engine.world, body);
    return piece;
  }

  private remove(piece: Piece): void {
    piece.dead = true;
    this.pieces.delete(piece.id);
    Composite.remove(this.engine.world, piece.body);
  }
}

function polygonAreaOf(poly: Vec[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(s) / 2;
}

function buildGeometry(shape: TierShape, tier: number): TierGeometry {
  const diameter = MAX_DIAMETER * TIERS[tier].diameter;
  const targetArea = AREA_FILL * Math.PI * (diameter / 2) ** 2;
  const scale = Math.sqrt(targetArea / shape.area);
  const vertices = shape.outline.map(v => ({x: v.x * scale, y: v.y * scale}));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return {
    scale,
    vertices,
    pivot: {x: shape.pivot.x * scale, y: shape.pivot.y * scale},
    minX,
    maxX,
    minY,
    maxY,
    drawW: shape.width * scale,
    drawH: shape.height * scale,
  };
}
