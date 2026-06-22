/**
 * Minimal async DI container.
 *
 * - Register services by string key with an async factory.
 * - First call to get() runs the factory; subsequent calls return the cached singleton.
 * - No decorators, no reflect-metadata, no external dependencies.
 *
 * Usage:
 *   const container = new SimpleContainer();
 *   container.register('config', async () => loadMyConfig());
 *   container.register('db', async () => new DbPool(await container.get('config')));
 *   const db = await container.get<DbPool>('db');
 */
export class SimpleContainer {
    private readonly factories = new Map<string, () => Promise<unknown>>();
    private readonly singletons = new Map<string, unknown>();

    register<T>(name: string, factory: () => Promise<T>): void {
        if (this.factories.has(name)) {
            throw new Error(`Service already registered: ${name}`);
        }
        this.factories.set(name, factory as () => Promise<unknown>);
    }

    async get<T>(name: string): Promise<T> {
        if (this.singletons.has(name)) {
            return this.singletons.get(name) as T;
        }

        const factory = this.factories.get(name);
        if (!factory) {
            throw new Error(`Service not registered: ${name}`);
        }

        const instance = await factory();
        this.singletons.set(name, instance);
        return instance as T;
    }

    /**
     * Eagerly resolve all registered services in registration order.
     * Useful for fail-fast startup validation.
     */
    async initialize(): Promise<void> {
        for (const name of this.factories.keys()) {
            await this.get(name);
        }
    }
}
