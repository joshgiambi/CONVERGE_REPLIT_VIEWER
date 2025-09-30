# Registration Relationship System

## Overview

The Registration Relationship System automatically detects and records spatial relationships between DICOM series, enabling intelligent fusion hierarchy and automated series organization.

## Key Features

### 1. **Automatic Relationship Detection**

The system detects three types of relationships:

#### **REG-based Relationships** (Confidence: 0.95)
- Parses DICOM REG (Registration) files
- Extracts source/target Frame of Reference UIDs
- Links moving images (MR, PT, PET) to fixed images (CT)
- Type: `rigid` or `deformable`

#### **Shared Frame of Reference** (Confidence: 0.9)
- Identifies series with identical Frame of Reference UID
- Indicates series are spatially aligned
- Type: `shared-frame`

#### **Identity Transform** (Confidence: 1.0)
- Series referencing itself
- Type: `identity`

### 2. **Database Schema**

The `series_registration_relationships` table stores:

```typescript
{
  primarySeriesId: number;        // Primary series (usually CT)
  secondarySeriesId: number;      // Secondary series (MR, PT, etc.)
  registrationId: number | null;  // Link to registrations table
  registrationFilePath: string | null;  // Path to REG DICOM file
  transformMatrix: number[][] | null;   // 4x4 transformation matrix
  inverseTransformMatrix: number[][] | null;
  transformHash: string | null;
  relationshipType: string;       // 'rigid', 'deformable', 'shared-frame'
  confidenceScore: number;        // 0.0 to 1.0
  registrationMethod: string;     // 'DICOM-REG', 'frame-of-reference'
  geometricValidationPassed: boolean;
  validationMetrics: object;
}
```

### 3. **Automatic Processing During Import**

When a series is created during DICOM import, the system automatically:

1. **Checks if REG modality**
   - Parses REG file to extract registration info
   - Creates relationships between source and target series

2. **Checks Frame of Reference**
   - Finds all series with same Frame of Reference UID
   - Creates bidirectional relationships

3. **Handles Primary/Secondary Logic**
   - CT is typically primary
   - MR/PT/PET are typically secondary
   - Consistent ordering for CT-CT or MR-MR pairs

## Usage

### During DICOM Import

Relationships are created automatically. No action needed.

### Batch Reprocessing Existing Data

#### Via Script

```bash
# Process all patients
tsx scripts/populate-registration-relationships.ts

# Process specific patient
tsx scripts/populate-registration-relationships.ts --patient-id=1

# Process specific study
tsx scripts/populate-registration-relationships.ts --study-id=5
```

#### Via API

```bash
# Process patient
curl -X POST http://localhost:5000/api/patients/1/process-registration-relationships

# Process study
curl -X POST http://localhost:5000/api/studies/5/process-registration-relationships
```

### Querying Relationships

#### Get Planning CT and Fusion Candidates

```bash
GET /api/studies/:studyId/series-selection
```

Returns:
```json
{
  "planningCT": { "id": 1, "seriesDescription": "CT Planning", ... },
  "planningCTConfidence": 0.95,
  "planningCTReasons": ["Has RT structure references"],
  "fusionCandidates": [
    {
      "seriesId": 2,
      "modality": "MR",
      "seriesDescription": "T1 with Contrast",
      "relationshipType": "rigid",
      "confidence": 0.95
    }
  ],
  "allSeries": [...]
}
```

#### Get Fusion Candidates for Specific Series

```bash
GET /api/series/:seriesId/fusion-candidates
```

## Frontend Integration

### Using the Hook

```typescript
import { useSeriesSelection } from '@/hooks/use-series-selection';

function MyComponent({ studyId }) {
  const { data, isLoading } = useSeriesSelection(studyId);

  if (!data) return null;

  return (
    <div>
      <h3>Planning CT: {data.planningCT?.seriesDescription}</h3>
      <h4>Fusable Images:</h4>
      <ul>
        {data.fusionCandidates.map(candidate => (
          <li key={candidate.seriesId}>
            {candidate.modality} - {candidate.seriesDescription}
            <span>({candidate.relationshipType}, {candidate.confidence * 100}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Algorithm Details

### REG File Processing

1. **Parse DICOM File**
   - Read Frame of Reference UID (0020,0052)
   - Parse Registration Sequence (0070,0308)
   - Extract Referenced Series Sequence (0008,1115)

2. **Find Related Series**
   - Match Frame of Reference UIDs
   - Filter by modality (CT vs MR/PT/PET)

3. **Create Relationships**
   - Primary: CT series
   - Secondary: MR/PT/PET series
   - Method: `DICOM-REG`
   - Confidence: 0.95

### Frame of Reference Detection

1. **Query Same Study**
   - Find all series with matching Frame of Reference UID
   - Exclude REG and RTSTRUCT modalities

2. **Determine Primary/Secondary**
   - If one is CT and other is not → CT is primary
   - If both same type → lower ID is primary

3. **Create Relationships**
   - Method: `frame-of-reference`
   - Confidence: 0.9

### Deduplication

- Uses unique constraint: `(primary_series_id, secondary_series_id)`
- Checks for existing relationship before inserting
- Idempotent - safe to run multiple times

## Architecture

```
DICOM Import
    ↓
Series Created
    ↓
processSeriesRegistrationRelationships()
    ↓
    ├─→ processREGSeries()
    │   └─→ Parse REG file → Create relationships
    │
    └─→ processSharedFrameOfReference()
        └─→ Find same FOR → Create relationships
    ↓
series_registration_relationships table
    ↓
seriesSelectionService.getSeriesSelectionData()
    ↓
Frontend: useSeriesSelection() hook
    ↓
UI: Hierarchical series selector
```

## Troubleshooting

### No Relationships Created

**Check Frame of Reference:**
```sql
SELECT id, series_description, modality, frame_of_reference_uid
FROM series
WHERE study_id = ?;
```

**Check if REG files exist:**
```sql
SELECT * FROM series WHERE modality = 'REG';
```

### Incorrect Primary/Secondary

The system uses this logic:
- CT → Primary (when paired with MR/PT/PET)
- MR/PT/PET → Secondary
- Same modality → Lower ID is primary

To fix: Delete and recreate relationships with correct IDs.

### Performance

Batch processing is asynchronous and non-blocking:
- Runs in background after series creation
- Errors logged but don't block import
- Can be rerun safely with script

## Future Enhancements

1. **Enhanced REG Parsing**
   - Full Registration Sequence parsing
   - Extract transformation matrices directly
   - Support Deformable Registration Sequence

2. **Geometric Validation**
   - Verify spatial alignment numerically
   - Check for orientation mismatches
   - Calculate registration quality metrics

3. **Series Co-registration Detection**
   - Detect series that are part of same acquisition
   - Link multi-echo MR sequences
   - Group PET/CT fusion scans

4. **Machine Learning Scoring**
   - Train model on successful fusions
   - Predict fusion quality
   - Suggest optimal primary series

## Related Files

- Service: `server/services/registration-relationship-service.ts`
- Series Selection: `server/services/series-selection-service.ts`
- Migration: `migrations/20250202_add_fusion_schema.sql`
- Schema: `shared/schema.ts`
- Frontend Hook: `client/src/hooks/use-series-selection.ts`
- Script: `scripts/populate-registration-relationships.ts`