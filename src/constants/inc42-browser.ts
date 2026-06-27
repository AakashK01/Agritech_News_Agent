export const INC42_READ_MORE_TEXT = 'Read More Stories';
/** Max Read More button click attempts per listing fetch. */
export const INC42_READ_MORE_MAX_CLICKS = 7;
/** Wait after a Read More click for new stories to render (ms). */
export const INC42_READ_MORE_SETTLE_MS = 1500;

export const INC42_LATEST_NEWS_TEXT = 'Latest News';
/** Pixels to scroll down each step (~50% of a full PageDown). */
export const INC42_SCROLL_STEP_PX = 500;
/** Max scroll steps per listing fetch. */
export const INC42_SCROLL_MAX_STEPS = 12;
/** Pause between each scroll/click iteration (ms). */
export const INC42_SCROLL_SETTLE_MS = 2000;

/** Saved auth state for agent-browser (exported by npm run inc42:login). */
export const INC42_AUTH_STATE_FILE = 'inc42-auth.json';

export const INC42_DEFAULT_DEBUG_PORT = 9222;

/** Wait after opening an article in a new tab before snapshot (ms). */
export const INC42_ARTICLE_SETTLE_MS = 2000;
/** Max snapshot attempts when article content is incomplete. */
export const INC42_ARTICLE_SNAPSHOT_MAX_RETRIES = 3;
/** Minimum body excerpt length to consider a snapshot complete. */
export const INC42_ARTICLE_MIN_BODY_CHARS = 80;
