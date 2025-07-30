// SQLite database connection for local testing
// This creates a local database file without any setup required

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from "@shared/schema";

// Create or connect to local SQLite database
const sqlite = new Database('local-dicom.db');
export const db = drizzle(sqlite, { schema });

// Export preview mode flag (false for SQLite)
export const isPreview = false;

console.log('📁 Using local SQLite database: local-dicom.db');