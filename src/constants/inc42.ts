import type { SectionPriority } from '../domain/types';

export const INC42_BASE_URL = 'https://inc42.com';
export const INC42_HOST = 'inc42.com';
export const INC42_SOURCE_ID = 'inc42';
export const INC42_BROWSER_SESSION = 'inc42';

export type Inc42FetchMode = 'http' | 'browser';

export interface Inc42SectionSeed {
    id: string;
    url: string;
    priority: SectionPriority;
    fetchMode: Inc42FetchMode;
}

/** HTTP listing pages + browser-only Datalabs agritech feed. */
export const INC42_SECTION_SEEDS: Inc42SectionSeed[] = [
    { id: 'homepage', url: `${INC42_BASE_URL}/`, priority: 'high', fetchMode: 'http' },
    {
        id: 'ipo-tracker',
        url: `${INC42_BASE_URL}/features/indian-startup-ipo-tracker-2026/`,
        priority: 'high',
        fetchMode: 'http',
    },
    {
        id: 'agritech-industry',
        url: `${INC42_BASE_URL}/industry/agritech/`,
        priority: 'high',
        fetchMode: 'browser',
    },
];

/** WordPress article routes on inc42.com. */
export const INC42_ARTICLE_PATH_PREFIXES = ['/buzz/', '/features/', '/startups/'] as const;

export const INC42_NON_ARTICLE_PATH_PREFIXES = [
    '/about',
    '/newsletter',
    '/tag/',
    '/industry/',
    '/category/',
    '/author/',
    '/page/',
    '/feed/',
    '/courses/',
    '/reports/',
    '/events/',
    '/brandlabs/',
    '/login',
    '/datalabs/',
    '/wp-content',
    '/wp-includes',
    '/search',
    '/privacy',
    '/terms',
    '/markets',
    '/resources',
    '/glossary',
] as const;

export const INC42_EXCLUDED_PATHS = ['/', '/about', '/newsletter', '/login'] as const;

export const INC42_ARTICLE_SELECTORS = {
    title: 'h1.entry-title',
    titleFallback: 'meta[property="og:title"]',
    ogTitle: 'meta[property="og:title"]',
    body: '.single-post-content',
    bodyFallback: '.entry-content',
    bodyLastResort: 'article',
} as const;
