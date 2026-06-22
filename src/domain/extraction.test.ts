import { isCompleteExtraction } from './extraction';
import type { StartupNewsExtractResult } from './types';

describe('isCompleteExtraction', () => {
    it('passes when not relevant', () => {
        expect(isCompleteExtraction({ isRelevant: false, startupName: null, startupWebsite: null, description: null, newsSummary: null })).toBe(true);
    });

    it('requires startupName and newsSummary when relevant', () => {
        const base: StartupNewsExtractResult = {
            isRelevant: true,
            startupName: 'Picketa',
            startupWebsite: null,
            description: null,
            newsSummary: 'Raised $1.5m',
        };
        expect(isCompleteExtraction(base)).toBe(true);
        expect(isCompleteExtraction({ ...base, newsSummary: null })).toBe(false);
        expect(isCompleteExtraction({ ...base, startupName: null })).toBe(false);
        expect(isCompleteExtraction({ ...base, newsSummary: '  ' })).toBe(false);
    });
});
