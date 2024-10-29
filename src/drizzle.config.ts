import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from './config';
dotenv.config();

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: "postgresql",
  
  dbCredentials: {
    host: DB_HOST,
    port: parseInt(DB_PORT || '5432'),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    ssl: false
  },
} satisfies Config;