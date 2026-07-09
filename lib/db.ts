import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from '../db/schema'

export type Database = NeonHttpDatabase<typeof schema>

let cached: Database | null = null

export function getDb(): Database {
  if (cached) return cached
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL não configurada')
  cached = drizzle(neon(url), { schema })
  return cached
}
