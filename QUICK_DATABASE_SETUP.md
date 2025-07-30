# Quick Database Setup Guide

## Option 1: Neon PostgreSQL (Recommended - Free & Fast)

### Step 1: Create a Neon Account
1. Go to https://neon.tech/
2. Click "Start Free" 
3. Sign up with GitHub/Google/Email

### Step 2: Create a Database
1. Once logged in, click "Create a database"
2. Choose a region close to you
3. Give your database a name (e.g., "dicom-viewer")
4. Click "Create"

### Step 3: Get Your Connection String
1. On your dashboard, find your database
2. Click on it to see details
3. Copy the connection string that looks like:
   ```
   postgresql://username:password@host.neon.tech/database?sslmode=require
   ```

### Step 4: Set Up Environment
1. Create a `.env` file in the project root:
   ```bash
   touch .env
   ```

2. Add your connection string:
   ```env
   DATABASE_URL=postgresql://username:password@host.neon.tech/database?sslmode=require
   PORT=5000
   NODE_ENV=development
   ```

### Step 5: Initialize Database & Run
```bash
# Push the database schema
npm run db:push

# Start the application
npm run dev
```

## Option 2: Local PostgreSQL

### Install PostgreSQL
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# macOS
brew install postgresql
brew services start postgresql
```

### Create Database
```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE dicom_viewer;
CREATE USER dicom_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE dicom_viewer TO dicom_user;
\q
```

### Set Up Environment
Create `.env` file:
```env
DATABASE_URL=postgresql://dicom_user:your_password@localhost:5432/dicom_viewer
PORT=5000
NODE_ENV=development
```

### Initialize & Run
```bash
npm run db:push
npm run dev
```

## Option 3: Quick Demo Database

For a quick demo, I can provide a temporary database URL. This is only for testing and will be cleared regularly.

**WARNING**: This is a shared demo database. Do not upload sensitive data!

Create `.env` file:
```env
DATABASE_URL=postgresql://demo:demo123@ep-calm-snow-123456.us-east-2.aws.neon.tech/demo_dicom?sslmode=require
PORT=5000
NODE_ENV=development
```

Then run:
```bash
npm run db:push
npm run dev
```

## Verifying Everything Works

Once the server starts, you should see:
```
🚀 Server running on port 5000
```

Navigate to http://localhost:5000 and you should be able to:
- Create patients
- Upload DICOM files
- View medical images
- Edit RT structures
- All data will persist in the database