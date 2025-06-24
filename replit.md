# DICOM Viewer Application

## Overview

This is a web-based DICOM (Digital Imaging and Communications in Medicine) viewer application built as a full-stack solution. The application provides comprehensive DICOM file management, viewing capabilities, and basic PACS (Picture Archiving and Communication System) integration for medical imaging workflows.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for lightweight client-side routing
- **UI Framework**: Shadcn/ui components with Tailwind CSS
- **State Management**: TanStack Query (React Query) for server state
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite for development and production builds

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **Database ORM**: Drizzle ORM with PostgreSQL
- **File Handling**: Multer for DICOM file uploads
- **DICOM Processing**: Custom DICOM parser with dcmjs integration
- **Development**: Hot reload with Vite integration

### Database Design
- **Provider**: Neon PostgreSQL (serverless)
- **Schema**: Relational structure with patients, studies, series, and images
- **Migrations**: Drizzle Kit for schema management
- **Relationships**: Proper foreign key relationships between entities

## Key Components

### DICOM Data Models
- **Patients**: Patient demographics and identifiers
- **Studies**: Medical studies with study-level metadata
- **Series**: Image series within studies
- **Images**: Individual DICOM instances
- **PACS Connections**: Configuration for external PACS systems

### DICOM Viewer Features
- **Multi-planar Reconstruction (MPR)**: Axial, sagittal, and coronal views
- **Window/Level Adjustment**: Customizable image display parameters
- **Image Navigation**: Slice-by-slice navigation through series
- **Preset Window Levels**: Common presets for different tissue types
- **Zoom and Pan**: Interactive image manipulation

### File Management
- **Upload System**: Drag-and-drop DICOM file upload
- **Validation**: DICOM file format validation
- **Storage**: Organized file storage with metadata extraction
- **Batch Processing**: Multiple file upload support

## Data Flow

### DICOM File Processing
1. **Upload**: Files uploaded via REST API with validation
2. **Parsing**: DICOM headers extracted using custom parser
3. **Storage**: Files stored in organized directory structure
4. **Database**: Metadata stored in PostgreSQL with relationships
5. **Retrieval**: Images served via API endpoints for viewer

### Viewer Workflow
1. **Study Selection**: Browse patients and studies
2. **Series Loading**: Load series metadata and image references
3. **Image Rendering**: Render DICOM images with proper windowing
4. **Interaction**: Navigate through slices with mouse/keyboard
5. **Multi-planar**: Generate orthogonal views from volume data

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL database connection
- **drizzle-orm**: Database ORM and query builder
- **express**: Web server framework
- **multer**: File upload handling
- **react**: UI framework
- **@tanstack/react-query**: Server state management

### DICOM-Specific
- **dcmjs**: DICOM parsing and manipulation
- **dicom-dimse**: DICOM network services (planned)
- Custom DICOM parser for metadata extraction

### UI Components
- **@radix-ui/***: Accessible UI primitives
- **tailwindcss**: Utility-first CSS framework
- **shadcn/ui**: Pre-built component library
- **lucide-react**: Icon library

## Deployment Strategy

### Development Environment
- **Platform**: Replit with Node.js 20
- **Database**: PostgreSQL 16 module
- **Port Configuration**: 5000 (internal) → 80 (external)
- **Hot Reload**: Vite development server with HMR

### Production Build
- **Build Process**: Vite for frontend, esbuild for backend
- **Bundle Target**: ES modules for Node.js
- **Static Assets**: Served from dist/public directory
- **Database**: Neon serverless PostgreSQL

### Autoscale Deployment
- **Target**: Replit autoscale infrastructure
- **Build Command**: `npm run build`
- **Start Command**: `npm run start`
- **Environment**: Production Node.js with optimized bundles

## Changelog

```
Changelog:
- June 24, 2025. Initial setup
```

## User Preferences

Preferred communication style: Simple, everyday language.