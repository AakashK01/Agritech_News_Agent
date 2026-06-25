import * as dotenv from 'dotenv';
import { z } from 'zod';
import {
    AI_INPUT_MAX_CHARS_DEFAULT,
    AGRITECH_DEFAULT_INTERVAL_MS_DEFAULT,
    JOB_STAGGER_DELAY_MS_DEFAULT,
    AGRITECH_POSTGRES_SCHEMA_DEFAULT,
    HTTP_FETCH_TIMEOUT_MS_DEFAULT,
    MAX_ITEMS_SCANNED_PER_RUN_DEFAULT,
    MAX_NEW_ROWS_PER_RUN_DEFAULT,
    MAX_SECTIONS_PER_RUN_DEFAULT,
    RUNS_DIR_DEFAULT,
    SECTION_SNAPSHOTS_PATH_DEFAULT,
    URL_CONTENT_INDEX_PATH_DEFAULT,
} from '../constants/app';
import {
    AGRITECH_PROFILES_ROOT_DEFAULT,
    BROWSER_COMMAND_TIMEOUT_MS_DEFAULT,
    BROWSER_MAX_ARGV_COUNT_DEFAULT,
    BROWSER_MAX_ARG_STRING_BYTES_DEFAULT,
    BROWSER_NAVIGATION_TIMEOUT_MS_DEFAULT,
    BROWSER_READY_POLL_MS_DEFAULT,
    BROWSER_READY_TIMEOUT_MS_DEFAULT,
} from '../constants/browser';
import { OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL } from '../constants/ollama';

dotenv.config();

function boolFromEnv(defaultValue: 'true' | 'false' = 'true') {
    return z
        .string()
        .default(defaultValue)
        .transform((v) => v.toLowerCase() === 'true' || v === '1');
}

const AgriTechConfigSchema = z
    .object({
        SERVICE_NAME: z.string().default('agritech-tracker'),
        NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
        LOG_LEVEL: z.string().default('info'),

        AGRITECH_EXCEL_ENABLED:    boolFromEnv('true'),
        AGRITECH_POSTGRES_ENABLED: boolFromEnv('true'),
        AGRITECH_AI_ENABLED:       boolFromEnv('true'),
        AGRITECH_RUN_ONCE:         boolFromEnv('false'),
        AGRITECH_BROWSER_FALLBACK_ENABLED: boolFromEnv('false'),

        AGRITECH_AGFUNDER_ENABLED:      boolFromEnv('true'),
        AGRITECH_INC42_ENABLED:         boolFromEnv('true'),
        AGRITECH_INC42_BROWSER_ENABLED: boolFromEnv('true'),
        AGRITECH_DEFAULT_INTERVAL_MS:   z.coerce.number().int().positive().default(AGRITECH_DEFAULT_INTERVAL_MS_DEFAULT),
        JOB_STAGGER_DELAY_MS:            z.coerce.number().int().nonnegative().default(JOB_STAGGER_DELAY_MS_DEFAULT),

        MAX_ITEMS_SCANNED_PER_RUN: z.coerce.number().int().positive().default(MAX_ITEMS_SCANNED_PER_RUN_DEFAULT),
        MAX_NEW_ROWS_PER_RUN:      z.coerce.number().int().positive().default(MAX_NEW_ROWS_PER_RUN_DEFAULT),
        MAX_SECTIONS_PER_RUN:      z.coerce.number().int().positive().default(MAX_SECTIONS_PER_RUN_DEFAULT),
        AI_INPUT_MAX_CHARS:        z.coerce.number().int().positive().default(AI_INPUT_MAX_CHARS_DEFAULT),
        HTTP_FETCH_TIMEOUT_MS:     z.coerce.number().int().positive().default(HTTP_FETCH_TIMEOUT_MS_DEFAULT),

        AGRITECH_RUNS_DIR:           z.string().default(RUNS_DIR_DEFAULT),
        AGRITECH_URL_CONTENT_INDEX:  z.string().default(URL_CONTENT_INDEX_PATH_DEFAULT),
        AGRITECH_SECTION_SNAPSHOTS:  z.string().default(SECTION_SNAPSHOTS_PATH_DEFAULT),

        AGRITECH_PROFILES_ROOT: z.string().default(AGRITECH_PROFILES_ROOT_DEFAULT),
        AGENT_BROWSER_CLI_PATH: z.string().optional(),
        BROWSER_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(BROWSER_COMMAND_TIMEOUT_MS_DEFAULT),
        BROWSER_READY_TIMEOUT_MS: z.coerce.number().int().positive().default(BROWSER_READY_TIMEOUT_MS_DEFAULT),
        BROWSER_READY_POLL_MS: z.coerce.number().int().positive().default(BROWSER_READY_POLL_MS_DEFAULT),
        BROWSER_NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(BROWSER_NAVIGATION_TIMEOUT_MS_DEFAULT),
        BROWSER_MAX_ARGV_COUNT: z.coerce.number().int().positive().default(BROWSER_MAX_ARGV_COUNT_DEFAULT),
        BROWSER_MAX_ARG_STRING_BYTES: z.coerce.number().int().positive().default(BROWSER_MAX_ARG_STRING_BYTES_DEFAULT),

        OLLAMA_BASE_URL:          z.string().url().default(OLLAMA_DEFAULT_BASE_URL),
        OLLAMA_MODEL:             z.string().min(1).default(OLLAMA_DEFAULT_MODEL),
        OLLAMA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
        OLLAMA_TEMPERATURE:        z.coerce.number().min(0).max(2).default(0.2),
        OLLAMA_NUM_PREDICT:        z.coerce.number().int().positive().optional(),

        DB_HOST:                z.string().optional(),
        DB_PORT:                z.coerce.number().int().positive().default(5432),
        DB_NAME:                z.string().optional(),
        DB_USER:                z.string().optional(),
        DB_PASS:                z.string().optional(),
        DB_SCHEMA:              z.string().default(AGRITECH_POSTGRES_SCHEMA_DEFAULT),
        DB_SSL:                 boolFromEnv('false'),
        DB_MAX_POOL_SIZE:       z.coerce.number().int().positive().default(10),
        DB_MIN_POOL_SIZE:       z.coerce.number().int().positive().default(2),
        DB_IDLE_TIMEOUT_MS:     z.coerce.number().int().positive().default(30_000),
        DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    })
    .superRefine((cfg, ctx) => {
        if (!cfg.AGRITECH_EXCEL_ENABLED && !cfg.AGRITECH_POSTGRES_ENABLED) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'At least one of AGRITECH_EXCEL_ENABLED or AGRITECH_POSTGRES_ENABLED must be true',
            });
        }
        if (cfg.AGRITECH_POSTGRES_ENABLED) {
            if (!cfg.DB_HOST || !cfg.DB_NAME || !cfg.DB_USER || cfg.DB_PASS === undefined) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'DB_HOST, DB_NAME, DB_USER, DB_PASS are required when AGRITECH_POSTGRES_ENABLED=true',
                });
            }
        }
    });

export type AgriTechConfig = z.infer<typeof AgriTechConfigSchema>;

function parseConfig(): AgriTechConfig {
    const result = AgriTechConfigSchema.safeParse(process.env);
    if (!result.success) {
        throw new Error(`AgriTech configuration validation failed:\n${result.error.message}`);
    }
    return result.data;
}

export const configPromise: Promise<AgriTechConfig> = Promise.resolve(parseConfig());

export async function getConfig(): Promise<AgriTechConfig> {
    return configPromise;
}

export function configRequiresPostgres(cfg: AgriTechConfig): boolean {
    return cfg.AGRITECH_POSTGRES_ENABLED;
}
