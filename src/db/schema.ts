import { decimal } from 'drizzle-orm/mysql-core';
import { pgTable, serial, varchar, timestamp, text, boolean, integer, numeric } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }),
  telegramId: varchar('telegram_id', { length: 100 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const wallets = pgTable('wallets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  address: varchar('address', { length: 100 }).notNull(),
  encryptedPrivateKey: text('encrypted_private_key'),
  label: varchar('label', { length: 100 }),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const coins = pgTable('coins', {
  id: serial('id').primaryKey(),
  address: varchar('address', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  symbol: varchar('symbol', { length: 255 }).notNull(),
  decimals: integer('decimals').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;

export type Coin = typeof coins.$inferSelect;
export type NewCoin = typeof coins.$inferInsert;