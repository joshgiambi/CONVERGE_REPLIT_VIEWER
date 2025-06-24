# CONVERGE - Medical DICOM Viewer

## Project Overview
A specialized DICOM medical imaging viewer featuring multi-planar reconstruction (axial, sagittal, coronal views), real DICOM file parsing and upload, comprehensive patient management interface, and PACS networking capabilities for hospital integration.

## Recent Changes
- **2025-06-24**: Processed complete HN-ATLAS dataset with all 153 CT slices using proper DICOM metadata
- **2025-06-24**: Implemented correct Z slice spatial ordering based on slice location and image position
- **2025-06-24**: Fixed "View Studies" navigation to properly open DICOM viewer with study parameters
- **2025-06-24**: Cleaned up project structure, removed temporary files and messy workarounds  
- **2025-06-24**: Built robust DICOM processing system with proper database schema
- **2025-06-24**: Fixed logo styling to white/black as requested

## Project Architecture

### Backend
- **Express.js** server with TypeScript
- **PostgreSQL** database with Drizzle ORM
- **DICOM Processing**: Proper DICOM metadata extraction and storage
- **File Upload**: Multer-based DICOM file handling
- **Storage Layer**: Abstracted database operations for scalability

### Frontend
- **React** with TypeScript
- **Tailwind CSS** for styling
- **TanStack Query** for data fetching
- **DICOM Viewer**: Custom viewer with proper DICOM parsing and spatial ordering

### Database Schema
- **Patients**: Core patient demographics
- **Studies**: DICOM studies with proper hierarchy
- **Series**: Image series with metadata
- **Images**: Individual DICOM instances with spatial data

## User Preferences
- Logo: White text with black outline (no colorful elements)
- Code Quality: Build scalable, production-ready systems, avoid temporary workarounds
- DICOM Standards: Use industry-standard metadata parsing for proper slice ordering
- Architecture: Prefer robust, maintainable solutions over quick fixes

## Technical Decisions
- Using dicom-parser library for proper DICOM metadata extraction
- Implemented proper Patient → Study → Series → Images hierarchy
- Storing spatial metadata (slice location, image position) for correct ordering
- Abstracted storage layer for future scalability
- Clean separation of concerns between processing, storage, and API layers

## Current Status
- Database schema properly designed for DICOM hierarchy
- DICOM processor extracts comprehensive metadata
- Storage layer provides clean interface for data operations
- Demo data loading system in place with complete HN-ATLAS dataset (153 CT slices)
- Frontend viewer displays Z slice readout and proper spatial ordering
- Server properly configured for Replit deployment (binds to 0.0.0.0:5000)
- Application accessible via Replit domain
- React components loading correctly with fixed TooltipProvider