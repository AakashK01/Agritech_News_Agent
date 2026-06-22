import { logger } from './logger';

/**
 * Simple interval-based job scheduler.
 *
 * - start() runs the provided function immediately, then on every interval.
 * - Errors from the run function are logged but do not stop the scheduler.
 * - stop() clears the interval and prevents the next scheduled run.
 */
export class JobScheduler {
    private handle: NodeJS.Timeout | null = null;
    private running = false;

    constructor(
        private readonly name: string,
        private readonly intervalMs: number,
    ) {}

    start(runFn: () => Promise<void>): void {
        if (this.running) {
            logger.warn(`Scheduler ${this.name} is already running`);
            return;
        }
        this.running = true;

        const safeRun = (): void => {
            runFn().catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`Scheduler ${this.name} run error`, { err: msg });
            });
        };

        safeRun();
        this.handle = setInterval(safeRun, this.intervalMs);
        logger.info(`Scheduler ${this.name} started`, { intervalMs: this.intervalMs });
    }

    stop(): void {
        if (this.handle !== null) {
            clearInterval(this.handle);
            this.handle = null;
        }
        this.running = false;
        logger.info(`Scheduler ${this.name} stopped`);
    }

    isRunning(): boolean {
        return this.running;
    }
}
