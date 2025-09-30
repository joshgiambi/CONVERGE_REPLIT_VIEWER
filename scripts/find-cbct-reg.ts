import 'dotenv/config';
import { db } from '../server/db';
import { series, images } from '../shared/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import dicomParser from 'dicom-parser';

const CBCT_SERIES_UID = '1.2.246.352.221.570537758543275012911456240642628457867';
const PLANNING_CT_SERIES_UID = '1.2.246.352.221.534437763102598122915916606648478293420';

async function findCBCTRegistration() {
  // Get all REG series in study 60
  const regSeries = await db.select().from(series).where(eq(series.studyId, 60));
  const regs = regSeries.filter(s => s.modality === 'REG');

  console.log(`Checking ${regs.length} REG series for CBCT/Planning CT references...\n`);

  for (const reg of regs) {
    const regImages = await db.select().from(images).where(eq(images.seriesId, reg.id));
    if (regImages.length === 0) continue;

    const regFile = regImages[0].filePath;
    try {
      const dicomData = fs.readFileSync(regFile);
      const dataSet = dicomParser.parseDicom(dicomData);

      const refSeriesSeq = dataSet.elements['x00081115'];
      if (!refSeriesSeq) continue;

      const buffer = dicomData.slice(refSeriesSeq.dataOffset, refSeriesSeq.dataOffset + refSeriesSeq.length);
      const seriesUIDTag = Buffer.from([0x20, 0x00, 0x0E, 0x00]);
      const foundUIDs: string[] = [];

      let offset = 0;
      while (offset < buffer.length - 4) {
        if (buffer[offset] === seriesUIDTag[0] &&
            buffer[offset + 1] === seriesUIDTag[1] &&
            buffer[offset + 2] === seriesUIDTag[2] &&
            buffer[offset + 3] === seriesUIDTag[3]) {

          const valueLength = buffer.readUInt32LE(offset + 4);
          const valueOffset = offset + 8;
          if (valueLength < 1000) {
            const valueBytes = buffer.slice(valueOffset, valueOffset + valueLength);
            const value = valueBytes.toString('ascii').trim().replace(/\0/g, '');
            if (value.length > 10) {
              foundUIDs.push(value);
            }
          }
        }
        offset++;
      }

      const hasCBCT = foundUIDs.includes(CBCT_SERIES_UID);
      const hasPlanningCT = foundUIDs.includes(PLANNING_CT_SERIES_UID);

      if (hasCBCT || hasPlanningCT) {
        console.log(`✓ REG Series ${reg.id}:`);
        console.log(`  CBCT: ${hasCBCT ? 'YES' : 'no'}`);
        console.log(`  Planning CT: ${hasPlanningCT ? 'YES' : 'no'}`);
        console.log(`  References ${foundUIDs.length} series total`);
        console.log('');
      }

    } catch (err) {
      // Skip
    }
  }
}

findCBCTRegistration().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});