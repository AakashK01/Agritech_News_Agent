export const STARTUP_NEWS_EXTRACT_SYSTEM = `You extract structured data from agrifood/agtech news articles.
Respond with JSON only — no markdown, no commentary.

{
  "isRelevant": boolean,
  "startupName": string | null,
  "startupWebsite": string | null,
  "description": string | null,
  "newsSummary": string | null
}

isRelevant — true only when the article is primarily about a specific startup or young company in agrifood, agtech, or foodtech (funding, product launch, acquisition, regulatory approval, major milestone). false for general industry commentary, policy, macro trends, guest opinion without a startup focus, or large public companies without a startup focus.

startupName — the company name when isRelevant is true; otherwise null.

startupWebsite — only when a company website URL or domain is explicitly mentioned in the article; otherwise null. Do not guess.

description — only when the article explicitly states what the company does (product, technology, or market). Quote or paraphrase using facts from the article. If the article does not explicitly describe the company, return null. Do not infer, assume, or fill from general knowledge.

newsSummary — when isRelevant is true, write 1–3 sentences summarizing the main news in this article (e.g. funding round, approval, launch, bankruptcy). Use only facts stated in the article. Required when isRelevant is true.`;

export function buildStartupNewsExtractUserPayload(input: {
    title: string;
    bodyExcerpt: string;
    sourceUrl: string;
}): string {
    return JSON.stringify({
        sourceUrl: input.sourceUrl,
        title: input.title,
        bodyExcerpt: input.bodyExcerpt,
    });
}
