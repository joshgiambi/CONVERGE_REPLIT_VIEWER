import { studies, series, images, patients, pacsConnections, type Study, type Series, type DicomImage, type Patient, type PacsConnection, type InsertStudy, type InsertSeries, type InsertImage, type InsertPatient, type InsertPacsConnection } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Patient operations
  createPatient(patient: InsertPatient): Promise<Patient>;
  getPatient(id: number): Promise<Patient | undefined>;
  getPatientByID(patientID: string): Promise<Patient | undefined>;
  getAllPatients(): Promise<Patient[]>;

  // Study operations
  createStudy(study: InsertStudy): Promise<Study>;
  getStudy(id: number): Promise<Study | undefined>;
  getStudyByUID(studyInstanceUID: string): Promise<Study | undefined>;
  getAllStudies(): Promise<Study[]>;
  getStudiesByPatient(patientId: number): Promise<Study[]>;

  // Series operations
  createSeries(series: InsertSeries): Promise<Series>;
  getSeries(id: number): Promise<Series | undefined>;
  getSeriesById(id: number): Promise<Series | undefined>;
  getSeriesByUID(seriesInstanceUID: string): Promise<Series | undefined>;
  getSeriesByStudyId(studyId: number): Promise<Series[]>;
  getSeriesWithImages(seriesId: number): Promise<any>;
  getRTStructuresForStudy(studyId: number): Promise<Series[]>;

  // Image operations
  createImage(image: InsertImage): Promise<DicomImage>;
  getImage(id: number): Promise<DicomImage | undefined>;
  getImageByUID(sopInstanceUID: string): Promise<DicomImage | undefined>;
  getImagesBySeriesId(seriesId: number): Promise<DicomImage[]>;
  
  // PACS operations
  createPacsConnection(connection: InsertPacsConnection): Promise<PacsConnection>;
  getPacsConnection(id: number): Promise<PacsConnection | undefined>;
  getAllPacsConnections(): Promise<PacsConnection[]>;
  updatePacsConnection(id: number, updates: Partial<InsertPacsConnection>): Promise<PacsConnection>;
  deletePacsConnection(id: number): Promise<void>;
  
  // Update operations
  updateSeriesImageCount(seriesId: number, count: number): Promise<void>;
  updateStudyCounts(studyId: number, seriesCount: number, imageCount: number): Promise<void>;
  
  // Clear all data
  clearAll(): void;
}

export class MemStorage implements IStorage {
  private studies: Map<number, Study>;
  private series: Map<number, Series>;
  private images: Map<number, DicomImage>;
  private currentStudyId: number;
  private currentSeriesId: number;
  private currentImageId: number;

  constructor() {
    this.studies = new Map();
    this.series = new Map();
    this.images = new Map();
    this.currentStudyId = 1;
    this.currentSeriesId = 1;
    this.currentImageId = 1;
  }

  async createStudy(insertStudy: InsertStudy): Promise<Study> {
    const id = this.currentStudyId++;
    const study: Study = {
      id,
      studyInstanceUID: insertStudy.studyInstanceUID,
      patientName: insertStudy.patientName || null,
      patientID: insertStudy.patientID || null,
      studyDate: insertStudy.studyDate || null,
      studyDescription: insertStudy.studyDescription || null,
      accessionNumber: insertStudy.accessionNumber || null,
      createdAt: new Date(),
    };
    this.studies.set(id, study);
    return study;
  }

  async getStudy(id: number): Promise<Study | undefined> {
    return this.studies.get(id);
  }

  async getStudyByUID(studyInstanceUID: string): Promise<Study | undefined> {
    return Array.from(this.studies.values()).find(
      (study) => study.studyInstanceUID === studyInstanceUID
    );
  }

  async getAllStudies(): Promise<Study[]> {
    return Array.from(this.studies.values());
  }

  async createSeries(insertSeries: InsertSeries): Promise<Series> {
    const id = this.currentSeriesId++;
    const seriesData: Series = {
      id,
      studyId: insertSeries.studyId,
      seriesInstanceUID: insertSeries.seriesInstanceUID,
      seriesDescription: insertSeries.seriesDescription || null,
      modality: insertSeries.modality,
      seriesNumber: insertSeries.seriesNumber || null,
      imageCount: insertSeries.imageCount || 0,
      sliceThickness: insertSeries.sliceThickness || null,
      metadata: insertSeries.metadata || {},
      createdAt: new Date(),
    };
    this.series.set(id, seriesData);
    return seriesData;
  }

  async getSeries(id: number): Promise<Series | undefined> {
    return this.series.get(id);
  }

  async getSeriesByUID(seriesInstanceUID: string): Promise<Series | undefined> {
    return Array.from(this.series.values()).find(
      (series) => series.seriesInstanceUID === seriesInstanceUID
    );
  }

  async getSeriesByStudyId(studyId: number): Promise<Series[]> {
    return Array.from(this.series.values()).filter(
      (series) => series.studyId === studyId
    );
  }

  async createImage(insertImage: InsertImage): Promise<DicomImage> {
    const id = this.currentImageId++;
    const image: DicomImage = {
      id,
      seriesId: insertImage.seriesId,
      sopInstanceUID: insertImage.sopInstanceUID,
      instanceNumber: insertImage.instanceNumber || null,
      filePath: insertImage.filePath,
      fileName: insertImage.fileName,
      fileSize: insertImage.fileSize || null,
      imagePosition: insertImage.imagePosition || null,
      imageOrientation: insertImage.imageOrientation || null,
      pixelSpacing: insertImage.pixelSpacing || null,
      sliceLocation: insertImage.sliceLocation || null,
      windowCenter: insertImage.windowCenter || null,
      windowWidth: insertImage.windowWidth || null,
      metadata: insertImage.metadata || {},
      createdAt: new Date(),
    };
    this.images.set(id, image);
    return image;
  }

  async getImage(id: number): Promise<DicomImage | undefined> {
    return this.images.get(id);
  }

  async getImageByUID(sopInstanceUID: string): Promise<DicomImage | undefined> {
    return Array.from(this.images.values()).find(
      (image) => image.sopInstanceUID === sopInstanceUID
    );
  }

  async getImagesBySeriesId(seriesId: number): Promise<DicomImage[]> {
    return Array.from(this.images.values()).filter(
      (image) => image.seriesId === seriesId
    ).sort((a, b) => (a.instanceNumber || 0) - (b.instanceNumber || 0));
  }

  async updateSeriesImageCount(seriesId: number, count: number): Promise<void> {
    const seriesData = this.series.get(seriesId);
    if (seriesData) {
      seriesData.imageCount = count;
      this.series.set(seriesId, seriesData);
    }
  }

  clearAll(): void {
    this.studies.clear();
    this.series.clear();
    this.images.clear();
    this.currentStudyId = 1;
    this.currentSeriesId = 1;
    this.currentImageId = 1;
  }
}

export class DatabaseStorage implements IStorage {
  // Patient operations
  async createPatient(insertPatient: InsertPatient): Promise<Patient> {
    const [patient] = await db
      .insert(patients)
      .values(insertPatient)
      .returning();
    return patient;
  }

  async getPatient(id: number): Promise<Patient | undefined> {
    const [patient] = await db.select().from(patients).where(eq(patients.id, id));
    return patient || undefined;
  }

  async getPatientByID(patientID: string): Promise<Patient | undefined> {
    const [patient] = await db.select().from(patients).where(eq(patients.patientID, patientID));
    return patient || undefined;
  }

  async getAllPatients(): Promise<Patient[]> {
    return await db.select().from(patients).orderBy(desc(patients.createdAt));
  }

  // Study operations
  async createStudy(insertStudy: InsertStudy): Promise<Study> {
    const [study] = await db
      .insert(studies)
      .values(insertStudy)
      .returning();
    return study;
  }

  async getStudy(id: number): Promise<Study | undefined> {
    const [study] = await db.select().from(studies).where(eq(studies.id, id));
    return study || undefined;
  }

  async getStudyByUID(studyInstanceUID: string): Promise<Study | undefined> {
    const [study] = await db.select().from(studies).where(eq(studies.studyInstanceUID, studyInstanceUID));
    return study || undefined;
  }

  async getAllStudies(): Promise<Study[]> {
    return await db.select().from(studies).orderBy(desc(studies.createdAt));
  }

  async getStudiesByPatient(patientId: number): Promise<Study[]> {
    return await db.select().from(studies).where(eq(studies.patientId, patientId)).orderBy(desc(studies.createdAt));
  }

  // Series operations
  async createSeries(insertSeries: InsertSeries): Promise<Series> {
    const [seriesData] = await db
      .insert(series)
      .values(insertSeries)
      .returning();
    return seriesData;
  }

  async getSeries(id: number): Promise<Series | undefined> {
    const [seriesData] = await db.select().from(series).where(eq(series.id, id));
    return seriesData || undefined;
  }

  async getSeriesByUID(seriesInstanceUID: string): Promise<Series | undefined> {
    const [seriesData] = await db.select().from(series).where(eq(series.seriesInstanceUID, seriesInstanceUID));
    return seriesData || undefined;
  }

  async getSeriesByStudyId(studyId: number): Promise<Series[]> {
    return await db.select().from(series).where(eq(series.studyId, studyId));
  }

  // Image operations
  async createImage(insertImage: InsertImage): Promise<DicomImage> {
    const [image] = await db
      .insert(images)
      .values(insertImage)
      .returning();
    return image;
  }

  async getImage(id: number): Promise<DicomImage | undefined> {
    const [image] = await db.select().from(images).where(eq(images.id, id));
    return image || undefined;
  }

  async getImageByUID(sopInstanceUID: string): Promise<DicomImage | undefined> {
    const [image] = await db.select().from(images).where(eq(images.sopInstanceUID, sopInstanceUID));
    return image || undefined;
  }

  async getImagesBySeriesId(seriesId: number): Promise<DicomImage[]> {
    return await db.select().from(images).where(eq(images.seriesId, seriesId));
  }

  // PACS operations
  async createPacsConnection(insertConnection: InsertPacsConnection): Promise<PacsConnection> {
    const [connection] = await db
      .insert(pacsConnections)
      .values(insertConnection)
      .returning();
    return connection;
  }

  async getPacsConnection(id: number): Promise<PacsConnection | undefined> {
    const [connection] = await db.select().from(pacsConnections).where(eq(pacsConnections.id, id));
    return connection || undefined;
  }

  async getAllPacsConnections(): Promise<PacsConnection[]> {
    return await db.select().from(pacsConnections).orderBy(desc(pacsConnections.createdAt));
  }

  async updatePacsConnection(id: number, updates: Partial<InsertPacsConnection>): Promise<PacsConnection> {
    const [connection] = await db
      .update(pacsConnections)
      .set(updates)
      .where(eq(pacsConnections.id, id))
      .returning();
    return connection;
  }

  async deletePacsConnection(id: number): Promise<void> {
    await db.delete(pacsConnections).where(eq(pacsConnections.id, id));
  }

  // Update operations
  async updateSeriesImageCount(seriesId: number, count: number): Promise<void> {
    await db
      .update(series)
      .set({ imageCount: count })
      .where(eq(series.id, seriesId));
  }

  async updateStudyCounts(studyId: number, seriesCount: number, imageCount: number): Promise<void> {
    await db
      .update(studies)
      .set({ 
        numberOfSeries: seriesCount,
        numberOfImages: imageCount 
      })
      .where(eq(studies.id, studyId));
  }

  async getSeriesWithImages(seriesId: number): Promise<any> {
    const [seriesData] = await db
      .select()
      .from(series)
      .where(eq(series.id, seriesId));

    if (!seriesData) return null;

    const seriesImages = await db
      .select()
      .from(images)
      .where(eq(images.seriesId, seriesId));

    return {
      ...seriesData,
      images: seriesImages
    };
  }

  async getSeriesById(id: number): Promise<Series | undefined> {
    const [seriesData] = await db
      .select()
      .from(series)
      .where(eq(series.id, id));
    return seriesData || undefined;
  }

  async getRTStructuresForStudy(studyId: number): Promise<Series[]> {
    return await db
      .select()
      .from(series)
      .where(eq(series.studyId, studyId));
  }

  clearAll(): void {
    // This would be implemented as database truncation
    throw new Error('Database clearAll not implemented - use proper migration tools');
  }
}

export const storage = new DatabaseStorage();
