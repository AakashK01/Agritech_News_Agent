import { parseInc42ListingLinks, parseInc42Article, isInc42ArticleUrl } from './inc42.parser';

const LISTING_FIXTURE = `
<html><body>
  <a href="https://inc42.com/buzz/recykal-bags-23-mn-to-take-its-waste-management-solutions-global/">Recykal</a>
  <a href="https://inc42.com/features/indian-startup-ipo-tracker-2026/">IPO Tracker</a>
  <a href="https://inc42.com/industry/agritech/">Agritech industry</a>
  <a href="https://inc42.com/about">About</a>
</body></html>
`;

const ARTICLE_FIXTURE = `
<article>
  <h1 class="entry-title">Recykal Bags $23 Mn To Take Its Waste Management Solutions Global</h1>
  <div class="single-post-content">
    <p>Recykal has raised $23 million in funding led by Peak XV Partners.</p>
    <p>The Hyderabad-based startup operates a waste management platform.</p>
  </div>
</article>
`;

describe('inc42.parser', () => {
    it('identifies inc42 article URLs', () => {
        expect(isInc42ArticleUrl('https://inc42.com/buzz/recykal-bags-23-mn/')).toBe(true);
        expect(isInc42ArticleUrl('https://inc42.com/features/indian-startup-ipo-tracker-2026/')).toBe(true);
        expect(isInc42ArticleUrl('https://inc42.com/industry/agritech/')).toBe(false);
        expect(isInc42ArticleUrl('https://inc42.com/about')).toBe(false);
    });

    it('extracts article links from listing HTML', () => {
        const links = parseInc42ListingLinks(LISTING_FIXTURE);
        expect(links).toContain('https://inc42.com/buzz/recykal-bags-23-mn-to-take-its-waste-management-solutions-global');
        expect(links).toContain('https://inc42.com/features/indian-startup-ipo-tracker-2026');
        expect(links.some((l) => l.includes('/industry/'))).toBe(false);
    });

    it('extracts article title and body', () => {
        const { title, bodyExcerpt } = parseInc42Article(ARTICLE_FIXTURE, 2000);
        expect(title).toContain('Recykal Bags $23 Mn');
        expect(bodyExcerpt).toContain('$23 million');
        expect(bodyExcerpt).toContain('waste management');
    });
});
