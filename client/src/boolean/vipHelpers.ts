import type { Grid } from '@/margins/types';
import type { VoxelIndexPair } from './types';

// Merge overlapping or adjacent index pairs within a single row
export function mergeIndexPairs(pairs: VoxelIndexPair[], grid: Grid): VoxelIndexPair[] {
  if (pairs.length === 0) return [];
  const sorted = [...pairs].sort((a, b) => a.index - b.index);
  const merged: VoxelIndexPair[] = [];
  let current = { index: sorted[0].index, length: sorted[0].length } as VoxelIndexPair;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const currentEnd = current.index + current.length; // exclusive
    if (next.index <= currentEnd) {
      // overlap or adjacency (index == end)
      const nextEnd = next.index + next.length;
      const newEnd = Math.max(currentEnd, nextEnd);
      current.length = newEnd - current.index;
    } else {
      merged.push(current);
      current = { index: next.index, length: next.length };
    }
  }
  merged.push(current);
  return merged;
}

// Compute overlap intervals between two rows (A ∩ B)
export function getOverlappingVoxelIndexPairs(aRow: VoxelIndexPair[], bRow: VoxelIndexPair[]): VoxelIndexPair[] {
  if (aRow.length === 0 || bRow.length === 0) return [];
  const out: VoxelIndexPair[] = [];
  const A = [...aRow].sort((x, y) => x.index - y.index);
  const B = [...bRow].sort((x, y) => x.index - y.index);
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const a = A[i];
    const b = B[j];
    const aStart = a.index;
    const aEnd = a.index + a.length; // exclusive
    const bStart = b.index;
    const bEnd = b.index + b.length; // exclusive

    const start = Math.max(aStart, bStart);
    const end = Math.min(aEnd, bEnd);
    if (end > start) {
      out.push({ index: start, length: end - start });
    }
    if (aEnd < bEnd) i++; else j++;
  }
  return out;
}

// Remove coverage of bRow from aRow (A \ B) for a single row
export function subtractVoxelIndexPairs(aRow: VoxelIndexPair[], bRow: VoxelIndexPair[]): VoxelIndexPair[] {
  if (aRow.length === 0) return [];
  if (bRow.length === 0) return mergeIndexPairs(aRow, {} as Grid);
  const A = mergeIndexPairs(aRow, {} as Grid);
  const B = mergeIndexPairs(bRow, {} as Grid);
  const out: VoxelIndexPair[] = [];
  let j = 0;
  for (const a of A) {
    let segments: { start: number; end: number }[] = [{ start: a.index, end: a.index + a.length }];
    while (j < B.length && B[j].index + B[j].length <= a.index) j++;
    let k = j;
    while (k < B.length && B[k].index < a.index + a.length) {
      const b = B[k];
      const newSegs: { start: number; end: number }[] = [];
      for (const seg of segments) {
        const s = Math.max(seg.start, Math.min(seg.end, seg.start));
        const e = Math.max(seg.start, Math.min(seg.end, seg.end));
        const bStart = b.index;
        const bEnd = b.index + b.length;
        // no overlap
        if (bEnd <= s || bStart >= e) {
          newSegs.push(seg);
          continue;
        }
        // left piece
        if (bStart > s) newSegs.push({ start: s, end: Math.max(s, Math.min(e, bStart)) });
        // right piece
        if (bEnd < e) newSegs.push({ start: Math.max(s, Math.min(e, bEnd)), end: e });
      }
      segments = newSegs.filter(seg => seg.end > seg.start);
      k++;
    }
    for (const seg of segments) {
      out.push({ index: seg.start, length: seg.end - seg.start });
    }
  }
  return mergeIndexPairs(out, {} as Grid);
}


