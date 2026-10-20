// Audio files are emitted as static assets by the rule in next.config.js and imported as URLs.
declare module '*.mp3' {
  const value: string;
  export default value;
}

// poly-decomp ships no types; this is the subset Matter.js's `Common.setDecomp` needs.
declare module 'poly-decomp' {
  type Point = [number, number];
  const decomp: {
    makeCCW(polygon: Point[]): boolean;
    quickDecomp(polygon: Point[]): Point[][];
    decomp(polygon: Point[]): Point[][] | false;
    isSimple(polygon: Point[]): boolean;
    removeCollinearPoints(polygon: Point[], thresholdAngle?: number): number;
    removeDuplicatePoints(polygon: Point[], precision?: number): void;
  };
  export default decomp;
}
