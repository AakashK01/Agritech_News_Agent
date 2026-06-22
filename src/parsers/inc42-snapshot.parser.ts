import { isInc42ArticleUrl } from './inc42.parser';
import { buildA11yTree, collectUrlsFromSubtree } from './snapshot/a11y-tree';
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

/** Heuristic: Datalabs pages show login prompts when session is not authenticated. */
export function snapshotIndicatesLoginRequired(snapshotYaml: string): boolean {
    const lower = snapshotYaml.toLowerCase();
    const hasSignIn = lower.includes('sign in') || lower.includes('login');
    const hasPaywall =
        lower.includes('inc42 plus') ||
        lower.includes('join inc42') ||
        lower.includes('my feed');
    return hasSignIn && hasPaywall;
}
