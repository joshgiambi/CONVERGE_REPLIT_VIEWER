# Detailed Fusion System Documentation

This document provides comprehensive step-by-step information about the four key components of the medical imaging fusion system.

## 1. Fusion Manifest Test Page Logic - Step by Step

### Overview
The fusion manifest test page (`/fusion-test?patientId=X`) is a quality assurance tool that generates side-by-side test images to validate fusion accuracy between a primary CT series and secondary series (MR, PET, etc.).

### Frontend Initialization Process

#### Step 1: URL Parameter Processing (`lines 171-173`)
1. **Parse URL**: Extract `patientId` parameter from URL search params
2. **Create Search Params**: Use `useMemo` to create URLSearchParams object from `window.location.search`
3. **Extract Patient ID**: Get `patientId` value from search parameters

#### Step 2: Data Loading (`lines 176-178`)
1. **Parallel API Calls**: Execute three simultaneous React Query requests:
   - `/api/patients` - Load all patient records
   - `/api/studies` - Load all study records  
   - `/api/series` - Load all series records
2. **Loading State Management**: Track loading status with `patientsLoading`, `studiesLoading`, `seriesLoading`

#### Step 3: Data Filtering and Organization (`lines 199-219`)
1. **Patient Record Resolution**:
   - Search patients array for matching `patientID` (DICOM field) or database `id`
   - Use `useMemo` to prevent unnecessary recalculation
   - Return null if no match found

2. **Study Filtering**:
   - Filter studies array to only include studies where `patientId` matches the patient record's database ID
   - Create array of study IDs for series filtering

3. **Series Filtering**:
   - Extract study IDs into a Set for O(1) lookup performance
   - Filter series array to only include series belonging to patient's studies
   - Separate into CT series (primary candidates) and all other series (secondary candidates)

4. **Series Classification**:
   - **CT Series**: Filter by `modality === 'CT'` for primary dropdown
   - **Secondary Series**: All series except the currently selected primary series

#### Step 4: Auto-Selection Logic (`lines 221-231`)
1. **Primary Auto-Selection**:
   - If no primary selected and CT series exist, auto-select first CT series
   - Uses `useEffect` with dependencies `[ctSeries, selectedPrimaryId]`

2. **Secondary Auto-Selection**:
   - If no secondary selected and secondary series exist, auto-select first secondary
   - Uses `useEffect` with dependencies `[secondarySeries, selectedSecondaryId]`

### Test Generation Process

#### Step 5: Slice Input Parsing (`line 247`)
1. **Parse Slice Input**: Call `parseSliceInput(sliceInput, primary.imageCount)`
2. **Input Validation**: 
   - Parse comma-separated values and ranges (e.g., "1,5-10,15")
   - Ensure indices are within bounds [0, imageCount)
   - Remove duplicates and sort numerically
3. **Default Fallback**: If no valid slices, use middle slice: `[Math.floor(imageCount / 2)]`

#### Step 6: State Reset and Request Preparation (`lines 250-255`)
1. **Clear Previous Results**: Reset all result states to null/empty:
   - `setResults([])`
   - `setTransformInfo(null)`
   - `setDebugInfo(null)`
   - `setTransformDetails(null)`
2. **Set Loading State**: `setIsSubmitting(true)`

#### Step 7: API Request Construction (`lines 257-265`)
1. **HTTP Request Setup**:
   - Method: POST to `/api/fusebox/test-slices`
   - Headers: `'Content-Type': 'application/json'`
   - Body: JSON with `primarySeriesId`, `secondarySeriesId`, `sliceIndices`

### Backend Processing Pipeline

#### Step 8: Input Validation (`lines 3417-3424`)
1. **Parameter Extraction**: Extract and convert body parameters to numbers
2. **Numeric Validation**: Verify both series IDs are finite numbers
3. **Registration ID**: Extract optional registration ID as string
4. **Interpolation**: Default to 'linear' if not specified

#### Step 9: Database Verification (`lines 3426-3434`)
1. **Series Lookup**: Query database for both primary and secondary series records
2. **Existence Check**: Return 404 if either series not found
3. **Image Verification**: Load and sort images by instance number for primary series
4. **Empty Check**: Return 404 if primary series has no images

#### Step 10: File System Verification (`lines 3437-3441`)
1. **File Collection**: Use `collectSeriesFiles()` to gather DICOM file paths
2. **File Existence**: Verify actual DICOM files exist on disk
3. **Completeness Check**: Ensure both primary and secondary have files

#### Step 11: Transform Resolution (`lines 3445-3448`)
1. **Registration Lookup**: Call `resolveFuseboxTransform()` with series pair
2. **Transform Validation**: Verify either matrix or transform file exists
3. **Error Handling**: Return 404 if no valid registration found

#### Step 12: Slice Processing Loop (`lines 3482-3500`)
1. **Slice Index Validation**: 
   - Filter requested indices to valid range [0, sliceCount)
   - Remove duplicates and sort
   - Default to middle slice if no valid indices

2. **Per-Slice Processing**:
   - **Configuration Setup**: Create fusebox config with files and transform
   - **Resampling**: Call `runFuseboxResample()` for each slice
   - **Error Checking**: Return 500 if any slice processing fails
   - **Result Assembly**: Combine primary, secondary, and blended image data

#### Step 13: Metadata Extraction (`lines 3502-3520`)
1. **Frame of Reference UIDs**: Extract from primary and secondary DICOM files
2. **DICOM Parsing**: Use dicom-parser to read Frame of Reference UID tags
3. **Error Handling**: Return null for UIDs if parsing fails

### Frontend Result Processing

#### Step 14: Response Handling (`lines 272-295`)
1. **Success Path**:
   - Parse JSON response containing slice array and metadata
   - Update `results` state with processed slice data
   - Extract and store transform information
   - Create debug info object with patient and series context

2. **Error Path**:
   - Extract error message from response text
   - Display toast notification with error details
   - Reset loading state

#### Step 15: Visual Rendering
1. **Canvas Creation**: Generate three canvases per slice (primary, secondary, blend)
2. **Image Data Processing**: Convert base64 data to ImageData objects
3. **Color Mapping**: Apply modality-specific color schemes
4. **Navigation Controls**: Enable slice-by-slice browsing of results

### Transform Inspector Logic

#### Step 16: Transform Analysis
1. **Matrix Inspection**: Display 4x4 transformation matrices
2. **Recursion Protection**: Prevent infinite loops in composite transforms
3. **Source Tracking**: Show whether transform came from REG files or helper generation
4. **Validation**: Check for identity matrices and suspicious transforms

## 2. Series Dropdown Menu Logic - Step by Step

### Overview
The series dropdown in the main viewer interface organizes and displays all medical imaging series for a patient in a hierarchical, intelligent manner that prioritizes clinical workflow.

### Initialization and Data Processing

#### Step 1: Component Setup and State Management (`lines 52-85`)
1. **Props Reception**: Receive all series data, registration associations, and fusion status maps
2. **State Initialization**:
   - `rtSeries`: Array of RT structure series
   - `selectedRTSeries`: Currently selected RT structure
   - `structureVisibility`: Map of structure ID to visibility boolean
   - `selectedStructures`: Set of selected structure IDs
   - `searchTerm`: Text filter for series
   - `expandedGroups`: Map controlling accordion section expansion
   - `accordionValues`: Array of currently open accordion sections

#### Step 2: Series Categorization (`lines 738-743`)
1. **Modality Extraction**: Create helper function `modalityOf()` to normalize modality strings
2. **Primary Buckets**: Sort all series into modality-based groups:
   - **MR Series**: Filter by `modality === 'MR'`
   - **PET/PT Series**: Filter by `['PT', 'PET', 'NM'].includes(modality)`
   - **REG Series**: Filter by `modality === 'REG'` (registration files)
   - **Other Series**: Everything not CT, MR, PET, REG, or RTSTRUCT

### Planning CT Selection Algorithm

#### Step 3: Planning CT Scoring System (`lines 746-781`)
1. **Signal Gathering**:
   - **Registration Associations**: Extract all registration primary IDs from `regAssociations`
   - **RT Structure References**: Get all series IDs referenced by RT structure sets
   - **PET Study IDs**: Identify studies containing PET data
   - **CTAC Series IDs**: Get series marked as CT Attenuation Correction

2. **Scoring Algorithm** (`scoreCT` function):
   - **Base Score**: Start at 0
   - **RT Structure Reference**: +1000 points (highest priority - clinical planning CT)
   - **Registration Primary**: +500 points + 5 points per associated secondary
   - **Non-PET Study**: +100 points (prefer dedicated planning scans)
   - **CTAC Penalty**: -200 points (avoid attenuation correction CTs)
   - **Image Count Bonus**: Up to +200 points based on series completeness

3. **Selection Process**:
   - Score all CT series using the algorithm
   - Sort by score (highest first)
   - Select top-scoring CT as the "Planning CT"
   - If no CT series exist, return null

#### Step 4: Primary Series Determination (`lines 783-789`)
1. **Hierarchy Logic**:
   - **First Priority**: Single Planning CT (if any CT exists)
   - **Fallback 1**: All MR series (if no CT)
   - **Fallback 2**: All PET series (if no CT or MR)
   - **Fallback 3**: Other modalities (if nothing else available)

### Fusion Relationship Mapping

#### Step 5: Registration Association Processing (`lines 794-859`)
For each primary series, build comprehensive fusion relationships:

1. **Candidate ID Collection**:
   - Get all series IDs that can be fused with this primary
   - Create Set for O(1) lookup performance
   - Add primary series ID to candidate set

2. **Sibling Map Processing**:
   - Extract PET and MR sibling maps from `fusionSiblingMap`
   - Build bidirectional relationships between modalities
   - Track CT series linked to specific PET series

3. **MR Association Logic**:
   - **Explicit Associations**: MR series with direct registration to primary
   - **Fallback**: All MR series if no explicit associations exist
   - **Additional MR**: Process sibling map to find linked MR series

4. **PET Association Logic**:
   - **Sibling Map Priority**: Use fusion sibling map if available
   - **Explicit Associations**: PET series with direct registration to primary
   - **Fallback**: All PET series if no explicit associations

5. **CT Association Filtering**:
   - Find registered CT series that can be fused with primary
   - Exclude CTs already linked to PET (avoid double-listing)
   - Filter by candidate set membership

### Visual Organization and Rendering

#### Step 6: Series Card Generation (`lines 860-900`)
1. **Primary Series Card**:
   - **Visual Styling**: Blue accent for selected, hover effects for others
   - **Modality Badge**: Show modality with "Planning" label for Planning CT
   - **Image Count**: Display number of images in series
   - **Series Description**: Formatted clinical description

2. **Fusion Button Logic**:
   - **Anchor Button**: Available when fusion candidates exist
   - **Open Button**: Always available for standalone viewing
   - **Status Indicators**: Show fusion preparation progress

#### Step 7: Associated Series Grouping (`lines 900-1200`)
1. **MR Series Rendering**:
   - Group fusion-ready MR series under primary
   - Show registration status and fusion availability
   - Display loading states during fusion preparation

2. **PET Series Rendering**:
   - Handle PET/CT pairs intelligently
   - Show explicit PET candidates when available
   - Group related CT series under PET entries

3. **Additional CT Rendering**:
   - Show registered CT series that aren't PET-linked
   - Avoid duplicating the main Planning CT
   - Display registration relationships

### Search and Filtering

#### Step 8: Search Implementation (`lines 92-93`)
1. **Text Filtering**: Filter series by description or modality matching search term
2. **Real-time Update**: Update visible series as user types
3. **Case Insensitive**: Convert to lowercase for matching

#### Step 9: Accordion Management (`lines 719-724`)
1. **Multi-Section Support**: Allow multiple accordion sections open simultaneously
2. **State Persistence**: Remember which sections user has expanded
3. **Default States**: Series section open by default

### RT Structure Integration

#### Step 10: RT Structure Processing (`lines 1400-1600`)
1. **RT Series Loading**: Load RT structure sets associated with current study
2. **Reference Resolution**: Link RT structures to their reference CT series
3. **Structure Visibility**: Track individual structure visibility states
4. **Color Management**: Handle structure color assignments and changes

### Performance Optimizations

#### Step 11: Memoization and Caching (`lines 100-130`)
1. **useMemo Hooks**: Prevent unnecessary recalculations of:
   - Filtered series lists
   - Registration relationships
   - Fusion candidate mappings
2. **Reference Stability**: Maintain stable object references to prevent re-renders
3. **Lazy Evaluation**: Only calculate expensive operations when data changes

#### Step 12: Event Handling Optimization
1. **Debounced Search**: Prevent excessive filtering during typing
2. **Batch State Updates**: Group related state changes together
3. **Conditional Rendering**: Only render visible components

## 3. Frontend Fusion Overlay/Panel Logic - Step by Step

### Overview
The fusion overlay system provides real-time image fusion capabilities, allowing clinicians to view multiple imaging modalities (CT, MR, PET) simultaneously with adjustable opacity and advanced visualization controls.

### Fusion State Management

#### Step 1: State Initialization (`viewer-interface.tsx` lines 72-85)
1. **Core Fusion States**:
   - `secondarySeriesId`: Currently selected overlay series (number | null)
   - `fusionOpacity`: Overlay transparency value (0.0 to 1.0)
   - `fusionManifest`: Cached manifest data with series metadata
   - `fusionManifestLoading`: Boolean indicating manifest preparation status
   - `fusionManifestError`: Error message if manifest loading fails

2. **Secondary States**:
   - `secondaryLoadingStates`: Map tracking progress for each secondary series
   - `currentlyLoadingSecondary`: ID of currently processing secondary
   - `fusionWindowLevel`: Custom window/level settings for overlay display
   - `manifestActionStatus`: Status message for user feedback

3. **Reference Management**:
   - `fusionManifestRequestRef`: Counter for request deduplication
   - `fusionDebugSnapshot`: Debug information for troubleshooting

### Manifest Loading and Caching

#### Step 2: Manifest Service Integration (`fusion-utils.ts` lines 244-269)
1. **Request Construction**:
   - Build URL parameters: `primarySeriesId`, `secondarySeriesIds`, `force`, `interpolation`
   - Set cache policy to 'no-store' for fresh data
   - Handle optional parameters (force refresh, interpolation mode)

2. **Response Processing**:
   - Parse JSON response into `FusionManifest` type
   - Update local manifest cache with new data
   - Process secondary descriptors for each fusion candidate

3. **Cache Management**:
   - **Cache Key**: Primary series ID used as cache key
   - **Entry Structure**: Manifest + Map of secondary descriptors
   - **Cache Updates**: Merge new secondary data with existing cache

#### Step 3: Manifest Cache Architecture (`fusion-utils.ts` lines 72-97)
1. **Cache Entry Structure**:
   ```typescript
   {
     manifest: FusionManifest,        // Core manifest metadata
     secondaries: Map<number, {       // Per-secondary cache
       descriptor: FusionSecondaryDescriptor,
       slices: Map<string, FuseboxSlice>,
       status: 'idle' | 'loading' | 'ready' | 'error'
     }>
   }
   ```

2. **Cache Operations**:
   - **Get**: Retrieve manifest by primary series ID
   - **Update**: Merge new secondary data preserving existing slices
   - **Invalidate**: Clear cache on force refresh or errors

### Backend Manifest Generation

#### Step 4: Manifest Service Processing (`manifest-service.ts` lines 164-283)
1. **Request Validation**:
   - Verify primary series exists in database
   - Check secondary series IDs are valid
   - Resolve patient and study information

2. **Secondary Processing Loop**:
   - For each secondary series, call `ensureSecondary()`
   - Check for existing cached fusion data
   - Generate new fusion if missing or force refresh requested

3. **Manifest Assembly**:
   - Combine all secondary descriptors into unified manifest
   - Set metadata: creation time, settings, study information
   - Write manifest to disk for persistence

#### Step 5: Volume Resampling Process (`manifest-service.ts` lines 285-554)
1. **Transform Resolution**:
   - Call `resolveFuseboxTransform()` to find registration matrix
   - Support both 4x4 matrices and ITK transform files
   - Handle transform inversion for different coordinate systems

2. **File Collection**:
   - Gather all DICOM files for primary and secondary series
   - Sort by instance number for consistent ordering
   - Validate file existence on disk

3. **Resampling Execution**:
   - Create `VolumeResampleRequest` with all parameters
   - Call Python ITK/SimpleITK pipeline via `FuseboxVolumeResampler`
   - Generate complete resampled volume matching primary geometry

4. **Output Processing**:
   - Create new database series record for fused data
   - Generate individual DICOM files for each slice
   - Update image records with proper metadata

### Frontend Overlay Rendering

#### Step 6: Render Request Management (`working-viewer.tsx` lines 4573-4625)
1. **Request Token System**:
   - Increment `fusionRequestTokenRef` for each render request
   - Create `ensureActive()` closure to check token validity
   - Cancel outdated requests to prevent race conditions

2. **Validation Checks**:
   - Verify secondary series ID is selected and opacity > 0
   - Check fusion manifest is loaded and not in loading state
   - Ensure secondary series status is 'ready'
   - Validate manifest matches current primary series

3. **Early Exit Conditions**:
   - No secondary selected → clear transform source and exit
   - Manifest still loading → set issue flag and exit
   - Secondary not ready → set issue flag and exit
   - Primary image missing SOP UID → exit

#### Step 7: Cache Key Generation and Lookup (`lines 4627-4632`)
1. **Cache Key Components**:
   - Primary image SOP Instance UID
   - Secondary series ID
   - Registration ID (for transform disambiguation)

2. **Cache Strategy**:
   - Check `fuseboxCacheRef` for existing processed slice
   - Cache contains both raw slice data and processed canvas
   - Include timestamp for cache invalidation

#### Step 8: Slice Loading and Fallback Logic (`lines 4634-4652`)
1. **Primary Lookup Strategy**:
   - Try exact SOP Instance UID match first
   - Use `getFusedSlice()` for direct SOP matching

2. **Fallback Strategies**:
   - **Instance Number**: Match by DICOM instance number
   - **Index Position**: Use slice index if instance number unavailable
   - **Image Position**: Use spatial coordinates for geometric matching

3. **Smart Slice Loading**:
   - Call `getFusedSliceSmart()` with all available hints
   - Handle cases where SOP UIDs differ between primary and fused data
   - Provide multiple fallback options for robust matching

#### Step 9: Canvas Conversion and Processing (`lines 4662-4679`)
1. **Slice Data Conversion**:
   - Convert raw fusion slice to canvas-ready format
   - Apply modality-specific color mapping
   - Handle different pixel data types and scaling

2. **Color Map Application**:
   - **PET/PT**: Apply heat map (black → orange → yellow → white)
   - **MR**: Apply grayscale with custom window/level
   - **CT**: Standard grayscale windowing

3. **Signal Detection**:
   - Check if fused slice contains visible signal
   - Log empty slices for debugging
   - Set appropriate flags for rendering decisions

#### Step 10: Canvas Rendering (`lines 4702-4710`)
1. **Transform Application**:
   - Get current CT transform (scale, offset)
   - Apply geometric transformation to overlay
   - Ensure pixel-perfect alignment with primary

2. **Alpha Blending**:
   - Use `drawFusionOverlay()` with specified opacity
   - Blend overlay with primary image on canvas
   - Preserve primary image visibility

3. **Prefetch Optimization**:
   - Call `prefetchFusionSlices()` for adjacent slices
   - Load nearby slices in background for smooth navigation
   - Manage memory usage with cache size limits

### Fusion Control Panel

#### Step 11: Control Panel State (`fusion-control-panel.tsx` lines 26-50)
1. **Active Descriptor Resolution**:
   - Find descriptor matching current secondary series ID
   - Extract window/level defaults from manifest
   - Determine modality-specific presets

2. **Window/Level Preset System**:
   - **Manifest Preset**: Use values from fusion descriptor
   - **Modality Presets**: Predefined values for MR, CT, PET
   - **Dynamic Loading**: Update presets when secondary changes

#### Step 12: Secondary Series Management (`lines 176-228`)
1. **Series List Rendering**:
   - Show all available secondary options
   - Display status badges (Ready, Building, Error)
   - Handle click events for series selection

2. **Status Indicator Logic**:
   - **Ready**: Green badge, series can be displayed
   - **Loading**: Blue badge with spinner, fusion in progress  
   - **Error**: Red badge, fusion failed with error message
   - **Disabled**: Gray badge, series not available for fusion

3. **User Interaction**:
   - Click to select/deselect secondary series
   - Disabled state prevents interaction during loading
   - Visual feedback for current selection

### Performance Optimizations

#### Step 13: Caching Strategy
1. **Multi-Level Caching**:
   - **Manifest Cache**: Metadata and file paths
   - **Slice Cache**: Processed image data per SOP UID
   - **Canvas Cache**: Rendered overlay canvases

2. **Memory Management**:
   - **LRU Eviction**: Remove oldest cached slices when memory full
   - **Reference Counting**: Track active slice usage
   - **Garbage Collection**: Clear unused caches on series change

#### Step 14: Request Optimization
1. **Debouncing**: Prevent rapid-fire requests during navigation
2. **Request Cancellation**: Cancel outdated requests using tokens
3. **Batch Operations**: Group related manifest requests
4. **Background Loading**: Prefetch adjacent slices during idle time

## 4. Patient Database Structure and DICOM Fields - Step by Step

### Overview
The system uses **PostgreSQL** as the primary database, with the schema defined in `shared/schema.ts`. The database stores both metadata extracted from DICOM files and relationships between different medical imaging components.

### Database Architecture and Relationships

#### Step 1: Core Hierarchical Tables (`schema.ts` lines 6-115)

**Patients Table** (lines 6-14):
1. **Purpose**: Store basic patient demographics and identifiers
2. **Key Fields**:
   - `id`: Auto-incrementing primary key for internal references
   - `patientID`: Unique DICOM Patient ID (0010,0020) - business key
   - `patientName`: Patient's name from DICOM (0010,0010)
   - `patientSex`: Patient gender (0010,0040)
   - `patientAge`: Age at time of study (0010,1010)
   - `dateOfBirth`: Date of birth (0010,0030)
   - `createdAt`: Timestamp when record was created

**Studies Table** (lines 16-30):
1. **Purpose**: Represent imaging studies (exam sessions)
2. **Key DICOM Fields**:
   - `studyInstanceUID`: Unique study identifier (0020,000D)
   - `patientId`: Foreign key linking to patients table
   - `studyDate`: Date of study (0008,0020)
   - `studyDescription`: Clinical description (0008,1030)
   - `accessionNumber`: Hospital accession number (0008,0050)
   - `modality`: Primary modality of study
   - `numberOfSeries`: Count of series in study
   - `numberOfImages`: Total image count across all series
   - `isDemo`: Boolean flag for demonstration data

**Series Table** (lines 44-55):
1. **Purpose**: Individual imaging series within studies
2. **Key DICOM Fields**:
   - `seriesInstanceUID`: Unique series identifier (0020,000E)
   - `seriesDescription`: Clinical description (0008,103E)
   - `modality`: Imaging modality (0008,0060) - CT, MR, PT, RTSTRUCT, etc.
   - `seriesNumber`: Series number within study (0020,0011)
   - `imageCount`: Number of images in series
   - `sliceThickness`: Slice thickness (0018,0050)
   - `metadata`: JSON field storing additional DICOM tags

**Images Table** (lines 57-73):
1. **Purpose**: Individual DICOM image/slice information
2. **Key DICOM Fields**:
   - `sopInstanceUID`: Unique image identifier (0008,0018)
   - `instanceNumber`: Image number in series (0020,0013)
   - `filePath`: Physical file location on disk
   - `imagePosition`: Patient position coordinates (0020,0032) - JSON array
   - `imageOrientation`: Image orientation vectors (0020,0037) - JSON array
   - `pixelSpacing`: Physical spacing between pixels (0028,0030) - JSON array
   - `sliceLocation`: Slice location (0020,1041)
   - `windowCenter`: Default window center (0028,1050)
   - `windowWidth`: Default window width (0028,1051)

#### Step 2: Relationship Definitions (`lines 32-114`)
1. **Patient-Study Relationship**: One-to-many (one patient, multiple studies)
2. **Study-Series Relationship**: One-to-many (one study, multiple series)
3. **Series-Images Relationship**: One-to-many (one series, multiple images)
4. **Foreign Key Constraints**: Ensure referential integrity across hierarchy

### Fusion and Registration Tables

#### Step 3: Registration Infrastructure (`lines 200-211`)
**Registrations Table**:
1. **Purpose**: Store DICOM registration transformation matrices for image fusion
2. **Key Fields**:
   - `seriesInstanceUID`: Series containing registration data
   - `sopInstanceUID`: Specific registration object
   - `sourceFrameOfReferenceUID`: Source coordinate system
   - `targetFrameOfReferenceUID`: Target coordinate system
   - `transformationMatrix`: 4x4 transformation matrix as JSON array
   - `matrixType`: Type of transformation (RIGID, AFFINE, etc.)
   - `metadata`: Additional metadata as JSON

#### Step 4: Fusion Processing Tracking (`lines 213-230`)
**Fusebox Runs Table**:
1. **Purpose**: Track fusion processing jobs and their status
2. **Key Fields**:
   - `primarySeriesId`: Reference to primary CT series
   - `secondarySeriesId`: Reference to secondary series (MR, PET)
   - `registrationId`: Associated registration transform
   - `status`: Processing status (pending, running, completed, failed)
   - `outputDirectory`: Location of generated fusion files
   - `manifestPath`: Path to fusion manifest JSON
   - `transformSource`: Source of transformation data
   - `sliceCount`, `rows`, `columns`: Output volume dimensions

### RT Structure Storage System

#### Step 5: RT Structure Hierarchy (`lines 232-277`)

**RT Structure Sets Table** (lines 232-243):
1. **Purpose**: Store metadata for radiation therapy structure sets
2. **Key Fields**:
   - `seriesId`: Link to RT structure series
   - `referencedSeriesId`: CT/MR series the structures are drawn on
   - `frameOfReferenceUID`: Coordinate system reference
   - `structureSetLabel`: Clinical label for the structure set
   - `structureSetDate`: Date structure set was created

**RT Structures Table** (lines 246-254):
1. **Purpose**: Individual organs/targets within structure sets
2. **Key Fields**:
   - `rtStructureSetId`: Foreign key to parent structure set
   - `roiNumber`: ROI number from DICOM
   - `structureName`: Clinical name (e.g., "Heart", "PTV")
   - `color`: RGB color values for display (array)
   - `isVisible`: Visibility toggle state

**RT Structure Contours Table** (lines 257-265):
1. **Purpose**: Polygon data defining structure boundaries
2. **Key Fields**:
   - `rtStructureId`: Foreign key to parent structure
   - `slicePosition`: Z-coordinate of the contour slice
   - `points`: Flattened array of 3D coordinates defining polygon
   - `isPredicted`: Whether contour was AI-generated
   - `predictionConfidence`: AI confidence score

#### Step 6: History and Audit Trail (`lines 268-277`)
**RT Structure History Table**:
1. **Purpose**: Track all changes to structures for clinical audit
2. **Key Fields**:
   - `rtStructureSetId`: Structure set being modified
   - `userId`: Future user tracking capability
   - `actionType`: Type of change (create, update, delete, brush, etc.)
   - `actionDetails`: JSON with detailed information
   - `affectedStructureIds`: Array of structure IDs changed
   - `snapshot`: Complete state snapshot for rollback
   - `timestamp`: When change occurred

### DICOM Metadata Extraction Process

#### Step 7: Primary Metadata Parser (`routes.ts` lines 435-467)
**Extraction Process**:
1. **File Reading**: Read DICOM file using dicom-parser library
2. **Core Fields Extraction**:
   - **Patient Information**: Name, ID, sex, age, birth date
   - **Study Information**: UID, date, time, description, accession number
   - **Series Information**: UID, description, number, modality
   - **Image Information**: Position, orientation, pixel spacing, window settings
   - **Technical Parameters**: Slice thickness, rows, columns, rescale values

3. **Data Cleaning**:
   - Filter out null/undefined values
   - Normalize string formats
   - Validate numeric ranges

#### Step 8: Specialized Fusion Parser (`fusion/dicom-metadata.ts` lines 49-102)
**Enhanced Extraction**:
1. **Geometric Information**:
   - Frame of Reference UID for coordinate system consistency
   - Image orientation/position for spatial alignment
   - Pixel spacing for geometric accuracy

2. **Display Parameters**:
   - Window center/width arrays for multi-window displays
   - Photometric interpretation for color/grayscale determination
   - Rescale slope/intercept for pixel value conversion

3. **Technical Details**:
   - Bits allocated/stored for pixel data interpretation
   - Pixel representation for signed/unsigned data
   - Samples per pixel for color image support

### Advanced Features and Extensions

#### Step 9: Media Preview System (`lines 76-91`)
**Media Previews Table**:
1. **Purpose**: Store thumbnails and preview movies for series
2. **Key Fields**:
   - `seriesId`: Link to parent series
   - `type`: 'thumbnail' or 'movie'
   - `format`: File format (png, jpg, mp4, gif)
   - `filePath`: Location of preview file
   - `status`: Processing status (pending, processing, completed, failed)
   - `frameCount`: For movies, number of frames
   - `processedAt`: When preview was generated

#### Step 10: Patient Organization (`lines 411-427`)
**Patient Tags Table**:
1. **Purpose**: Organize patients by anatomical sites and registration status
2. **Key Fields**:
   - `patientId`: Link to patient record
   - `tagType`: Category (anatomical, registration, fusion, custom)
   - `tagValue`: Tag content
   - `color`: Visual color coding
   - `createdAt`: When tag was applied

#### Step 11: Network Integration (`lines 154-197`)
**PACS Connections Table**:
1. **Purpose**: Configure DICOM network connections
2. **Key Fields**:
   - `name`: Connection name
   - `aeTitle`: Application Entity Title
   - `hostname`, `port`: Network location
   - `protocol`: DICOM or DICOMweb
   - `wadoUri`, `qidoUri`, `stowUri`: DICOMweb endpoints

**Network Queries Table**:
1. **Purpose**: Track DICOM queries and their results
2. **Key Fields**:
   - `pacsId`: Source PACS connection
   - `queryType`: C-FIND or QIDO-RS
   - Patient/study search criteria
   - `status`: Query status and result count

### Data Integrity and Performance

#### Step 12: Schema Validation and Types (`lines 116-151`)
1. **Drizzle Schema Integration**:
   - Type-safe database operations
   - Automatic TypeScript type generation
   - Zod validation schemas for runtime checking

2. **Insert Schemas**:
   - Omit auto-generated fields (id, timestamps)
   - Validate required fields before database insertion
   - Type checking for all DICOM metadata

#### Step 13: Performance Considerations
1. **Indexing Strategy**:
   - Primary keys on all tables for fast joins
   - Unique constraints on DICOM UIDs prevent duplicates
   - Foreign key relationships ensure referential integrity

2. **JSON Storage Optimization**:
   - Complex DICOM tags stored as JSON in metadata fields
   - Enables flexible schema evolution without migrations
   - Supports efficient querying of nested DICOM attributes

3. **File System Integration**:
   - Database stores metadata and file paths only
   - Actual DICOM pixel data remains in original files
   - Fusion outputs cached in structured directory hierarchy

This comprehensive database design supports both basic DICOM viewing and advanced clinical workflows including image fusion, radiation therapy planning, and AI-assisted contouring, while maintaining full DICOM standard compliance and clinical audit capabilities.
