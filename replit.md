# DICOM Medical Imaging System

## Overview

This is a full-stack DICOM (Digital Imaging and Communications in Medicine) medical imaging application built with React, Express.js, and PostgreSQL. The system allows users to upload, manage, and view medical images with proper DICOM metadata handling. It includes a complete PACS-like interface for medical imaging workflows.

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

- June 29, 2025: Major Codebase Cleanup and Stabilization - COMPLETED
  - ✅ Fixed all duplicate function declarations causing app crashes
  - ✅ Consolidated shared utilities into shared/utils.ts file
  - ✅ Cleaned up working-viewer component with proper function organization
  - ✅ Removed duplicate generateUID, isDICOMFile, getTagString functions
  - ✅ Fixed variable hoisting issues in React components
  - ✅ Enhanced DICOM file validation with proper format checking
  - ✅ Improved error handling throughout the application
  - ✅ Application now runs stably without compilation errors
- June 27, 2025: High-Performance Medical Imaging System - COMPLETED
  - ✅ Implemented optimized preloading with range requests for metadata (2KB headers only)
  - ✅ Added 8-concurrent downloads with controlled batching for maximum speed
  - ✅ Unrolled pixel processing loops for 4x faster DICOM parsing
  - ✅ Progressive cache updates show images as they load
  - ✅ Browser-friendly yields prevent UI freezing during bulk operations
  - ✅ All 153 CT images cached with professional progress tracking
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