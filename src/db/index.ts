import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD } from '../config';

const pool = new Pool({
  host: DB_HOST,
  port: parseInt(DB_PORT || '5432'),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
});

export const db = drizzle(pool, { schema });

