/*
  Usage:
    npx ts-node scripts/preview-reg.ts 13 14
*/
import { parseDicomRegistrationFromFile } from '../server/registration/reg-parser.ts';

function toOrientation(matrix: number[]): { R: number[][]; T: number[] } {
  const R = [
    [matrix[0], matrix[1], matrix[2]],
    [matrix[4], matrix[5], matrix[6]],
    [matrix[8], matrix[9], matrix[10]],
  ];
  const T = [matrix[3], matrix[7], matrix[11]];
  return { R, T };
}

function toEulerZYXDegrees(R: number[][]): { rxDeg: number; ryDeg: number; rzDeg: number } {
  const sy = Math.sqrt(R[0][0] * R[0][0] + R[1][0] * R[1][0]);
  let x = 0, y = 0, z = 0;
  if (sy > 1e-6) {
    x = Math.atan2(R[2][1], R[2][2]);
    y = Math.atan2(-R[2][0], sy);
    z = Math.atan2(R[1][0], R[0][0]);
  } else {
    // Gimbal lock fallback
    x = Math.atan2(-R[1][2], R[1][1]);
    y = Math.atan2(-R[2][0], sy);
    z = 0;
  }
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  return { rxDeg: toDeg(x), ryDeg: toDeg(y), rzDeg: toDeg(z) };
}

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx > -1 && args[fileIdx + 1]) {
    const filePath = args[fileIdx + 1];
    const parsed = parseDicomRegistrationFromFile(filePath);
    if (!parsed || !parsed.matrixRowMajor4x4) {
      console.log(`File ${filePath}: No valid rigid matrix parsed`);
      return;
    }
    const { R, T } = toOrientation(parsed.matrixRowMajor4x4);
    const euler = toEulerZYXDegrees(R);
    console.log(`\nREG file`);
    console.log(`  Path: ${filePath}`);
    if (parsed.sourceFrameOfReferenceUid) console.log(`  Source FoR: ${parsed.sourceFrameOfReferenceUid}`);
    if (parsed.targetFrameOfReferenceUid) console.log(`  Target FoR: ${parsed.targetFrameOfReferenceUid}`);
    console.log('  Orientation axes (rows):');
    console.log(`    X: [${R[0].map((v) => v.toFixed(6)).join(', ')}]`);
    console.log(`    Y: [${R[1].map((v) => v.toFixed(6)).join(', ')}]`);
    console.log(`    Z: [${R[2].map((v) => v.toFixed(6)).join(', ')}]`);
    console.log(`  Translation (mm): [${T.map((v) => v.toFixed(4)).join(', ')}]`);
    console.log(`  Rotation ZYX (deg): X=${euler.rxDeg.toFixed(4)}, Y=${euler.ryDeg.toFixed(4)}, Z=${euler.rzDeg.toFixed(4)}`);
    if (parsed.notes && parsed.notes.length) {
      console.log('  Notes:');
      for (const n of parsed.notes) console.log(`    - ${n}`);
    }
    return;
  }

  const ids = args.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
  if (ids.length === 0) {
    console.error('Provide one or more study IDs, e.g. 13 14, or --file /path/to/reg.dcm');
    process.exit(1);
  }

  for (const studyId of ids) {
    try {
      const { findRegFileForStudy } = await import('../server/registration/reg-resolver.ts');
      if (!resolved) {
        console.log(`Study ${studyId}: No REG file found`);
        continue;
      }
      const parsed = parseDicomRegistrationFromFile(resolved.filePath);
      if (!parsed || !parsed.matrixRowMajor4x4) {
        console.log(`Study ${studyId}: No valid rigid matrix parsed`);
        continue;
      }
      const { R, T } = toOrientation(parsed.matrixRowMajor4x4);
      const euler = toEulerZYXDegrees(R);

      console.log(`\nStudy ${studyId}`);
      console.log(`  REG: ${resolved.filePath}`);
      if (parsed.sourceFrameOfReferenceUid) console.log(`  Source FoR: ${parsed.sourceFrameOfReferenceUid}`);
      if (parsed.targetFrameOfReferenceUid) console.log(`  Target FoR: ${parsed.targetFrameOfReferenceUid}`);
      // Per DICOM Supplement 73, columns are direction cosines of B axes in A (X=col1, Y=col2, Z=col3)
      const colX = [R[0][0], R[1][0], R[2][0]];
      const colY = [R[0][1], R[1][1], R[2][1]];
      const colZ = [R[0][2], R[1][2], R[2][2]];
      console.log('  Orientation axes (columns, dir cosines):');
      console.log(`    X: [${colX.map((v) => v.toFixed(6)).join(', ')}]`);
      console.log(`    Y: [${colY.map((v) => v.toFixed(6)).join(', ')}]`);
      console.log(`    Z: [${colZ.map((v) => v.toFixed(6)).join(', ')}]`);
      console.log(`  Translation (mm): [${T.map((v) => v.toFixed(4)).join(', ')}]`);
      console.log(`  Rotation ZYX (deg): X=${euler.rxDeg.toFixed(4)}, Y=${euler.ryDeg.toFixed(4)}, Z=${euler.rzDeg.toFixed(4)}`);
      if (parsed.notes && parsed.notes.length) {
        console.log('  Notes:');
        for (const n of parsed.notes) console.log(`    - ${n}`);
      }
    } catch (e) {
      console.error(`Study ${studyId}: failed -`, e);
    }
  }
}

main();


