import type { SectionSeed } from '../domain/types';

export const AGFUNDER_BASE_URL = 'https://agfundernews.com';
export const AGFUNDER_HOST = 'agfundernews.com';
export const AGFUNDER_SOURCE_ID = 'agfunder';
export const AGFUNDER_BROWSER_SESSION = 'agfunder';

/** AFN listing/tag pages — resolved from live site structure (WordPress /tag/ routes). */
export const AGFUNDER_SECTION_SEEDS: SectionSeed[] = [
    { id: 'homepage', url: `${AGFUNDER_BASE_URL}/`, priority: 'high' },
    { id: 'tag-agtech', url: `${AGFUNDER_BASE_URL}/tag/agtech`, priority: 'high' },
    { id: 'tag-foodtech', url: `${AGFUNDER_BASE_URL}/tag/foodtech`, priority: 'high' },
    { id: 'tag-startups', url: `${AGFUNDER_BASE_URL}/tag/startups`, priority: 'high' },
    { id: 'tag-investor-qa', url: `${AGFUNDER_BASE_URL}/tag/investor-qa`, priority: 'medium' },
    { id: 'tag-insect-ag', url: `${AGFUNDER_BASE_URL}/tag/insect-ag`, priority: 'medium' },
    { id: 'tag-video', url: `${AGFUNDER_BASE_URL}/tag/video`, priority: 'low' },
    { id: 'tag-global-report-2026', url: `${AGFUNDER_BASE_URL}/tag/global-report-2026`, priority: 'low' },
];

/** Paths excluded from article link extraction. */
export const AGFUNDER_NON_ARTICLE_PATH_PREFIXES = [
    '/about',
    '/newsletter',
    '/wp-content',
    '/wp-includes',
    '/tag/',
    '/news/page/',
    '/search',
    '/privacy',
    '/terms',
];

/** URL path segments that are never article pages. */
export const AGFUNDER_EXCLUDED_PATHS = ['/', '/about', '/newsletter'] as const;

/** Single-segment slug paths like `/rainbow-crops-raises-11m`. */
export const AGFUNDER_ARTICLE_PATH_PATTERN = /^\/[a-z0-9-]+$/i;

export const AGFUNDER_ARTICLE_SELECTORS = {
    title: 'h1',
    titleFallback: 'title',
    ogTitle: 'meta[property="og:title"]',
    body: '.article-content .text-wrapper',
    bodyFallback: '.article-content .content-column',
    bodyLastResort: '.article-content',
} as const;
