import { storage } from '../server/storage.ts';
import { db } from '../server/db.ts';
import { series as seriesTable, studies as studiesTable, rtStructureSets, rtStructures, rtStructureContours } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import polygonClipping from 'polygon-clipping';

// Types compatible with client dice-utils
type MultiPolygon = Array<Array<[number, number][]>>; // polygon-clipping format

function toRing(points: number[]): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < points.length; i += 3) {
    ring.push([points[i], points[i + 1]]);
  }
  if (ring.length > 0) {
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  }
  return ring;
}

function unionRings(rings: [number, number][][]): MultiPolygon {
  if (rings.length === 0) return [] as any;
  const polys = rings.map((r) => [r]);
  const res = polygonClipping.union(...polys) as MultiPolygon;
  return res || [];
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

function medianSpacing(values: number[]): number {
  if (values.length < 2) return 1;
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) diffs.push(values[i] - values[i - 1]);
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
}

async function findSeriesByStudyAndSeriesNumber(studyId: number, seriesNumber: number) {
  const rows = await db.select().from(seriesTable).where(and(eq(seriesTable.studyId, studyId), eq(seriesTable.seriesNumber, seriesNumber)));
  return rows[0] || null;
}

async function findRtStructSetReferencingSeries(studyId: number, referencedSeriesId: number) {
  const rows = await db
    .select()
    .from(rtStructureSets)
    .where(and(eq(rtStructureSets.studyId, studyId), eq(rtStructureSets.referencedSeriesId, referencedSeriesId)));
  return rows[0] || null;
}

async function loadStructureContoursByName(rtSetId: number, targetName: string) {
  const structs = await db.select().from(rtStructures).where(eq(rtStructures.rtStructureSetId, rtSetId));
  const match = structs.find((s) => (s.structureName || '').toUpperCase().includes(targetName.toUpperCase()));
  if (!match) return null;
  const contours = await db.select().from(rtStructureContours).where(eq(rtStructureContours.rtStructureId, match.id));
  return { structure: match, contours };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (k: string) => {
    const i = args.indexOf(k);
    return i > -1 ? args[i + 1] : undefined;
  };
  const studyIdStr = getArg('--study');
  const primarySeriesNumStr = getArg('--primary');
  const fusedSeriesNumStr = getArg('--fused');
  const name = (getArg('--name') || 'BODY').toString();

  if (!studyIdStr || !primarySeriesNumStr || !fusedSeriesNumStr) {
    console.error('Usage: npx tsx scripts/compute-body-dsc.ts --study <id> --primary <seriesNumber> --fused <seriesNumber> [--name BODY]');
    process.exit(1);
  }
  const studyId = parseInt(studyIdStr, 10);
  const primarySeriesNumber = parseInt(primarySeriesNumStr, 10);
  const fusedSeriesNumber = parseInt(fusedSeriesNumStr, 10);

  const primarySeries = await findSeriesByStudyAndSeriesNumber(studyId, primarySeriesNumber);
  const fusedSeries = await findSeriesByStudyAndSeriesNumber(studyId, fusedSeriesNumber);
  if (!primarySeries) {
    console.error(`Primary series not found for study ${studyId}, seriesNumber ${primarySeriesNumber}`);
    process.exit(2);
  }
  if (!fusedSeries) {
    console.error(`Fused series not found for study ${studyId}, seriesNumber ${fusedSeriesNumber}`);
    process.exit(2);
  }

  const rtPrimary = await findRtStructSetReferencingSeries(studyId, primarySeries.id);
  const rtFused = await findRtStructSetReferencingSeries(studyId, fusedSeries.id);
  if (!rtPrimary) {
    console.error('RTSTRUCT referencing primary series not found');
    process.exit(3);
  }
  if (!rtFused) {
    console.error('RTSTRUCT referencing fused series not found');
    process.exit(3);
  }

  const bodyPrim = await loadStructureContoursByName(rtPrimary.id, name);
  const bodyFused = await loadStructureContoursByName(rtFused.id, name);
  if (!bodyPrim || !bodyFused) {
    console.error(`${name} structure missing in one of the RTSTRUCTs`);
    process.exit(4);
  }

  // Group contours by slice position with a tolerance bin
  function groupBySlice(contours: { slicePosition: number; points: number[] }[]) {
    const map = new Map<number, [number, number][][]>();
    const tol = 1e-3;
    for (const c of contours) {
      const z = c.slicePosition;
      let key: number | null = null;
      for (const k of map.keys()) {
        if (Math.abs(k - z) < tol) { key = k; break; }
      }
      const useKey = key !== null ? key : z;
      if (!map.has(useKey)) map.set(useKey, []);
      (map.get(useKey) as any).push(toRing(c.points));
    }
    return map;
  }

  const primMap = groupBySlice(bodyPrim.contours as any);
  const fusedMap = groupBySlice(bodyFused.contours as any);
  const allZ = Array.from(new Set<number>([...Array.from(primMap.keys()), ...Array.from(fusedMap.keys())])).sort((a, b) => a - b);
  const thick = medianSpacing(allZ);

  const perSlice: Array<{ z: number; areaA: number; areaB: number; areaI: number; dice: number }> = [];
  let volA = 0, volB = 0, inter = 0;

  for (const z of allZ) {
    const ringsA = primMap.get(z) || [];
    const ringsB = fusedMap.get(z) || [];
    if (ringsA.length === 0 && ringsB.length === 0) continue;
    const uA = unionRings(ringsA);
    const uB = unionRings(ringsB);
    const areaA = areaOfMultiPolygon(uA);
    const areaB = areaOfMultiPolygon(uB);
    let areaI = 0;
    if (areaA > 0 && areaB > 0) {
      const mpI = polygonClipping.intersection(uA, uB) as MultiPolygon;
      areaI = areaOfMultiPolygon(mpI || []);
    }
    const d = (areaA + areaB) > 0 ? (2 * areaI) / (areaA + areaB) : 1.0;
    perSlice.push({ z, areaA, areaB, areaI, dice: d });
    volA += areaA * thick;
    volB += areaB * thick;
    inter += areaI * thick;
  }

  const dsc = (volA + volB) > 0 ? (2 * inter) / (volA + volB) : 1.0;
  const fails = perSlice.filter((s) => s.dice < 0.98);

  const summary = {
    ok: true,
    studyId,
    primary: { id: primarySeries.id, number: primarySeries.seriesNumber, desc: primarySeries.seriesDescription },
    fused: { id: fusedSeries.id, number: fusedSeries.seriesNumber, desc: fusedSeries.seriesDescription },
    structure: name,
    volumeDice: dsc,
    slices: perSlice.length,
    below098: fails.length,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (fails.length) {
    console.log('Slices with DSC < 0.98 (first 20 shown):');
    for (const s of fails.slice(0, 20)) {
      console.log(`  z=${s.z.toFixed(3)}  dsc=${s.dice.toFixed(4)}  areaA=${s.areaA.toFixed(1)}  areaB=${s.areaB.toFixed(1)}  inter=${s.areaI.toFixed(1)}`);
    }
  }
}

main().catch((e) => {
  console.error('Failed:', e?.message || e);
  process.exit(1);
});
