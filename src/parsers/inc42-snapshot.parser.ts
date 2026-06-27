import { isInc42ArticleUrl } from './inc42.parser';
import { buildA11yTree, collectUrlsFromSubtree, collectStaticTextFromSubtree } from './snapshot/a11y-tree';
import { canonicalizeSourceUrl } from '../utils/url';

/** Extract article URLs from an agent-browser accessibility snapshot (Datalabs feeds). */
export function parseInc42ListingLinksFromSnapshot(snapshotYaml: string): string[] {
    const root = buildA11yTree(snapshotYaml);
    const urls = collectUrlsFromSubtree(root);
    const seen = new Set<string>();
    const out: string[] = [];

    for (const raw of urls) {
        if (!isInc42ArticleUrl(raw)) {
            continue;
        }
        const canonical = canonicalizeSourceUrl(raw);
        if (seen.has(canonical)) {
            continue;
        }
        seen.add(canonical);
        out.push(canonical);
    }

    return out;
}

/**
 * Extract title and body text from an article page accessibility snapshot.
 * The first static text node is treated as the headline; the rest form the body.
 */
export function parseArticleFromSnapshot(
    snapshotYaml: string,
    maxChars: number,
): { title: string; bodyExcerpt: string } {
    const root = buildA11yTree(snapshotYaml);
    const texts = collectStaticTextFromSubtree(root);
    if (texts.length === 0) {
        return { title: '', bodyExcerpt: '' };
    }
    const title = texts[0] ?? '';
    const bodyExcerpt = texts.slice(1).join('\n').slice(0, maxChars);
    return { title, bodyExcerpt };
}

/** True when snapshot parsing yielded a usable title and body for Ollama extraction. */
export function isArticleSnapshotComplete(
    title: string,
    bodyExcerpt: string,
    minBodyChars = 80,
): boolean {
    return title.trim().length > 0 && bodyExcerpt.trim().length >= minBodyChars;
}

function snapshotHasPaywallMarkers(snapshotYaml: string): boolean {
    const lower = snapshotYaml.toLowerCase();
    return (
        lower.includes('sign in to continue') ||
        lower.includes('sign in to read') ||
        (lower.includes('sign in') && lower.includes('join inc42'))
    );
}

/** Heuristic: paywall markers take precedence; teaser links alone do not mean logged in. */
export function snapshotIndicatesLoginRequired(snapshotYaml: string): boolean {
    return snapshotHasPaywallMarkers(snapshotYaml);
}

/** Merge page links into an existing collection; returns newly discovered URLs. */
export function mergeNewLinks(
    existing: string[],
    pageLinks: string[],
): { merged: string[]; newLinks: string[] } {
    const merged = [...existing];
    const newLinks: string[] = [];
    for (const link of pageLinks) {
        if (merged.includes(link)) {
            continue;
        }
        merged.push(link);
        newLinks.push(link);
    }
    return { merged, newLinks };
}

export interface ListingCollectStopInput {
    newLinksCount: number;
    readMoreClickCount: number;
    maxReadMoreClicks: number;
    scrollStepsThisRound: number;
    maxScrollStepsPerRound: number;
}

/** Whether the listing scroll/collect loop should stop for this round. */
export function shouldStopListingCollecting(input: ListingCollectStopInput): boolean {
    if (input.readMoreClickCount >= input.maxReadMoreClicks) {
        return true;
    }
    if (input.newLinksCount > 0) {
        return false;
    }
    return input.scrollStepsThisRound >= input.maxScrollStepsPerRound;
}

/** True when Latest News is in the interactive viewport and the feed has article links. */
export function isLatestNewsSectionAnchored(
    interactiveSnapshot: string,
    articleLinkCount: number,
    latestNewsText = 'Latest News',
): boolean {
    if (articleLinkCount < 1) {
        return false;
    }
    return interactiveSnapshot.toLowerCase().includes(latestNewsText.toLowerCase());
}

/** Stop further Read More clicks when the last click did not expand the link set. */
export function shouldStopAfterReadMoreClick(linksBefore: number, linksAfter: number): boolean {
    return linksAfter <= linksBefore;
}

/**
 * True when the Read More text appears as an exact quoted string in the interactive viewport
 * snapshot. Accepts any a11y role — click success is validated by link count change.
 */
export function isReadMoreButtonVisibleInInteractiveSnapshot(
    interactiveSnapshot: string,
    readMoreText = 'Read More Stories',
): boolean {
    const escaped = readMoreText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`["']${escaped}["']`, 'i').test(interactiveSnapshot);
}

/** Extract @eN ref for a quoted label from an agent-browser interactive snapshot line. */
export function extractInteractiveRefForQuotedText(
    interactiveSnapshot: string,
    text: string,
): string | null {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quotedPattern = new RegExp(`["']${escaped}["']`, 'i');
    for (const line of interactiveSnapshot.split('\n')) {
        if (!quotedPattern.test(line)) {
            continue;
        }
        const refMatch = /@e\d+/.exec(line);
        if (refMatch) {
            return refMatch[0];
        }
    }
    return null;
}
