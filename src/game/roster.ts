import chiyonoVoice from '@/images/chiyono.mp3';
import chiyono from '@/images/chiyono.png';
import daiwaScarlet from '@/images/daiwa_scarlet.png';
import goldShipVoice from '@/images/gold_ship.mp3';
import goldShip from '@/images/gold_ship.png';
import haruUraraVoice from '@/images/haru_urara.mp3';
import haruUrara from '@/images/haru_urara.png';
import kitasanBlackVoice from '@/images/kitasan_black.mp3';
import kitasanBlack from '@/images/kitasan_black.png';
import mamboVoice from '@/images/mambo.mp3';
import mambo from '@/images/mambo.png';
import mejiroMcqueen from '@/images/mejiro_mcqueen.png';
import silenceSuzuka from '@/images/silence_suzuka.png';
import specialWeekVoice from '@/images/special_week.mp3';
import specialWeek from '@/images/special_week.png';
import tokaiTeioVoice from '@/images/tokai_teio.mp3';
import tokaiTeio from '@/images/tokai_teio.png';
import vodka from '@/images/vodka.png';

type ImageSource = string | {src: string};
const resolveSrc = (img: ImageSource): string => (typeof img === 'string' ? img : img.src);

export interface Tier {
  /** Stable id (file name). */
  id: string;
  name: string;
  src: string;
  /** Accent colour used for merge particles and the evolution ring. */
  color: string;
  /**
   * Diameter of the equivalent Suika fruit, watermelon = 1. Mean of two independent Switch
   * pixel measurements (game-hashirigaki.site areas, kairess/suika-game sprite table).
   */
  diameter: number;
  /** Points awarded when this tier is *created* by a merge (triangular numbers, as on Switch). */
  points: number;
  /** Voice clip played whenever a merge creates this tier. */
  voice?: string;
}

// Smallest → biggest. The Suika lineage: cherry, strawberry, grape, dekopon, persimmon, apple,
// pear, peach, pineapple, melon, watermelon.
export const TIERS: readonly Tier[] = [
  {
    id: 'mejiro_mcqueen',
    name: 'Mejiro McQueen',
    src: resolveSrc(mejiroMcqueen),
    color: '#b89be8',
    diameter: 0.127,
    points: 0,
  },
  {id: 'vodka', name: 'Vodka', src: resolveSrc(vodka), color: '#8d6b52', diameter: 0.176, points: 1},
  {
    id: 'daiwa_scarlet',
    name: 'Daiwa Scarlet',
    src: resolveSrc(daiwaScarlet),
    color: '#e2554f',
    diameter: 0.235,
    points: 3,
  },
  {
    id: 'tokai_teio',
    name: 'Tokai Teio',
    src: resolveSrc(tokaiTeio),
    color: '#5aa5e0',
    diameter: 0.27,
    points: 6,
    voice: tokaiTeioVoice,
  },
  {
    id: 'chiyono',
    name: 'Chiyono O',
    src: resolveSrc(chiyono),
    color: '#f0a3bf',
    diameter: 0.345,
    points: 10,
    voice: chiyonoVoice,
  },
  {
    id: 'silence_suzuka',
    name: 'Silence Suzuka',
    src: resolveSrc(silenceSuzuka),
    color: '#7bc96f',
    diameter: 0.438,
    points: 15,
  },
  {
    id: 'kitasan_black',
    name: 'Kitasan Black',
    src: resolveSrc(kitasanBlack),
    color: '#e05a3a',
    diameter: 0.5,
    points: 21,
    voice: kitasanBlackVoice,
  },
  {
    id: 'gold_ship',
    name: 'Gold Ship',
    src: resolveSrc(goldShip),
    color: '#d94b57',
    diameter: 0.609,
    points: 28,
    voice: goldShipVoice,
  },
  {
    id: 'haru_urara',
    name: 'Haru Urara',
    src: resolveSrc(haruUrara),
    color: '#ff8fb8',
    diameter: 0.686,
    points: 36,
    voice: haruUraraVoice,
  },
  {
    id: 'special_week',
    name: 'Special Week',
    src: resolveSrc(specialWeek),
    color: '#c78be8',
    diameter: 0.846,
    points: 45,
    voice: specialWeekVoice,
  },
  {id: 'mambo', name: 'Mambo', src: resolveSrc(mambo), color: '#6fa8e8', diameter: 1, points: 55, voice: mamboVoice},
];

export const LAST_TIER = TIERS.length - 1;
/** Only the five smallest fall from the cloud, uniformly at random (Switch: 20% each). */
export const DROPPABLE_TIERS = 5;
/** Two Mambos cancel out. Undocumented on Switch; 66 continues the triangular series. */
export const MAMBO_CANCEL_POINTS = 66;
