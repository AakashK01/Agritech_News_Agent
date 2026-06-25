import { logger } from './lib/logger';
import { JobScheduler } from './lib/scheduler';
import type { AgriTechConfig } from './config/app-config';
import { agritechContainer } from './di/container';
import { SERVICE_NAMES } from './di/service-names';
import type { ICrawlJobManager } from './jobs/crawl-job-manager.interface';
import type { AgfunderNewsJobManager } from './jobs/agfunder-news-job-manager';
import type { Inc42NewsJobManager } from './jobs/inc42-news-job-manager';
import { closeDatabase } from './db/index';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Central orchestrator — one scheduler runs all enabled crawl jobs sequentially
 * with a configurable delay between each job (Inc42 first, then AgFunder by default).
 */
export class AgriTechJobsOrchestrator {
    private scheduler: JobScheduler | null = null;

    constructor(private readonly config: AgriTechConfig) {}

    async startAll(): Promise<void> {
        if (this.config.AGRITECH_RUN_ONCE) {
            logger.info('AGRITECH_RUN_ONCE=true — running one cycle then exiting');
            await this.runAllJobsOnce();
            return;
        }

        this.scheduler = new JobScheduler('agritech-orchestrator', this.config.AGRITECH_DEFAULT_INTERVAL_MS);
        this.scheduler.start(() => this.runAllJobsOnce());
        logger.info('AgriTech orchestrator started', {
            intervalMs: this.config.AGRITECH_DEFAULT_INTERVAL_MS,
            staggerDelayMs: this.config.JOB_STAGGER_DELAY_MS,
        });
    }

    async stopAll(): Promise<void> {
        this.scheduler?.stop();
        this.scheduler = null;
        logger.info('AgriTech orchestrator stopped');
    }

    private async runAllJobsOnce(): Promise<void> {
        const jobs = await this.resolveEnabledJobs();
        if (jobs.length === 0) {
            logger.warn('No crawl jobs enabled — enable AGRITECH_AGFUNDER_ENABLED or AGRITECH_INC42_ENABLED');
            return;
        }

        logger.info('Orchestrator cycle starting', { jobCount: jobs.length, jobs: jobs.map((j) => j.jobId) });

        for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i]!;
            logger.info(`Job cycle start: ${job.jobId}`);
            try {
                await job.runOnce();
                logger.info(`Job cycle complete: ${job.jobId}`);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`Job cycle failed: ${job.jobId}`, { err: msg });
            }

            if (i < jobs.length - 1) {
                logger.info('Waiting before next job', { delayMs: this.config.JOB_STAGGER_DELAY_MS });
                await sleep(this.config.JOB_STAGGER_DELAY_MS);
            }
        }

        logger.info('Orchestrator cycle complete');
    }

    private async resolveEnabledJobs(): Promise<ICrawlJobManager[]> {
        const agfunder = await agritechContainer.get<AgfunderNewsJobManager>(SERVICE_NAMES.AGFUNDER_JOB_MANAGER);
        const inc42 = await agritechContainer.get<Inc42NewsJobManager>(SERVICE_NAMES.INC42_JOB_MANAGER);
        // Inc42 runs first (browser login feed); AgFunder starts after JOB_STAGGER_DELAY_MS.
        return [inc42, agfunder].filter((j) => j.isEnabled());
    }
}

export async function initializeDependencies(): Promise<{
    config: AgriTechConfig;
    shutdown: () => Promise<void>;
}> {
    await agritechContainer.initialize();

    const config = await agritechContainer.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
    const orchestrator = new AgriTechJobsOrchestrator(config);

    const shutdown = async (): Promise<void> => {
        logger.info('AgriTech tracker shutting down');
        await orchestrator.stopAll();
        await closeDatabase();
    };

    await orchestrator.startAll();

    if (config.AGRITECH_RUN_ONCE) {
        await shutdown();
        process.exit(0);
    }

    let shuttingDown = false;
    const onSignal = async (): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        await shutdown();
        process.exit(0);
    };

    process.once('SIGINT', () => void onSignal());
    process.once('SIGTERM', () => void onSignal());

    return { config, shutdown };
}
