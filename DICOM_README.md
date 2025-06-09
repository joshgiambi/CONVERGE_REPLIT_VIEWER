# DICOM Medical Imaging Relationships and Architecture

## Overview
This document defines the DICOM (Digital Imaging and Communications in Medicine) data structures and relationships used in the CONVERGE medical imaging platform. Understanding these relationships is critical for proper medical imaging workflow implementation.

## DICOM Hierarchy

### Patient → Study → Series → Instance
```
Patient (0010,xxxx)
├── Study (0008,xxxx, 0020,xxxx)
    ├── Series (0008,xxxx, 0020,xxxx)
        ├── Instance/Image (0008,xxxx, 0020,xxxx)
        ├── Instance/Image
        └── Instance/Image
    ├── Series (RT Structure Set)
        └── Instance (Structure Set Object)
    └── Series (Registration)
        └── Instance (Spatial Registration Object)
```

## Core DICOM Modalities

### 1. Medical Imaging Modalities
- **CT** (Computed Tomography) - Cross-sectional X-ray images
- **MR** (Magnetic Resonance) - Soft tissue imaging using magnetic fields
- **US** (Ultrasound) - Real-time imaging using sound waves
- **CR/DX** (Computed/Digital Radiography) - Digital X-ray images
- **PT** (Positron Emission Tomography) - Metabolic imaging
- **NM** (Nuclear Medicine) - Radioisotope imaging

### 2. Radiotherapy Planning Modalities
- **RTPLAN** (RT Treatment Plan) - Treatment planning parameters
- **RTDOSE** (RT Dose Distribution) - 3D dose calculations
- **RTSTRUCT** (RT Structure Set) - Anatomical contours and ROIs
- **RTIMAGE** (RT Portal Image) - Treatment verification images
- **RTRECORD** (RT Treatment Record) - Delivered treatment log

### 3. Registration and Fusion
- **REG** (Spatial Registration) - Image-to-image transformations
- **FIDUCIALS** - Reference point markers
- **DEFORM** (Deformable Registration) - Non-rigid transformations

## DICOM Tag Structure

### Critical Identification Tags
```
Patient Level:
(0010,0010) Patient Name           [PN]
(0010,0020) Patient ID             [LO]
(0010,0030) Patient Birth Date     [DA]
(0010,0040) Patient Sex            [CS]

Study Level:
(0008,0020) Study Date             [DA]
(0008,0030) Study Time             [TM]
(0008,1030) Study Description      [LO]
(0020,000D) Study Instance UID     [UI]
(0008,0050) Accession Number       [SH]

Series Level:
(0008,103E) Series Description     [LO]
(0020,000E) Series Instance UID    [UI]
(0020,0011) Series Number          [IS]
(0008,0060) Modality               [CS]

Instance Level:
(0008,0018) SOP Instance UID       [UI]
(0008,0016) SOP Class UID          [UI]
(0020,0013) Instance Number        [IS]
(0020,1041) Slice Location         [DS]
```

### Spatial Reference Tags
```
Image Position/Orientation:
(0020,0032) Image Position Patient  [DS] - X,Y,Z coordinates
(0020,0037) Image Orientation       [DS] - Direction cosines
(0018,0050) Slice Thickness         [DS]
(0028,0030) Pixel Spacing           [DS] - Row,Column spacing

Frame of Reference:
(0020,0052) Frame of Reference UID  [UI] - Links related images
(0020,1040) Position Reference       [LO]
```

## Complex Relationships

### 1. Multi-Modal Registration
When MRI and CT images are registered for treatment planning:
```
Registration Object (REG):
├── Primary Image Set (CT Planning Scan)
├── Secondary Image Set (MRI Diagnostic)
├── Transformation Matrix (4x4 spatial transform)
└── Registration Method (RIGID_BODY, DEFORMABLE, etc.)
```

### 2. RT Structure Sets (RTSTRUCT)
Anatomical contours drawn on planning images:
```
Structure Set Object:
├── Referenced Image Sequence → Links to planning CT/MR
├── ROI Contour Sequence → 3D contour data per structure
├── RT ROI Observations → Clinical classifications
└── Structure Set ROI Sequence → ROI definitions

Each ROI Contains:
├── ROI Number (unique identifier)
├── ROI Name (e.g., "Brain", "Tumor", "Brainstem")
├── ROI Type (ORGAN, PTV, CTV, OAR, etc.)
├── ROI Color (RGB display values)
└── Contour Data (3D point coordinates)
```

### 3. RT Treatment Plans (RTPLAN)
Treatment planning parameters:
```
Plan Object:
├── Referenced Structure Set → Links to RTSTRUCT
├── Referenced Dose → Links to RTDOSE
├── Beam Sequence → Individual treatment beams
├── Fraction Group Sequence → Treatment fractionation
└── Patient Setup Sequence → Positioning parameters
```

### 4. RT Dose Distributions (RTDOSE)
3D dose calculations:
```
Dose Object:
├── Referenced RT Plan → Links to RTPLAN
├── Referenced Structure Set → Links to RTSTRUCT  
├── Dose Grid → 3D dose matrix
├── Dose Units → cGy, Gy, etc.
└── Dose Type → PHYSICAL, EFFECTIVE, etc.
```

## LIMBIC Dataset Structure

Based on authentic DICOM parsing from the LIMBIC_57 dataset:

### Patient Information
- **Patient ID**: LIMBIC_57
- **Patient Name**: LIMBIC_57
- **Study UID**: 2.16.840.1.114362.1.12072839.23213054100.618021210.557.4707

### Series Breakdown
1. **MRI MPRAGE Series**
   - Modality: MR
   - Series Description: "MPRAGE MRI"
   - Series UID: 2.16.840.1.114362.1.12072839.23213054100.618021213.502.5106
   - Images: 392 slices (T1-weighted brain MRI)
   - Slice Locations: 10.5mm to ~400mm (1mm spacing)

2. **Structure Set Series**
   - Modality: CT (RTSTRUCT referenced to CT)
   - Series Description: "Brain Mets"
   - Images: 392 structure definition files
   - Contains: Brain metastases contours and organ-at-risk structures

3. **Registration Series**
   - Modality: REG
   - Series Description: "MRI Reg"
   - SOP Instance UID: 2.16.840.1.114362.1.12072839.23213054100.628829730.600.6988
   - Purpose: Spatial registration between MRI and reference coordinate system

## Implementation Requirements

### 1. DICOM Parser Features
- Support both Implicit and Explicit VR transfer syntaxes
- Handle all RT-specific tags (300A,xxxx, 3006,xxxx, 3004,xxxx)
- Parse sequence data for complex objects
- Extract spatial transformation matrices
- Validate DICOM file integrity

### 2. Database Schema
```sql
-- Core hierarchy tables
patients → studies → series → images

-- RT-specific relationship tables  
rt_structure_sets → rt_structures → rt_contours
rt_plans → rt_beams → rt_control_points
rt_doses → dose_grid_points

-- Registration relationships
spatial_registrations → transformation_matrices
image_references → frame_of_reference_uids
```

### 3. Viewer Requirements
- Multi-planar reconstruction (Axial, Sagittal, Coronal)
- Structure set overlay rendering
- Registration fusion display
- Dose distribution visualization
- Measurement and annotation tools
- DICOM metadata display panel

### 4. Series Organization Logic
Series should be grouped by:
1. **Modality type** (CT, MR, RTSTRUCT, REG, etc.)
2. **Temporal relationship** (planning vs. verification scans)
3. **Spatial reference** (same Frame of Reference UID)
4. **Clinical workflow** (simulation → planning → treatment → follow-up)

## Critical Implementation Notes

1. **Never use fabricated UIDs** - Always parse authentic DICOM identifiers
2. **Preserve spatial relationships** - Maintain Frame of Reference linkages
3. **Handle missing metadata gracefully** - Some fields may be optional
4. **Validate DICOM compliance** - Ensure proper tag encoding
5. **Support multi-modal fusion** - Enable CT/MR registration display
6. **Real-time parsing** - Parse metadata during file upload/import
7. **Series numbering** - Use authentic DICOM series numbers, not auto-increment

This architecture ensures proper medical imaging workflow support and enables advanced features like treatment planning, dose analysis, and multi-modal image fusion.