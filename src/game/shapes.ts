import {type Vec, outlineFromAlpha, polygonArea, polygonCentroid} from './contour';

export interface TierShape {
  image: HTMLImageElement;
  /** Native bitmap size in px. */
  width: number;
  height: number;
  /** Outline polygon in native px, relative to the bitmap centre. */
  outline: Vec[];
  /** Area centroid of `outline` (native px, relative to the bitmap centre). */
  pivot: Vec;
  /** Area of `outline` in native px². */
  area: number;
  /** Mean colour of the opaque pixels (CSS rgb), used for merge particles of custom characters. */
  tint: string;
}

const OUTLINE_OPTIONS = {threshold: 40, epsilon: 2.2, maxVertices: 36, minPocketFraction: 0.03};

function loadImage(src: string): Promise<HTMLImageElement> {
  const {promise, resolve, reject} = Promise.withResolvers<HTMLImageElement>();
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Failed to load ${src}`));
  image.src = src;
  return promise;
}

/** Traces the opaque silhouette of one sprite. Exported for the debug overlay and tests. */
export function shapeFromImage(image: HTMLImageElement): TierShape {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(image, 0, 0);
  const {data} = ctx.getImageData(0, 0, width, height);
  const outline = outlineFromAlpha(data, width, height, OUTLINE_OPTIONS).map(p => ({
    x: p.x - width / 2,
    y: p.y - height / 2,
  }));
  if (outline.length < 3) {
    // Fully transparent bitmap: fall back to the bitmap rectangle so the game still runs.
    outline.splice(
      0,
      outline.length,
      {x: -width / 2, y: -height / 2},
      {x: width / 2, y: -height / 2},
      {x: width / 2, y: height / 2},
      {x: -width / 2, y: height / 2},
    );
  }
  return {
    image,
    width,
    height,
    outline,
    pivot: polygonCentroid(outline),
    area: polygonArea(outline),
    tint: meanColor(data),
  };
}

function meanColor(data: Uint8ClampedArray): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (n === 0) return '#f5a623';
  return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
}

/** Loads every character sprite (smallest → biggest) and traces its silhouette. */
export async function loadShapes(sources: readonly string[]): Promise<TierShape[]> {
  const images = await Promise.all(sources.map(loadImage));
  return images.map(shapeFromImage);
}
