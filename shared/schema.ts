import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const studies = pgTable("studies", {
  id: serial("id").primaryKey(),
  studyInstanceUID: text("study_instance_uid").notNull().unique(),
  patientName: text("patient_name"),
  patientID: text("patient_id"),
  studyDate: text("study_date"),
  studyDescription: text("study_description"),
  accessionNumber: text("accession_number"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export type Study = typeof studies.$inferSelect;
export type Series = typeof series.$inferSelect;
export type DicomImage = typeof images.$inferSelect;
export type InsertStudy = z.infer<typeof insertStudySchema>;
export type InsertSeries = z.infer<typeof insertSeriesSchema>;
export type InsertImage = z.infer<typeof insertImageSchema>;
