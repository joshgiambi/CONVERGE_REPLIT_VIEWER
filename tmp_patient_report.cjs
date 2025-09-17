require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const dicomParser = require('dicom-parser');

function parsePixelSpacing(ds) {
  try {
    const el = ds.elements['x00280030'];
    if (!el) return null;
    const s = ds.string('x00280030');
    if (!s) return null;
    const parts = s.split('\\').map(Number).filter(n => Number.isFinite(n));
    return parts.length >= 2 ? { row: parts[0], col: parts[1] } : null;
  } catch { return null; }
}

function parseRowsCols(ds) {
  let rows = null, cols = null;
  try {
    const r = ds.uint16 && ds.uint16('x00280010');
    const c = ds.uint16 && ds.uint16('x00280011');
    rows = Number.isFinite(r) ? r : null;
    cols = Number.isFinite(c) ? c : null;
  } catch {}
  if (rows == null || cols == null) {
    // fallback via string parsing
    try {
      const rs = Number(ds.string('x00280010'));
      const cs = Number(ds.string('x00280011'));
      if (Number.isFinite(rs)) rows = rs;
      if (Number.isFinite(cs)) cols = cs;
    } catch {}
  }
  return { rows, columns: cols };
}

function tryParseFD16(dataSet, element) {
  try {
    const byteArray = dataSet.byteArray;
    const offset = element.dataOffset;
    const length = element.length;
    const view = new DataView(byteArray.buffer, byteArray.byteOffset + offset, length);
    const values = [];
    for (let j = 0; j + 8 <= length && values.length < 16; j += 8) values.push(view.getFloat64(j, true));
    return values.length === 16 ? values : null;
  } catch { return null; }
}

function tryParseDS16(str) {
  if (typeof str !== 'string') return null;
  const vals = str.split('\\').map(v => parseFloat(v)).filter(n => !Number.isNaN(n));
  return vals.length === 16 ? vals : null;
}

function parseRegistrationMatrix(filePath) {
  const out = { file: filePath, matrix: null, notes: [] };
  try {
    if (!fs.existsSync(filePath)) { out.notes.push('file_not_found'); return out; }
    const bytes = fs.readFileSync(filePath);
    const ds = dicomParser.parseDicom(new Uint8Array(bytes));

    // Traverse Registration Sequence 0070,0308
    const cands = [];
    try {
      const regSeq = ds.elements?.['x00700308'];
      if (regSeq?.items?.length) {
        for (const regItem of regSeq.items) {
          const mrs = regItem.dataSet?.elements?.['x00700309'];
          if (mrs?.items?.length) {
            for (const mi of mrs.items) {
              const mseq = mi.dataSet?.elements?.['x0070030a'];
              if (mseq?.items?.length) {
                for (const mItem of mseq.items) {
                  const fdEl = mItem.dataSet?.elements?.['x0070030c'];
                  const fdVals = fdEl ? tryParseFD16(mItem.dataSet, fdEl) : null;
                  if (fdVals && fdVals.length === 16) cands.push(fdVals);
                  const dsVals = tryParseDS16(mItem.dataSet?.string?.('x300600c6'));
                  if (dsVals) cands.push(dsVals);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      out.notes.push('failed_registration_sequence');
    }

    // Fallback: look at top-level DS 3006,00C6
    try {
      const top = tryParseDS16(ds.string?.('x300600c6'));
      if (top) cands.push(top);
    } catch {}

    if (cands.length === 0) { out.notes.push('no_matrices_found'); return out; }
    // Prefer last non-identity
    function isIdentity(m){return m[0]===1&&m[5]===1&&m[10]===1&&m[15]===1&&m[1]===0&&m[2]===0&&m[3]===0&&m[4]===0&&m[6]===0&&m[7]===0&&m[8]===0&&m[9]===0&&m[11]===0&&m[12]===0&&m[13]===0&&m[14]===0}
    for (let i=cands.length-1;i>=0;i--){ const m=cands[i]; if (!isIdentity(m)){ out.matrix=m; break; } }
    if (!out.matrix) out.matrix = cands[cands.length-1];
  } catch (e) {
    out.notes.push('parse_error');
  }
  return out;
}

function decomposeRigidRowMajor(M) {
  if (!Array.isArray(M) || M.length !== 16) return null;
  const r00=M[0], r01=M[1], r02=M[2], tx=M[3];
  const r10=M[4], r11=M[5], r12=M[6], ty=M[7];
  const r20=M[8], r21=M[9], r22=M[10], tz=M[11];
  // Euler angles (XYZ intrinsic / roll-pitch-yaw)
  let pitchY = Math.asin(-Math.min(1, Math.max(-1, r20)));
  let rollX, yawZ;
  if (Math.abs(Math.cos(pitchY)) > 1e-6) {
    rollX = Math.atan2(r21, r22);
    yawZ = Math.atan2(r10, r00);
  } else {
    // Gimbal lock
    rollX = 0;
    yawZ = Math.atan2(-r01, r11);
  }
  const deg = x => x*180/Math.PI;
  return {
    rotationMatrix: [[r00,r01,r02],[r10,r11,r12],[r20,r21,r22]],
    translation: { x: tx, y: ty, z: tz },
    eulerXYZdeg: { rollX: deg(rollX), pitchY: deg(pitchY), yawZ: deg(yawZ) }
  };
}

(async () => {
  const client = new (require('pg').Client)({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const patientKey = 'nYHUfQQEeTNqKGsj';
  const out = { patientKey, patient: null, studies: [] };
  try {
    const pat = await client.query("SELECT * FROM patients WHERE patient_id = $1 OR patient_name = $1", [patientKey]);
    if (pat.rows.length === 0) { console.log(JSON.stringify({ error: 'patient_not_found', patientKey }, null, 2)); process.exit(0); }
    const patient = pat.rows[0];
    out.patient = { id: patient.id, patient_id: patient.patient_id, patient_name: patient.patient_name };
    const stRows = (await client.query("SELECT * FROM studies WHERE patient_id = $1 ORDER BY id", [patient.id])).rows;
    for (const st of stRows) {
      const stObj = { id: st.id, studyInstanceUID: st.study_instance_uid, series: [], registrations: [] };
      const seRows = (await client.query("SELECT * FROM series WHERE study_id = $1 ORDER BY id", [st.id])).rows;
      for (const se of seRows) {
        // first image
        const imgs = (await client.query("SELECT * FROM images WHERE series_id = $1 ORDER BY instance_number NULLS LAST, id LIMIT 1", [se.id])).rows;
        const first = imgs[0];
        let dims = null, spacing = null;
        if (first) {
          try {
            const buf = fs.readFileSync(first.file_path);
            const ds = dicomParser.parseDicom(new Uint8Array(buf));
            dims = parseRowsCols(ds);
            spacing = parsePixelSpacing(ds);
          } catch {}
        }
        stObj.series.push({ id: se.id, seriesInstanceUID: se.series_instance_uid, modality: se.modality, description: se.series_description, imageCount: se.image_count, sliceThickness: se.slice_thickness, dimensions: dims, pixelSpacing: spacing });

        if (se.modality === 'REG' && first) {
          const parsed = parseRegistrationMatrix(first.file_path);
          const dec = parsed.matrix ? decomposeRigidRowMajor(parsed.matrix) : null;
          stObj.registrations.push({ seriesId: se.id, file: parsed.file, matrix: parsed.matrix, notes: parsed.notes, decomposition: dec });
        }
      }
      out.studies.push(stObj);
    }
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
})();
