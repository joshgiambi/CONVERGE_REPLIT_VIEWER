import 'dotenv/config';
import * as fs from 'fs';
import dicomParser from 'dicom-parser';
import { db } from '../server/db';
import { series, images } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { storage } from '../server/storage';

// Get REG series 2291
const regSeries = await db.select().from(series).where(eq(series.id, 2291)).limit(1);
const reg = regSeries[0];

console.log('REG Series 2291:');
console.log('  ID:', reg.id);
console.log('  Modality:', reg.modality);
console.log('');

// Get the DICOM file
const regImages = await db.select().from(images).where(eq(images.seriesId, 2291));
const regFile = regImages[0].filePath;

console.log('Reading:', regFile);
const dicomData = fs.readFileSync(regFile);
const dataSet = dicomParser.parseDicom(dicomData);

const refSeriesSeq = dataSet.elements['x00081115'];
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

    if (valueLength < 1000 && valueOffset + valueLength <= buffer.length) {
      const valueBytes = buffer.slice(valueOffset, valueOffset + valueLength);
      const value = valueBytes.toString('ascii').trim().replace(/\0/g, '');
      if (value.length > 10 && value.startsWith('1.')) {
        foundUIDs.push(value);
      }
    }
  }
  offset++;
}

console.log('\nExtracted Series UIDs:');
foundUIDs.forEach((uid, i) => console.log(`  ${i + 1}. ${uid}`));

// Find series in database
const allSeries = await storage.getSeriesByStudyId(reg.studyId);
console.log('\nMatching series in database:');

foundUIDs.forEach((uid, i) => {
  const match = allSeries.find(s => s.seriesInstanceUID === uid);
  if (match) {
    console.log(`  ${i + 1}. Series ${match.id} | ${match.modality} | ${match.imageCount} images | ${match.seriesDescription || 'N/A'}`);
  } else {
    console.log(`  ${i + 1}. NOT FOUND`);
  }
});

process.exit(0);