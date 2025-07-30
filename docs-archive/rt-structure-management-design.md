# RT Structure Management System Design

## Current State Analysis

### What We Have:
1. **In-Memory Storage Only**: RT structure modifications are stored in memory maps, not persisted to database
2. **Basic Association**: RT structures are series with modality 'RTSTRUCT' linked to studies via `studyId`
3. **Undo/Redo System**: Already implemented but only in memory
4. **Frame of Reference**: Used to link RT structures to imaging series spatially

### What's Missing:
1. **Database Persistence**: No permanent storage of RT structure modifications
2. **Series Association Tracking**: No clear tracking of which specific CT/MRI series an RT structure belongs to
3. **History Visualization**: No UI for viewing RT structure history
4. **Multi-Scan Management**: Poor handling when patient has multiple CT/MRI scans with different RT structures

## DICOM Standard for RT Structure References

RT Structure Sets reference their associated imaging series through:
1. **Frame of Reference UID** (0020,0052): Links spatial coordinate systems
2. **Referenced Frame of Reference Sequence** (3006,0010): Points to original imaging series
3. **Referenced Study Sequence** (0008,1110): References the study containing the images
4. **Referenced Series Sequence** (0008,1115): References specific series used for contouring
5. **Contour Image Sequence** (3006,0016): References specific images for each contour

## Proposed Database Schema

```sql
-- Table to store RT structure set metadata and associations
CREATE TABLE rt_structure_sets (
  id SERIAL PRIMARY KEY,
  series_id INTEGER REFERENCES series(id),
  study_id INTEGER REFERENCES studies(id),
  referenced_series_id INTEGER REFERENCES series(id), -- The CT/MRI series this RT struct is based on
  frame_of_reference_uid TEXT,
  structure_set_label TEXT,
  structure_set_date TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table to store individual structures within an RT structure set
CREATE TABLE rt_structures (
  id SERIAL PRIMARY KEY,
  rt_structure_set_id INTEGER REFERENCES rt_structure_sets(id),
  roi_number INTEGER,
  structure_name TEXT,
  color INTEGER[], -- RGB values
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table to store contour data for each structure
CREATE TABLE rt_structure_contours (
  id SERIAL PRIMARY KEY,
  rt_structure_id INTEGER REFERENCES rt_structures(id),
  slice_position FLOAT,
  points FLOAT[], -- Flattened array of x,y,z coordinates
  is_predicted BOOLEAN DEFAULT false,
  prediction_confidence FLOAT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table for RT structure history (time machine feature)
CREATE TABLE rt_structure_history (
  id SERIAL PRIMARY KEY,
  rt_structure_set_id INTEGER REFERENCES rt_structure_sets(id),
  user_id INTEGER, -- If we add user tracking
  action_type TEXT, -- 'create', 'update', 'delete', 'brush', 'grow', 'boolean_op', etc.
  action_details JSONB, -- Detailed information about the action
  affected_structure_ids INTEGER[],
  snapshot JSONB, -- Complete state snapshot at this point
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Index for efficient history queries
CREATE INDEX idx_rt_history_set_timestamp ON rt_structure_history(rt_structure_set_id, timestamp DESC);
CREATE INDEX idx_rt_history_structure ON rt_structure_history USING GIN(affected_structure_ids);
```

## API Design

### RT Structure Management Endpoints

```typescript
// Get all RT structure sets for a patient
GET /api/patients/:patientId/rt-structure-sets
Response: {
  rtStructureSets: [{
    id: number,
    seriesId: number,
    referencedSeriesId: number,
    referencedSeriesDescription: string,
    structureSetLabel: string,
    structureCount: number,
    lastModified: string,
    hasHistory: boolean
  }]
}

// Get RT structure set with full details
GET /api/rt-structure-sets/:id
Response: {
  id: number,
  structures: RTStructure[],
  referencedSeries: Series,
  history: { count: number, lastAction: string }
}

// Save RT structure modifications
PUT /api/rt-structure-sets/:id
Body: {
  structures: RTStructure[],
  action: string,
  actionDetails: object
}

// Get RT structure history (time machine)
GET /api/rt-structure-sets/:id/history
Query: {
  startDate?: string,
  endDate?: string,
  actionTypes?: string[],
  structureIds?: number[]
}
Response: {
  history: [{
    id: number,
    timestamp: string,
    actionType: string,
    actionSummary: string,
    affectedStructures: string[],
    canRestore: boolean
  }]
}

// Restore to specific history point
POST /api/rt-structure-sets/:id/restore/:historyId

// Get history snapshot preview
GET /api/rt-structure-sets/:id/history/:historyId/preview
Response: {
  structures: RTStructure[], // State at that point in time
  diff: { // Differences from current state
    added: string[],
    removed: string[],
    modified: string[]
  }
}
```

## UI Design

### 1. Patient Manager Enhancements

```
Patient Card
├── Patient Info
├── Studies & Series
│   ├── CT Series (200 images)
│   │   └── 🔗 RT Structure Set: "Clinical Contours v3"
│   │       ├── 19 structures
│   │       ├── Last modified: 2 hours ago
│   │       └── [View History]
│   ├── MRI T1 Series (60 images)
│   └── MRI T2 Series (60 images)
│       └── 🔗 RT Structure Set: "MRI Structures"
│           ├── 5 structures
│           └── Last modified: 1 day ago
└── Tags & Metadata
```

### 2. Viewer Series Sidebar

```
Series List
├── 🔲 CT Series
│   └── 📐 RT Structures (Clinical v3)
│       ├── ✓ BRAINSTEM
│       ├── ✓ PAROTID_L
│       └── [+14 more...]
├── 🔲 MRI T1
│   └── 📐 RT Structures (MRI Set)
│       ├── ✓ TUMOR_CORE
│       └── [+3 more...]
└── 🔲 MRI T2
```

### 3. Time Machine UI

```
┌─────────────────────────────────────────────────────────┐
│  RT Structure History - Clinical Contours v3             │
├─────────────────────────────────────────────────────────┤
│  Timeline View                                          │
│  ──┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬──   │
│    ●   ●   ●   ●   ●   ●   ●   ●   ●   ●   ●   ●      │
│  9am 10am 11am 12pm 1pm 2pm 3pm 4pm 5pm 6pm 7pm 8pm   │
│                                                         │
│  Selected: 3:45 PM - "Grow PAROTID_L by 5mm"          │
│                                                         │
│  Preview:                                               │
│  ┌─────────────────┐  Changes:                        │
│  │  [CT Image]     │  • PAROTID_L expanded            │
│  │  [with contour] │  • 15 slices affected            │
│  └─────────────────┘  • Volume: 12.3cc → 15.8cc       │
│                                                         │
│  [Restore to This Point] [Compare with Current]        │
└─────────────────────────────────────────────────────────┘
```

### 4. History List View (Alternative)

```
┌─────────────────────────────────────────────────────────┐
│  RT Structure History                                   │
├─────────────────────────────────────────────────────────┤
│  🕐 Today                                              │
│  ├── 8:15 PM - Brush edit on BRAINSTEM (5 slices)     │
│  ├── 7:45 PM - Boolean subtract PAROTID_L - PAROTID_R │
│  ├── 6:30 PM - Interpolate SPINALCORD (12 slices)     │
│  └── 3:45 PM - Grow PAROTID_L by 5mm                  │
│                                                         │
│  🕐 Yesterday                                          │
│  ├── 4:20 PM - Delete slice 45 from TUMOR             │
│  └── 2:15 PM - Create new structure LESION_1          │
│                                                         │
│  [Load More...]                                         │
└─────────────────────────────────────────────────────────┘
```

### 5. Interactive Features

1. **Hover Preview**: Hovering over history points shows thumbnail preview
2. **Scrubbing**: Drag along timeline to see animated progression
3. **Diff View**: Side-by-side comparison of any two points
4. **Filter Options**: Filter by structure, action type, user, date range
5. **Annotations**: Add notes to important history points
6. **Export**: Export history as report or video

## Implementation Plan

### Phase 1: Database Schema & Persistence
1. Create migration for new RT structure tables
2. Update storage interface to persist RT structures
3. Migrate existing in-memory data to database

### Phase 2: Association Tracking
1. Parse Referenced Series Sequence from DICOM RT structures
2. Store series associations in database
3. Update API to return association information

### Phase 3: Basic History API
1. Implement history logging for all RT structure operations
2. Create endpoints for history retrieval
3. Add restore functionality

### Phase 4: Patient Manager Integration
1. Update patient cards to show RT structure associations
2. Add RT structure count and last modified info
3. Link to history view

### Phase 5: Viewer Integration
1. Update series sidebar to show RT structure associations
2. Add visual indicators for which series has RT structures
3. Show referenced series information

### Phase 6: Time Machine UI
1. Implement timeline component
2. Add history list view
3. Create preview and comparison features
4. Add interactive scrubbing

### Phase 7: Advanced Features
1. Add collaborative features (user tracking)
2. Implement diff algorithms for structure comparison
3. Add export/reporting capabilities
4. Performance optimization for large histories

## Benefits

1. **Clear Association Tracking**: Always know which scan an RT structure belongs to
2. **Full Audit Trail**: Complete history of all modifications
3. **Easy Recovery**: Restore to any previous state
4. **Collaborative Work**: Track who made what changes when
5. **Quality Assurance**: Review contour evolution over time
6. **Teaching Tool**: Show progression of contouring process