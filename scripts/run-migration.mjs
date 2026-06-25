import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

const migrationsDir = path.join(process.cwd(), 'db/migrations');
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  console.error('No migration files found in', migrationsDir);
  process.exit(1);
}

const client = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'agritech',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASS ?? '',
});

await client.connect();

for (const file of migrationFiles) {
  const migrationPath = path.join(migrationsDir, file);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await client.query(sql);
  console.log('Migration applied:', migrationPath);
}

await client.end();
