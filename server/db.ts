import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Allow preview mode without database
const isDevelopment = process.env.NODE_ENV === 'development';
const isPreviewMode = !process.env.DATABASE_URL && isDevelopment;

if (!process.env.DATABASE_URL && !isPreviewMode) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Use a dummy URL for preview mode
const databaseUrl = process.env.DATABASE_URL || 'postgresql://preview:preview@localhost/preview';

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle({ client: pool, schema });

// Export preview mode flag
export const isPreview = isPreviewMode;