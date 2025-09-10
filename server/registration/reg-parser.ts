import * as fs from 'fs';
import dicomParser from 'dicom-parser';
import { isIdentity4x4, isRigidRowMajor4x4, toRowMajorFlat } from './validators.ts';

export interface ParsedRegistration {
  matrixRowMajor4x4: number[] | null;
  sourceFrameOfReferenceUid?: string;
  targetFrameOfReferenceUid?: string;
  referencedSeriesInstanceUids?: string[];
  notes?: string[];
}

function invert3x3(m: number[][]): number[][] | null {
  const a=m[0][0], b=m[0][1], c=m[0][2];
  const d=m[1][0], e=m[1][1], f=m[1][2];
  const g=m[2][0], h=m[2][1], i=m[2][2];
  const A = e*i - f*h;
  const B = -(d*i - f*g);
  const C = d*h - e*g;
  const D = -(b*i - c*h);
  const E = a*i - c*g;
  const F = -(a*h - b*g);
  const G = b*f - c*e;
  const H = -(a*f - c*d);
  const I = a*e - b*d;
  const det = a*A + b*B + c*C;
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  return [
    [A*invDet, D*invDet, G*invDet],
    [B*invDet, E*invDet, H*invDet],
    [C*invDet, F*invDet, I*invDet],
  ];
}

// Project an arbitrary 3x3 onto the nearest rotation matrix using polar decomposition
function projectToNearestRotation(Rin: number[][]): { R: number[][]; adjusted: boolean } {
  let R = Rin.map(row => row.slice());
  let adjusted = false;
  for (let iter = 0; iter < 12; iter++) {
    const RinvT = invert3x3(R);
    if (!RinvT) break;
    // (R + (R^{-1})^T) / 2
    const N: number[][] = [ [0,0,0], [0,0,0], [0,0,0] ];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        N[r][c] = 0.5 * (R[r][c] + RinvT[r][c]);
      }
    }
    // Convergence check
    let delta = 0;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(N[r][c] - R[r][c]));
    R = N;
    if (delta < 1e-8) break;
  }
  // Ensure right-handed (det ~ +1)
  const det = R[0][0]*(R[1][1]*R[2][2]-R[1][2]*R[2][1]) - R[0][1]*(R[1][0]*R[2][2]-R[1][2]*R[2][0]) + R[0][2]*(R[1][0]*R[2][1]-R[1][1]*R[2][0]);
  if (det < 0) {
    R[0][2] = -R[0][2]; R[1][2] = -R[1][2]; R[2][2] = -R[2][2];
    adjusted = true;
  }
  return { R, adjusted };
}

function tryParseFD16(dataSet: any, element: any): number[] | null {
  try {
    const byteArray: Uint8Array = dataSet.byteArray as any;
    const offset: number = element.dataOffset as any;
    const length: number = element.length as any;
    const view = new DataView(byteArray.buffer, byteArray.byteOffset + offset, length);
    const values: number[] = [];
    for (let j = 0; j + 8 <= length && values.length < 16; j += 8) values.push(view.getFloat64(j, true));
    return values.length === 16 ? values : null;
  } catch {
    return null;
  }
}

function tryParseDS16(str: string | undefined): number[] | null {
  if (typeof str !== 'string') return null;
  const vals = str.split('\\').map(v => parseFloat(v)).filter(n => !Number.isNaN(n));
  return vals.length === 16 ? vals : null;
}

export function parseDicomRegistrationFromFile(filePath: string): ParsedRegistration | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const bytes = fs.readFileSync(filePath);
  const dataSet = dicomParser.parseDicom(new Uint8Array(bytes));
  const notes: string[] = [];

  // Collect candidate matrices in flat row-major form
  const candidates: number[][] = [];

  // Extract FoR UIDs and referenced series if available
  let sourceFoR: string | undefined;
  let targetFoR: string | undefined;
  const referencedSeries: string[] = [];

  try {
    const regSeq = (dataSet as any).elements?.['x00700308'];
    if (regSeq?.items?.length) {
      for (const regItem of regSeq.items) {
        const ds = regItem.dataSet;
        const s1 = ds?.string?.('x30060062');
        const t1 = ds?.string?.('x30060061');
        if (!sourceFoR && typeof s1 === 'string') sourceFoR = s1;
        if (!targetFoR && typeof t1 === 'string') targetFoR = t1;
        const refSeriesAtLevel = ds?.string?.('x0020000e');
        if (refSeriesAtLevel) referencedSeries.push(refSeriesAtLevel);

        const mrs = ds?.elements?.['x00700309'];
        if (mrs?.items?.length) {
          for (const mi of mrs.items) {
            const mds = mi.dataSet;
            const s2 = mds?.string?.('x30060062');
            const t2 = mds?.string?.('x30060061');
            if (!sourceFoR && typeof s2 === 'string') sourceFoR = s2;
            if (!targetFoR && typeof t2 === 'string') targetFoR = t2;
            const nestedRef = mds?.string?.('x0020000e');
            if (nestedRef) referencedSeries.push(nestedRef);

            const mseq = mds?.elements?.['x0070030a'];
            if (mseq?.items?.length) {
              for (const mItem of mseq.items) {
                const fdEl = mItem.dataSet?.elements?.['x0070030c'];
                const fdVals = fdEl ? tryParseFD16(mItem.dataSet, fdEl) : null;
                if (fdVals && fdVals.length === 16) {
                  candidates.push(fdVals);
                }
                const dsVals = tryParseDS16(mItem.dataSet?.string?.('x300600c6'));
                if (dsVals) candidates.push(dsVals);
              }
            }
          }
        }
      }
    }
  } catch (e) {
    notes.push('Failed to traverse Registration Sequence');
  }

  // Deep scan fallback to collect FoR UIDs and SeriesInstanceUIDs wherever they appear
  try {
    const visit = (ds: any) => {
      if (!ds) return;
      try {
        const s = ds.string?.('x30060062');
        const t = ds.string?.('x30060061');
        const rid = ds.string?.('x0020000e');
        if (!sourceFoR && typeof s === 'string') sourceFoR = s;
        if (!targetFoR && typeof t === 'string') targetFoR = t;
        if (rid) referencedSeries.push(rid);
      } catch {}
      const elements = ds.elements || {};
      for (const tag in elements) {
        const el = elements[tag];
        if (el?.items?.length) {
          for (const it of el.items) visit(it.dataSet || it);
        }
      }
    };
    visit(dataSet);
  } catch {}

  // Fallbacks outside nested sequences
  try {
    const dsTop = tryParseDS16((dataSet as any).string?.('x300600c6'));
    if (dsTop) candidates.push(dsTop);
  } catch {}

  // De-duplicate and validate
  const unique: string[] = [];
  const uniqueMats: number[][] = [];
  for (const c of candidates) {
    const key = c.map(v => (Number.isFinite(v) ? v.toFixed(6) : 'NaN')).join(',');
    if (!unique.includes(key)) { unique.push(key); uniqueMats.push(c); }
  }

  // Prefer the last valid rigid matrix that is non-identity
  let selected: number[] | null = null;
  for (let i = uniqueMats.length - 1; i >= 0; i--) {
    const m = uniqueMats[i];
    const flat = Array.isArray(m[0]) ? (toRowMajorFlat(m as any) as any) : m;
    if (!flat || flat.length !== 16) continue;
    if (isIdentity4x4(flat)) { notes.push(`candidate ${i} is identity`); continue; }
    // Validate and project to rigid if needed
    const Rraw = [
      [flat[0], flat[1], flat[2]],
      [flat[4], flat[5], flat[6]],
      [flat[8], flat[9], flat[10]],
    ];
    const { R, adjusted } = projectToNearestRotation(Rraw);
    const T = [flat[3], flat[7], flat[11]];
    const corrected = [
      R[0][0], R[0][1], R[0][2], T[0],
      R[1][0], R[1][1], R[1][2], T[1],
      R[2][0], R[2][1], R[2][2], T[2],
      0, 0, 0, 1
    ];
    if (!isRigidRowMajor4x4(corrected)) {
      notes.push(`candidate ${i} failed rigid projection`);
      continue;
    }
    if (adjusted) notes.push(`candidate ${i} rotation projected to nearest rigid`);
    selected = corrected;
    break;
  }

  return {
    matrixRowMajor4x4: selected,
    sourceFrameOfReferenceUid: sourceFoR,
    targetFrameOfReferenceUid: targetFoR,
    referencedSeriesInstanceUids: referencedSeries.length ? Array.from(new Set(referencedSeries)) : undefined,
    notes,
  };
}


