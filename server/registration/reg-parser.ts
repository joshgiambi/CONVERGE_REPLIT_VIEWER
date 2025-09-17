import * as fs from 'fs';
import dicomParser from 'dicom-parser';
import { isIdentity4x4, isRigidRowMajor4x4, toRowMajorFlat } from './validators.ts';

export interface ParsedRegistration {
  matrixRowMajor4x4: number[] | null; // RAW row‑major as found (no projection)
  matrixRawRowMajor4x4?: number[] | null; // alias for clarity
  sourceFrameOfReferenceUid?: string;
  targetFrameOfReferenceUid?: string;
  referencedSeriesInstanceUids?: string[];
  notes?: string[];
  // Detailed candidates parsed from the file (if multiple transforms exist)
  candidates?: Array<{
    matrix: number[];
    sourceFoR?: string;
    targetFoR?: string;
    referenced?: string[];
  }>;
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

  // Collect candidate matrices with metadata
  const candidates: Array<{ matrix: number[]; sourceFoR?: string; targetFoR?: string; referenced?: string[] }> = [];

  // Extract FoR UIDs and referenced series if available
  let sourceFoR: string | undefined;
  let targetFoR: string | undefined;
  const referencedSeries: string[] = [];

  try {
    const regSeq = (dataSet as any).elements?.['x00700308'];
    if (regSeq?.items?.length) {
      for (const regItem of regSeq.items) {
        const ds = regItem.dataSet;
        // Try Spatial Registration (0070,0308...) and RT Frame-of-Reference tags (3006,00C0/00C2)
        const s1 = ds?.string?.('x300600c2') || ds?.string?.('x30060062') || ds?.string?.('x00200052');
        const t1 = ds?.string?.('x300600c0') || ds?.string?.('x30060061') || ds?.string?.('x00200052');
        if (!sourceFoR && typeof s1 === 'string') sourceFoR = s1;
        if (!targetFoR && typeof t1 === 'string') targetFoR = t1;
        const refSeriesAtLevel = ds?.string?.('x0020000e');
        if (refSeriesAtLevel) referencedSeries.push(refSeriesAtLevel);

        const mrs = ds?.elements?.['x00700309'];
        if (mrs?.items?.length) {
          for (const mi of mrs.items) {
            const mds = mi.dataSet;
            const s2 = mds?.string?.('x300600c2') || mds?.string?.('x30060062') || mds?.string?.('x00200052');
            const t2 = mds?.string?.('x300600c0') || mds?.string?.('x30060061') || mds?.string?.('x00200052');
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
                  candidates.push({ matrix: fdVals, sourceFoR: s2 || sourceFoR, targetFoR: t2 || targetFoR, referenced: [nestedRef].filter(Boolean) as string[] });
                }
                const dsVals = tryParseDS16(mItem.dataSet?.string?.('x300600c6'));
                if (dsVals) candidates.push({ matrix: dsVals, sourceFoR: s2 || sourceFoR, targetFoR: t2 || targetFoR, referenced: [nestedRef].filter(Boolean) as string[] });
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
        const s = ds.string?.('x300600c2') || ds.string?.('x30060062') || ds.string?.('x00200052');
        const t = ds.string?.('x300600c0') || ds.string?.('x30060061') || ds.string?.('x00200052');
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
    if (dsTop) candidates.push({ matrix: dsTop });
  } catch {}

  // De-duplicate and validate
  const unique: string[] = [];
  const uniqueCands: typeof candidates = [];
  for (const c of candidates) {
    const key = c.matrix.map(v => (Number.isFinite(v) ? v.toFixed(6) : 'NaN')).join(',');
    if (!unique.includes(key)) { unique.push(key); uniqueCands.push(c); }
  }

  // Prefer the last matrix that is non-identity; DO NOT project – return raw as-is
  let selected: number[] | null = null;
  let selectedRaw: number[] | null = null;
  for (let i = uniqueCands.length - 1; i >= 0; i--) {
    const m = uniqueCands[i].matrix;
    const flat = Array.isArray(m[0]) ? (toRowMajorFlat(m as any) as any) : m;
    if (!flat || flat.length !== 16) continue;
    if (isIdentity4x4(flat)) { notes.push(`candidate ${i} is identity`); continue; }
    // Keep raw as-is. If it is not rigid, still return raw but note it.
    if (!isRigidRowMajor4x4(flat)) {
      notes.push(`candidate ${i} appears non-rigid; returning raw unmodified`);
    }
    selectedRaw = flat.slice();
    selected = flat.slice();
    break;
  }

  return {
    matrixRowMajor4x4: selected,
    matrixRawRowMajor4x4: selectedRaw ?? selected ?? null,
    sourceFrameOfReferenceUid: sourceFoR,
    targetFrameOfReferenceUid: targetFoR,
    referencedSeriesInstanceUids: referencedSeries.length ? Array.from(new Set(referencedSeries)) : undefined,
    notes,
    candidates: uniqueCands,
  };
}
