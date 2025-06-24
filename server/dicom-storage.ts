import { db } from './db';
import { patients, studies, series, images } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';

export interface DICOMStorageService {
  getPatients(): Promise<any[]>;
  getPatientById(id: number): Promise<any>;
  createPatient(data: any): Promise<any>;
  getStudies(): Promise<any[]>;
  getStudyById(id: number): Promise<any>;
  getStudiesByPatient(patientId: number): Promise<any[]>;
  createStudy(data: any): Promise<any>;
  getSeriesById(id: number): Promise<any>;
  getSeriesByStudy(studyId: number): Promise<any[]>;
  createSeries(data: any): Promise<any>;
  getImageById(sopInstanceUID: string): Promise<any>;
  getImagesBySeriesId(seriesId: number): Promise<any[]>;
  createImage(data: any): Promise<any>;
}

export class DatabaseStorage implements DICOMStorageService {
  
  async getPatients() {
    return await db.query.patients.findMany({
      orderBy: [desc(patients.createdAt)],
      with: {
        studies: {
          orderBy: [desc(studies.createdAt)],
          limit: 3
        }
      }
    });
  }

  async getPatientById(id: number) {
    return await db.query.patients.findFirst({
      where: eq(patients.id, id),
      with: {
        studies: {
          orderBy: [desc(studies.createdAt)],
          with: {
            series: {
              orderBy: [desc(series.createdAt)]
            }
          }
        }
      }
    });
  }

  async createPatient(data: any) {
    const [patient] = await db.insert(patients)
      .values(data)
      .returning();
    return patient;
  }

  async getStudies() {
    return await db.query.studies.findMany({
      orderBy: [desc(studies.createdAt)],
      with: {
        patient: true,
        series: {
          orderBy: [desc(series.createdAt)]
        }
      }
    });
  }

  async getStudyById(id: number) {
    return await db.query.studies.findFirst({
      where: eq(studies.id, id),
      with: {
        patient: true,
        series: {
          orderBy: [desc(series.createdAt)],
          with: {
            images: {
              orderBy: [images.instanceNumber]
            }
          }
        }
      }
    });
  }

  async getStudiesByPatient(patientId: number) {
    return await db.query.studies.findMany({
      where: eq(studies.patientId, patientId),
      orderBy: [desc(studies.createdAt)],
      with: {
        series: {
          orderBy: [desc(series.createdAt)]
        }
      }
    });
  }

  async createStudy(data: any) {
    const [study] = await db.insert(studies)
      .values(data)
      .returning();
    return study;
  }

  async getSeriesById(id: number) {
    return await db.query.series.findFirst({
      where: eq(series.id, id),
      with: {
        study: {
          with: {
            patient: true
          }
        },
        images: {
          orderBy: [images.instanceNumber, images.sliceLocation]
        }
      }
    });
  }

  async getSeriesByStudy(studyId: number) {
    return await db.query.series.findMany({
      where: eq(series.studyId, studyId),
      orderBy: [series.seriesNumber],
      with: {
        images: {
          orderBy: [images.instanceNumber]
        }
      }
    });
  }

  async createSeries(data: any) {
    const [seriesRecord] = await db.insert(series)
      .values(data)
      .returning();
    return seriesRecord;
  }

  async getImageById(sopInstanceUID: string) {
    return await db.query.images.findFirst({
      where: eq(images.sopInstanceUID, sopInstanceUID),
      with: {
        series: {
          with: {
            study: {
              with: {
                patient: true
              }
            }
          }
        }
      }
    });
  }

  async getImagesBySeriesId(seriesId: number) {
    return await db.query.images.findMany({
      where: eq(images.seriesId, seriesId),
      orderBy: [images.instanceNumber, images.sliceLocation]
    });
  }

  async createImage(data: any) {
    const [image] = await db.insert(images)
      .values(data)
      .returning();
    return image;
  }
}

export const storage = new DatabaseStorage();