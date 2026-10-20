// Canvas 2D renderer: wood wall + gingham floor, faux-3D glass box, Poppy the cloud, sprites drawn
// about their silhouette centroid, merge bursts and score pops. All drawing happens in world units;
// `resize` fits the world into the canvas with letterboxing.
import {BOX_BOTTOM, BOX_H, BOX_LEFT, BOX_RIGHT, BOX_TOP, BOX_W, MambokaEngine, WALL, WORLD_H, WORLD_W} from './engine';
import type {TierShape} from './shapes';

const COLORS = {
  woodTop: '#d89b5c',
  woodBottom: '#c9884a',
  woodLine: 'rgba(120, 70, 30, 0.12)',
  tableEdge: '#b87a44',
  gingham: '#f6e7a8',
  ginghamStripe: 'rgba(214, 180, 90, 0.35)',
  boxFill: 'rgba(255, 250, 240, 0.4)',
  boxTopFill: 'rgba(255, 250, 238, 0.78)',
  boxWall: 'rgba(250, 236, 205, 0.92)',
  boxEdge: '#e8cd9b',
  boxEdgeDark: '#d6b37a',
  boxInnerEdge: 'rgba(255, 250, 236, 0.9)',
  boxShadow: 'rgba(120, 70, 30, 0.18)',
  glassSheen: 'rgba(255, 255, 255, 0.18)',
  guide: 'rgba(255, 255, 255, 0.65)',
  poppy: '#fbefb8',
  poppyOutline: '#a8783c',
  poppyFace: '#5b3a1e',
  poppyCheek: 'rgba(255, 140, 140, 0.55)',
  warn: 'rgba(230, 70, 60, 0.9)',
  scoreFill: '#f5a623',
  scoreStroke: '#8b4a15',
};

// Faux-3D: the back rim sits higher and slightly narrower than the front rim.
const RIM_RISE = 26;
const RIM_INSET = 14;
const HORIZON = BOX_TOP + BOX_H * 0.72;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  born: number;
  life: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  color: string;
  born: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  born: number;
}

const POP_IN_MS = 240;
const PARTICLE_GRAVITY = 900; // world units / s²

export class Renderer {
  debug = false;
  private readonly ctx: CanvasRenderingContext2D;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private background: HTMLCanvasElement | null = null;
  private readonly particles: Particle[] = [];
  private readonly rings: Ring[] = [];
  private readonly popups: Popup[] = [];
  /** Wall-clock time at which a merge-spawned piece appeared, for the pop-in scale. */
  private readonly popIn = new Map<number, number>();

  /** `colors[tier]` is the burst colour for a tier (roster accents for the built-in set, sprite tints for uploads). */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly shapes: TierShape[],
    private readonly engine: MambokaEngine,
    private readonly fontFamily: string,
    private readonly colors: readonly string[],
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  /**
   * Sizes the backing store for `cssW × cssH` CSS px and fits the world into the area left free
   * by the HUD overlays (`insets`, CSS px), keeping the aspect ratio.
   */
  resize(
    cssW: number,
    cssH: number,
    dpr: number,
    insets: {top: number; bottom: number; left: number; right: number},
  ): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    const freeW = Math.max(1, cssW - insets.left - insets.right);
    const freeH = Math.max(1, cssH - insets.top - insets.bottom);
    this.scale = Math.min(freeW / WORLD_W, freeH / WORLD_H);
    this.offsetX = insets.left + (freeW - WORLD_W * this.scale) / 2;
    this.offsetY = insets.top + (freeH - WORLD_H * this.scale) / 2;
    this.background = null;
  }

  /** Canvas-relative CSS px → world x. */
  toWorldX(clientX: number): number {
    return (clientX - this.offsetX) / this.scale;
  }

  burst(x: number, y: number, tier: number, now: number): void {
    const color = this.colors[tier];
    const size = 1 + tier * 0.18;
    const count = 10 + tier;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const speed = (140 + Math.random() * 220) * size;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120 * size,
        r: (3 + Math.random() * 4) * size,
        color: i % 3 === 0 ? '#fff6e3' : color,
        born: now,
        life: 450 + Math.random() * 250,
      });
    }
    this.rings.push({x, y, r: 30 * size, color, born: now});
  }

  popup(x: number, y: number, text: string, now: number): void {
    this.popups.push({x, y, text, born: now});
  }

  markSpawn(pieceId: number, now: number): void {
    this.popIn.set(pieceId, now);
  }

  clearEffects(): void {
    this.particles.length = 0;
    this.rings.length = 0;
    this.popups.length = 0;
    this.popIn.clear();
  }

  render(now: number, dtMs: number): void {
    const {ctx} = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.ensureBackground(), 0, 0, this.cssW, this.cssH);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    this.drawBoxBack();
    this.drawGuide();
    this.drawPieces(now);
    this.drawEffects(now, dtMs);
    this.drawBoxFront(now);
    this.drawPoppy();
    if (this.debug) this.drawDebug();

    ctx.restore();
  }

  private ensureBackground(): HTMLCanvasElement {
    if (this.background) return this.background;
    const bg = document.createElement('canvas');
    bg.width = this.canvas.width;
    bg.height = this.canvas.height;
    const ctx = bg.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const horizon = this.offsetY + HORIZON * this.scale;
    const edge = 16 * this.scale;

    const wood = ctx.createLinearGradient(0, 0, 0, horizon);
    wood.addColorStop(0, COLORS.woodTop);
    wood.addColorStop(1, COLORS.woodBottom);
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, this.cssW, horizon);
    ctx.strokeStyle = COLORS.woodLine;
    ctx.lineWidth = 1;
    const plank = 34 * this.scale;
    for (let y = plank; y < horizon; y += plank) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.cssW, y);
      ctx.stroke();
    }

    ctx.fillStyle = COLORS.tableEdge;
    ctx.fillRect(0, horizon, this.cssW, edge);

    const floorTop = horizon + edge;
    ctx.fillStyle = COLORS.gingham;
    ctx.fillRect(0, floorTop, this.cssW, this.cssH - floorTop);
    ctx.fillStyle = COLORS.ginghamStripe;
    const stripe = 26 * this.scale;
    for (
      let x = (((this.offsetX % (stripe * 2)) + stripe * 2) % (stripe * 2)) - stripe * 2;
      x < this.cssW;
      x += stripe * 2
    ) {
      ctx.fillRect(x, floorTop, stripe, this.cssH - floorTop);
    }
    for (let y = floorTop; y < this.cssH; y += stripe * 2) {
      ctx.fillRect(0, y, this.cssW, stripe);
    }
    this.background = bg;
    return bg;
  }

  private drawBoxBack(): void {
    const {ctx} = this;
    const backL = BOX_LEFT + RIM_INSET;
    const backR = BOX_RIGHT - RIM_INSET;
    const backY = BOX_TOP - RIM_RISE;

    // Top face (open lid seen from slightly above).
    ctx.fillStyle = COLORS.boxTopFill;
    ctx.beginPath();
    ctx.moveTo(BOX_LEFT - WALL, BOX_TOP);
    ctx.lineTo(backL - WALL, backY);
    ctx.lineTo(backR + WALL, backY);
    ctx.lineTo(BOX_RIGHT + WALL, BOX_TOP);
    ctx.closePath();
    ctx.fill();

    // Interior, with a soft shadow along the floor so the box reads as sitting on the table.
    ctx.fillStyle = COLORS.boxFill;
    ctx.fillRect(BOX_LEFT, BOX_TOP, BOX_W, BOX_H);
    const floorShadow = ctx.createLinearGradient(0, BOX_BOTTOM - 90, 0, BOX_BOTTOM);
    floorShadow.addColorStop(0, 'rgba(120, 70, 30, 0)');
    floorShadow.addColorStop(1, COLORS.boxShadow);
    ctx.fillStyle = floorShadow;
    ctx.fillRect(BOX_LEFT, BOX_BOTTOM - 90, BOX_W, 90);

    // Side walls and floor of the box.
    ctx.fillStyle = COLORS.boxWall;
    ctx.fillRect(BOX_LEFT - WALL, BOX_TOP, WALL, BOX_H + WALL);
    ctx.fillRect(BOX_RIGHT, BOX_TOP, WALL, BOX_H + WALL);
    ctx.fillRect(BOX_LEFT, BOX_BOTTOM, BOX_W, WALL);

    // Back rim and the slanted edges.
    ctx.strokeStyle = COLORS.boxEdgeDark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(BOX_LEFT - WALL, BOX_TOP);
    ctx.lineTo(backL - WALL, backY);
    ctx.lineTo(backR + WALL, backY);
    ctx.lineTo(BOX_RIGHT + WALL, BOX_TOP);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(BOX_LEFT, BOX_TOP);
    ctx.lineTo(backL, backY);
    ctx.lineTo(backR, backY);
    ctx.lineTo(BOX_RIGHT, BOX_TOP);
    ctx.stroke();
  }

  private drawBoxFront(now: number): void {
    const {ctx} = this;
    // Glass sheen over the contents.
    const sheen = ctx.createLinearGradient(BOX_LEFT, 0, BOX_LEFT + BOX_W * 0.35, 0);
    sheen.addColorStop(0, COLORS.glassSheen);
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(BOX_LEFT, BOX_TOP, BOX_W * 0.35, BOX_H);

    ctx.strokeStyle = COLORS.boxEdge;
    ctx.lineWidth = 3;
    ctx.strokeRect(BOX_LEFT - WALL, BOX_TOP, BOX_W + 2 * WALL, BOX_H + WALL);
    ctx.strokeRect(BOX_LEFT, BOX_TOP, BOX_W, BOX_H);
    ctx.strokeStyle = COLORS.boxInnerEdge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(BOX_LEFT - WALL + 3, BOX_TOP + 3, BOX_W + 2 * WALL - 6, BOX_H + WALL - 6);

    if (this.engine.warning) {
      const pulse = 0.55 + 0.45 * Math.sin(now / 90);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = COLORS.warn;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(BOX_LEFT - WALL, BOX_TOP);
      ctx.lineTo(BOX_RIGHT + WALL, BOX_TOP);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawGuide(): void {
    const centre = this.engine.heldCentre();
    if (centre === null || this.engine.held === null || this.engine.phase !== 'ready') return;
    const g = this.engine.geometry[this.engine.held];
    const {ctx} = this;
    ctx.strokeStyle = COLORS.guide;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centre.x, centre.y + g.maxY);
    ctx.lineTo(centre.x, BOX_BOTTOM);
    ctx.stroke();
  }

  private drawSprite(tier: number, cx: number, cy: number, angle: number, scale: number): void {
    const {ctx} = this;
    const g = this.engine.geometry[tier];
    const shape = this.shapes[tier];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.drawImage(shape.image, -g.drawW / 2, -g.drawH / 2, g.drawW, g.drawH);
    ctx.restore();
  }

  private drawPieces(now: number): void {
    const {ctx} = this;
    for (const piece of this.engine.pieces.values()) {
      const g = this.engine.geometry[piece.tier];
      const {position, angle} = piece.body;
      let pop = 1;
      const born = this.popIn.get(piece.id);
      if (born !== undefined) {
        const t = Math.max(0, (now - born) / POP_IN_MS);
        if (t >= 1) this.popIn.delete(piece.id);
        else pop = 0.55 + 0.45 * easeOutBack(t);
      }
      // body.position is the silhouette centroid; the sprite centre sits at -pivot in body space.
      ctx.save();
      ctx.translate(position.x, position.y);
      ctx.rotate(angle);
      ctx.scale(pop, pop);
      ctx.drawImage(
        this.shapes[piece.tier].image,
        -g.pivot.x - g.drawW / 2,
        -g.pivot.y - g.drawH / 2,
        g.drawW,
        g.drawH,
      );
      ctx.restore();
    }
  }

  private drawPoppy(): void {
    const {ctx, engine} = this;
    if (engine.phase === 'over') return;
    const x = engine.heldX;
    const bottom = engine.cloudBottomY;
    const w = 128;
    const h = 66;
    const cy = bottom - h / 2;

    const cloud = () => {
      ctx.beginPath();
      ctx.ellipse(x, cy + 6, w / 2, h / 2 - 6, 0, 0, Math.PI * 2);
      ctx.ellipse(x - w * 0.22, cy - 2, w * 0.2, h * 0.36, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.05, cy - 10, w * 0.24, h * 0.42, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.3, cy, w * 0.17, h * 0.3, 0, 0, Math.PI * 2);
    };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.poppyOutline;
    ctx.lineWidth = 6;
    cloud();
    ctx.stroke();
    ctx.fillStyle = COLORS.poppy;
    cloud();
    ctx.fill();

    // Face: dot eyes, tiny smile, blush.
    ctx.fillStyle = COLORS.poppyFace;
    ctx.beginPath();
    ctx.arc(x - 14, cy + 2, 3.2, 0, Math.PI * 2);
    ctx.arc(x + 14, cy + 2, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.poppyFace;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, cy + 6, 6, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.fillStyle = COLORS.poppyCheek;
    ctx.beginPath();
    ctx.arc(x - 24, cy + 10, 5, 0, Math.PI * 2);
    ctx.arc(x + 24, cy + 10, 5, 0, Math.PI * 2);
    ctx.fill();

    const centre = engine.heldCentre();
    if (centre !== null && engine.held !== null) {
      this.drawSprite(engine.held, centre.x, centre.y, 0, 1);
    }
  }

  private drawEffects(now: number, dtMs: number): void {
    const {ctx} = this;
    const dt = dtMs / 1000;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      const t = Math.max(0, (now - ring.born) / 320);
      if (t >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r * (0.4 + 1.2 * easeOutCubic(t)), 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const t = Math.max(0, (now - p.born) / p.life);
      if (t >= 1) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += PARTICLE_GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = `700 34px ${this.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      const t = Math.max(0, (now - pop.born) / 750);
      if (t >= 1) {
        this.popups.splice(i, 1);
        continue;
      }
      const y = pop.y - 50 * easeOutCubic(t);
      ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      ctx.lineWidth = 6;
      ctx.strokeStyle = COLORS.scoreStroke;
      ctx.strokeText(pop.text, pop.x, y);
      ctx.fillStyle = COLORS.scoreFill;
      ctx.fillText(pop.text, pop.x, y);
    }
    ctx.globalAlpha = 1;
  }

  private drawDebug(): void {
    const {ctx} = this;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 0, 80, 0.9)';
    for (const piece of this.engine.pieces.values()) {
      const parts = piece.body.parts.length > 1 ? piece.body.parts.slice(1) : [piece.body];
      for (const part of parts) {
        ctx.beginPath();
        part.vertices.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
        ctx.closePath();
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0, 120, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(piece.body.position.x, piece.body.position.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const centre = this.engine.heldCentre();
    if (centre && this.engine.held !== null) {
      const g = this.engine.geometry[this.engine.held];
      ctx.strokeStyle = 'rgba(0, 200, 120, 0.9)';
      ctx.beginPath();
      g.vertices.forEach((v, i) =>
        i === 0 ? ctx.moveTo(centre.x + v.x, centre.y + v.y) : ctx.lineTo(centre.x + v.x, centre.y + v.y),
      );
      ctx.closePath();
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(BOX_LEFT, BOX_TOP);
    ctx.lineTo(BOX_RIGHT, BOX_TOP);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
