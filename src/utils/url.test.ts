import { canonicalizeSourceUrl } from './url';
import { isAgfunderArticleUrl } from '../parsers/agfunder.parser';

describe('url', () => {
    it('strips query and hash', () => {
        expect(canonicalizeSourceUrl('https://agfundernews.com/foo?utm=1#x')).toBe(
            'https://agfundernews.com/foo',
        );
    });

    it('normalizes www hostname', () => {
        expect(canonicalizeSourceUrl('https://www.inc42.com/buzz/foo/')).toBe(
            'https://inc42.com/buzz/foo',
        );
    });
});

describe('isAgfunderArticleUrl', () => {
    it('recognizes article slugs', () => {
        expect(isAgfunderArticleUrl('https://agfundernews.com/rainbow-crops-raises-11m')).toBe(true);
        expect(isAgfunderArticleUrl('https://agfundernews.com/tag/agtech')).toBe(false);
        expect(isAgfunderArticleUrl('https://agfundernews.com/about')).toBe(false);
    });
});
