export interface ParsedArticle {
    title: string;
    bodyExcerpt: string;
}

export interface IListingParser {
    parseListingLinks(html: string, baseUrl?: string): string[];
}

export interface IArticleParser {
    parseArticle(html: string, maxBodyChars: number): ParsedArticle;
}
