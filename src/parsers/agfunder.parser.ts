import * as cheerio from 'cheerio';
import {
    AGFUNDER_ARTICLE_PATH_PATTERN,
    AGFUNDER_ARTICLE_SELECTORS,
    AGFUNDER_BASE_URL,
    AGFUNDER_EXCLUDED_PATHS,
    AGFUNDER_HOST,
    AGFUNDER_NON_ARTICLE_PATH_PREFIXES,
} from '../constants/agfunder';
import { canonicalizeSourceUrl } from '../utils/url';
import { htmlToPlainText, truncateText } from '../utils/html';
import type { IArticleParser, IListingParser, ParsedArticle } from './types';

export function isAgfunderArticleUrl(urlString: string): boolean {
    try {
        const u = new URL(urlString);
        if (u.hostname.replace(/^www\./, '') !== AGFUNDER_HOST) {
            return false;
        }
        const path = u.pathname;
        if ((AGFUNDER_EXCLUDED_PATHS as readonly string[]).includes(path)) {
            return false;
        }
        if (path.startsWith('/tag/') || path.startsWith('/news/page/')) {
            return false;
        }
        if (path.startsWith('/wp-') || path === '/about' || path === '/newsletter') {
            return false;
        }
        return AGFUNDER_ARTICLE_PATH_PATTERN.test(path);
    } catch {
        return false;
    }
}

export function parseAgfunderListingLinks(html: string, baseUrl = AGFUNDER_BASE_URL): string[] {
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const out: string[] = [];

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href')?.trim();
        if (!href) {
            return;
        }
        let absolute: string;
        try {
            absolute = new URL(href, baseUrl).href;
        } catch {
            return;
        }
        if (!isAgfunderArticleUrl(absolute)) {
            return;
        }
        const path = new URL(absolute).pathname;
        if (AGFUNDER_NON_ARTICLE_PATH_PREFIXES.some((p) => path.startsWith(p))) {
            return;
        }
        const canonical = canonicalizeSourceUrl(absolute);
        if (seen.has(canonical)) {
            return;
        }
        seen.add(canonical);
        out.push(canonical);
    });

    return out;
}

export function parseAgfunderArticle(html: string, maxBodyChars: number): ParsedArticle {
    const $ = cheerio.load(html);
    const sel = AGFUNDER_ARTICLE_SELECTORS;

    const title =
        $(sel.title).first().text().trim() ||
        $(sel.titleFallback).first().text().trim() ||
        $(sel.ogTitle).attr('content')?.trim() ||
        '';

    const bodyHtml =
        $(sel.body).html() ||
        $(sel.bodyFallback).html() ||
        $(sel.bodyLastResort).first().html() ||
        '';

    const bodyPlain = htmlToPlainText(bodyHtml);
    const bodyExcerpt = truncateText(bodyPlain, maxBodyChars);

    return { title, bodyExcerpt };
}

/** AgFunder parser — implements shared interfaces for reuse across sources. */
export const agfunderParser: IListingParser & IArticleParser = {
    parseListingLinks: parseAgfunderListingLinks,
    parseArticle: parseAgfunderArticle,
};
