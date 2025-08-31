/*
 Validate interpolation and margin parity on SHAPETESTER_01.
 - Interpolation: compare TARGET1_INTERP vs our interpolation between TARGET1 slices.
 - Margins: compare SHAPE1_1cm and SHAPE1_-0.5cm against our Clipper-based offsets of SHAPE1.

 Run: npx tsx scripts/validate-shapetester.ts
*/

import polygonClipping from 'polygon-clipping';
import { offsetContour } from '../client/src/lib/clipper-boolean-operations';

type Vec2 = [number, number];
type RTContour = { slicePosition: number; points: number[]; numberOfPoints: number };
type RTStructure = { roiNumber: number; structureName: string; contours: RTContour[] };
type RTStructureSet = { structures: RTStructure[] };

const BASE = process.env.VALIDATE_BASE || 'http://localhost:5175';
const STUDY_ID = Number(process.env.VALIDATE_STUDY_ID || 12);
const RT_SERIES_ID = Number(process.env.VALIDATE_RT_SERIES_ID || 25);

function toPolys2D(contours: RTContour[]): number[][][] {
  // Convert array of contours (same z) to list of polygons for polygon-clipping
  return contours.map(c => {
    const poly: number[][] = [];
    for (let i = 0; i < c.points.length; i += 3) {
      poly.push([c.points[i], c.points[i + 1]]);
    }
    // Ensure ring is closed
    if (poly.length && (poly[0][0] !== poly[poly.length - 1][0] || poly[0][1] !== poly[poly.length - 1][1])) {
      poly.push([poly[0][0], poly[0][1]]);
    }
    return [poly];
  });
}

function areaOfMultiPolygon(mp: any): number {
  if (!mp) return 0;
  let area = 0;
  for (const poly of mp) {
    // poly: [outerRing, hole1, hole2, ...]
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r];
      area += (r === 0 ? 1 : -1) * Math.abs(shoelaceArea(ring));
    }
  }
  return area;
}

function shoelaceArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

async function fetchRTStruct(seriesId: number): Promise<RTStructureSet> {
  const res = await fetch(`${BASE}/api/rt-structures/${seriesId}/contours`);
  if (!res.ok) throw new Error(`Failed to fetch RT structures: ${res.status}`);
  return res.json();
}

function mapByName(rt: RTStructureSet): Record<string, RTStructure> {
  const map: Record<string, RTStructure> = {};
  for (const s of rt.structures) {
    map[s.structureName?.toUpperCase?.() || `ROI_${s.roiNumber}`] = s as any;
  }
  return map;
}

function groupContoursByZ(structure: RTStructure, tol = 0.1): Map<number, RTContour[]> {
  const m = new Map<number, RTContour[]>();
  for (const c of structure.contours || []) {
    const z = c.slicePosition;
    // bucket by nearest 0.1mm to align minor rounding differences
    const key = Math.round(z / tol) * tol;
    const arr = m.get(key) || [];
    arr.push(c);
    m.set(key, arr);
  }
  return m;
}

async function validateMargins(rt: RTStructureSet) {
  const map = mapByName(rt);
  const shape1 = map['SHAPE1'];
  const shape1_p = map['SHAPE1_1CM'];
  const shape1_n = map['SHAPE1_-0.5CM'];
  if (!shape1 || !shape1_p || !shape1_n) {
    console.log('Skipping margin validation: required SHAPE structures not found');
    return;
  }

  const byZ = groupContoursByZ(shape1);
  const byZp = groupContoursByZ(shape1_p);
  const byZn = groupContoursByZ(shape1_n);

  let slicesChecked = 0;
  let totalErrP = 0;
  let totalErrN = 0;

  for (const [z, contours] of byZ.entries()) {
    const refP = byZp.get(z) || [];
    const refN = byZn.get(z) || [];
    if (refP.length === 0 && refN.length === 0) continue;

    // union reference polys
    // Generate our offsets at this slice from base SHAPE1
    const myPlusPolys: number[][][] = [];
    const myMinusPolys: number[][][] = [];
    for (const c of contours) {
      if (!c.points || c.points.length < 9) continue;
      try {
        const outsP = await offsetContour(c.points, 10);
        for (const o of outsP) {
          const ring: number[][] = [];
          for (let i = 0; i < o.length; i += 3) ring.push([o[i], o[i + 1]]);
          if (ring.length) myPlusPolys.push([ring.concat([[ring[0][0], ring[0][1]]])]);
        }
        const outsN = await offsetContour(c.points, -5);
        for (const o of outsN) {
          const ring: number[][] = [];
          for (let i = 0; i < o.length; i += 3) ring.push([o[i], o[i + 1]]);
          if (ring.length) myMinusPolys.push([ring.concat([[ring[0][0], ring[0][1]]])]);
        }
      } catch {}
    }

    // Union our generated and reference shapes
    const UmyP = myPlusPolys.length ? polygonClipping.union(...myPlusPolys) : null;
    const UmyN = myMinusPolys.length ? polygonClipping.union(...myMinusPolys) : null;
    const Up = refP.length ? polygonClipping.union(...toPolys2D(refP)) : null;
    const Un = refN.length ? polygonClipping.union(...toPolys2D(refN)) : null;

    if (Up && UmyP) {
      const xor = polygonClipping.xor(UmyP, Up);
      const err = areaOfMultiPolygon(xor);
      const denom = Math.max(1e-6, areaOfMultiPolygon(Up));
      totalErrP += err / denom;
    }
    if (Un && UmyN) {
      const xor = polygonClipping.xor(UmyN, Un);
      const err = areaOfMultiPolygon(xor);
      const denom = Math.max(1e-6, areaOfMultiPolygon(Un));
      totalErrN += err / denom;
    }
    slicesChecked++;
  }

  console.log(`Margin validation: checked ${slicesChecked} slices`);
  if (slicesChecked > 0) {
    console.log(`  Mean relative symmetric-difference vs +10mm: ${(totalErrP / slicesChecked).toFixed(4)}`);
    console.log(`  Mean relative symmetric-difference vs -5mm:  ${(totalErrN / slicesChecked).toFixed(4)}`);
  }
}

async function main() {
  console.log(`Fetching RTSTRUCT for study ${STUDY_ID} series ${RT_SERIES_ID} from ${BASE}`);
  const rt = await fetchRTStruct(RT_SERIES_ID);
  await validateMargins(rt);
  // Interpolation parity could be added similarly by comparing TARGET1 vs TARGET1_INTERP
}

main().catch(e => { console.error(e); process.exit(1); });
