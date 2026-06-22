import * as cheerio from 'cheerio';
import {
    INC42_ARTICLE_PATH_PREFIXES,
    INC42_ARTICLE_SELECTORS,
    INC42_BASE_URL,
    INC42_EXCLUDED_PATHS,
    INC42_HOST,
    INC42_NON_ARTICLE_PATH_PREFIXES,
} from '../constants/inc42';
import { canonicalizeSourceUrl } from '../utils/url';
import { htmlToPlainText, truncateText } from '../utils/html';
import type { IArticleParser, IListingParser, ParsedArticle } from './types';

export function isInc42ArticleUrl(urlString: string): boolean {
    try {
        const u = new URL(urlString);
        if (u.hostname.replace(/^www\./, '') !== INC42_HOST) {
            return false;
        }
        const path = u.pathname.toLowerCase();
        if ((INC42_EXCLUDED_PATHS as readonly string[]).includes(path)) {
            return false;
        }
        if (!INC42_ARTICLE_PATH_PREFIXES.some((p) => path.startsWith(p))) {
            return false;
        }
        const segments = path.split('/').filter(Boolean);
        return segments.length >= 2;
    } catch {
        return false;
    }
}

export function parseInc42ListingLinks(html: string, baseUrl = INC42_BASE_URL): string[] {
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
        if (!isInc42ArticleUrl(absolute)) {
            return;
        }
        const path = new URL(absolute).pathname;
        if (INC42_NON_ARTICLE_PATH_PREFIXES.some((p) => path.startsWith(p))) {
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

export function parseInc42Article(html: string, maxBodyChars: number): ParsedArticle {
    const $ = cheerio.load(html);
    const sel = INC42_ARTICLE_SELECTORS;

    const title =
        $(sel.title).first().text().trim() ||
        $(sel.titleFallback).attr('content')?.trim() ||
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

export const inc42Parser: IListingParser & IArticleParser = {
    parseListingLinks: parseInc42ListingLinks,
    parseArticle: parseInc42Article,
};
