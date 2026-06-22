/** Contract for a scheduled crawl job (one source pipeline per implementation). */
export interface ICrawlJobManager {
    readonly jobId: string;
    isEnabled(): boolean;
    runOnce(): Promise<void>;
}
