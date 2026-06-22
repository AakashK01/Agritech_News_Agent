import { parseStartupExtractJson } from '../integrations/ollama-startup-extractor.service';

describe('parseStartupExtractJson', () => {
    it('parses valid ollama json', () => {
        const raw = JSON.stringify({
            isRelevant: true,
            startupName: 'Rainbow Crops',
            startupWebsite: 'https://rainbowcrops.com',
            description: 'Gene editing for crops',
            newsSummary: 'Raised $11.25m',
        });
        const result = parseStartupExtractJson(raw);
        expect(result.isRelevant).toBe(true);
        expect(result.startupName).toBe('Rainbow Crops');
    });

    it('strips markdown fences', () => {
        const raw = '```json\n{"isRelevant":false,"startupName":null,"startupWebsite":null,"description":null,"newsSummary":null}\n```';
        const result = parseStartupExtractJson(raw);
        expect(result.isRelevant).toBe(false);
    });

    it('rejects relevant extraction missing newsSummary via isCompleteExtraction', () => {
        const raw = JSON.stringify({
            isRelevant: true,
            startupName: 'Picketa',
            startupWebsite: null,
            description: null,
            newsSummary: null,
        });
        const result = parseStartupExtractJson(raw);
        expect(result.isRelevant).toBe(true);
        expect(result.newsSummary).toBeNull();
    });
});
