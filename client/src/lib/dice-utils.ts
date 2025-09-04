import polygonClipping from 'polygon-clipping';

type RTStructures = {
  structures: Array<{
    roiNumber: number;
    structureName: string;
    contours: Array<{ slicePosition: number; points: number[]; numberOfPoints?: number }>;
  }>;
};

type MultiPolygon = Array<Array<[number, number][]>>; // polygon-clipping format

function toRing(points: number[]): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < points.length; i += 3) {
    ring.push([points[i], points[i + 1]]);
  }
  // Ensure closed
  if (ring.length > 0) {
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  }
  return ring;
}

function listUniqueSlices(structure: any): number[] {
  const set = new Set<number>();
  for (const c of structure.contours || []) {
    if (typeof c.slicePosition === 'number') set.add(c.slicePosition);
  }
  return Array.from(set.values()).sort((a, b) => a - b);
}

function medianSpacing(values: number[]): number {
  if (values.length < 2) return 1;
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) diffs.push(values[i] - values[i - 1]);
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
}

function areaOfRing(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function areaOfMultiPolygon(multi: MultiPolygon): number {
  let total = 0;
  for (const poly of multi) {
    if (poly.length === 0) continue;
    const outer = Math.abs(areaOfRing(poly[0]));
    let holes = 0;
    for (let i = 1; i < poly.length; i++) holes += Math.abs(areaOfRing(poly[i]));
    total += Math.max(0, outer - holes);
  }
  return total;
}

function unionRings(rings: [number, number][][]): MultiPolygon {
  if (rings.length === 0) return [] as any;
  // polygon-clipping expects each polygon as array of rings
  const polys = rings.map(r => [r]);
  const res = polygonClipping.union(...polys) as MultiPolygon;
  return res || [];
}

export function listStructureNames(rt: RTStructures): string[] {
  return (rt?.structures || []).map(s => s.structureName);
}

export function computeDiceForStructureNames(rt: RTStructures, nameA: string, nameB: string): { dice: number; volA: number; volB: number; inter: number } {
  if (!rt || !rt.structures) throw new Error('RT structures not available');
  const A = rt.structures.find(s => s.structureName === nameA);
  const B = rt.structures.find(s => s.structureName === nameB);
  if (!A) throw new Error(`Structure ${nameA} not found`);
  if (!B) throw new Error(`Structure ${nameB} not found`);

  // Collect all slices
  const unique = new Set<number>();
  for (const v of listUniqueSlices(A)) unique.add(v);
  for (const v of listUniqueSlices(B)) unique.add(v);
  const slices = Array.from(unique).sort((a, b) => a - b);
  const thickness = medianSpacing(slices) || 1; // mm

  let volA = 0;
  let volB = 0;
  let inter = 0;

  for (const z of slices) {
    const ringsA: [number, number][][] = [];
    const ringsB: [number, number][][] = [];
    for (const c of A.contours) if (Math.abs(c.slicePosition - z) < 1e-3) ringsA.push(toRing(c.points));
    for (const c of B.contours) if (Math.abs(c.slicePosition - z) < 1e-3) ringsB.push(toRing(c.points));
    if (ringsA.length === 0 && ringsB.length === 0) continue;

    const uA = unionRings(ringsA);
    const uB = unionRings(ringsB);
    const areaA = areaOfMultiPolygon(uA);
    const areaB = areaOfMultiPolygon(uB);
    volA += areaA * thickness;
    volB += areaB * thickness;

    if (areaA > 0 && areaB > 0) {
      const interMP = polygonClipping.intersection(uA, uB) as MultiPolygon;
      const areaI = areaOfMultiPolygon(interMP || []);
      inter += areaI * thickness;
    }
  }

  const dice = (volA + volB) > 0 ? (2 * inter) / (volA + volB) : 1.0;
  return { dice, volA, volB, inter };
}

// Expose helpers for debugging in browser
declare global {
  interface Window {
    __listStructures?: () => string[];
    __diceNames?: (a: string, b: string) => any;
  }
}

export function attachDiceDebug(rtProvider: () => RTStructures | null) {
  if (typeof window === 'undefined') return;
  window.__listStructures = () => {
    const rt = rtProvider();
    return rt ? listStructureNames(rt) : [];
  };
  window.__diceNames = (a: string, b: string) => {
    const rt = rtProvider();
    if (!rt) {
      console.warn('RT structures not ready');
      return null;
    }
    const result = computeDiceForStructureNames(rt, a, b);
    console.log(`Dice(${a}, ${b}) = ${result.dice.toFixed(6)} | VolA: ${result.volA.toFixed(2)} mm^3 | VolB: ${result.volB.toFixed(2)} mm^3 | Inter: ${result.inter.toFixed(2)} mm^3`);
    return result;
  };
}

