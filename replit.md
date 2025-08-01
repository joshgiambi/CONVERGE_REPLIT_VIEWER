# Superbeam - DICOM Medical Imaging System

## Overview
Superbeam is a full-stack DICOM medical imaging application built with React, Express.js, and PostgreSQL. It enables users to upload, manage, and view medical images with advanced DICOM metadata handling and contour editing capabilities, functioning as a PACS-like interface for medical imaging workflows. The project aims to provide a robust, high-performance system for medical image analysis and manipulation, with a focus on accurate multi-modal fusion.

## Recent Changes (August 1, 2025)
- **Performance Optimizations**: Implemented cached LUT (Look-Up Table) and reusable offscreen canvas for render16BitImage function
- **Memory Improvements**: Replaced all JSON.parse(JSON.stringify) with structuredClone API for better performance
- **Code Quality**: Added DEBUG flag to control excessive logging output
- **Type Safety**: Fixed missing onRTStructureUpdate prop and improved PreviewContour type definition
- **Consistency**: Replaced hardcoded tolerance values with SLICE_TOL_MM constant throughout codebase
- **MPR Enhancement**: Added automatic cache invalidation on window/level changes for proper image updates

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
- **DICOM Fusion Registration**: Emphasizes the critical use of DICOM registration transformation matrices for multi-modal fusion (e.g., CT/MRI). The system strictly uses the 4x4 rigid transformation matrices from registration files as the absolute truth for spatial alignment, transforming secondary image origins (e.g., MRI) into the primary image's (e.g., CT) coordinate space. No additional offsets or complex transformations are calculated beyond direct matrix application.
- **Medical Data Hierarchy**: Organizes data logically as Patients → Studies → Series → Images to reflect real-world medical data structures.
- **RT Structure Management**: Comprehensive system for managing radiation therapy structures, including persistent storage for modifications and a history tracking mechanism.
- **Medical Safety**: Prioritizes medical-grade precision for all operations, including coordinate transformations, pixel spacing validation, and boolean operations. Critical safeguards are implemented to prevent data integrity issues during import and processing.

### Frontend
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS with shadcn/ui components, featuring a glassmorphic design system with selective theming.
- **State Management**: TanStack Query for server state management.
- **UI Components**: Radix UI primitives.
- **Viewer**: Consolidated and unified viewer (previously dual viewers), supporting advanced features like MPR (Multi-Planar Reconstruction) and GPU acceleration via Cornerstone3D integration.
- **Contour Editing**: Advanced contouring tools (Brush, Pen, Eclipse TPS, ITK-SNAP style) with real-time feedback, undo/redo, and precise medical-grade operations (grow, interpolate, boolean operations).

### Backend
- **Framework**: Express.js with TypeScript.
- **DICOM Processing**: Custom DICOM parser (using `dicom-parser` library) for metadata extraction and validation. Web Workers are used for off-main-thread metadata parsing to ensure UI responsiveness.
- **File Management**: Multer for uploads, structured patient-based storage (`storage/patients/{patientId}/{studyUID}/{seriesUID}/{sopUID}.dcm`), and automatic ZIP file extraction.
- **Triage System**: Manages uploaded and parsed files in a staged workflow (Upload → Auto-Parse → Triage → Import) for clear state separation and robust error handling.

### Database
- **Primary Database**: PostgreSQL (Neon serverless).
- **ORM**: Drizzle ORM with schema-based type safety.
- **Migrations**: Drizzle Kit.

### Key Features and Implementations
- **DICOM File Management**: Upload, parsing, metadata extraction, validation (DICM magic number), and structured storage.
- **Image Serving**: DICOM files served with proper content-type headers for display.
- **Fusion Registration System**: Uses 4x4 transformation matrices from DICOM REG files for precise spatial alignment of multi-modal images. MRI positions are pre-computed in CT space for performance.
- **Multi-Planar Reconstruction (MPR)**: Enables sagittal and coronal views from axial slices with true 3D volume reconstruction, crosshair synchronization, and consistent window/level.
- **GPU Acceleration**: Integration with Cornerstone3D for GPU-accelerated rendering, including WebGL2 detection and a hybrid rendering decision logic.
- **Performance Optimizations**: Web Workers for DICOM metadata parsing, background prefetching (using `requestIdleCallback`), and optimized batch loading for faster image series loading.
- **RT Structure Visualization & Editing**: Displays 19 anatomical structures with color-coding, individual visibility toggles, and robust contour editing tools (brush, pen, grow, boolean operations) with comprehensive undo/redo support.
- **Patient Management**: Enhanced patient cards with GIF previews, expandable views for RT structures and registration info, and selection functionality for bulk operations (export, merge).
- **Metadata Editing**: Redesigned UI for editing patient and series metadata, including tag management and anatomical tag generation.

## External Dependencies

### Core
- **@neondatabase/serverless**: PostgreSQL database connection.
- **dicom-parser**: DICOM file format parsing.
- **multer**: File upload handling.
- **drizzle-orm**: Type-safe database ORM.
- **@tanstack/react-query**: Server state management.
- **@radix-ui/react-***: UI component primitives.
- **yauzl**: ZIP file extraction.
- **ClipperLib**: Polygon boolean operations (union, subtract, intersect) for contour editing.
- **Cornerstone Libraries (local)**: `cornerstone-core`, `cornerstone-math`, `cornerstone-tools`, `cornerstone-web-image-loader`, `cornerstone-wado-image-loader` for image rendering and manipulation.

### Development
- **vite**: Frontend build tool and development server.
- **typescript**: Type safety.
- **tailwindcss**: Utility-first CSS framework.
- **drizzle-kit**: Database migration toolkit.