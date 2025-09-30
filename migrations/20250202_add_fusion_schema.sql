BEGIN;

ALTER TABLE series ADD COLUMN IF NOT EXISTS slice_thickness_mm double precision;
ALTER TABLE series ADD COLUMN IF NOT EXISTS spacing_between_slices_mm double precision;
ALTER TABLE series ADD COLUMN IF NOT EXISTS frame_of_reference_uid text;
ALTER TABLE series ADD COLUMN IF NOT EXISTS acquisition_datetime timestamp;
ALTER TABLE series ADD COLUMN IF NOT EXISTS rows integer;
ALTER TABLE series ADD COLUMN IF NOT EXISTS columns integer;
ALTER TABLE series ADD COLUMN IF NOT EXISTS pixel_spacing jsonb;
ALTER TABLE series ADD COLUMN IF NOT EXISTS image_orientation_patient jsonb;
ALTER TABLE series ADD COLUMN IF NOT EXISTS image_position_patient_first jsonb;
ALTER TABLE series ADD COLUMN IF NOT EXISTS image_position_patient_last jsonb;
ALTER TABLE series ADD COLUMN IF NOT EXISTS is_derived boolean DEFAULT false;
ALTER TABLE series ADD COLUMN IF NOT EXISTS derived_from_series_id integer REFERENCES series(id);
ALTER TABLE series ADD COLUMN IF NOT EXISTS derivation_description text;

ALTER TABLE images ADD COLUMN IF NOT EXISTS frame_of_reference_uid text;

CREATE TABLE IF NOT EXISTS frame_of_reference_groups (
  id serial PRIMARY KEY,
  frame_of_reference_uid text UNIQUE NOT NULL,
  study_id integer REFERENCES studies(id),
  coordinate_system_description text,
  spatial_resolution_mm double precision,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS series_registration_relationships (
  id serial PRIMARY KEY,
  primary_series_id integer NOT NULL REFERENCES series(id),
  secondary_series_id integer NOT NULL REFERENCES series(id),
  registration_id integer REFERENCES registrations(id),
  registration_file_path text,
  transform_matrix jsonb,
  inverse_transform_matrix jsonb,
  transform_hash text,
  relationship_type text NOT NULL,
  confidence_score double precision,
  registration_method text,
  geometric_validation_passed boolean DEFAULT false,
  validation_metrics jsonb,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  CONSTRAINT series_registration_relationships_pair_unique UNIQUE (primary_series_id, secondary_series_id)
);

CREATE TABLE IF NOT EXISTS planning_series_designations (
  id serial PRIMARY KEY,
  study_id integer NOT NULL REFERENCES studies(id),
  series_id integer NOT NULL REFERENCES series(id),
  designation_type text NOT NULL,
  confidence_score double precision,
  designation_reason jsonb,
  algorithm_version text DEFAULT '1.0',
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  CONSTRAINT planning_series_designation_unique UNIQUE (study_id, designation_type)
);

CREATE TABLE IF NOT EXISTS series_fusion_capabilities (
  id serial PRIMARY KEY,
  primary_series_id integer NOT NULL REFERENCES series(id),
  secondary_series_id integer NOT NULL REFERENCES series(id),
  can_fuse boolean NOT NULL,
  fusion_method text,
  confidence_score double precision,
  validation_status text,
  validation_notes text,
  last_validated timestamp DEFAULT now() NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  CONSTRAINT series_fusion_capability_pair_unique UNIQUE (primary_series_id, secondary_series_id)
);

CREATE INDEX IF NOT EXISTS series_frame_of_reference_idx ON series(frame_of_reference_uid);
CREATE INDEX IF NOT EXISTS series_study_modality_idx ON series(study_id, modality);
CREATE INDEX IF NOT EXISTS series_derived_from_idx ON series(derived_from_series_id);

CREATE INDEX IF NOT EXISTS images_series_instance_idx ON images(series_id, instance_number);
CREATE INDEX IF NOT EXISTS images_frame_of_reference_idx ON images(frame_of_reference_uid);

CREATE INDEX IF NOT EXISTS series_reg_primary_idx ON series_registration_relationships(primary_series_id);
CREATE INDEX IF NOT EXISTS series_reg_secondary_idx ON series_registration_relationships(secondary_series_id);
CREATE INDEX IF NOT EXISTS planning_designation_study_idx ON planning_series_designations(study_id);
CREATE INDEX IF NOT EXISTS fusion_capability_primary_idx ON series_fusion_capabilities(primary_series_id);

COMMIT;
