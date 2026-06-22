import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import {
    STARTUP_NEWS_EXTRACT_SYSTEM,
    buildStartupNewsExtractUserPayload,
} from '../constants/ollama-prompts';
import type { IStartupNewsExtractor,
    StartupNewsExtractInput,
    StartupNewsExtractResult,
} from '../domain/types';
import { postOllamaJsonChat, stripMarkdownJsonFence } from './ollama-json-chat';
import { truncateText } from '../utils/html';

const EXTRACTION_FAILED: StartupNewsExtractResult = {
    isRelevant: false,
    startupName: null,
    startupWebsite: null,
    description: null,
    newsSummary: null,
    extractionFailed: true,
};

export class OllamaStartupExtractor implements IStartupNewsExtractor {
    constructor(private readonly config: AgriTechConfig) {}

    async extract(input: StartupNewsExtractInput): Promise<StartupNewsExtractResult> {
        const bodyExcerpt = truncateText(input.bodyExcerpt, this.config.AI_INPUT_MAX_CHARS);
        const userText = buildStartupNewsExtractUserPayload({
            title: input.title,
            bodyExcerpt,
            sourceUrl: input.sourceUrl,
        });

        try {
            const raw = await postOllamaJsonChat({
                baseUrl: this.config.OLLAMA_BASE_URL,
                model: this.config.OLLAMA_MODEL,
                systemText: STARTUP_NEWS_EXTRACT_SYSTEM,
                userText,
                temperature: this.config.OLLAMA_TEMPERATURE,
                timeoutMs: this.config.OLLAMA_REQUEST_TIMEOUT_MS,
                numPredict: this.config.OLLAMA_NUM_PREDICT,
            });
            return parseStartupExtractJson(raw);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn('Ollama startup extract failed', { sourceUrl: input.sourceUrl, err: message });
            return EXTRACTION_FAILED;
        }
    }
}

export function parseStartupExtractJson(raw: string): StartupNewsExtractResult {
    const stripped = stripMarkdownJsonFence(raw);
    const parsed = JSON.parse(stripped) as Partial<StartupNewsExtractResult>;
    return {
        isRelevant: Boolean(parsed.isRelevant),
        startupName: nullOrString(parsed.startupName),
        startupWebsite: nullOrString(parsed.startupWebsite),
        description: nullOrString(parsed.description),
        newsSummary: nullOrString(parsed.newsSummary),
    };
}

function nullOrString(v: unknown): string | null {
    if (typeof v !== 'string') {
        return null;
    }
    const t = v.trim();
    return t.length > 0 ? t : null;
}
