import { studies, series, images, patients, pacsConnections, patientTags, registrations, rtStructureSets, rtStructures, rtStructureContours, rtStructureHistory, type Study, type Series, type DicomImage, type Patient, type PacsConnection, type PatientTag, type Registration, type InsertStudy, type InsertSeries, type InsertImage, type InsertPatient, type InsertPacsConnection, type InsertPatientTag, type InsertRegistration, type RTStructureSet, type InsertRTStructureSet, type RTStructure, type InsertRTStructure, type RTStructureContour, type InsertRTStructureContour, type RTStructureHistory, type InsertRTStructureHistory } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

// In-memory storage for RT structure modifications
interface RTStructureModification {
  structureName?: string;
  color?: number[];
}

const rtStructureModifications = new Map<number, RTStructureModification>();

export interface IStorage {
  // Patient operations
  createPatient(patient: InsertPatient): Promise<Patient>;
  getPatient(id: number): Promise<Patient | undefined>;
  getPatientByID(patientID: string): Promise<Patient | undefined>;
  getAllPatients(): Promise<Patient[]>;
  deletePatient(id: number): Promise<void>;

  // Study operations
  createStudy(study: InsertStudy): Promise<Study>;
  getStudy(id: number): Promise<Study | undefined>;
  getStudyByUID(studyInstanceUID: string): Promise<Study | undefined>;
  getAllStudies(): Promise<Study[]>;
  getStudiesByPatient(patientId: number): Promise<Study[]>;
  relinkStudyToPatient(studyId: number, newPatientId: number): Promise<void>;

  // Series operations
  createSeries(series: InsertSeries): Promise<Series>;
  getSeries(id: number): Promise<Series | undefined>;
  getSeriesById(id: number): Promise<Series | undefined>;
  getSeriesByUID(seriesInstanceUID: string): Promise<Series | undefined>;
  getSeriesByStudyId(studyId: number): Promise<Series[]>;
  getSeriesWithImages(seriesId: number): Promise<any>;
  getRTStructuresForStudy(studyId: number): Promise<Series[]>;
  getAllSeries(): Promise<Series[]>;

  // Image operations
  createImage(image: InsertImage): Promise<DicomImage>;
  getImage(id: number): Promise<DicomImage | undefined>;
  getImageByUID(sopInstanceUID: string): Promise<DicomImage | undefined>;
  getImagesBySeriesId(seriesId: number): Promise<DicomImage[]>;
  // Update image geometry/metadata fields (partial)
  updateImageGeometry(imageId: number, updates: {
    imagePosition?: string | number[] | null;
    imageOrientation?: string | number[] | null;
    pixelSpacing?: string | number[] | null;
    metadata?: any;
  }): Promise<void>;
  
  // PACS operations
  createPacsConnection(connection: InsertPacsConnection): Promise<PacsConnection>;
  getPacsConnection(id: number): Promise<PacsConnection | undefined>;
  getAllPacsConnections(): Promise<PacsConnection[]>;
  updatePacsConnection(id: number, updates: Partial<InsertPacsConnection>): Promise<PacsConnection>;
  deletePacsConnection(id: number): Promise<void>;
  
  // Update operations
  updateSeriesImageCount(seriesId: number, count: number): Promise<void>;
  updateStudyCounts(studyId: number, seriesCount: number, imageCount: number): Promise<void>;
  
  // RT Structure operations
  updateRTStructureName(structureId: number, name: string): Promise<void>;
  updateRTStructureColor(structureId: number, color: number[]): Promise<void>;
  
  // RT Structure Set operations
  createRTStructureSet(data: InsertRTStructureSet): Promise<RTStructureSet>;
  getRTStructureSet(id: number): Promise<RTStructureSet | null>;
  getRTStructureSetsForPatient(patientId: number): Promise<RTStructureSet[]>;
  getRTStructureSetBySeriesId(seriesId: number): Promise<RTStructureSet | null>;
  updateRTStructureSet(id: number, data: Partial<RTStructureSet>): Promise<void>;
  
  // RT Structure operations
  createRTStructure(data: InsertRTStructure): Promise<RTStructure>;
  getRTStructuresBySetId(rtStructureSetId: number): Promise<RTStructure[]>;
  updateRTStructure(id: number, data: Partial<RTStructure>): Promise<void>;
  deleteRTStructure(id: number): Promise<void>;
  
  // RT Structure Contour operations
  createRTStructureContours(data: InsertRTStructureContour[]): Promise<void>;
  getRTStructureContours(rtStructureId: number): Promise<RTStructureContour[]>;
  updateRTStructureContours(rtStructureId: number, contours: InsertRTStructureContour[]): Promise<void>;
  deleteRTStructureContours(rtStructureId: number, slicePositions?: number[]): Promise<void>;
  
  // RT Structure History operations
  createRTStructureHistory(data: InsertRTStructureHistory): Promise<RTStructureHistory>;
  getRTStructureHistory(rtStructureSetId: number, options?: {
    startDate?: Date;
    endDate?: Date;
    actionTypes?: string[];
    structureIds?: number[];
    limit?: number;
    offset?: number;
  }): Promise<RTStructureHistory[]>;
  getRTStructureHistorySnapshot(historyId: number): Promise<RTStructureHistory | null>;
  
  // Registration operations (temporarily disabled for rebuild)
  createRegistration(data: InsertRegistration): Promise<Registration | null>;
  getRegistrationByStudyId(studyId: number): Promise<Registration | null>;
  deleteRegistrationByStudyId(studyId: number): Promise<void>;
  
  // Patient metadata editing
  updatePatientMetadata(patientId: number, metadata: Partial<InsertPatient>): Promise<Patient | null>;
  updateSeriesDescription(seriesId: number, description: string): Promise<Series | null>;
  
  // Patient tagging
  createPatientTag(data: InsertPatientTag): Promise<PatientTag | null>;
  getPatientTags(patientId: number): Promise<PatientTag[]>;
  deletePatientTag(tagId: number): Promise<boolean>;
  generateAnatomicalTags(patientId: number): Promise<PatientTag[]>;
  
  // Clear all data
  clearAll(): void;
}

export class MemStorage {
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
      patientId: (insertStudy as any).patientId ?? null,
      patientName: insertStudy.patientName || null,
      patientID: insertStudy.patientID || null,
      studyDate: insertStudy.studyDate || null,
      studyDescription: insertStudy.studyDescription || null,
      accessionNumber: insertStudy.accessionNumber || null,
      modality: (insertStudy as any).modality ?? null,
      numberOfSeries: (insertStudy as any).numberOfSeries ?? 0,
      numberOfImages: (insertStudy as any).numberOfImages ?? 0,
      isDemo: (insertStudy as any).isDemo ?? false,
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

  async relinkStudyToPatient(studyId: number, newPatientId: number): Promise<void> {
    const study = this.studies.get(studyId);
    if (study) {
      (study as any).patientId = newPatientId;
      this.studies.set(studyId, study);
    }
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

  async updateImageGeometry(imageId: number, updates: {
    imagePosition?: string | number[] | null;
    imageOrientation?: string | number[] | null;
    pixelSpacing?: string | number[] | null;
    metadata?: any;
  }): Promise<void> {
    const img = this.images.get(imageId);
    if (!img) return;
    const next: any = { ...img };
    if (updates.imagePosition !== undefined) next.imagePosition = updates.imagePosition as any;
    if (updates.imageOrientation !== undefined) next.imageOrientation = updates.imageOrientation as any;
    if (updates.pixelSpacing !== undefined) next.pixelSpacing = updates.pixelSpacing as any;
    if (updates.metadata !== undefined) next.metadata = updates.metadata as any;
    this.images.set(imageId, next);
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

  async deletePatient(id: number): Promise<void> {
    await db.delete(patients).where(eq(patients.id, id));
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

  async getStudiesByPatient(patientId: string | number): Promise<Study[]> {
    // If patientId is a string, it's a DICOM patient ID - convert to database ID
    if (typeof patientId === 'string') {
      const patient = await this.getPatientByID(patientId);
      if (!patient) {
        console.log(`No patient found with DICOM ID: ${patientId}`);
        return [];
      }
      return await db.select().from(studies).where(eq(studies.patientId, patient.id)).orderBy(desc(studies.createdAt));
    }
    
    // If patientId is a number, use it directly as database ID
    return await db.select().from(studies).where(eq(studies.patientId, patientId)).orderBy(desc(studies.createdAt));
  }

  async relinkStudyToPatient(studyId: number, newPatientId: number): Promise<void> {
    await db
      .update(studies)
      .set({ patientId: newPatientId })
      .where(eq(studies.id, studyId));
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

  async updateImageGeometry(imageId: number, updates: {
    imagePosition?: string | number[] | null;
    imageOrientation?: string | number[] | null;
    pixelSpacing?: string | number[] | null;
    metadata?: any;
  }): Promise<void> {
    const toDbVal = (v: any) => v === undefined ? undefined : v;
    await db
      .update(images)
      .set({
        imagePosition: toDbVal(updates.imagePosition) as any,
        imageOrientation: toDbVal(updates.imageOrientation) as any,
        pixelSpacing: toDbVal(updates.pixelSpacing) as any,
        metadata: toDbVal(updates.metadata) as any,
      })
      .where(eq(images.id, imageId));
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
  
  async getAllSeries(): Promise<Series[]> {
    return await db
      .select()
      .from(series)
      .orderBy(series.studyId, series.seriesNumber);
  }

  // RT Structure operations
  async updateRTStructureName(structureId: number, name: string): Promise<void> {
    const existing = rtStructureModifications.get(structureId) || {};
    rtStructureModifications.set(structureId, { ...existing, structureName: name });
    console.log(`Updated RT structure ${structureId} name to: ${name}`);
  }

  async updateRTStructureColor(structureId: number, color: number[]): Promise<void> {
    const existing = rtStructureModifications.get(structureId) || {};
    rtStructureModifications.set(structureId, { ...existing, color });
    console.log(`Updated RT structure ${structureId} color to: ${color}`);
  }

  // Registration operations (re-enabled as cache persistence for REG parsing)
  async createRegistration(data: InsertRegistration): Promise<Registration | null> {
    try {
      const normalized: any = { ...data };
      if (normalized && typeof normalized.transformationMatrix !== 'string') {
        try {
          normalized.transformationMatrix = JSON.stringify(normalized.transformationMatrix);
        } catch (_) {
          normalized.transformationMatrix = JSON.stringify([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ]);
        }
      }
      if (normalized && normalized.metadata && typeof normalized.metadata !== 'string') {
        try { normalized.metadata = JSON.stringify(normalized.metadata); } catch { normalized.metadata = JSON.stringify({}); }
      }
      const [registration] = await db.insert(registrations).values(normalized).returning();
      return registration;
    } catch (error) {
      console.error('Error creating registration:', error);
      return null;
    }
  }

  async getRegistrationByStudyId(studyId: number): Promise<Registration | null> {
    try {
      const [registration] = await db.select().from(registrations).where(eq(registrations.studyId, studyId));
      return registration || null;
    } catch (error) {
      console.error('Error getting registration:', error);
      return null;
    }
  }

  async deleteRegistrationByStudyId(studyId: number): Promise<void> {
    try {
      await db.delete(registrations).where(eq(registrations.studyId, studyId));
    } catch (error) {
      console.error('Error deleting registration:', error);
      throw error;
    }
  }

  // Patient metadata editing
  async updatePatientMetadata(patientId: number, metadata: Partial<InsertPatient>): Promise<Patient | null> {
    try {
      const [updated] = await db
        .update(patients)
        .set(metadata)
        .where(eq(patients.id, patientId))
        .returning();
      return updated || null;
    } catch (error) {
      console.error('Error updating patient metadata:', error);
      return null;
    }
  }

  async updateSeriesDescription(seriesId: number, description: string): Promise<Series | null> {
    try {
      const [updated] = await db
        .update(series)
        .set({ seriesDescription: description })
        .where(eq(series.id, seriesId))
        .returning();
      return updated || null;
    } catch (error) {
      console.error('Error updating series description:', error);
      return null;
    }
  }

  // Patient tagging
  async createPatientTag(data: InsertPatientTag): Promise<PatientTag | null> {
    try {
      const [tag] = await db.insert(patientTags).values(data).returning();
      return tag;
    } catch (error) {
      console.error('Error creating patient tag:', error);
      return null;
    }
  }

  async getPatientTags(patientId: number): Promise<PatientTag[]> {
    try {
      return await db.select().from(patientTags).where(eq(patientTags.patientId, patientId));
    } catch (error) {
      console.error('Error getting patient tags:', error);
      return [];
    }
  }

  async deletePatientTag(tagId: number): Promise<boolean> {
    try {
      await db.delete(patientTags).where(eq(patientTags.id, tagId));
      return true;
    } catch (error) {
      console.error('Error deleting patient tag:', error);
      return false;
    }
  }

  async generateAnatomicalTags(patientId: number): Promise<PatientTag[]> {
    try {
      // Get all studies for this patient
      const patientStudies = await this.getStudiesByPatient(patientId);
      const tags: PatientTag[] = [];
      const createdTags: PatientTag[] = [];
      
      // For each study, check series for RT structures and determine anatomical sites
      for (const study of patientStudies) {
        const studySeries = await this.getSeriesByStudyId(study.id);
        const rtStructures = studySeries.filter(s => s.modality === 'RTSTRUCT');
        
        // Analyze RT structures to determine anatomical sites
        const anatomicalSites = new Set<string>();
        
        // Common anatomical mapping based on structure names
        const anatomicalMapping: Record<string, string> = {
          'BRAIN': 'Head & Neck',
          'BRAINSTEM': 'Head & Neck',
          'CHIASM': 'Head & Neck',
          'GLOBE': 'Head & Neck',
          'LENS': 'Head & Neck',
          'OPTIC': 'Head & Neck',
          'PAROTID': 'Head & Neck',
          'MANDIBLE': 'Head & Neck',
          'LARYNX': 'Head & Neck',
          'CTVNECK': 'Head & Neck',
          'LUNG': 'Thorax',
          'HEART': 'Thorax',
          'ESOPHAGUS': 'Thorax',
          'LIVER': 'Abdomen',
          'KIDNEY': 'Abdomen',
          'BOWEL': 'Abdomen',
          'BLADDER': 'Pelvis',
          'RECTUM': 'Pelvis',
          'FEMUR': 'Pelvis'
        };
        
        // For now, we'll check if it's head & neck based on common structures
        if (rtStructures.length > 0) {
          anatomicalSites.add('Head & Neck'); // Default for HN-ATLAS dataset
        }
        
        // Check for fusion capability
        const hasCT = studySeries.some(s => s.modality === 'CT');
        const hasMRI = studySeries.some(s => s.modality === 'MR');
        const hasRegistration = null;
        if (hasCT && hasMRI && hasRegistration) {
          const fusionTag = await this.createPatientTag({
            patientId,
            tagType: 'fusion',
            tagValue: 'CT/MRI Fusion Ready',
            color: '#9333ea' // Purple
          });
          if (fusionTag) createdTags.push(fusionTag);
        }
        
        // Add anatomical tags
        for (const site of Array.from(anatomicalSites)) {
          const anatomicalTag = await this.createPatientTag({
            patientId,
            tagType: 'anatomical',
            tagValue: site,
            color: '#10b981' // Green
          });
          if (anatomicalTag) createdTags.push(anatomicalTag);
        }
      }
      
      return createdTags;
    } catch (error) {
      console.error('Error generating anatomical tags:', error);
      return [];
    }
  }

  // RT Structure Set operations
  async createRTStructureSet(data: InsertRTStructureSet): Promise<RTStructureSet> {
    const [result] = await db.insert(rtStructureSets).values(data).returning();
    return result;
  }

  async getRTStructureSet(id: number): Promise<RTStructureSet | null> {
    const [result] = await db.select().from(rtStructureSets).where(eq(rtStructureSets.id, id));
    return result || null;
  }

  async getRTStructureSetsForPatient(patientId: number): Promise<RTStructureSet[]> {
    // First get all studies for the patient
    const patientStudies = await db
      .select({ id: studies.id })
      .from(studies)
      .where(eq(studies.patientId, patientId));
    
    if (patientStudies.length === 0) return [];
    
    const studyIds = patientStudies.map((s: { id: number }) => s.id);
    
    // Get all RT structure sets for those studies
    const result = await db
      .select()
      .from(rtStructureSets)
      .where(eq(rtStructureSets.studyId, studyIds[0])); // TODO: Handle multiple studies
    
    return result;
  }

  async getRTStructureSetBySeriesId(seriesId: number): Promise<RTStructureSet | null> {
    const [result] = await db
      .select()
      .from(rtStructureSets)
      .where(eq(rtStructureSets.seriesId, seriesId));
    return result || null;
  }

  async updateRTStructureSet(id: number, data: Partial<RTStructureSet>): Promise<void> {
    await db
      .update(rtStructureSets)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rtStructureSets.id, id));
  }

  // RT Structure operations
  async createRTStructure(data: InsertRTStructure): Promise<RTStructure> {
    const [result] = await db.insert(rtStructures).values(data).returning();
    return result;
  }

  async getRTStructuresBySetId(rtStructureSetId: number): Promise<RTStructure[]> {
    return await db
      .select()
      .from(rtStructures)
      .where(eq(rtStructures.rtStructureSetId, rtStructureSetId));
  }

  async updateRTStructure(id: number, data: Partial<RTStructure>): Promise<void> {
    await db.update(rtStructures).set(data).where(eq(rtStructures.id, id));
  }

  async deleteRTStructure(id: number): Promise<void> {
    // First delete all contours for this structure
    await db.delete(rtStructureContours).where(eq(rtStructureContours.rtStructureId, id));
    // Then delete the structure itself
    await db.delete(rtStructures).where(eq(rtStructures.id, id));
  }

  // RT Structure Contour operations
  async createRTStructureContours(data: InsertRTStructureContour[]): Promise<void> {
    if (data.length === 0) return;
    await db.insert(rtStructureContours).values(data);
  }

  async getRTStructureContours(rtStructureId: number): Promise<RTStructureContour[]> {
    return await db
      .select()
      .from(rtStructureContours)
      .where(eq(rtStructureContours.rtStructureId, rtStructureId));
  }

  async updateRTStructureContours(rtStructureId: number, contours: InsertRTStructureContour[]): Promise<void> {
    // Delete existing contours
    await db.delete(rtStructureContours).where(eq(rtStructureContours.rtStructureId, rtStructureId));
    // Insert new contours
    if (contours.length > 0) {
      await db.insert(rtStructureContours).values(contours);
    }
  }

  async deleteRTStructureContours(rtStructureId: number, slicePositions?: number[]): Promise<void> {
    if (slicePositions && slicePositions.length > 0) {
      // Delete specific slice positions
      // Note: This would need a more complex query with OR conditions
      for (const pos of slicePositions) {
        await db
          .delete(rtStructureContours)
          .where(
            eq(rtStructureContours.rtStructureId, rtStructureId) &&
            eq(rtStructureContours.slicePosition, pos)
          );
      }
    } else {
      // Delete all contours for this structure
      await db.delete(rtStructureContours).where(eq(rtStructureContours.rtStructureId, rtStructureId));
    }
  }

  // RT Structure History operations
  async createRTStructureHistory(data: InsertRTStructureHistory): Promise<RTStructureHistory> {
    const [result] = await db.insert(rtStructureHistory).values(data).returning();
    return result;
  }

  async getRTStructureHistory(
    rtStructureSetId: number,
    options?: {
      startDate?: Date;
      endDate?: Date;
      actionTypes?: string[];
      structureIds?: number[];
      limit?: number;
      offset?: number;
    }
  ): Promise<RTStructureHistory[]> {
    let query = db
      .select()
      .from(rtStructureHistory)
      .where(eq(rtStructureHistory.rtStructureSetId, rtStructureSetId))
      .orderBy(desc(rtStructureHistory.timestamp));

    // TODO: Add filtering by date range, action types, and structure IDs
    
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    
    if (options?.offset) {
      query = query.offset(options.offset);
    }

    return await query;
  }

  async getRTStructureHistorySnapshot(historyId: number): Promise<RTStructureHistory | null> {
    const [result] = await db
      .select()
      .from(rtStructureHistory)
      .where(eq(rtStructureHistory.id, historyId));
    return result || null;
  }

  clearAll(): void {
    // This would be implemented as database truncation
    throw new Error('Database clearAll not implemented - use proper migration tools');
  }
}

export const storage = new DatabaseStorage();
