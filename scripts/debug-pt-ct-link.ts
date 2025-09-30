import 'dotenv/config';
import { storage } from '../server/storage';

const series2284 = await storage.getSeriesById(2284);
const series2283 = await storage.getSeriesById(2283);

console.log('\n=== Series 2284 (PT) ===');
console.log('ID:', series2284?.id);
console.log('Modality:', series2284?.modality);
console.log('Frame of Reference UID:', series2284?.frameOfReferenceUid);
console.log('Study ID:', series2284?.studyId);

console.log('\n=== Series 2283 (CT) ===');
console.log('ID:', series2283?.id);
console.log('Modality:', series2283?.modality);
console.log('Frame of Reference UID:', series2283?.frameOfReferenceUid);
console.log('Study ID:', series2283?.studyId);

if (series2284 && series2283) {
  const allSeriesInStudy = await storage.getSeriesByStudyId(series2284.studyId);

  console.log('\n=== All series in study ===');
  console.log('Total series:', allSeriesInStudy.length);

  const sameFORSeries = allSeriesInStudy.filter(s =>
    s.id !== series2284.id &&
    s.frameOfReferenceUid === series2284.frameOfReferenceUid &&
    !['REG', 'RTSTRUCT'].includes(s.modality?.toUpperCase() || '')
  );

  console.log('\n=== Series with same Frame of Reference as 2284 ===');
  console.log('Found:', sameFORSeries.length);
  sameFORSeries.forEach(s => {
    console.log(`  - Series ${s.id}: ${s.modality} (${s.imageCount} images) - ${s.seriesDescription || 'N/A'}`);
  });
}

process.exit(0);