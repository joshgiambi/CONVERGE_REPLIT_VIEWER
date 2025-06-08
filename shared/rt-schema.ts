import { pgTable, serial, text, integer, real, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// RT Structure Set table
export const rtStructureSets = pgTable('rt_structure_sets', {
  id: serial('id').primaryKey(),
  studyId: integer('study_id').notNull(),
  seriesInstanceUID: text('series_instance_uid').notNull().unique(),
  structureSetInstanceUID: text('structure_set_instance_uid').notNull().unique(),
  structureSetLabel: text('structure_set_label'),
  structureSetName: text('structure_set_name'),
  structureSetDescription: text('structure_set_description'),
  structureSetDate: text('structure_set_date'),
  structureSetTime: text('structure_set_time'),
  referencedFrameOfReferenceUID: text('referenced_frame_of_reference_uid'),
  manufacturerModelName: text('manufacturer_model_name'),
  softwareVersion: text('software_version'),
  createdAt: timestamp('created_at').defaultNow(),
});

// RT Structure table (individual contours/organs)
export const rtStructures = pgTable('rt_structures', {
  id: serial('id').primaryKey(),
  structureSetId: integer('structure_set_id').notNull(),
  roiNumber: integer('roi_number').notNull(),
  roiName: text('roi_name').notNull(),
  roiDescription: text('roi_description'),
  roiType: text('roi_type'), // ORGAN, PTV, CTV, GTV, OAR, etc.
  roiInterpretedType: text('roi_interpreted_type'),
  roiColor: text('roi_color'), // RGB color as hex string
  roiVolume: real('roi_volume'),
  roiGenerationAlgorithm: text('roi_generation_algorithm'),
  materialId: text('material_id'),
  density: real('density'),
  isVisible: boolean('is_visible').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// RT Contour Sequence (slice-by-slice contours)
export const rtContours = pgTable('rt_contours', {
  id: serial('id').primaryKey(),
  structureId: integer('structure_id').notNull(),
  contourNumber: integer('contour_number').notNull(),
  contourGeometricType: text('contour_geometric_type'), // CLOSED_PLANAR, POINT, etc.
  numberOfContourPoints: integer('number_of_contour_points'),
  contourData: jsonb('contour_data').notNull(), // Array of [x,y,z] coordinates
  referencedSOPInstanceUID: text('referenced_sop_instance_uid'),
  sliceLocation: real('slice_location'),
  imagePosition: jsonb('image_position'), // [x,y,z] of image position
  createdAt: timestamp('created_at').defaultNow(),
});

// Relations
export const rtStructureSetsRelations = relations(rtStructureSets, ({ many }) => ({
  structures: many(rtStructures),
}));

export const rtStructuresRelations = relations(rtStructures, ({ one, many }) => ({
  structureSet: one(rtStructureSets, {
    fields: [rtStructures.structureSetId],
    references: [rtStructureSets.id],
  }),
  contours: many(rtContours),
}));

export const rtContoursRelations = relations(rtContours, ({ one }) => ({
  structure: one(rtStructures, {
    fields: [rtContours.structureId],
    references: [rtStructures.id],
  }),
}));

// Zod schemas
export const insertRTStructureSetSchema = createInsertSchema(rtStructureSets).omit({
  id: true,
  createdAt: true,
});

export const insertRTStructureSchema = createInsertSchema(rtStructures).omit({
  id: true,
  createdAt: true,
});

export const insertRTContourSchema = createInsertSchema(rtContours).omit({
  id: true,
  createdAt: true,
});

// Types
export type RTStructureSet = typeof rtStructureSets.$inferSelect;
export type RTStructure = typeof rtStructures.$inferSelect;
export type RTContour = typeof rtContours.$inferSelect;
export type InsertRTStructureSet = z.infer<typeof insertRTStructureSetSchema>;
export type InsertRTStructure = z.infer<typeof insertRTStructureSchema>;
export type InsertRTContour = z.infer<typeof insertRTContourSchema>;

// RT Structure types for medical use
export const RTStructureTypes = {
  ORGAN: 'ORGAN',
  PTV: 'PTV', // Planning Target Volume
  CTV: 'CTV', // Clinical Target Volume
  GTV: 'GTV', // Gross Target Volume
  OAR: 'OAR', // Organ at Risk
  PRV: 'PRV', // Planning Risk Volume
  TREATED_VOLUME: 'TREATED_VOLUME',
  IRRADIATED_VOLUME: 'IRRADIATED_VOLUME',
  BOLUS: 'BOLUS',
  AVOIDANCE: 'AVOIDANCE',
  CAVITY: 'CAVITY',
  CONTRAST_AGENT: 'CONTRAST_AGENT',
  DOSE_REGION: 'DOSE_REGION',
  MARKER: 'MARKER',
  REGISTRATION: 'REGISTRATION',
  ISOCENTER: 'ISOCENTER',
  FIXATION: 'FIXATION',
  SUPPORT: 'SUPPORT',
} as const;

export type RTStructureType = keyof typeof RTStructureTypes;