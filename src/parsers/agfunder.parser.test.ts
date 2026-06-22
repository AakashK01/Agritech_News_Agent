import { parseAgfunderListingLinks, parseAgfunderArticle } from './agfunder.parser';

const FIXTURE = `
<html><body>
  <a href="https://agfundernews.com/rainbow-crops-raises-11-25m">Rainbow Crops raises $11.25m</a>
  <a href="/vivici-bags-funding">Vivici bags funding</a>
  <a href="https://agfundernews.com/tag/agtech">Agtech tag</a>
  <a href="https://agfundernews.com/about">About</a>
</body></html>
`;

const ARTICLE_FIXTURE = `
<article class="article-detail">
  <header><h1 class="h2">Picketa Systems raises $1.5m to bring crop nutrient testing to the field</h1></header>
  <div class="article-content">
    <div class="container">
      <div class="row">
        <div class="col-lg-8 content-column">
          <div class="text-wrapper">
            <p>Canada-based startup Picketa Systems has raised a CAD$2.1 million ($1.5 million) round.</p>
            <p>The round was led by Tall Grass Ventures.</p>
          </div>
        </div>
        <div class="col-xl-3 col-lg-4 single-sidebar">
          <div class="textwidget"><p>Sign up for our weekly newsletter.</p></div>
        </div>
      </div>
    </div>
  </div>
</article>
`;

describe('agfunder.parser', () => {
    it('extracts unique article links and skips tags/about', () => {
        const links = parseAgfunderListingLinks(FIXTURE);
        expect(links).toContain('https://agfundernews.com/rainbow-crops-raises-11-25m');
        expect(links).toContain('https://agfundernews.com/vivici-bags-funding');
        expect(links.some((l) => l.includes('/tag/'))).toBe(false);
        expect(links.some((l) => l.includes('/about'))).toBe(false);
    });

    it('extracts article title and body from text-wrapper without sidebar noise', () => {
        const { title, bodyExcerpt } = parseAgfunderArticle(ARTICLE_FIXTURE, 2000);
        expect(title).toContain('Picketa Systems raises $1.5m');
        expect(bodyExcerpt).toContain('CAD$2.1 million');
        expect(bodyExcerpt).toContain('Tall Grass Ventures');
        expect(bodyExcerpt).not.toContain('weekly newsletter');
    });
});
