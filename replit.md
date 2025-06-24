# MediView Pro - Medical DICOM Viewer

## Overview

MediView Pro is a comprehensive web-based DICOM (Digital Imaging and Communications in Medicine) viewer and management system built with React, Express.js, and PostgreSQL. The application provides healthcare professionals with tools to view, manage, and analyze medical imaging data with support for DICOM file uploads, patient management, and advanced visualization features.

## System Architecture

The application follows a full-stack architecture with clear separation between frontend and backend concerns:

- **Frontend**: React 18 with TypeScript, using Vite for development and build tooling
- **Backend**: Express.js server with TypeScript for REST API endpoints
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Storage**: File system storage for DICOM files with metadata extraction
- **UI Framework**: Tailwind CSS with shadcn/ui components for consistent styling

## Key Components

### Frontend Architecture
- **React Router**: Uses Wouter for lightweight client-side routing
- **State Management**: React Query (TanStack Query) for server state management
- **UI Components**: Comprehensive shadcn/ui component library with custom DICOM-themed styling
- **DICOM Rendering**: Custom DICOM loader with support for medical imaging display
- **Form Handling**: React Hook Form with Zod validation

### Backend Architecture
- **Express Server**: RESTful API with middleware for request logging and error handling
- **Database Layer**: Drizzle ORM with typed schemas for patients, studies, series, and images
- **File Upload**: Multer middleware for handling DICOM file uploads with validation
- **DICOM Processing**: Custom DICOM parser for metadata extraction and validation
- **Network Services**: Mock DICOM network service for PACS integration (development)

### Database Schema
- **Patients**: Core patient demographic information
- **Studies**: Medical studies with metadata and relationships to patients
- **Series**: Image series within studies with technical parameters
- **Images**: Individual DICOM images with file paths and metadata
- **PACS Connections**: Configuration for external PACS systems

## Data Flow

1. **File Upload**: DICOM files are uploaded via drag-and-drop interface
2. **Validation**: Server validates DICOM format and extracts metadata
3. **Storage**: Files are stored in filesystem with database records created
4. **Processing**: DICOM metadata is parsed and stored in relational structure
5. **Retrieval**: Frontend queries database for studies/series and renders images
6. **Viewing**: Custom DICOM viewer displays images with window/level controls

## External Dependencies

### Frontend Dependencies
- **React Ecosystem**: React 18, React Query, React Hook Form
- **UI Libraries**: Radix UI primitives, Tailwind CSS, Lucide icons
- **DICOM Libraries**: Custom implementation with dicom-parser fallback
- **Utility Libraries**: date-fns, clsx, class-variance-authority

### Backend Dependencies
- **Server Framework**: Express.js with TypeScript support
- **Database**: Neon Postgres with connection pooling
- **ORM**: Drizzle with PostgreSQL dialect
- **File Handling**: Multer for uploads, fs for file operations
- **DICOM Processing**: Custom parser with dcmjs integration planned

### Development Tools
- **Build Tools**: Vite for frontend, esbuild for backend
- **Type Checking**: TypeScript with strict configuration
- **Development**: tsx for server development, hot reload support

## Deployment Strategy

The application is configured for deployment on Replit with the following setup:

- **Environment**: Node.js 20 with PostgreSQL 16
- **Build Process**: Frontend builds to `dist/public`, backend builds to `dist/`
- **Production Server**: Serves static files and API from single Express instance
- **Database**: Neon PostgreSQL with connection string from environment
- **File Storage**: Local filesystem storage in `uploads/dicom/` directory

### Build Configuration
- **Development**: `npm run dev` - starts development server with hot reload
- **Production Build**: `npm run build` - builds both frontend and backend
- **Production Start**: `npm run start` - serves production build

## Changelog

- June 24, 2025. Initial setup

## User Preferences

Preferred communication style: Simple, everyday language.