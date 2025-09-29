# Local Development Setup

This guide helps you set up the medical imaging application locally using your own DICOM data and database.

## Prerequisites

- Node.js (v18+)
- PostgreSQL (v12+)
- Git

## Quick Setup

### 1. Environment Configuration

```bash
# Copy the environment template
cp .env.template .env

# Edit .env with your local settings
nano .env
```

### 2. Database Setup

```bash
# Create local database
createdb converge_viewer

# Update your .env with correct DATABASE_URL:
# DATABASE_URL="postgresql://your_username@localhost:5432/converge_viewer"
```

### 3. Install Dependencies & Setup Database

```bash
npm install
npm run db:push
```

### 4. Load Your DICOM Data

Place your DICOM files in the `storage/patients/` directory structure:

```
storage/patients/
├── PATIENT_1/
│   ├── study1/
│   │   └── *.dcm files
│   └── study2/
└── PATIENT_2/
    └── *.dcm files
```

Then populate the database:

```bash
# This script scans storage/patients/ and creates database records
node populate-from-storage.js
```

### 5. Start Development Server

```bash
npm run dev
```

Visit: http://localhost:3000

### 6. (Optional) Launch Fusebox Helper + Dev Server

If you are working on fusion overlays, use the bundled helper script instead of the manual environment setup:

```bash
./scripts/start-fusebox.sh
```

The script activates `sam_env`, ensures SimpleITK is present, exports the required helper paths, and then runs `npm run dev:itk` for you.

## Adding New Patient Data

1. Add DICOM files to `storage/patients/NEW_PATIENT_NAME/`
2. Run `node populate-from-storage.js`
3. Refresh your browser

## What's Ignored by Git

- `.env` files (your local config)
- `storage/` directory (your patient data)
- `uploads/` directory
- `populate-from-storage.js` (your local population script)
- Any `*-local.js` or `*-dev.js` files

## Reverting Local Changes

If you want to reset to the original codebase state:

```bash
git checkout -- server/db.ts server/index.ts
npm install  # Reinstall original dependencies
```

## Tips

- Keep your `.env` file private - it's in `.gitignore`
- Your patient data in `storage/` won't be committed
- You can create `*-local.js` scripts for custom workflows
- The database URL in `.env` overrides any hardcoded settings 
