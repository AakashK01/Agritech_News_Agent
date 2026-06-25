import {
    isLatestNewsSectionAnchored,
    mergeNewLinks,
    parseInc42ListingLinksFromSnapshot,
    shouldStopAfterReadMoreClick,
    shouldStopListingCollecting,
    snapshotIndicatesLoginRequired,
} from './inc42-snapshot.parser';

describe('snapshotIndicatesLoginRequired', () => {
    it('returns false when article links are present and no paywall markers', () => {
        const snapshot = `
- link "Sign in" url=https://inc42.com/login
- link "My Feed" url=https://inc42.com/feed
- link "Aquapulse raises funding" url=https://inc42.com/buzz/aquapulse-funding
`;
        expect(parseInc42ListingLinksFromSnapshot(snapshot).length).toBeGreaterThan(0);
        expect(snapshotIndicatesLoginRequired(snapshot)).toBe(false);
    });

    it('returns true when paywall markers present even with teaser article links', () => {
        const snapshot = `
- StaticText "Sign in to continue reading"
- link "Aquapulse raises funding" url=https://inc42.com/buzz/aquapulse-funding
`;
        expect(parseInc42ListingLinksFromSnapshot(snapshot).length).toBeGreaterThan(0);
        expect(snapshotIndicatesLoginRequired(snapshot)).toBe(true);
    });

    it('returns true when no article links and login wall markers present', () => {
        const snapshot = `
- StaticText "Sign in to continue reading"
- StaticText "Join Inc42 Plus"
`;
        expect(snapshotIndicatesLoginRequired(snapshot)).toBe(true);
    });

    it('returns false when no article links and no login wall markers', () => {
        const snapshot = `
- StaticText "Latest News"
- StaticText "Loading..."
`;
        expect(snapshotIndicatesLoginRequired(snapshot)).toBe(false);
    });
});

describe('mergeNewLinks', () => {
    it('returns only URLs not already in existing', () => {
        const existing = ['https://inc42.com/buzz/a', 'https://inc42.com/buzz/b'];
        const pageLinks = ['https://inc42.com/buzz/b', 'https://inc42.com/buzz/c'];
        const { merged, newLinks } = mergeNewLinks(existing, pageLinks);
        expect(newLinks).toEqual(['https://inc42.com/buzz/c']);
        expect(merged).toEqual([
            'https://inc42.com/buzz/a',
            'https://inc42.com/buzz/b',
            'https://inc42.com/buzz/c',
        ]);
    });

    it('returns empty newLinks when page adds nothing', () => {
        const existing = ['https://inc42.com/buzz/a'];
        const { merged, newLinks } = mergeNewLinks(existing, ['https://inc42.com/buzz/a']);
        expect(newLinks).toEqual([]);
        expect(merged).toEqual(existing);
    });
});

describe('shouldStopListingCollecting', () => {
    const base = {
        readMoreClickCount: 0,
        maxReadMoreClicks: 4,
        scrollStepsThisRound: 0,
        maxScrollStepsPerRound: 8,
    };

    it('returns false when new links were found', () => {
        expect(shouldStopListingCollecting({ ...base, newLinksCount: 3 })).toBe(false);
    });

    it('returns true when max Read More clicks reached', () => {
        expect(
            shouldStopListingCollecting({ ...base, newLinksCount: 0, readMoreClickCount: 4 }),
        ).toBe(true);
    });

    it('returns false after Read More click with no new links when scroll budget remains', () => {
        expect(
            shouldStopListingCollecting({
                ...base,
                newLinksCount: 0,
                readMoreClickCount: 1,
                scrollStepsThisRound: 0,
            }),
        ).toBe(false);
    });

    it('returns true when no new links and scroll steps exhausted', () => {
        expect(
            shouldStopListingCollecting({
                ...base,
                newLinksCount: 0,
                scrollStepsThisRound: 8,
            }),
        ).toBe(true);
    });

    it('returns false when no new links but scroll steps remain', () => {
        expect(
            shouldStopListingCollecting({
                ...base,
                newLinksCount: 0,
                scrollStepsThisRound: 5,
            }),
        ).toBe(false);
    });
});

describe('isLatestNewsSectionAnchored', () => {
    it('returns true when Latest News is visible and article links exist', () => {
        const interactive = '- heading "Latest News" [level=2]';
        expect(isLatestNewsSectionAnchored(interactive, 3)).toBe(true);
    });

    it('returns false when Latest News visible but no article links', () => {
        expect(isLatestNewsSectionAnchored('- heading "Latest News"', 0)).toBe(false);
    });

    it('returns false when article links exist but Latest News not in viewport', () => {
        expect(isLatestNewsSectionAnchored('- link "Home"', 5)).toBe(false);
    });
});

describe('shouldStopAfterReadMoreClick', () => {
    it('returns true when link count unchanged', () => {
        expect(shouldStopAfterReadMoreClick(6, 6)).toBe(true);
    });

    it('returns true when link count decreased', () => {
        expect(shouldStopAfterReadMoreClick(6, 5)).toBe(true);
    });

    it('returns false when new links were added', () => {
        expect(shouldStopAfterReadMoreClick(6, 10)).toBe(false);
    });
});
