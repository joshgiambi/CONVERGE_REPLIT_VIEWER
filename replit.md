# Superbeam - DICOM Medical Imaging System

## Overview

Superbeam is a full-stack DICOM (Digital Imaging and Communications in Medicine) medical imaging application built with React, Express.js, and PostgreSQL. The system allows users to upload, manage, and view medical images with proper DICOM metadata handling. It includes a complete PACS-like interface for medical imaging workflows with advanced contour editing capabilities.

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

## Changelog

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