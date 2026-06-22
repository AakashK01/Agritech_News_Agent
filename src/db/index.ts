import { Pool, PoolClient } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';
import type { AgriTechConfig } from '../config/app-config';
import { logger } from '../lib/logger';
import { AGRITECH_POSTGRES_SCHEMA_DEFAULT } from '../constants/app';

export type { QueryResult };

let pool: Pool | null = null;

export async function initializeDatabase(config: AgriTechConfig): Promise<void> {
    if (pool) {
        logger.warn('Database pool already initialized');
        return;
    }

    if (!config.DB_HOST || config.DB_PORT === undefined || !config.DB_NAME || !config.DB_USER || config.DB_PASS === undefined) {
        throw new Error('Database enabled but DB_* configuration is incomplete');
    }

    pool = new Pool({
        host:               config.DB_HOST,
        port:               config.DB_PORT,
        database:           config.DB_NAME,
        user:               config.DB_USER,
        password:           config.DB_PASS,
        ssl:                config.DB_SSL ? { rejectUnauthorized: false } : undefined,
        max:                config.DB_MAX_POOL_SIZE   ?? 10,
        min:                config.DB_MIN_POOL_SIZE   ?? 2,
        idleTimeoutMillis:  config.DB_IDLE_TIMEOUT_MS ?? 30_000,
        connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS ?? 10_000,
        options:            `--search_path=${config.DB_SCHEMA ?? AGRITECH_POSTGRES_SCHEMA_DEFAULT},public`,
    });

    pool.on('error', (err) => logger.error('Postgres pool error', { err: err.message }));

    logger.info('Database pool initialized', {
        host: config.DB_HOST,
        database: config.DB_NAME,
        schema: config.DB_SCHEMA ?? AGRITECH_POSTGRES_SCHEMA_DEFAULT,
    });
}

export async function closeDatabase(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
        logger.info('Database pool closed');
    }
}

export async function executeQuery<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    if (!pool) {
        throw new Error('Database pool not initialized — call initializeDatabase() first');
    }
    return pool.query<T>(text, params as never[]);
}

export async function runInTransaction<T extends QueryResultRow>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!pool) {
        throw new Error('Database pool not initialized — call initializeDatabase() first');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}
