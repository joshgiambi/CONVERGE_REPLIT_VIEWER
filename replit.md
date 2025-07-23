# Superbeam - DICOM Medical Imaging System

## Overview

Superbeam is a full-stack DICOM (Digital Imaging and Communications in Medicine) medical imaging application built with React, Express.js, and PostgreSQL. The system allows users to upload, manage, and view medical images with proper DICOM metadata handling. It includes a complete PACS-like interface for medical imaging workflows with advanced contour editing capabilities.

**CRITICAL: Fusion Registration Requirements**
- Multi-modal fusion (CT/MRI) MUST use DICOM registration transformation matrices
- Registration files contain 4x4 rigid transformation matrices for spatial alignment
- NEVER use simple linear slice mapping for fusion - always apply registration matrix
- Registration matrix transforms CT coordinates to MRI space for proper alignment
- The system stores registration matrices in the database registrations table
- **NEVER CALCULATE ADDITIONAL OFFSETS - THE REGISTRATION FILE IS THE ABSOLUTE TRUTH**
- The registration matrix contains ALL necessary transformations - use it directly without modifications

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS with shadcn/ui components
- **State Management**: TanStack Query for server state management
- **Build Tool**: Vite with hot reload development server
- **UI Components**: Radix UI primitives with custom styling

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **File Upload**: Multer middleware for handling DICOM file uploads
- **DICOM Processing**: Custom DICOM parser using dicom-parser library
- **Static File Serving**: Express static middleware for serving built frontend and DICOM files

### Database Architecture
- **Primary Database**: PostgreSQL via Neon serverless
- **ORM**: Drizzle ORM with schema-based type safety
- **Migration Management**: Drizzle Kit for database migrations

## Key Components

### DICOM File Management
- **File Upload System**: Handles DICOM file uploads with validation
- **Metadata Extraction**: Parses DICOM headers to extract medical imaging metadata
- **File Storage**: Organizes uploaded files in structured directory hierarchy
- **DICOM Validation**: Validates files by checking for DICM magic number at byte 128

### Medical Data Hierarchy
- **Patients**: Top-level patient records with demographics
- **Studies**: Medical imaging studies linked to patients
- **Series**: Groups of related images within studies
- **Images**: Individual DICOM image instances

### Demo Dataset Integration
- **HN-ATLAS Dataset**: Includes Head & Neck CT imaging dataset (153 slices)
- **RT Structure Sets**: Support for radiation therapy structure overlays
- **Sample Data Population**: Scripts for populating demo medical imaging data

## Data Flow

1. **File Upload**: Users upload DICOM files through web interface
2. **DICOM Parsing**: Server validates and extracts metadata from DICOM headers
3. **Database Storage**: Metadata stored in PostgreSQL with file references
4. **Hierarchy Organization**: Files organized by Patient → Study → Series → Image
5. **Image Serving**: DICOM files served with proper content-type headers
6. **Frontend Display**: React components display medical imaging data with proper organization

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL database connection
- **dicom-parser**: DICOM file format parsing
- **multer**: File upload handling
- **drizzle-orm**: Type-safe database ORM
- **@tanstack/react-query**: Server state management
- **@radix-ui/react-***: UI component primitives

### Development Dependencies
- **vite**: Frontend build tool and development server
- **typescript**: Type safety across the stack
- **tailwindcss**: Utility-first CSS framework
- **drizzle-kit**: Database migration toolkit

## Deployment Strategy

### Development Environment
- **Runtime**: Node.js 20 with ES modules
- **Development Server**: Vite dev server with hot reload
- **Database**: Neon PostgreSQL serverless instance
- **File Storage**: Local filesystem with uploads directory

### Production Build
- **Frontend**: Vite production build to `dist/public`
- **Backend**: ESBuild compilation to `dist/index.js`
- **Static Assets**: Express serves built frontend and DICOM files
- **Database**: Production Neon PostgreSQL instance

### Replit Configuration
- **Modules**: nodejs-20, web, postgresql-16, python-3.11
- **Port Configuration**: Internal port 5000, external port 80
- **Auto-scaling**: Configured for autoscale deployment target

## Critical Implementation Notes

### Fusion Registration System
- **Registration Matrix**: The fusion viewer MUST use the 4x4 transformation matrix from DICOM registration files
- **Matrix Application**: Full 3D transformation including X, Y, and Z coordinates
- **Database Storage**: Registration matrices are stored in the registrations table with transformation_matrix as JSON array
- **API Endpoint**: `/api/registrations/:studyId` returns the transformation matrix for fusion alignment
- **Fallback Behavior**: Only use linear mapping if registration matrix is unavailable (with console warning)

#### Critical Implementation Details (PROVEN WORKING):
1. **Center-to-Center Alignment**: Registration matrices align anatomical centers, NOT image corners
   - Calculate MRI center in physical space: `mriPosition + (dimensions/2 * pixelSpacing)`
   - Transform MRI center to CT space using registration matrix
   - Calculate offset between transformed MRI center and CT center
   - Apply offset to achieve proper anatomical alignment

2. **Coordinate System Transformations**:
   - Convert pixel coordinates to physical (mm) coordinates using image position and pixel spacing
   - Apply 4x4 registration transformation matrix
   - Convert back to pixel coordinates for display
   - DICOM pixel spacing is [row spacing, column spacing] = [Y spacing, X spacing]

3. **Database Requirements**:
   - All images MUST have `image_position` and `pixel_spacing` metadata populated
   - Missing metadata causes misalignment - run update scripts if needed

4. **Z-Axis Slice Matching**:
   - Transform all MRI slice positions to CT coordinate space
   - Find MRI slice with minimum Z-distance to current CT slice
   - Only render fusion if Z-distance < 10mm (tight tolerance)

## Changelog

- July 23, 2025: Implemented Parallel Batch Loading Optimization - COMPLETED
  - ✅ Fixed server overwhelm issue when loading large image sets by implementing batch loading
  - ✅ Modified preloadAllImages function to load images in batches of 10 instead of all at once
  - ✅ Each batch of 10 images loads in parallel, then waits before loading the next batch
  - ✅ Added incremental progress logging showing percentage completion (e.g., "Loaded 50/200 images (25%)")
  - ✅ Cache updates incrementally after each batch for smoother user experience
  - ✅ Maintains parallel loading benefits while preventing too many concurrent server requests
  - ✅ Secondary images (MRI) already had batch loading implemented, now primary images match
  - Previous issue: Loading 200+ images simultaneously would overwhelm the server with concurrent requests
  - Solution: Batch loading with 10 concurrent requests at a time, sequential batch processing
- July 23, 2025: Fixed MRI Fusion Slice Position Display - COMPLETED
  - ✅ Removed confusing MRI slice position display during fusion viewing
  - ✅ Confirmed CT slice position is the correct reference frame for fusion
  - ✅ MRI slices are transformed to CT coordinate space, not vice versa
  - ✅ Fusion display now shows only CT Z position as the spatial reference
  - ✅ Maintains standard medical imaging convention: CT provides spatial reference for multi-modality fusion
  - Previous issue: Added MRI slice position display that confused the reference frame
  - Solution: Show only CT position since fusion is referenced to CT coordinate system
- July 23, 2025: Fixed Fusion "None" Selection Database Errors - COMPLETED
  - ✅ Fixed critical bug where selecting "none" in fusion panel caused database errors
  - ✅ Added validation in loadSecondaryImages to check for invalid secondarySeriesId values
  - ✅ Enhanced validation to prevent API calls with string "none" or NaN values
  - ✅ Updated renderFusionOverlay to handle "none" string values properly
  - ✅ System now gracefully handles null/invalid secondary series selections
  - Previous issue: "invalid input syntax for type integer: 'none'" database errors
  - Solution: Added comprehensive validation before all API calls using secondarySeriesId
- July 23, 2025: Fusion System Enhancement - Registration Parsing and Grey REG Pills - COMPLETED
  - ✅ Fixed fusion control panel not appearing for PET/CT cases by adding automatic registration parsing
  - ✅ Added registration matrix parsing when clicking REG files before initiating fusion
  - ✅ REG file onClick now calls `/api/registrations/${studyId}/parse` to extract and store transformation matrix
  - ✅ Fusion control panel now appears for any modality combination with valid REG file
  - ✅ Fixed contextual fusion labels (PT Fusion vs MR Fusion) based on secondary modality
  - ✅ Enhanced fusion panel to dynamically detect and display correct modality labels
  - ✅ Kept REG file pills grey (not yellow) per user preference for subtle appearance
  - Previous issue: Fusion control panel required registration matrix but wasn't loading for PET/CT
  - Solution: Parse REG file on click to populate registration matrix in database before fusion
- July 23, 2025: Critical Import Data Integrity Safeguards - COMPLETED
  - ✅ CRITICAL BUG FIXED: Studies were being linked to wrong patient IDs during import process
  - ✅ Root cause: No verification between patient creation and study linking, allowing race conditions
  - ✅ Implemented comprehensive safeguards in import process:
    - Patient verification before each study creation
    - Re-fetch patient data to ensure correct ID is used
    - Verify study was created with correct patient link after creation
    - Check existing studies are linked to expected patient
    - Transaction-like error handling that preserves data on failure
  - ✅ Added detailed logging at each verification step for debugging
  - ✅ Import now fails fast with descriptive errors if data integrity issues detected
  - ✅ Preserved upload sessions on error to prevent data loss during recovery
  - Previous issue: Patient created with ID 20, but study linked to non-existent patient ID 17
  - Solution: Multi-layer verification ensures patient-study relationships are always correct
- July 23, 2025: Critical Import Data Loss Fix - COMPLETED
  - ✅ Fixed CRITICAL bug where import process was deleting files before moving them to permanent storage
  - ✅ Enhanced moveDatasetToPermanentStorage to search for files in subdirectories (handles ZIP extractions)
  - ✅ Added safety check: upload directory is ONLY deleted if ALL files are successfully moved
  - ✅ Fixed field name mismatch between parsing (filename) and import (fileName) processes
  - ✅ Added comprehensive logging to track file movement and identify failures
  - ✅ Import now throws error and preserves upload directory if any files fail to move
  - ✅ Fixed UI showing "0 images" in triage sessions by using correct field names
  - ✅ Successfully imported ESOPHAGUS_31 dataset (215 DICOM files)
  - Previous issue: "Permanent file not found" errors - files were deleted without being moved
  - Solution: Move files FIRST, verify success, THEN cleanup - never delete on partial failure
- July 23, 2025: Duplicate DICOM Import Protection System - COMPLETED
  - ✅ Fixed critical duplicate key constraint error preventing large dataset imports
  - ✅ Added duplicate checking logic to skip existing images during import process
  - ✅ Enhanced recursive DICOM file detection for ZIP-extracted nested directories
  - ✅ Successfully imported ESOPHAGUS_31 dataset (554 DICOM files) with 2 studies
  - ✅ Fixed upload session recovery after server restart using triage system
  - ✅ Import process now gracefully handles duplicate SOP Instance UIDs
  - ✅ System automatically skips existing images while preserving new data integrity
  - Previous issue: "duplicate key value violates unique constraint images_sop_instance_uid_unique"
  - Solution: Added getImageByUID check before createImage to prevent duplicate insertions
- July 23, 2025: Patient-Based Storage System Implementation - COMPLETED
  - ✅ Implemented structured patient storage system: storage/patients/{patientId}/{studyUID}/{seriesUID}/{sopUID}.dcm
  - ✅ Created PatientStorage class for managing DICOM file organization and storage lifecycle
  - ✅ Updated import workflow to move files from temporary uploads to permanent patient storage
  - ✅ Added automatic file path updates in database after successful import
  - ✅ Implemented automatic cleanup of temporary upload directories after file migration
  - ✅ Added patient storage management API endpoints for monitoring storage usage
  - ✅ Files now organized by medical hierarchy instead of random upload session IDs
  - ✅ Permanent storage ensures files persist even after import session cleanup
  - ✅ Added storage overview endpoint to monitor patient data organization
  - Previous issue: Files were deleted when upload sessions were cleaned up, breaking image serving
  - Solution: Hierarchical patient storage with automatic migration during import process
- July 23, 2025: Automatic Upload-to-Parse Workflow Implementation - COMPLETED
  - ✅ Implemented automatic parsing workflow: Upload → Auto-Parse → Triage → Import  
  - ✅ Added triage sessions state management and UI display
  - ✅ Created "Ready to Import" section as primary interface for parsed files
  - ✅ Modified "Unprocessed Files" to be fallback section for orphaned files only
  - ✅ Files now automatically move to triage after parsing completion
  - ✅ Enhanced import handler to use triage import endpoint with proper cleanup
  - ✅ Added comprehensive polling for both triage sessions and unprocessed files
  - ✅ Upload flow now seamless: user uploads → system auto-parses → shows "Ready to Import" → user clicks import
  - Manual "Process" button now only appears as fallback when automatic processing fails
  - System maintains clean separation: active parsing vs ready-to-import vs orphaned files
- July 23, 2025: Unprocessed Files Cleanup System Completion - COMPLETED
  - ✅ Fixed critical uploadSessionId preservation through parsing → triage → import workflow
  - ✅ Enhanced debug logging for uploadSessionId tracking at all workflow stages
  - ✅ Fixed import logic error (study.values() → study.series.values()) preventing successful imports
  - ✅ Verified complete cleanup functionality: unprocessed files properly removed after import
  - ✅ Added comprehensive error handling and troubleshooting for import operations
  - ✅ Confirmed end-to-end workflow with automatic cleanup: Upload → Parse → Triage → Import → Cleanup
  - ✅ Upload session directories are preserved during processing and cleaned up only after successful import
  - ✅ System now maintains clean file state with no leftover unprocessed files after workflow completion
  - ✅ Fixed orphaned file cleanup issue with enhanced debugging and manual cleanup verification
  - Final verification: API endpoint `/api/unprocessed-files` returns `{"files":[]}` after successful import and cleanup
- July 23, 2025: Import Workflow Enhancement and Verification - COMPLETED
  - ✅ Fixed Import to Database functionality with comprehensive debug logging
  - ✅ Enhanced triage import workflow with better matching logic for parsed sessions
  - ✅ Added success toasts and proper loading states for import operations
  - ✅ Verified end-to-end workflow: Upload → Parse → Triage → Import works seamlessly
  - ✅ Import automatically detects triage sessions and uses optimized import endpoint
  - ✅ Added proper query invalidation for patients, studies, and series data refresh
  - ✅ Confirmed navigation redirect to patient manager after successful import
  - System successfully imports large datasets (554 DICOM files) with complete metadata preservation
- July 23, 2025: Triage Folder System Implementation - COMPLETED
  - ✅ Implemented triage folder system to separate upload → parse → import workflow states
  - ✅ Added server-side triageSessions storage for parsed but not imported files
  - ✅ Created API endpoints: GET/DELETE /api/triage-sessions for managing triage sessions
  - ✅ Enhanced DICOM uploader UI with "Ready to Import" section showing parsed sessions
  - ✅ Added import functionality directly from triage sessions with one-click import
  - ✅ Improved workflow clarity: raw uploads go to unprocessed, parsed files go to triage, imported files go to database
  - ✅ Fixed confusing UI where same files appeared in multiple states simultaneously
  - ✅ Added triage session metadata display showing patient/image counts and timestamps
  - ✅ Implemented cleanup functionality to remove triage sessions after successful import
  - Rationale: User identified workflow confusion where parsed files appeared as both "unprocessed" and "import data" - triage system creates clear state separation
- July 23, 2025: ZIP File Upload Support - COMPLETED
  - ✅ Fixed ZIP file upload issue by adding extraction capability
  - ✅ Imported yauzl library for ZIP file extraction
  - ✅ Added extractZipFile function to handle ZIP extraction
  - ✅ Modified upload endpoint to detect and extract ZIP files before processing
  - ✅ System now extracts DICOM files from ZIP archives automatically
  - ✅ Supports mixed uploads of both ZIP files and individual DICOM files
  - ✅ Cleans up ZIP files after successful extraction
  - ✅ Only processes .dcm files or files without extensions from ZIP archives
- July 23, 2025: Viewer Consolidation and Patient Selection - COMPLETED
  - ✅ Consolidated dual viewer system (dicom-viewer and enhanced-viewer) into a single unified viewer
  - ✅ Renamed enhanced-viewer to just "viewer" for simplicity
  - ✅ All viewer routes (/viewer, /dicom-viewer, /enhanced-viewer) now redirect to the unified viewer
  - ✅ Removed redundant dicom-viewer.tsx file and associated code
  - ✅ Added patient selection functionality to patient manager with checkboxes
  - ✅ Implemented contextual Export and Merge buttons that appear when patients are selected
  - ✅ Created export dialog showing all series from selected patients
  - ✅ Added merge dialog with options to merge patients
  - Rationale: The enhanced viewer had all features of the standard viewer plus RT structures, fusion, and contour editing, making the dual system unnecessary
- July 23, 2025: RT Structure Management System Phase 1 - COMPLETED
  - ✅ Created comprehensive design document for RT structure management with time machine feature
  - ✅ Added new database tables: rt_structure_sets, rt_structures, rt_structure_contours, rt_structure_history
  - ✅ Implemented persistent storage for RT structure modifications (replacing in-memory storage)
  - ✅ Added complete storage interface with methods for RT structure CRUD operations
  - ✅ Implemented DatabaseStorage methods for all RT structure operations
  - ✅ Added type definitions and schemas for all new RT structure tables
  - ✅ Designed API endpoints for RT structure management and history tracking
  - ✅ Documented UI mockups for patient manager enhancements and time machine interface
  - Next phase: Implement API endpoints and migrate existing RT structure data
- July 18, 2025: Server-Side DICOM Parsing Sessions - COMPLETED
  - ✅ Implemented background parsing sessions that continue when user navigates away
  - ✅ Added `/api/parse-dicom-session` endpoint to start async parsing sessions
  - ✅ Added `/api/parse-dicom-session/:sessionId` endpoint for status polling
  - ✅ Real-time progress display shows actual file being processed (e.g., "File 15 of 50: CT.Image.23.dcm")
  - ✅ Session IDs stored in localStorage for recovery on page refresh
  - ✅ Parsing continues server-side even when user leaves Import DICOM tab
  - ✅ Progress automatically resumes when returning to Import tab
  - ✅ Added informative message: "You can navigate away - parsing continues in background"
- July 18, 2025: CSS-Based Animated Previews for Patient Cards - COMPLETED
  - ✅ Discovered browser environment blocks ALL images (including data URLs and GIFs)
  - ✅ Implemented CSS-based animated preview system as alternative to GIF images
  - ✅ Created gradient backgrounds with animated sliding effect for multi-slice series
  - ✅ Added visual indicators: "Animated Preview" badge with pulsing green dot
  - ✅ Series with single image show static modality text, multi-image series show animation
  - ✅ Fixed fallback display to properly show modality text when images fail
  - ✅ GIF generation backend still works properly (verified with curl) but browser blocks display
- July 18, 2025: Simplified Tag System and Fixed Metadata Update Issues - COMPLETED
  - ✅ Removed tag category dropdown per user request - now simple text input for tags
  - ✅ Fixed patient age field not updating (was using wrong field name 'age' instead of 'patientAge')
  - ✅ Fixed missing thumbnails after metadata update by adding proper query invalidation
  - ✅ Added refresh mechanism to PatientCard component to update all data after changes
  - ✅ Tags now display with neutral gray styling instead of colored categories
  - ✅ Fixed metadata dialog initialization to properly load current patient data
- July 18, 2025: Enhanced Metadata Editing UI and Registration Visualization - COMPLETED
  - ✅ Redesigned metadata edit dialog with dark theme matching overall UI design
  - ✅ Improved patient tags with emoji icons and color presets (Anatomical, Registration, Fusion, Custom)
  - ✅ Added auto-generate tags button that creates anatomical tags from RT structures
  - ✅ Enhanced registration visualization showing CT→MRI connections with gradient lines and icons
  - ✅ Fixed GIF generation with fallback placeholder frames for robust preview generation
  - ✅ Patient cards now show GIF animations for CT/MR series with 30-frame previews
  - ✅ Registration info displays which MRI is co-registered with CT using visual connection diagram
  - ✅ RT structures display in expanded card view with proper color coding
  - ✅ Added comprehensive metadata editing for patient info and series descriptions
- July 18, 2025: Patient Card Redesign with GIF Previews and Expandable Structure Display - COMPLETED
  - ✅ Implemented GIF generation endpoint at `/api/series/:id/gif` for 30-frame DICOM previews
  - ✅ Added canvas and gifencoder dependencies for server-side GIF generation
  - ✅ Redesigned patient cards to be expandable (replaced hover with expand/collapse functionality)
  - ✅ Patient cards now display RT structures in expanded view with color-coded structure names
  - ✅ Added registration information display showing MRI series linked via registration matrix
  - ✅ Replaced static image previews with animated GIF thumbnails for better visualization
  - ✅ Added fusion-ready badge when both CT and MRI series with registration are available
  - ✅ Fixed dicomParser usage in GIF generator with proper error handling and placeholder frames
- July 18, 2025: Fusion UI Improvements and Opacity Fix - COMPLETED
  - ✅ Fixed fusion opacity slider issue where 0% still showed MRI overlay (now properly skips rendering at 0 opacity)
  - ✅ Fixed show/hide all structures button to actually toggle contour visibility
  - ✅ Updated global contour settings: default opacity 10%, default width 2px, minimum opacity 0%
  - ✅ Simplified MRI fusion panel with clean button interface (removed broken image preview thumbnails)
  - ✅ Made fusion panel more compact with 3-column grid layout (width 80, padding 3)
  - ✅ Removed non-functional auto-zoom and auto-localize controls from structure settings
  - ✅ User feedback: Prefers compact fusion UI over row-based layouts
- July 18, 2025: Perfect CT/MRI Fusion Alignment Using Center-to-Center Registration - COMPLETED
  - ✅ Fixed critical fusion misalignment issue by implementing center-to-center coordinate transformation
  - ✅ Registration matrices now properly align anatomical centers, not image corners
  - ✅ Calculate MRI center in physical space using image position + (dimensions/2 * pixel spacing)
  - ✅ Transform MRI center to CT space using 4x4 registration matrix
  - ✅ Calculate center offset between transformed MRI center and CT center
  - ✅ Apply pixel offset based on center alignment for perfect anatomical registration
  - ✅ Added comprehensive logging for debugging coordinate transformations
  - ✅ Documented proven working fusion methodology in Critical Implementation Details
  - ✅ User confirmed: "PERFECT, YOU DID IT" - fusion alignment now working flawlessly
- July 17, 2025: Fusion Panel State Sync and Series Selection Integration - COMPLETED
  - ✅ Fixed critical fusion panel state synchronization issue where secondarySeriesId wasn't syncing between components
  - ✅ Updated WorkingViewer to use external secondarySeriesId prop directly instead of local state
  - ✅ Modified FusionControlPanel to accept selectedSecondaryId prop and removed conflicting local state management
  - ✅ Added secondary series handlers (onSecondarySeriesSelect, onFusionOpacityChange) to ViewerInterface component
  - ✅ Updated SeriesSelector interface to accept secondarySeriesId prop for fusion selection synchronization
  - ✅ Series list now shows which MRI is selected for fusion with purple glow and "Fusion Active" badge
  - ✅ Clarified MRI click behavior: clicking MRI in series list views MRI alone and activates fusion if CT is currently selected
  - ✅ Fusion panel thumbnails now correctly sync with series selection state
- July 17, 2025: Fusion X-Y Alignment Fix and UI Improvements - COMPLETED
  - ✅ Fixed X-Y alignment issue in MRI fusion by properly applying registration matrix transformation
  - ✅ Updated registration matrix transformation to calculate proper X-Y offset between CT and MRI
  - ✅ Fixed multiplyMatrixVector function error by defining it at the top of renderFusionOverlay
  - ✅ Enhanced series selector UI to show registration relationships with "Fusion-ready MRI (Registered)" label
  - ✅ MRI series now appear nested under CT series with purple theme to indicate fusion capability
  - ✅ Registration files no longer appear as selectable items in series list
  - ✅ Added real MRI image thumbnails to fusion panel replacing placeholder icons
  - ✅ Thumbnails now show middle slice preview of each MRI series for better visual selection
  - Note: MRI fusion still limited to registered areas - disappears when CT extends beyond MRI coverage as intended
- July 16, 2025: MRI Window/Level Controls and UI Refinements - COMPLETED
  - ✅ Removed redundant MR tab buttons from fusion control panel since thumbnails provide same functionality
  - ✅ Added dedicated MRI window/level controls to fusion panel with preset buttons (Auto, T1, T1+C)
  - ✅ Fixed MRI rendering using controlled window/level state instead of hardcoded values
  - ✅ Added live window/level display showing current width and center values for MRI
  - ✅ MRI window/level can now be adjusted independently from CT window/level controls
  - Note: Right-click drag still only adjusts CT window/level, MRI must be adjusted via fusion panel buttons
- July 16, 2025: Database Cleanup and DICOM Metadata Integration - COMPLETED
  - ✅ Deleted older fusion patient and all associated data
  - ✅ Updated patient names to use real DICOM metadata (SKXivnJzBjPxssVj) instead of made-up names
  - ✅ Fixed patient IDs to match between patients and studies tables for proper viewer button functionality
  - ✅ Updated MRI window/level default values from hardcoded 1069/615 to more appropriate 400/800
  - ✅ Added logging for MRI window/level values showing actual DICOM metadata values
  - ✅ Verified fusion dataset contains: CT (200 images), MR "AX T1 FS+C" (60 images), MR "AX T1" (60 images), RT structures, and image registration
  - Note: MRI window/level values vary significantly: AX T1 (257-684 center, 446-1189 width), AX T1 FS+C (220-917 center, 383-1593 width)
- July 16, 2025: Enhanced Medical Image Fusion System - COMPLETED
  - ✅ Implemented automatic RT structure loading for fusion dataset patient
  - ✅ Fixed MRI fusion overlay black square issue by using grayscale rendering
  - ✅ Replaced dropdown with thumbnail grid for secondary series selection
  - ✅ Added visual thumbnails with selection indicators for faster MRI switching
  - ✅ Added window/level adjustment tip for MRI series (right-click + drag)
  - ✅ Fixed auto-selection of first MR series when fusion panel opens
  - ✅ Enhanced fusion control panel with purple-themed UI and better layout
  - ✅ Fusion opacity slider shows CT/MR balance with labeled endpoints
  - Note: Fusion dataset now contains 2 MRI series (AX T1 FS+C and AX T1, 60 images each)
- July 11, 2025: Added Advanced Contour Editing Operations - COMPLETED
  - ✅ Added Interpolate button to fill missing slices between existing contours using linear interpolation
  - ✅ Added Nth Slice Delete button with hover menu to delete every 2nd, 3rd, or 4th slice
  - ✅ Added Clear button with hover options: delete all slices, delete below current, delete above current
  - ✅ All new operations work only on the selected contour structure
  - ✅ Full undo/redo support for all new operations (interpolate, delete_nth_slice, clear_below, clear_above)
  - ✅ Hover menus provide easy access to batch operations without cluttering the interface
  - ✅ Server automatically tracks all new action types in history for proper undo/redo
- July 11, 2025: Fixed Undo/Redo for All Contour Operations - COMPLETED
  - ✅ Updated server endpoint to track specific action types in history (delete_slice, clear_all, etc.)
  - ✅ Modified all saveContourUpdates calls to include action metadata for proper undo/redo tracking
  - ✅ Added server-side RT structure caching to improve undo/redo performance
  - ✅ Fixed data flow between ContourEditToolbar and WorkingViewer using forwardRef/useImperativeHandle
  - ✅ All contour operations now properly tracked: delete slice, clear all, brush, pen, grow, boolean, margin
  - ✅ Server detects delete operations automatically by comparing contour counts
  - ✅ Undo/redo now restores exact state for all operation types including deletions
- July 07, 2025: Eclipse TPS Draw Planar Contour Tool Integration - COMPLETED
  - ✅ Added Eclipse planar contour tool to contour edit toolbar with "Eclipse Planar" label
  - ✅ Integrated EclipsePlanarContourTool component into working viewer for "planar-contour" tool
  - ✅ Added comprehensive settings panel with drawing mode and line style controls
  - ✅ Implemented tool-specific settings panels for brush, pen, and planar contour tools
  - ✅ Added detailed usage instructions for Eclipse TPS workflow in settings panel
  - ✅ Updated pointer events handling to include planar contour tool
  - ✅ Eclipse planar contour tool now appears alongside ITK-SNAP pen tool in toolbar
  - ✅ Full Eclipse TPS specification support with curved/straight line drawing modes
- July 07, 2025: ITK-SNAP Style Pen Tool Implementation - COMPLETED
  - ✅ Rebuilt pen tool to match ITK-SNAP polygon tool behavior (medical imaging standard)
  - ✅ Simplified state machine: IDLE → DRAWING → PREVIEW (removed complex states)
  - ✅ ITK-SNAP workflow: click to place vertices, click near first vertex or right-click to close
  - ✅ Preview mode with green rectangle boundary (ITK-SNAP visual style)
  - ✅ Accept/Cancel buttons appear in preview mode for polygon finalization
  - ✅ Vertex editing via selection box - draw box around vertices to select and drag
  - ✅ Paste functionality - copies last accepted polygon to current slice
  - ✅ Keyboard shortcuts: Escape (cancel), Enter (accept), Ctrl+V (paste)
  - ✅ Medical-grade coordinate transformations and proper HFS handling
  - ✅ Removed complex context menus for simplified medical workflow
- July 06, 2025: Brush Tool Width Calibration - COMPLETED
  - ✅ Fixed brush tool output being wider than brush diameter
  - ✅ Changed brush stroke generation to use brushSize/2 as offset on each side
  - ✅ Updated circle creation to use diameter instead of radius internally
  - ✅ Brush tool now produces exact line width matching the brush size slider value
- July 05, 2025: Fixed Critical RT Structure Issues - COMPLETED
  - ✅ Fixed "Error loading DICOM" after contour operations by adding delayed image display
  - ✅ Added proper error handling to prevent RT structure rendering from crashing image display
  - ✅ Fixed RT structures disappearing after delete/grow operations by updating parent state
  - ✅ Fixed pen tool preventing scroll by allowing wheel events to pass through
  - ✅ Improved state management to prevent unnecessary re-renders during RT structure updates
- July 05, 2025: Eclipse TPS Pen Tool Implementation - COMPLETED
  - ✅ Implemented comprehensive pen tool following Eclipse Treatment Planning System specification
  - ✅ Created complete state machine (IDLE → ACTIVE → DRAWING → EDITING → COMPLETE)
  - ✅ Added vertex placement with mouse tracking and coordinate transformation
  - ✅ Implemented vertex dragging and editing capabilities 
  - ✅ Added auto-close detection when cursor near first vertex (3+ vertices)
  - ✅ Right-click completes polygon following medical software standards
  - ✅ Ghost line preview shows next segment while drawing
  - ✅ Vertex snapping system with visual indicators
  - ✅ First vertex highlighted in purple to indicate closure point
  - ✅ Proper HFS coordinate transformations for medical imaging accuracy
- July 05, 2025: Complete Undo/Redo System for RT Structure Operations - COMPLETED
  - ✅ Implemented server-side in-memory storage for RT structure modifications with history tracking
  - ✅ Created API endpoints for undo/redo operations at `/api/rt-structures/:seriesId/undo` and `/redo`
  - ✅ Added contour persistence endpoint `/api/rt-structures/:seriesId/contours` for saving brush/pen edits
  - ✅ All contour operations (brush, pen, grow, boolean, delete) now automatically save to server
  - ✅ Added undo/redo buttons to contour edit toolbar with visual feedback and loading states
  - ✅ Fixed payload too large error by increasing Express body parser limit to 50MB
  - ✅ Implemented history management with proper state restoration for all operations
  - ✅ Created comprehensive undo/redo functionality matching medical imaging software standards
- July 04, 2025: Medical-Grade Grow Function with CM Measurements - COMPLETED
  - ✅ Updated brush size slider to display values in centimeters (cm) instead of pixels
  - ✅ Shows conversion: cm value with pixel value in parentheses for reference
  - ✅ Converted grow distance input field to a slider for better user experience
  - ✅ Grow slider ranges from 0 to 2.0 cm with 0.1 cm step precision
  - ✅ Displays both cm and mm values for grow distance (e.g., "0.5 cm (5.0 mm)")
  - ✅ Updated grow function handler to convert cm input to mm for the algorithm
  - ✅ Added grow_contour action handler to handleContourUpdate for proper integration
  - ✅ Pixel spacing: 1.171875mm per pixel (0.1171875 cm per pixel) for HN-ATLAS dataset
- July 04, 2025: Medical-Grade Pen Tool with Morphing - COMPLETED
  - ✅ Fixed brush tool coordinate system - now draws at correct position with zoom/pan
  - ✅ Applied zoom and pan transformations to match pen tool's accurate positioning
  - ✅ Pen tool completes polygon only on right-click (following 3D Slicer and Varian Eclipse standards)
  - ✅ Continuous drawing mode - mouse up doesn't stop drawing, only right-click completes
  - ✅ Hover detection shows existing contour points as draggable handles
  - ✅ Click and drag existing contour points to morph/edit contours
  - ✅ Added 'replace_contour' action for morphing existing contours
  - ✅ Visual feedback with structure-colored handles and faint contour lines when hovering
- July 04, 2025: HFS Radiological Viewing Convention Fixed - COMPLETED
  - ✅ Fixed scrolling issue - wheel events now work when brush tool is active
  - ✅ Analyzed DICOM metadata: HFS patient position, [1,0,0,0,1,0] orientation
  - ✅ Implemented proper HFS radiological viewing convention (patient's left on screen right)
  - ✅ Applied X-axis flip for correct anatomical orientation in axial views
  - ✅ Updated both viewer and shared coordinate transformation functions
  - ✅ Fixed pixel index calculations (0-511 range instead of 0-512)
  - ✅ Brush tool now uses consistent HFS coordinate transformations
- July 03, 2025: Complete Brush Tool Rebuild - COMPLETED
  - ✅ Completely rebuilt brush tool from scratch using medical imaging best practices
  - ✅ Researched 3D Slicer paint tool implementation for medical-grade functionality  
  - ✅ Implemented proper canvas overlay system with real-time cursor feedback
  - ✅ Added structure color-matched brush cursor and stroke visualization
  - ✅ Created proper coordinate transformation from canvas to DICOM world coordinates
  - ✅ Implemented smooth brush stroke collection with real-time visual feedback
  - ✅ Added proper RT structure contour point addition system
  - ✅ Fixed all parameter mismatches and component integration issues
  - ✅ Based implementation on radiotherapy contouring software standards
- July 03, 2025: Medical-Grade Contour Grow Function - COMPLETED
  - ✅ Implemented medical-grade contour growing algorithm using offset polygon techniques
  - ✅ Added radial contour expansion with millimeter precision based on research from medical imaging literature
  - ✅ Created dedicated grow button with clean interface (distance input + run button)
  - ✅ Integrated with RT structure update system to modify actual contour data
  - ✅ Applied medical-grade smoothing for professional contour quality
  - ✅ Added proper validation, error handling, and user feedback
  - ✅ Used algorithms referenced from polygon offsetting and CAD literature
  - ✅ Fixed toolbar positioning to prevent overlap with bottom navigation
- July 03, 2025: OHIF-Enhanced Brush Tool Refinement - COMPLETED
  - ✅ Implemented medical-grade brush tool engine following OHIF standards
  - ✅ Added enhanced smart brush mode with precise contour intersection detection
  - ✅ Improved interpolation algorithms for smooth stroke rendering at 60fps
  - ✅ Enhanced brush-contour intersection detection with brush radius consideration
  - ✅ Added real-time visual feedback with green/red cursor based on contour touching
  - ✅ Implemented medical-grade coordinate transformations and world space calculations
  - ✅ Added performance optimization with throttled rendering and stroke history management
  - ✅ Enhanced brush stroke smoothing and interpolation density controls
  - ✅ Fixed circular cursor display with dedicated overlay canvas for smooth rendering
  - ✅ Connected brush thickness slider to real-time brush size updates
  - ✅ Resolved coordinate transformation issues for proper stroke application
  - ✅ Added comprehensive debug logging for stroke tracking and troubleshooting
  - ✅ Integrated keyboard shortcuts (Shift for mode inversion) for professional workflow
- June 30, 2025: Auto-Zoom & Auto-Localize Function Fix - COMPLETED
  - ✅ Fixed cornerstone initialization errors by replacing unsafe cornerstoneConfig calls
  - ✅ Implemented proper window.cornerstone access with availability checks
  - ✅ Added robust error handling for viewport manipulation functions
  - ✅ Fixed TypeScript declarations for global cornerstone object
  - ✅ Auto-zoom and auto-localize now work when selecting structures for editing
  - ✅ Cleaned up debugging console logs for better performance
- June 30, 2025: Contour Delete Operations & Superbeam Rebranding - COMPLETED
  - ✅ Added three delete buttons to contour toolbar: Delete Current Slice, Delete Nth Slice, Clear All Slices
  - ✅ Delete operations appear in Operations settings panel with red destructive styling
  - ✅ Rebranded application from CONVERGE to Superbeam with vibrant gradient lettering
  - ✅ Each letter features unique color gradients (cyan to purple to pink) with glow effects
  - ✅ Updated project documentation to reflect new Superbeam branding
- June 30, 2025: Smart Brush Contour Detection - COMPLETED
  - ✅ Implemented intelligent brush mode detection based on contour intersection
  - ✅ Green brush cursor when touching selected structure's contour (add mode)
  - ✅ Red brush cursor when not touching contour (delete mode)
  - ✅ Contour intersection detection applies only to the structure being edited
  - ✅ Brush mode locks during stroke to maintain consistent behavior throughout drawing
  - ✅ Real-time visual feedback provides immediate guidance for contour editing operations
  - ✅ Fixed Vite React plugin preamble detection issue preventing page loading
- June 30, 2025: Contour Editing Toolbar Redesign - COMPLETED
  - ✅ Redesigned 4-button main toolbar: Brush, Pen, Erase, Operations with grey border/black background styling
  - ✅ Implemented persistent active tool states with enhanced visual feedback (structure color border and glow)
  - ✅ Added expandable settings panels that pop out horizontally to the right
  - ✅ Created hover expand button system for accessing advanced tool settings only when needed
  - ✅ Integrated brush thickness slider, 3D/2D mode toggle, and smart brush controls
  - ✅ Applied muted structure color borders (60% opacity) for subtle visual consistency
  - ✅ Positioned toolbar above main interface with proper z-index stacking
  - ✅ Maintained structure color matching for visual cohesion across interface elements
- June 29, 2025: Structure Selection and Operations System - COMPLETED
  - ✅ Enhanced structure sidebar with advanced search functionality and nested _L/_R grouping
  - ✅ Added parent rows displaying combined structure colors and counts with badges  
  - ✅ Implemented selection checkboxes for operations (yellow highlight when selected)
  - ✅ Added visibility toggle buttons (blue eye icons) and delete buttons (red trash icons)
  - ✅ Created structure selection mechanism with visual feedback in viewer interface
  - ✅ Positioned Operations button in sidebar next to Collapse All button (matching design spec)
  - ✅ Operations button shows selection count and appears only when structures are selected
  - ✅ All 19 anatomical structures now support individual selection and group operations
  - ✅ Enhanced UI follows medical imaging interface standards with proper color coding
- June 27, 2025: RT Structure Coordinate Transformation Fixed - COMPLETED
  - ✅ Fixed DICOM metadata extraction with proper dicomParser API usage
  - ✅ Extracted authentic spatial data: Image Position (-300,-300,35), Pixel Spacing (1.171875mm), Image Orientation (1\0\0\0\1\0)
  - ✅ Implemented correct world-to-canvas coordinate transformation for standard axial orientation
  - ✅ Applied proper axis mapping: worldX→column index, worldY→row index for DICOM pixel coordinates
  - ✅ Implemented 90-degree counter-rotation to fix sideways RT structure orientation
  - ✅ Applied horizontal flip transformation to correct mirrored anatomical structures
  - ✅ Applied medical-grade coordinate system with authentic HN-ATLAS-84 dataset spatial parameters
  - ✅ RT structures now display with correct anatomical orientation and positioning
- June 27, 2025: Enhanced RT Structure Visualization System - COMPLETED
  - ✅ Created tabbed sidebar interface with Series and Structures tabs
  - ✅ Implemented nested RT structure display under CT series in left sidebar
  - ✅ Added RT structure API endpoints for loading anatomical structures
  - ✅ Enhanced structure management with individual visibility toggles
  - ✅ Added dual viewer system: standard viewer (/dicom-viewer) and enhanced viewer (/enhanced-viewer)
  - ✅ Created Enhanced Viewer button in top navigation and patient cards
  - ✅ Styled enhanced viewer buttons in green to indicate RT structure capabilities
  - ✅ All 19 anatomical structures from HN-ATLAS-84 now accessible with color coding
  - ✅ Fixed Vite development server configuration for proper React app serving
  - ✅ User confirmed Enhanced Viewer button is visible and functional
- December 27, 2024: Implemented RT Structure Set visualization
  - Added RT structure parser for DICOM RTSTRUCT files
  - Integrated RT structure overlay with CT viewer
  - Parsed 19 anatomical structures from HN-ATLAS-84 dataset
  - Added structure visibility toggle in viewer interface
  - Fixed CONVERGE logo styling to white/black color scheme
  - Enhanced CT slice ordering with proper DICOM metadata processing
  - Added Z slice position readout in viewer overlay
- June 24, 2025: Initial setup

## User Preferences

Preferred communication style: Simple, everyday language.