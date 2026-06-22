import { SimpleContainer } from '../lib/container';
import { SERVICE_NAMES } from './service-names';
import { getConfig, configRequiresPostgres, type AgriTechConfig } from '../config/app-config';
import { AgentBrowserService } from '../integrations/agent-browser.service';
import { OllamaStartupExtractor } from '../integrations/ollama-startup-extractor.service';
import { PageFetchService } from '../integrations/page-fetch.service';
import { ProfileLockService } from '../integrations/profile-lock.service';
import type { IStartupNewsExtractor } from '../domain/types';
import { UrlContentIndexService } from '../persistence/url-content-index.service';
import { SectionSnapshotService } from '../persistence/section-snapshot.service';
import { ExcelStoreService } from '../persistence/excel-store.service';
import { PostgresStore } from '../persistence/postgres-store.repository';
import { RunHistoryService } from '../persistence/run-history.service';
import { AgfunderNewsJobManager } from '../jobs/agfunder-news-job-manager';
import { Inc42NewsJobManager } from '../jobs/inc42-news-job-manager';
import { Inc42BrowserListingService } from '../integrations/inc42-browser-listing.service';
import { initializeDatabase } from '../db/index';

const PROJECT_ROOT = process.cwd();

export class AgriTechContainer {
    private readonly container = new SimpleContainer();
    private initialized = false;

    constructor() {
        this.register();
    }

    private register(): void {
        const c = this.container;

        c.register(SERVICE_NAMES.CONFIG, () => getConfig());

        c.register(SERVICE_NAMES.PROFILE_LOCK, async () => new ProfileLockService());

        c.register(SERVICE_NAMES.AGENT_BROWSER, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            if (!config.AGRITECH_BROWSER_FALLBACK_ENABLED && !config.AGRITECH_INC42_BROWSER_ENABLED) {
                return null;
            }
            const lock = await c.get<ProfileLockService>(SERVICE_NAMES.PROFILE_LOCK);
            return new AgentBrowserService(config, lock, PROJECT_ROOT);
        });

        c.register(SERVICE_NAMES.INC42_BROWSER_LISTING, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            if (!config.AGRITECH_INC42_BROWSER_ENABLED) {
                return null;
            }
            const agentBrowser = await c.get<AgentBrowserService | null>(SERVICE_NAMES.AGENT_BROWSER);
            if (!agentBrowser) {
                return null;
            }
            return new Inc42BrowserListingService(config, agentBrowser);
        });

        c.register(SERVICE_NAMES.PAGE_FETCH, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            const agentBrowser = await c.get<AgentBrowserService | null>(SERVICE_NAMES.AGENT_BROWSER);
            return new PageFetchService(config, agentBrowser);
        });

        c.register(SERVICE_NAMES.STARTUP_EXTRACTOR, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            if (!config.AGRITECH_AI_ENABLED) {
                return null;
            }
            return new OllamaStartupExtractor(config);
        });

        c.register(SERVICE_NAMES.URL_CONTENT_INDEX, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            return new UrlContentIndexService(config);
        });

        c.register(SERVICE_NAMES.POSTGRES_STORE, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            if (!config.AGRITECH_POSTGRES_ENABLED) {
                return null;
            }
            return new PostgresStore();
        });

        c.register(SERVICE_NAMES.SECTION_SNAPSHOTS, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            const postgres = await c.get<PostgresStore | null>(SERVICE_NAMES.POSTGRES_STORE);
            return new SectionSnapshotService(config, postgres);
        });

        c.register(SERVICE_NAMES.EXCEL_STORE, async () => new ExcelStoreService());

        c.register(SERVICE_NAMES.RUN_HISTORY, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            const excelStore = await c.get<ExcelStoreService>(SERVICE_NAMES.EXCEL_STORE);
            const urlIndex = await c.get<UrlContentIndexService>(SERVICE_NAMES.URL_CONTENT_INDEX);
            const sections = await c.get<SectionSnapshotService>(SERVICE_NAMES.SECTION_SNAPSHOTS);
            const postgres = await c.get<PostgresStore | null>(SERVICE_NAMES.POSTGRES_STORE);
            return new RunHistoryService(config, excelStore, urlIndex, sections, postgres);
        });

        c.register(SERVICE_NAMES.AGFUNDER_JOB_MANAGER, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            const pageFetch = await c.get<PageFetchService>(SERVICE_NAMES.PAGE_FETCH);
            const extractor = await c.get<IStartupNewsExtractor | null>(SERVICE_NAMES.STARTUP_EXTRACTOR);
            const runHistory = await c.get<RunHistoryService>(SERVICE_NAMES.RUN_HISTORY);
            const snapshots = await c.get<SectionSnapshotService>(SERVICE_NAMES.SECTION_SNAPSHOTS);
            return new AgfunderNewsJobManager(config, pageFetch, extractor, runHistory, snapshots);
        });

        c.register(SERVICE_NAMES.INC42_JOB_MANAGER, async () => {
            const config = await c.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
            const pageFetch = await c.get<PageFetchService>(SERVICE_NAMES.PAGE_FETCH);
            const browserListing = await c.get<Inc42BrowserListingService | null>(SERVICE_NAMES.INC42_BROWSER_LISTING);
            const extractor = await c.get<IStartupNewsExtractor | null>(SERVICE_NAMES.STARTUP_EXTRACTOR);
            const runHistory = await c.get<RunHistoryService>(SERVICE_NAMES.RUN_HISTORY);
            const snapshots = await c.get<SectionSnapshotService>(SERVICE_NAMES.SECTION_SNAPSHOTS);
            return new Inc42NewsJobManager(config, pageFetch, browserListing, extractor, runHistory, snapshots);
        });
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        await this.container.initialize();
        const config = await this.container.get<AgriTechConfig>(SERVICE_NAMES.CONFIG);
        if (configRequiresPostgres(config)) {
            await initializeDatabase(config);
        }
        this.initialized = true;
    }

    async get<T>(name: string): Promise<T> {
        return this.container.get<T>(name);
    }
}

export const agritechContainer = new AgriTechContainer();
