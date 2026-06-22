import { logger } from './logger';

/**
 * Base class for a crawl fragment.
 *
 * Subclasses implement execute() with their crawl logic.
 * run() wraps execute() with error logging so scheduler loops
 * survive individual fragment failures.
 */
export abstract class BaseFragment {
    constructor(protected readonly id: string) {}

    protected abstract execute(): Promise<void>;

    async run(): Promise<void> {
        logger.info(`Fragment ${this.id} started`);
        try {
            await this.execute();
            logger.info(`Fragment ${this.id} finished`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`Fragment ${this.id} failed`, { err: msg });
            throw err;
        }
    }
}
