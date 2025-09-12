/*
  Usage:
    npx tsx scripts/analyze-reg-file.ts --file /abs/path/to/reg.dcm --patientRoot /abs/path/to/patient
*/
import * as fs from 'fs';
import * as path from 'path';
import dicomParser from 'dicom-parser';
import { parseDicomRegistrationFromFile } from '../server/registration/reg-parser.ts';

function readStr(ds: any, tag: string): string {
  try { return ds.string?.(tag) || ''; } catch { return ''; }
}

function findSampleForSeries(patientRoot: string, seriesInstanceUID: string): { modality: string; frameOfRef: string; path: string } | null {
  let result: any = null;
  function walk(dir: string) {
    if (result) return;
    let entries: any[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) as any[]; } catch { return; }
    for (const ent of entries) {
      if (result) break;
      const full = path.join(dir, ent.name);
      if ((ent as any).isDirectory()) walk(full);
      else if ((ent as any).isFile() && ent.name.toLowerCase().endsWith('.dcm')) {
        try {
          const ds = dicomParser.parseDicom(new Uint8Array(fs.readFileSync(full)));
          const suid = readStr(ds, 'x0020000e');
          if (suid === seriesInstanceUID) {
            result = {
              modality: readStr(ds, 'x00080060') || '',
              frameOfRef: readStr(ds, 'x00200052') || '',
              path: full
            };
          }
        } catch {}
      }
    }
  }
  walk(patientRoot);
  return result;
}

function invertRigid4x4(m: number[]): number[] | null {
  if (!Array.isArray(m) || m.length !== 16) return null;
  const R = [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]]
  ];
  const T = [m[3], m[7], m[11]];
  const Rt = [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]]
  ];
  const Tin = [
    -(Rt[0][0]*T[0] + Rt[0][1]*T[1] + Rt[0][2]*T[2]),
    -(Rt[1][0]*T[0] + Rt[1][1]*T[1] + Rt[1][2]*T[2]),
    -(Rt[2][0]*T[0] + Rt[2][1]*T[1] + Rt[2][2]*T[2])
  ];
  return [
    Rt[0][0], Rt[0][1], Rt[0][2], Tin[0],
    Rt[1][0], Rt[1][1], Rt[1][2], Tin[1],
    Rt[2][0], Rt[2][1], Rt[2][2], Tin[2],
    0, 0, 0, 1
  ];
}

function toEulerZYXDegrees(R: number[][]): { x: number; y: number; z: number } {
  const sy = Math.sqrt(R[0][0]*R[0][0] + R[1][0]*R[1][0]);
  let x=0, y=0, z=0;
  if (sy > 1e-6) {
    x = Math.atan2(R[2][1], R[2][2]);
    y = Math.atan2(-R[2][0], sy);
    z = Math.atan2(R[1][0], R[0][0]);
  }
  const deg = (r: number) => r * 180 / Math.PI;
  return { x: deg(x), y: deg(y), z: deg(z) };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (k: string) => { const i = args.indexOf(k); return i > -1 ? args[i+1] : undefined; };
  const file = getArg('--file');
  const patientRoot = getArg('--patientRoot');
  if (!file || !patientRoot) {
    console.error('Usage: --file REG.dcm --patientRoot /abs/patient');
    process.exit(1);
  }
  const parsed = parseDicomRegistrationFromFile(file);
  if (!parsed) {
    console.log(JSON.stringify({ ok:false, error:'parse_failed' }));
    return;
  }
  const refs = parsed.referencedSeriesInstanceUids || [];
  const meta = refs.map(uid => ({ uid, sample: findSampleForSeries(patientRoot, uid) }));

  const M = parsed.matrixRowMajor4x4 || null;
  const describe = (mat: number[] | null) => {
    if (!mat) return null;
    const R = [
      [mat[0], mat[1], mat[2]],
      [mat[4], mat[5], mat[6]],
      [mat[8], mat[9], mat[10]]
    ];
    const T = [mat[3], mat[7], mat[11]];
    const e = toEulerZYXDegrees(R);
    const colX = [R[0][0], R[1][0], R[2][0]];
    const colY = [R[0][1], R[1][1], R[2][1]];
    const colZ = [R[0][2], R[1][2], R[2][2]];
    return { colX, colY, colZ, T, eulerZYX:e };
  };

  // Direction per Supplement 73: matrix maps Target(A) <- Source(B)
  const AisCT = meta.find(m => m.sample?.modality === 'CT' && m.sample?.frameOfRef === parsed.targetFrameOfReferenceUid);
  const BisCT = meta.find(m => m.sample?.modality === 'CT' && m.sample?.frameOfRef === parsed.sourceFrameOfReferenceUid);

  let reported: any = {};
  if (M) {
    // Report in CT<-X convention when possible
    if (AisCT && !BisCT) {
      reported = { convention: 'CT<-moving', matrix: describe(M) };
    } else if (BisCT && !AisCT) {
      const Minv = invertRigid4x4(M);
      reported = { convention: 'CT<-moving (inverted)', matrix: describe(Minv) };
    } else {
      // Unknown, report raw and inverted
      reported = { convention: 'unknown', raw: describe(M), inverted: describe(invertRigid4x4(M)) };
    }
  }

  console.log(JSON.stringify({
    ok: true,
    regFile: file,
    sourceFoR: parsed.sourceFrameOfReferenceUid || null,
    targetFoR: parsed.targetFrameOfReferenceUid || null,
    referenced: meta.map(m => ({ uid: m.uid, modality: m.sample?.modality || null, frameOfRef: m.sample?.frameOfRef || null })),
    reported
  }, null, 2));
}

main();


