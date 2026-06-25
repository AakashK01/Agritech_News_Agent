import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import { AgfunderNewsFragment } from '../fragments/agfunder-news-fragment';
import type { PageFetchService } from '../integrations/page-fetch.service';
import type { IStartupNewsExtractor } from '../domain/types';
import type { RunHistoryService } from '../persistence/run-history.service';
import type { ICrawlJobManager } from './crawl-job-manager.interface';

export class AgfunderNewsJobManager implements ICrawlJobManager {
    readonly jobId = 'agfunder-news';

    constructor(
        private readonly appConfig: AgriTechConfig,
        private readonly pageFetch: PageFetchService,
        private readonly extractor: IStartupNewsExtractor | null,
        private readonly runHistory: RunHistoryService,
    ) {}

    isEnabled(): boolean {
        return this.appConfig.AGRITECH_AGFUNDER_ENABLED;
    }

    async runOnce(): Promise<void> {
        if (!this.isEnabled()) {
            logger.info('AgFunder job skipped — AGRITECH_AGFUNDER_ENABLED=false');
            return;
        }
        await this.createFragment(`${this.jobId}-once`).run();
    }

    private createFragment(id: string): AgfunderNewsFragment {
        return new AgfunderNewsFragment(
            id,
            this.appConfig,
            this.pageFetch,
            this.extractor,
            this.runHistory,
        );
    }
}
