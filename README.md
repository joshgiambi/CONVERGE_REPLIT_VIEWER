# DICOM Medical Imaging System

A full-stack DICOM medical imaging application with React frontend and Express backend, featuring advanced contour editing and multi-modal image fusion capabilities.

## Prerequisites

- Node.js 20+ 
- PostgreSQL database (or Neon PostgreSQL account)
- npm or yarn package manager

## Setup Instructions

### 1. Clone the Repository
```bash
git clone <repository-url>
cd <project-directory>
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory with:

```env
# Database connection (Neon PostgreSQL)
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# Server port (optional, defaults to 5000)
PORT=5000

# Node environment
NODE_ENV=development
```

### 4. Setup Database

Push the database schema to your PostgreSQL instance:

```bash
npm run db:push
```

### 5. Run the Application

#### Development Mode
```bash
npm run dev
```

This will start:
- Express server on http://localhost:5000
- Vite dev server with hot reload for the React frontend

#### Production Mode

First, build the application:
```bash
npm run build
```

Then start the production server:
```bash
npm run start
```

## Project Structure

```
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── pages/       # Route pages
│   │   └── lib/         # Utilities and configurations
│   └── index.html
├── server/              # Express backend
│   ├── index.ts         # Server entry point
│   ├── routes.ts        # API routes
│   ├── storage.ts       # Database operations
│   └── db.ts            # Database connection
├── shared/              # Shared types and schemas
│   └── schema.ts        # Drizzle ORM schemas
└── storage/             # File storage for DICOM files
    └── patients/        # Patient data directories
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run check` - Run TypeScript type checking
- `npm run db:push` - Push database schema changes

## Features

- **DICOM Viewer**: View and navigate medical images
- **Contour Editing**: Draw and edit RT structure contours
- **Multi-modal Fusion**: Overlay CT/MRI images with registration
- **Patient Management**: Organize studies by patient
- **RT Structure Support**: View and edit radiation therapy structures

## Troubleshooting

### Database Connection Issues
- Ensure your DATABASE_URL is correctly formatted
- Check that your PostgreSQL server is running
- Verify SSL mode settings for cloud databases

### Build Errors
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Delete .tsbuildinfo for fresh TypeScript compilation
- Check Node.js version (requires 20+)

### Port Already in Use
- Change the PORT in .env file
- Or kill the process using port 5000: `lsof -ti:5000 | xargs kill`

## Performance Notes

The application has been optimized for:
- Fast initial load with code splitting
- Efficient database queries with indexes
- Reduced bundle size by removing unused dependencies
- Modern ES2022 JavaScript features