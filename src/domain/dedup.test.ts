import { computeContentHash, hashArticleLinkList, computeNewsEntryId } from './dedup';

describe('dedup', () => {
    it('computeContentHash is stable for same input', () => {
        const a = computeContentHash('Title', 'Body text');
        const b = computeContentHash('Title', 'Body text');
        expect(a).toBe(b);
    });

    it('computeContentHash changes when body changes', () => {
        const a = computeContentHash('Title', 'Body v1');
        const b = computeContentHash('Title', 'Body v2');
        expect(a).not.toBe(b);
    });

    it('hashArticleLinkList is order-independent', () => {
        const links = [
            'https://agfundernews.com/a',
            'https://agfundernews.com/b',
        ];
        const reversed = [...links].reverse();
        expect(hashArticleLinkList(links)).toBe(hashArticleLinkList(reversed));
    });

    it('computeNewsEntryId produces stable md5 hex key', () => {
        const key = computeNewsEntryId('https://agfundernews.com/foo', 'abc123');
        expect(key).toMatch(/^[a-f0-9]{32}$/);
        expect(key).toBe(computeNewsEntryId('https://agfundernews.com/foo', 'abc123'));
    });

    it('computeNewsEntryId differs when content hash changes for same url', () => {
        const url = 'https://agfundernews.com/foo';
        expect(computeNewsEntryId(url, 'hash1')).not.toBe(computeNewsEntryId(url, 'hash2'));
    });
});
