/** Serialize automation per resolved profile directory (in-process queue). */
export class ProfileLockService {
    private readonly tails = new Map<string, Promise<unknown>>();

    runExclusive<T>(profilePath: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.tails.get(profilePath) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        this.tails.set(
            profilePath,
            next.then(
                () => undefined,
                () => undefined,
            ),
        );
        return next;
    }
}
