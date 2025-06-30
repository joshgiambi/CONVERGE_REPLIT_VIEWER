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