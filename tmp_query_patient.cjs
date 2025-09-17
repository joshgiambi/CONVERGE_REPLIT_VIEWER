require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const patientKey = 'nYHUfQQEeTNqKGsj';
  try {
    const pat = await client.query("SELECT * FROM patients WHERE patient_id = $1 OR patient_name = $1", [patientKey]);
    if (pat.rows.length === 0) {
      console.log(JSON.stringify({ error: 'patient_not_found', patientKey }, null, 2));
      process.exit(0);
    }
    const patient = pat.rows[0];
    const studies = (await client.query("SELECT * FROM studies WHERE patient_id = $1 ORDER BY id", [patient.id])).rows;
    const result = { patient: { id: patient.id, patient_id: patient.patient_id, patient_name: patient.patient_name }, studies: [] };
    for (const st of studies) {
      const stObj = { id: st.id, uid: st.study_instance_uid, series: [], registrations: [] };
      const series = (await client.query("SELECT * FROM series WHERE study_id = $1 ORDER BY id", [st.id])).rows;
      for (const se of series) {
        const imgs = (await client.query("SELECT id, file_path, file_name, pixel_spacing, image_position, metadata FROM images WHERE series_id = $1 ORDER BY instance_number NULLS LAST, id LIMIT 1", [se.id])).rows;
        const first = imgs[0];
        let dims = null; let spacing = null;
        if (first && first.metadata) {
          try {
            const md = typeof first.metadata === 'string' ? JSON.parse(first.metadata) : first.metadata;
            if (md && (md.rows || md.columns)) dims = { rows: md.rows || null, columns: md.columns || null };
            if (md && md.pixelSpacing && md.pixelSpacing.length >= 2) spacing = { row: md.pixelSpacing[0], col: md.pixelSpacing[1] };
          } catch {}
        }
        if (!spacing && first && first.pixel_spacing) {
          try {
            const ps = typeof first.pixel_spacing === 'string' ? JSON.parse(first.pixel_spacing) : first.pixel_spacing;
            if (Array.isArray(ps) && ps.length >= 2) spacing = { row: Number(ps[0]), col: Number(ps[1]) };
          } catch {}
        }
        stObj.series.push({ id: se.id, uid: se.series_instance_uid, modality: se.modality, description: se.series_description, imageCount: se.image_count, sliceThickness: se.slice_thickness, dimensions: dims, pixelSpacing: spacing });
      }
      const regs = (await client.query("SELECT * FROM registrations WHERE study_id = $1", [st.id])).rows;
      for (const r of regs) {
        let M = null; let meta = null;
        try { M = JSON.parse(r.transformation_matrix); } catch {}
        try { meta = JSON.parse(r.metadata); } catch {}
        stObj.registrations.push({ id: r.id, seriesInstanceUID: r.series_instance_uid, sopInstanceUID: r.sop_instance_uid, sourceFoR: r.source_frame_of_reference_uid, targetFoR: r.target_frame_of_reference_uid, matrixType: r.matrix_type, matrix: M, metadata: meta });
      }
      result.studies.push(stObj);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('query_error', e);
  } finally {
    await client.end();
  }
})();
