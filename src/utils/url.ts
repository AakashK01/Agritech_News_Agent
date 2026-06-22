/** Strip query/hash and normalize trailing slashes for dedup identity. */
export function canonicalizeSourceUrl(urlString: string): string {
    const u = new URL(urlString.trim());
    u.hash = '';
    u.search = '';
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${host}${pathname}`;
}
