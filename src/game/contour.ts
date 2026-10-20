// Alpha-mask → simplified outline polygon.
//
// The character sprites are transparent PNGs, so the "space a character occupies" is the set of
// opaque pixels. We trace the outer boundary of the largest opaque blob (Moore-neighbour tracing)
// and simplify it with Ramer–Douglas–Peucker so the physics engine gets a polygon with a few
// dozen vertices instead of a bounding box.

export interface Vec {
  x: number;
  y: number;
}

export interface OutlineOptions {
  /** Alpha value (0–255) at or above which a pixel counts as occupied. */
  threshold?: number;
  /** RDP tolerance in pixels; raised automatically until the polygon fits `maxVertices`. */
  epsilon?: number;
  /** Upper bound on the number of polygon vertices. */
  maxVertices?: number;
  /** Concave pockets smaller than this fraction of the polygon area are filled in (0 = keep all). */
  minPocketFraction?: number;
}
// Moore neighbourhood, clockwise, starting west (screen coordinates: +y is down).
const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];

/** Binary mask (1 = occupied) from RGBA pixel data. */
export function alphaMask(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) {
    if (data[p] >= threshold) mask[i] = 1;
  }
  return mask;
}

/** Keeps only the largest 8-connected component of `mask` (in place). Returns its pixel count. */
export function keepLargestComponent(mask: Uint8Array, width: number, height: number): number {
  const labels = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  const sizes: number[] = [0];
  let nextLabel = 1;

  for (let seed = 0; seed < mask.length; seed++) {
    if (mask[seed] === 0 || labels[seed] !== 0) continue;
    const label = nextLabel++;
    let size = 0;
    let top = 0;
    stack[top++] = seed;
    labels[seed] = label;
    while (top > 0) {
      const idx = stack[--top];
      size++;
      const x = idx % width;
      const y = (idx - x) / width;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (mask[n] === 1 && labels[n] === 0) {
          labels[n] = label;
          stack[top++] = n;
        }
      }
    }
    sizes.push(size);
  }

  let best = 0;
  for (let l = 1; l < sizes.length; l++) if (sizes[l] > sizes[best]) best = l;
  if (best === 0) return 0;
  for (let i = 0; i < mask.length; i++) if (labels[i] !== best) mask[i] = 0;
  return sizes[best];
}

/**
 * Traces the outer boundary of the (single, 8-connected) blob in `mask` using Moore-neighbour
 * tracing with Jacob's stopping criterion. Returns boundary pixel centres in order.
 */
export function traceBoundary(mask: Uint8Array, width: number, height: number): Vec[] {
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  const sx = start % width;
  const sy = (start - sx) / width;
  const points: Vec[] = [{x: sx + 0.5, y: sy + 0.5}];

  // Single-pixel blob.
  let hasNeighbour = false;
  for (let d = 0; d < 8 && !hasNeighbour; d++) hasNeighbour = inside(sx + DX[d], sy + DY[d]);
  if (!hasNeighbour) return points;

  let cx = sx;
  let cy = sy;
  // The start pixel is top-most then left-most, so its west neighbour is guaranteed outside.
  let backDir = 0;
  let firstStep = -1;
  const limit = mask.length * 4;

  for (let iter = 0; iter < limit; iter++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (backDir + k) & 7;
      if (inside(cx + DX[d], cy + DY[d])) {
        found = d;
        break;
      }
    }
    if (found < 0) break;

    // Jacob's stopping criterion: back at the start, entering the same way as the first step.
    if (cx === sx && cy === sy) {
      if (firstStep < 0) firstStep = found;
      else if (found === firstStep) break;
    }

    // The neighbour examined just before `found` is outside; it becomes the new backtrack.
    // Relative to the new current pixel it sits at D[prevOutside] - D[found], which is always a
    // unit Moore step because consecutive directions differ in exactly one coordinate.
    const prevOutside = (found + 7) & 7;
    cx += DX[found];
    cy += DY[found];
    backDir = dirTo(DX[prevOutside] - DX[found], DY[prevOutside] - DY[found]);

    if (cx === sx && cy === sy) {
      // Check the criterion on the next iteration; do not duplicate the start point.
      continue;
    }
    points.push({x: cx + 0.5, y: cy + 0.5});
  }

  return points;
}

function dirTo(dx: number, dy: number): number {
  for (let d = 0; d < 8; d++) if (DX[d] === dx && DY[d] === dy) return d;
  // (dx, dy) is at most one step away in each axis for Moore tracing; this is unreachable.
  return 0;
}

function perpendicularDistance(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

/** Ramer–Douglas–Peucker on an open polyline (keeps both end points). */
export function simplifyOpen(points: Vec[], epsilon: number): Vec[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop() as [number, number];
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpendicularDistance(points[i], points[s], points[e]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([s, maxIdx], [maxIdx, e]);
    }
  }
  const out: Vec[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** RDP on a closed ring: split at the two mutually farthest vertices, simplify both halves. */
export function simplifyClosed(ring: Vec[], epsilon: number): Vec[] {
  if (ring.length < 4) return ring.slice();
  let far = 0;
  let farDist = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i].x - ring[0].x) ** 2 + (ring[i].y - ring[0].y) ** 2;
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const a = simplifyOpen(ring.slice(0, far + 1), epsilon);
  const b = simplifyOpen(ring.slice(far).concat([ring[0]]), epsilon);
  // a ends at ring[far], b starts at ring[far] and ends at ring[0] (== a[0]).
  return a.concat(b.slice(1, -1));
}

/** Shoelace area (positive regardless of winding). */
export function polygonArea(poly: Vec[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(s) / 2;
}

/** Area centroid of a simple polygon. */
export function polygonCentroid(poly: Vec[]): Vec {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += cross;
    cx += (poly[j].x + poly[i].x) * cross;
    cy += (poly[j].y + poly[i].y) * cross;
  }
  if (a === 0) return {x: poly[0]?.x ?? 0, y: poly[0]?.y ?? 0};
  return {x: cx / (3 * a), y: cy / (3 * a)};
}

/** Andrew's monotone chain convex hull (counter-clockwise in a y-up frame; orientation irrelevant here). */
export function convexHull(points: Vec[]): Vec[] {
  const pts = points.slice().sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Fills concave pockets whose area is below `minFraction` of the polygon area, replacing them by
 * the corresponding convex-hull edge. Keeps the large concavities (e.g. between head and body)
 * that matter for stacking while dropping tiny notches that only add physics parts.
 */
export function prunePockets(poly: Vec[], minFraction: number): Vec[] {
  const n = poly.length;
  if (n < 4) return poly.slice();
  const total = polygonArea(poly);
  const hullIdx = convexHull(poly)
    .map(h => poly.indexOf(h))
    .sort((a, b) => a - b);
  if (hullIdx.length < 3) return poly.slice();
  const out: Vec[] = [];
  for (let k = 0; k < hullIdx.length; k++) {
    const a = hullIdx[k];
    const b = hullIdx[(k + 1) % hullIdx.length];
    out.push(poly[a]);
    const pocket: Vec[] = [];
    for (let i = (a + 1) % n; i !== b; i = (i + 1) % n) pocket.push(poly[i]);
    if (pocket.length === 0) continue;
    if (polygonArea([poly[a], ...pocket, poly[b]]) >= minFraction * total) out.push(...pocket);
  }
  return out;
}

/** True when no two non-adjacent edges of the ring intersect. O(n²), fine for n ≤ ~64. */
export function isSimplePolygon(poly: Vec[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  const segIntersect = (a: Vec, b: Vec, c: Vec, d: Vec) => {
    const o = (p: Vec, q: Vec, r: Vec) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = o(a, b, c);
    const o2 = o(a, b, d);
    const o3 = o(c, d, a);
    const o4 = o(c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

/**
 * Outline polygon of the opaque region of an RGBA bitmap, in pixel coordinates (origin top-left).
 * Falls back to the convex hull of the traced boundary if simplification produced a
 * self-intersecting ring.
 */
export function outlineFromAlpha(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  {threshold = 40, epsilon = 2, maxVertices = 40, minPocketFraction = 0}: OutlineOptions = {},
): Vec[] {
  const mask = alphaMask(data, width, height, threshold);
  if (keepLargestComponent(mask, width, height) === 0) return [];
  const boundary = traceBoundary(mask, width, height);
  if (boundary.length < 3) return convexHull(boundary);

  let eps = epsilon;
  let poly = simplifyClosed(boundary, eps);
  while (poly.length > maxVertices && eps < 64) {
    eps *= 1.5;
    poly = simplifyClosed(boundary, eps);
  }
  if (poly.length < 3 || !isSimplePolygon(poly)) return convexHull(boundary);
  if (minPocketFraction > 0) {
    // Pruning can leave collinear runs; a second RDP pass at the same tolerance removes them.
    poly = simplifyClosed(prunePockets(poly, minPocketFraction), eps);
    if (poly.length < 3 || !isSimplePolygon(poly)) return convexHull(boundary);
  }
  return poly;
}
