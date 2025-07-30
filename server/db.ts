import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool as PgPool } from 'pg';
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import ws from "ws";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Determine if we should use local PostgreSQL or Neon based on DATABASE_URL
const isLocalPostgres = process.env.DATABASE_URL.includes('localhost') || 
                       process.env.DATABASE_URL.includes('127.0.0.1') ||
                       process.env.USE_LOCAL_POSTGRES === 'true';

let pool: any;
let db: any;

if (isLocalPostgres) {
  // Local PostgreSQL setup
  pool = new PgPool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: false
  });
  db = pgDrizzle({ client: pool, schema });
} else {
  // Neon serverless setup (original)
  neonConfig.webSocketConstructor = ws;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle({ client: pool, schema });
}

export { pool, db };