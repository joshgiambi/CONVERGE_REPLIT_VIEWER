import { pgTable, text, serial, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
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
  patientId: integer("patient_id").references(() => patients.id),
  patientName: text("patient_name"),
  patientID: text("patient_id"),
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

export const seriesRelations = relations(series, ({ one, many }) => ({
  study: one(studies, {
    fields: [series.studyId],
    references: [studies.id],
  }),
  images: many(images),
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

export type Patient = typeof patients.$inferSelect;
export type Study = typeof studies.$inferSelect;
export type Series = typeof series.$inferSelect;
export type DicomImage = typeof images.$inferSelect;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type InsertStudy = z.infer<typeof insertStudySchema>;
export type InsertSeries = z.infer<typeof insertSeriesSchema>;
export type InsertImage = z.infer<typeof insertImageSchema>;

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
