import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type AppDatabase = NeonHttpDatabase<typeof schema>;

let _db: AppDatabase | null = null;

export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return Boolean(url && url.length > 0);
}

/**
 * Lazy Neon + Drizzle client initialization.
 * Never evaluates neon() at module top level so `next build` succeeds before
 * DATABASE_URL is configured, and never uses a JS Proxy wrapper.
 */
export function getDb(): AppDatabase {
  if (!_db) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      throw new Error("DATABASE_URL is not configured");
    }
    const sql = neon(url);
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export * as schema from "./schema";
