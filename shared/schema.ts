import { pgTable, text, serial, integer, timestamp, jsonb, boolean, doublePrecision, index, uniqueIndex } from "drizzle-orm/pg-core";
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
  sliceThicknessMm: doublePrecision("slice_thickness_mm"),
  spacingBetweenSlicesMm: doublePrecision("spacing_between_slices_mm"),
  frameOfReferenceUid: text("frame_of_reference_uid"),
  acquisitionDateTime: timestamp("acquisition_datetime"),
  rows: integer("rows"),
  columns: integer("columns"),
  pixelSpacing: jsonb("pixel_spacing"),
  imageOrientationPatient: jsonb("image_orientation_patient"),
  imagePositionPatientFirst: jsonb("image_position_patient_first"),
  imagePositionPatientLast: jsonb("image_position_patient_last"),
  isDerived: boolean("is_derived").default(false),
  derivedFromSeriesId: integer("derived_from_series_id").references(() => series.id),
  derivationDescription: text("derivation_description"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  frameOfReferenceIdx: index("series_frame_of_reference_idx").on(table.frameOfReferenceUid),
  studyModalityIdx: index("series_study_modality_idx").on(table.studyId, table.modality),
  derivedFromIdx: index("series_derived_from_idx").on(table.derivedFromSeriesId),
}));

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
  frameOfReferenceUid: text("frame_of_reference_uid"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  seriesInstanceIdx: index("images_series_instance_idx").on(table.seriesId, table.instanceNumber),
  imageForIdx: index("images_frame_of_reference_idx").on(table.frameOfReferenceUid),
}));

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

export type Patient = typeof patients.$inferSelect;
export type Study = typeof studies.$inferSelect;
export type Series = typeof series.$inferSelect;
export type DicomImage = typeof images.$inferSelect;
export type MediaPreview = typeof mediaPreviews.$inferSelect;
export type InsertPatient = typeof patients.$inferInsert;
export type InsertStudy = typeof studies.$inferInsert;
export type InsertSeries = typeof series.$inferInsert;
export type InsertImage = typeof images.$inferInsert;
export type InsertMediaPreview = typeof mediaPreviews.$inferInsert;

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

export type PacsConnection = typeof pacsConnections.$inferSelect;
export type NetworkQuery = typeof networkQueries.$inferSelect;
export type InsertPacsConnection = typeof pacsConnections.$inferInsert;
export type InsertNetworkQuery = typeof networkQueries.$inferInsert;

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

export const fuseboxRuns = pgTable("fusebox_runs", {
  id: serial("id").primaryKey(),
  primarySeriesId: integer("primary_series_id").references(() => series.id).notNull(),
  secondarySeriesId: integer("secondary_series_id").references(() => series.id).notNull(),
  registrationId: text("registration_id"),
  transformSource: text("transform_source"),
  status: text("status").notNull().default('pending'),
  error: text("error"),
  outputDirectory: text("output_directory"),
  manifestPath: text("manifest_path"),
  sliceCount: integer("slice_count"),
  rows: integer("rows"),
  columns: integer("columns"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
export type InsertRTStructureSet = typeof rtStructureSets.$inferInsert;
export type RTStructureSet = typeof rtStructureSets.$inferSelect;

export type InsertRTStructure = typeof rtStructures.$inferInsert;
export type RTStructure = typeof rtStructures.$inferSelect;

export type InsertRTStructureContour = typeof rtStructureContours.$inferInsert;
export type RTStructureContour = typeof rtStructureContours.$inferSelect;

export type InsertRTStructureHistory = typeof rtStructureHistory.$inferInsert;
export type RTStructureHistory = typeof rtStructureHistory.$inferSelect;

export type Registration = typeof registrations.$inferSelect;
export type InsertRegistration = typeof registrations.$inferInsert;

export type FuseboxRun = typeof fuseboxRuns.$inferSelect;
export type InsertFuseboxRun = typeof fuseboxRuns.$inferInsert;

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
export const SlicingMode = {
  I: 'I', // Sagittal
  J: 'J', // Coronal  
  K: 'K'  // Axial
} as const;

// Brush operation types
export const BrushOperation = {
  ADDITIVE: 'ADDITIVE',
  SUBTRACTIVE: 'SUBTRACTIVE'
} as const;

// Commit status tracking
export const CommitStatus = {
  SOURCE: 'SOURCE',
  COMMITTED: 'COMMITTED',
  STAGED: 'STAGED'
} as const;

export type SlicingMode = typeof SlicingMode[keyof typeof SlicingMode];
export type BrushOperation = typeof BrushOperation[keyof typeof BrushOperation];
export type CommitStatus = typeof CommitStatus[keyof typeof CommitStatus];

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

export type PatientTag = typeof patientTags.$inferSelect;
export type InsertPatientTag = typeof patientTags.$inferInsert;

// New fusion relationship tables
export const frameOfReferenceGroups = pgTable("frame_of_reference_groups", {
  id: serial("id").primaryKey(),
  frameOfReferenceUid: text("frame_of_reference_uid").notNull().unique(),
  studyId: integer("study_id").references(() => studies.id),
  coordinateSystemDescription: text("coordinate_system_description"),
  spatialResolutionMm: doublePrecision("spatial_resolution_mm"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  frameOfReferenceUidIdx: uniqueIndex("for_groups_uid_idx").on(table.frameOfReferenceUid),
}));

export const seriesRegistrationRelationships = pgTable("series_registration_relationships", {
  id: serial("id").primaryKey(),
  primarySeriesId: integer("primary_series_id").references(() => series.id).notNull(),
  secondarySeriesId: integer("secondary_series_id").references(() => series.id).notNull(),
  registrationId: integer("registration_id").references(() => registrations.id),
  registrationFilePath: text("registration_file_path"),
  transformMatrix: jsonb("transform_matrix"),
  inverseTransformMatrix: jsonb("inverse_transform_matrix"),
  transformHash: text("transform_hash"),
  relationshipType: text("relationship_type").notNull(),
  confidenceScore: doublePrecision("confidence_score"),
  registrationMethod: text("registration_method"),
  geometricValidationPassed: boolean("geometric_validation_passed").default(false),
  validationMetrics: jsonb("validation_metrics"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  seriesRegPairIdx: uniqueIndex("series_reg_relationship_pair_idx").on(table.primarySeriesId, table.secondarySeriesId),
  seriesRegPrimaryIdx: index("series_reg_primary_idx").on(table.primarySeriesId),
  seriesRegSecondaryIdx: index("series_reg_secondary_idx").on(table.secondarySeriesId),
}));

export const planningSeriesDesignations = pgTable("planning_series_designations", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").references(() => studies.id).notNull(),
  seriesId: integer("series_id").references(() => series.id).notNull(),
  designationType: text("designation_type").notNull(),
  confidenceScore: doublePrecision("confidence_score"),
  designationReason: jsonb("designation_reason"),
  algorithmVersion: text("algorithm_version").default("1.0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  planningDesignationUnique: uniqueIndex("planning_designation_study_type_idx").on(table.studyId, table.designationType),
}));

export const seriesFusionCapabilities = pgTable("series_fusion_capabilities", {
  id: serial("id").primaryKey(),
  primarySeriesId: integer("primary_series_id").references(() => series.id).notNull(),
  secondarySeriesId: integer("secondary_series_id").references(() => series.id).notNull(),
  canFuse: boolean("can_fuse").notNull(),
  fusionMethod: text("fusion_method"),
  confidenceScore: doublePrecision("confidence_score"),
  validationStatus: text("validation_status"),
  validationNotes: text("validation_notes"),
  lastValidated: timestamp("last_validated").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  fusionCapabilityPairIdx: uniqueIndex("fusion_capability_pair_idx").on(table.primarySeriesId, table.secondarySeriesId),
  fusionPrimaryIdx: index("fusion_capability_primary_idx").on(table.primarySeriesId),
}));

export type FrameOfReferenceGroup = typeof frameOfReferenceGroups.$inferSelect;
export type InsertFrameOfReferenceGroup = typeof frameOfReferenceGroups.$inferInsert;
export type SeriesRegistrationRelationship = typeof seriesRegistrationRelationships.$inferSelect;
export type InsertSeriesRegistrationRelationship = typeof seriesRegistrationRelationships.$inferInsert;
export type PlanningSeriesDesignation = typeof planningSeriesDesignations.$inferSelect;
export type InsertPlanningSeriesDesignation = typeof planningSeriesDesignations.$inferInsert;
export type SeriesFusionCapability = typeof seriesFusionCapabilities.$inferSelect;
export type InsertSeriesFusionCapability = typeof seriesFusionCapabilities.$inferInsert;
