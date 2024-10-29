import { createHash } from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

// export const SECRET = hash(process.env.SECRET || 'secret'); to 32 bytes ouput
export const SECRET = createHash('sha256').update(process.env.SECRET || 'secret').digest();
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
export const APTOS_NODE_URL = process.env.APTOS_NODE_URL!;
export const APTOS_FAUCET_URL = process.env.APTOS_FAUCET_URL!;
export const DB_HOST = process.env.DB_HOST!;
export const DB_PORT = process.env.DB_PORT!;
export const DB_USER = process.env.DB_USER!;
export const DB_NAME = process.env.DB_NAME!;
export const DB_PASSWORD = process.env.DB_PASSWORD!;