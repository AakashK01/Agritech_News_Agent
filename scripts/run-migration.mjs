import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const migrationPath = path.join(process.cwd(), 'db/migrations/001_agritech_schema.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

const client = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'agritech',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASS ?? '',
});

await client.connect();
await client.query(sql);
await client.end();
console.log('Migration applied:', migrationPath);
