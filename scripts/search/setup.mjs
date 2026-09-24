import fs from 'node:fs/promises';
import { database } from '../../lib/db.mjs';

process.loadEnvFile('.env.local');
const sql = database();
const migration = await fs.readFile('migrations/004_search.sql', 'utf8');
// Explicit statement boundaries preserve the function's dollar-quoted body.
await sql.transaction(migration.split('-- statement-break').map(statement => sql.query(statement.trim())));
console.log('Migration 004 applied: stored search vector and GIN index.');
