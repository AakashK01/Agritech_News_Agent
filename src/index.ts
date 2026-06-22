import { logger } from './lib/logger';
import { initializeDependencies } from './dependencies';

async function main(): Promise<void> {
    const { config } = await initializeDependencies();
    logger.info(`${config.SERVICE_NAME} running`, {
        nodeEnv:         config.NODE_ENV,
        excelEnabled:    config.AGRITECH_EXCEL_ENABLED,
        postgresEnabled: config.AGRITECH_POSTGRES_ENABLED,
        aiEnabled:       config.AGRITECH_AI_ENABLED,
        runOnce:         config.AGRITECH_RUN_ONCE,
        ollamaModel:     config.OLLAMA_MODEL,
    });
}

main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
});
