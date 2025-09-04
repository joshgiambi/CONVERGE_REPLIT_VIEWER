import { pgTable, text, serial, integer, timestamp, jsonb, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";
import { z } from "zod";

export const patients = pgTable("patients", {
  id: serial("id").primaryKey(),
  patientID: text("patient_id").notNull().unique(),
  patientName: text("patient_name").notNull(),
  patientSex: text("patient_sex"),
  patientAge: text("patient_age"),
  dateOfBirth: text("date_of_birth"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const studies = pgTable("studies", {
  id: serial("id").primaryKey(),
  studyInstanceUID: text("study_instance_uid").notNull().unique(),
  patientId: integer("patient_id"),
  patientName: text("patient_name"),
  patientID: text("patient_id_dicom"),
  studyDate: text("study_date"),
  studyDescription: text("study_description"),
  accessionNumber: text("accession_number"),
  modality: text("modality"),
  numberOfSeries: integer("number_of_series").default(0),
  numberOfImages: integer("number_of_images").default(0),
  isDemo: boolean("is_demo").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const patientsRelations = relations(patients, ({ many }) => ({
  studies: many(studies),
}));

export const studiesRelations = relations(studies, ({ one, many }) => ({
  patient: one(patients, {
    fields: [studies.patientId],
    references: [patients.id],
  }),
  series: many(series),
}));

export const series = pgTable("series", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").references(() => studies.id).notNull(),
  seriesInstanceUID: text("series_instance_uid").notNull().unique(),
  seriesDescription: text("series_description"),
  modality: text("modality").notNull(),
  seriesNumber: integer("series_number"),
  imageCount: integer("image_count").default(0),
  sliceThickness: text("slice_thickness"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const images = pgTable("images", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").references(() => series.id).notNull(),
  sopInstanceUID: text("sop_instance_uid").notNull().unique(),
  instanceNumber: integer("instance_number"),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  imagePosition: jsonb("image_position"),
  imageOrientation: jsonb("image_orientation"),
  pixelSpacing: jsonb("pixel_spacing"),
  sliceLocation: text("slice_location"),
  windowCenter: text("window_center"),
  windowWidth: text("window_width"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Media preview storage for thumbnails and movies
export const mediaPreviews = pgTable("media_previews", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").references(() => series.id).notNull(),
  type: text("type").notNull(), // 'thumbnail' or 'movie'
  format: text("format").notNull(), // 'png', 'jpg', 'mp4', 'gif'
  filePath: text("file_path").notNull(),
  url: text("url"), // For cloud storage URLs
  width: integer("width"),
  height: integer("height"),
  frameCount: integer("frame_count"), // For movies
  fileSize: integer("file_size"),
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  error: text("error"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const seriesRelations = relations(series, ({ one, many }) => ({
  study: one(studies, {
    fields: [series.studyId],
    references: [studies.id],
  }),
  images: many(images),
  mediaPreviews: many(mediaPreviews),
}));

export const mediaPreviewsRelations = relations(mediaPreviews, ({ one }) => ({
  series: one(series, {
    fields: [mediaPreviews.seriesId],
    references: [series.id],
  }),
}));

export const imagesRelations = relations(images, ({ one }) => ({
  series: one(series, {
    fields: [images.seriesId],
    references: [series.id],
  }),
}));

export const insertPatientSchema = createInsertSchema(patients).omit({
  id: true,
  createdAt: true,
});

export const insertStudySchema = createInsertSchema(studies).omit({
  id: true,
  createdAt: true,
});

export const insertSeriesSchema = createInsertSchema(series).omit({
  id: true,
  createdAt: true,
});

export const insertImageSchema = createInsertSchema(images).omit({
  id: true,
  createdAt: true,
});

export const insertMediaPreviewSchema = createInsertSchema(mediaPreviews).omit({
  id: true,
  createdAt: true,
  processedAt: true,
});

export type Patient = typeof patients.$inferSelect;
export type Study = typeof studies.$inferSelect;
export type Series = typeof series.$inferSelect;
export type DicomImage = typeof images.$inferSelect;
export type MediaPreview = typeof mediaPreviews.$inferSelect;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type InsertStudy = z.infer<typeof insertStudySchema>;
export type InsertSeries = z.infer<typeof insertSeriesSchema>;
export type InsertImage = z.infer<typeof insertImageSchema>;
export type InsertMediaPreview = z.infer<typeof insertMediaPreviewSchema>;

// DICOM Network Configuration
export const pacsConnections = pgTable("pacs_connections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  aeTitle: text("ae_title").notNull(),
  hostname: text("hostname").notNull(),
  port: integer("port").notNull(),
  callingAeTitle: text("calling_ae_title").notNull().default("DICOM_VIEWER"),
  protocol: text("protocol").notNull().default("DICOM"), // DICOM or DICOMweb
  wadoUri: text("wado_uri"), // For DICOMweb
  qidoUri: text("qido_uri"), // For DICOMweb queries
  stowUri: text("stow_uri"), // For DICOMweb storage
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const networkQueries = pgTable("network_queries", {
  id: serial("id").primaryKey(),
  pacsId: integer("pacs_id").references(() => pacsConnections.id),
  queryType: text("query_type").notNull(), // C-FIND, QIDO-RS
  patientName: text("patient_name"),
  patientID: text("patient_id"),
  studyDate: text("study_date"),
  studyDescription: text("study_description"),
  accessionNumber: text("accession_number"),
  modality: text("modality"),
  status: text("status").notNull().default("pending"), // pending, completed, failed
  resultCount: integer("result_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPacsConnectionSchema = createInsertSchema(pacsConnections).omit({
  id: true,
  createdAt: true,
});

export const insertNetworkQuerySchema = createInsertSchema(networkQueries).omit({
  id: true,
  createdAt: true,
});

export type PacsConnection = typeof pacsConnections.$inferSelect;
export type NetworkQuery = typeof networkQueries.$inferSelect;
export type InsertPacsConnection = z.infer<typeof insertPacsConnectionSchema>;
export type InsertNetworkQuery = z.infer<typeof insertNetworkQuerySchema>;

// Registration table for DICOM registration transformation matrices
export const registrations = pgTable("registrations", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").references(() => studies.id),
  seriesInstanceUID: text("series_instance_uid"),
  sopInstanceUID: text("sop_instance_uid"),
  sourceFrameOfReferenceUID: text("source_frame_of_reference_uid"),
  targetFrameOfReferenceUID: text("target_frame_of_reference_uid"),
  transformationMatrix: text("transformation_matrix"), // JSON array of 16 numbers for 4x4 matrix
  matrixType: text("matrix_type"), // e.g., 'RIGID'
  metadata: text("metadata"), // Additional metadata as JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// RT Structure Set table to store metadata and associations
export const rtStructureSets = pgTable("rt_structure_sets", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").references(() => series.id),
  studyId: integer("study_id").references(() => studies.id),
  referencedSeriesId: integer("referenced_series_id").references(() => series.id), // The CT/MRI series this RT struct is based on
  frameOfReferenceUID: text("frame_of_reference_uid"),
  structureSetLabel: text("structure_set_label").default(""),
  structureSetDate: text("structure_set_date").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Individual structures within an RT structure set
export const rtStructures = pgTable("rt_structures", {
  id: serial("id").primaryKey(),
  rtStructureSetId: integer("rt_structure_set_id").references(() => rtStructureSets.id),
  roiNumber: integer("roi_number"),
  structureName: text("structure_name"),
  color: integer("color").array(), // RGB values
  isVisible: boolean("is_visible").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Contour data for each structure
export const rtStructureContours = pgTable("rt_structure_contours", {
  id: serial("id").primaryKey(),
  rtStructureId: integer("rt_structure_id").references(() => rtStructures.id),
  slicePosition: doublePrecision("slice_position"),
  points: doublePrecision("points").array(), // Flattened array of x,y,z coordinates
  isPredicted: boolean("is_predicted").default(false),
  predictionConfidence: doublePrecision("prediction_confidence"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// RT structure history for time machine feature
export const rtStructureHistory = pgTable("rt_structure_history", {
  id: serial("id").primaryKey(),
  rtStructureSetId: integer("rt_structure_set_id").references(() => rtStructureSets.id),
  userId: integer("user_id"), // For future user tracking
  actionType: text("action_type"), // 'create', 'update', 'delete', 'brush', 'grow', 'boolean_op', etc.
  actionDetails: text("action_details"), // JSON string with detailed information
  affectedStructureIds: integer("affected_structure_ids").array(),
  snapshot: text("snapshot"), // JSON string with complete state snapshot
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// Type definitions for RT structures
export const insertRTStructureSetSchema = createInsertSchema(rtStructureSets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRTStructureSet = z.infer<typeof insertRTStructureSetSchema>;
export type RTStructureSet = typeof rtStructureSets.$inferSelect;

export const insertRTStructureSchema = createInsertSchema(rtStructures).omit({
  id: true,
  createdAt: true,
});
export type InsertRTStructure = z.infer<typeof insertRTStructureSchema>;
export type RTStructure = typeof rtStructures.$inferSelect;

export const insertRTStructureContourSchema = createInsertSchema(rtStructureContours).omit({
  id: true,
  createdAt: true,
});
export type InsertRTStructureContour = z.infer<typeof insertRTStructureContourSchema>;
export type RTStructureContour = typeof rtStructureContours.$inferSelect;

export const insertRTStructureHistorySchema = createInsertSchema(rtStructureHistory).omit({
  id: true,
  timestamp: true,
});
export type InsertRTStructureHistory = z.infer<typeof insertRTStructureHistorySchema>;
export type RTStructureHistory = typeof rtStructureHistory.$inferSelect;

export const insertRegistrationSchema = createInsertSchema(registrations).omit({
  id: true,
  createdAt: true,
});

export type Registration = typeof registrations.$inferSelect;
export type InsertRegistration = z.infer<typeof insertRegistrationSchema>;

// V2 Professional Contour System - Medical Grade Types
export interface Point {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface DisplayPoint {
  x: number;
  y: number;
}

// Polygon structures for medical-grade precision
export type PolygonRing = Point[];
export type Polygon = PolygonRing[];
export type MultiPolygon = Polygon[];
export type StructurePolygons = Map<number, MultiPolygon>;

// Professional contour data structure
export interface ContourData {
  id: string;
  slicePosition: number;
  slicingMode: SlicingMode;
  polygons: MultiPolygon;
  metadata: {
    sourceTime: number;
    modifiedTime: number;
    commitTime: number;
  };
}

// Structure data with complete medical integration
export interface StructureData {
  id: string;
  name: string;
  roiNumber: number;
  roiType: string;
  color: [number, number, number];
  contours: Map<number, ContourData>;
  metadata: {
    sourceTime: number;
    modifiedTime: number;
    commitTime: number;
  };
}

// Medical slicing modes
export enum SlicingMode {
  I = 'I', // Sagittal
  J = 'J', // Coronal  
  K = 'K'  // Axial
}

// Brush operation types
export enum BrushOperation {
  ADDITIVE = 'ADDITIVE',
  SUBTRACTIVE = 'SUBTRACTIVE'
}

// Commit status tracking
export enum CommitStatus {
  SOURCE = 'SOURCE',
  COMMITTED = 'COMMITTED',
  STAGED = 'STAGED'
}

// Professional DICOM metadata structure
export interface DICOMImageMetadata {
  imagePositionPatient: [number, number, number];
  imageOrientationPatient: [number, number, number, number, number, number];
  pixelSpacing: [number, number];
  rows: number;
  columns: number;
  sliceThickness: number;
  sliceLocation: number;
  sopInstanceUID: string;
  sopClassUID: string;
}

// Patient Tags for organizing by anatomical sites and registration
export const patientTags = pgTable("patient_tags", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  tagType: text("tag_type").notNull(), // 'anatomical', 'registration', 'fusion', 'custom'
  tagValue: text("tag_value").notNull(),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPatientTagSchema = createInsertSchema(patientTags).omit({
  id: true,
  createdAt: true,
});

export type PatientTag = typeof patientTags.$inferSelect;
export type InsertPatientTag = z.infer<typeof insertPatientTagSchema>;
