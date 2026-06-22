import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import { Inc42NewsFragment } from '../fragments/inc42-news-fragment';
import type { Inc42BrowserListingService } from '../integrations/inc42-browser-listing.service';
import type { PageFetchService } from '../integrations/page-fetch.service';
import type { IStartupNewsExtractor } from '../domain/types';
import type { RunHistoryService } from '../persistence/run-history.service';
import type { SectionSnapshotService } from '../persistence/section-snapshot.service';
import type { ICrawlJobManager } from './crawl-job-manager.interface';

export class Inc42NewsJobManager implements ICrawlJobManager {
    readonly jobId = 'inc42-news';

    constructor(
        private readonly appConfig: AgriTechConfig,
        private readonly pageFetch: PageFetchService,
        private readonly browserListing: Inc42BrowserListingService | null,
        private readonly extractor: IStartupNewsExtractor | null,
        private readonly runHistory: RunHistoryService,
        private readonly sectionSnapshots: SectionSnapshotService,
    ) {}

    isEnabled(): boolean {
        return this.appConfig.AGRITECH_INC42_ENABLED;
    }

    async runOnce(): Promise<void> {
        if (!this.isEnabled()) {
            logger.info('Inc42 job skipped — AGRITECH_INC42_ENABLED=false');
            return;
        }
        await this.createFragment(`${this.jobId}-once`).run();
    }

    private createFragment(id: string): Inc42NewsFragment {
        return new Inc42NewsFragment(
            id,
            this.appConfig,
            this.pageFetch,
            this.browserListing,
            this.extractor,
            this.runHistory,
            this.sectionSnapshots,
        );
    }
}
