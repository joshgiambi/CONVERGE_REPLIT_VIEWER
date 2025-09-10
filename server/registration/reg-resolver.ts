import { storage } from '../storage.ts';
import * as fs from 'fs';

export interface ResolvedRegFile {
  studyId: number;
  seriesId: number;
  filePath: string;
}

export async function findRegFileForStudy(studyId: number): Promise<ResolvedRegFile | null> {
  const seriesList = await storage.getSeriesByStudyId(studyId);
  const regSeries = seriesList.find((s: any) => (s.modality || '').toUpperCase() === 'REG');
  if (!regSeries) return null;
  const regImages = await storage.getImagesBySeriesId(regSeries.id);
  const first = regImages?.[0];
  if (first?.filePath && fs.existsSync(first.filePath)) {
    return { studyId, seriesId: regSeries.id, filePath: first.filePath };
  }
  return null;
}

export interface ResolvedRegForPatient {
  studyId: number;
  seriesId: number;
  filePath: string;
}

export async function findAllRegFilesForPatient(patientId: number): Promise<ResolvedRegForPatient[]> {
  const out: ResolvedRegForPatient[] = [];
  const studies = await storage.getStudiesByPatient(patientId);
  for (const st of studies) {
    const seriesList = await storage.getSeriesByStudyId(st.id);
    for (const ser of seriesList) {
      if ((ser.modality || '').toUpperCase() !== 'REG') continue;
      const imgs = await storage.getImagesBySeriesId(ser.id);
      const first = imgs?.[0];
      if (first?.filePath && fs.existsSync(first.filePath)) out.push({ studyId: st.id, seriesId: ser.id, filePath: first.filePath });
    }
  }
  return out;
}


