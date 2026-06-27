import { parseTabListOutput } from './agent-browser.service';

describe('parseTabListOutput', () => {
    it('parses agent-browser JSON envelope with data.tabs', () => {
        const stdout = JSON.stringify({
            success: true,
            data: {
                tabs: [
                    { active: false, index: 0, url: 'https://inc42.com/industry/agritech/' },
                    { active: false, index: 1, url: 'https://example.com/a1' },
                    { active: true, index: 5, url: 'https://example.com/a5' },
                ],
            },
            error: null,
        });

        const tabs = parseTabListOutput(stdout);
        expect(tabs).toHaveLength(3);
        expect(tabs?.[2]).toMatchObject({ index: 5, active: true, url: 'https://example.com/a5' });
    });

    it('does not treat JSON blob as a single plain-text line', () => {
        const stdout = JSON.stringify({
            success: true,
            data: { tabs: [{ index: 0 }, { index: 1 }, { index: 2 }] },
        });

        expect(parseTabListOutput(stdout)).toHaveLength(3);
    });

    it('parses plain tab list output', () => {
        const stdout = [
            '  [0] Agritech - https://inc42.com/industry/agritech/',
            '  [1] example.com/a1 - https://example.com/a1',
            '→ [2] example.com/a2 - https://example.com/a2',
        ].join('\n');

        const tabs = parseTabListOutput(stdout);
        expect(tabs).toHaveLength(3);
        expect(tabs?.[2]).toMatchObject({ index: 2, active: true, url: 'https://example.com/a2' });
    });
});
