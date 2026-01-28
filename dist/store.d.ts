import type { ConfigStore } from "@foldset/core";
export interface RedisCredentials {
    url: string;
    token: string;
    tenantId: string;
}
export declare function fetchRedisCredentials(apiKey: string): Promise<RedisCredentials>;
export declare function createRedisStore(credentials: RedisCredentials): ConfigStore;
//# sourceMappingURL=store.d.ts.map