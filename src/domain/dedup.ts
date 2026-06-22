import { createHash } from 'node:crypto';
import { NEWS_ENTRY_KEY_PREFIX } from '../constants/app';

export function normalizeContentText(title: string, bodyExcerpt: string): string {
    return `${title.trim()}\u0001${bodyExcerpt.trim()}`.replace(/\s+/g, ' ').toLowerCase();
}

export function computeContentHash(title: string, bodyExcerpt: string): string {
    return createHash('md5').update(normalizeContentText(title, bodyExcerpt), 'utf8').digest('hex');
}

export function hashArticleLinkList(links: string[]): string {
    const sorted = [...links].map((l) => l.trim()).sort();
    return createHash('md5').update(sorted.join('\n'), 'utf8').digest('hex');
}

export function computeNewsEntryId(canonicalUrl: string, contentHash: string): string {
    return createHash('md5')
        .update(`${NEWS_ENTRY_KEY_PREFIX}:${canonicalUrl}:${contentHash}`, 'utf8')
        .digest('hex');
}
