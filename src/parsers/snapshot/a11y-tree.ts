/**
 * Generic parser for agent-browser / Playwright-style accessibility snapshots:
 * indented lines starting with "- " (role + optional attributes).
 */

export interface A11ySnapNode {
    content: string;
    children: A11ySnapNode[];
}

const STATIC_TEXT_RE = /StaticText\s+"((?:[^"\\]|\\.)*)"/g;
const ATTR_URL_RE = /\burl=(https?:\/\/[^,\]\s]+)/gi;

function stripIndentLine(line: string): { indent: number; rest: string } | null {
    const m = line.match(/^(\s*)-\s+(.*)$/);
    if (!m) {
        return null;
    }
    return { indent: m[1].length, rest: m[2].trimEnd() };
}

export function buildA11yTree(snapshotText: string): A11ySnapNode {
    const lines = snapshotText.split(/\r?\n/);
    const entries: { indent: number; content: string }[] = [];
    for (const line of lines) {
        const parsed = stripIndentLine(line);
        if (!parsed) {
            continue;
        }
        entries.push({ indent: parsed.indent, content: parsed.rest });
    }

    const root: A11ySnapNode = { content: 'root', children: [] };
    const stack: { node: A11ySnapNode; indent: number }[] = [{ node: root, indent: -1 }];

    for (const { indent, content } of entries) {
        const node: A11ySnapNode = { content, children: [] };
        while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) {
            stack.pop();
        }
        const parent = stack[stack.length - 1]!.node;
        parent.children.push(node);
        stack.push({ node, indent });
    }

    return root;
}

function walkDepthFirst(node: A11ySnapNode, visit: (n: A11ySnapNode) => void): void {
    visit(node);
    for (const c of node.children) {
        walkDepthFirst(c, visit);
    }
}

/** Collect quoted StaticText payloads from this node and descendants (order preserved DFS). */
export function collectStaticTextFromSubtree(node: A11ySnapNode): string[] {
    const out: string[] = [];
    walkDepthFirst(node, (n) => {
        STATIC_TEXT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = STATIC_TEXT_RE.exec(n.content)) !== null) {
            const raw = m[1] ?? '';
            const unescaped = raw.replace(/\\"/g, '"').replace(/\\n/g, '\n');
            if (unescaped.trim().length > 0) {
                out.push(unescaped);
            }
        }
    });
    return out;
}

function normalizeUrl(raw: string): string {
    try {
        const u = new URL(raw);
        u.hash = '';
        u.search = '';
        let s = u.href;
        if (s.endsWith('/')) {
            s = s.slice(0, -1);
        }
        return s;
    } catch {
        return raw.trim();
    }
}

/** Collect `url=` attributes from a subtree (DFS order, deduped). */
export function collectUrlsFromSubtree(node: A11ySnapNode): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    walkDepthFirst(node, (n) => {
        ATTR_URL_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = ATTR_URL_RE.exec(n.content)) !== null) {
            const raw = m[1] ?? '';
            const norm = normalizeUrl(raw);
            if (!seen.has(norm)) {
                seen.add(norm);
                ordered.push(norm);
            }
        }
    });
    return ordered;
}

/** Wrap snapshot static text into minimal HTML so cheerio parsers can consume browser fallback output. */
export function snapshotToMinimalHtml(snapshotText: string): string {
    const root = buildA11yTree(snapshotText);
    const texts = collectStaticTextFromSubtree(root);
    const title = texts[0] ?? '';
    const body = texts.slice(1).join('\n');
    const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<html><head><title>${esc(title)}</title></head><body><article class="article-content"><p>${esc(body)}</p></article></body></html>`;
}
