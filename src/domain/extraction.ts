import type { StartupNewsExtractResult } from './types';

/** Relevant extractions must include a startup name and news summary. */
export function isCompleteExtraction(result: StartupNewsExtractResult): boolean {
    if (!result.isRelevant) {
        return true;
    }
    return Boolean(result.startupName?.trim()) && Boolean(result.newsSummary?.trim());
}
