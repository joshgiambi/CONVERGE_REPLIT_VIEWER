import { studies, series, images, type Study, type Series, type DicomImage, type InsertStudy, type InsertSeries, type InsertImage } from "@shared/schema";

export interface IStorage {
  // Study operations
  createStudy(study: InsertStudy): Promise<Study>;
  getStudy(id: number): Promise<Study | undefined>;
  getStudyByUID(studyInstanceUID: string): Promise<Study | undefined>;
  getAllStudies(): Promise<Study[]>;

  // Series operations
  createSeries(series: InsertSeries): Promise<Series>;
  getSeries(id: number): Promise<Series | undefined>;
  getSeriesByUID(seriesInstanceUID: string): Promise<Series | undefined>;
  getSeriesByStudyId(studyId: number): Promise<Series[]>;

  // Image operations
  createImage(image: InsertImage): Promise<DicomImage>;
  getImage(id: number): Promise<DicomImage | undefined>;
  getImageByUID(sopInstanceUID: string): Promise<DicomImage | undefined>;
  getImagesBySeriesId(seriesId: number): Promise<DicomImage[]>;
  
  // Update operations
  updateSeriesImageCount(seriesId: number, count: number): Promise<void>;
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
      ...insertStudy,
      id,
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
      ...insertSeries,
      id,
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
      ...insertImage,
      id,
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
}

export const storage = new MemStorage();
