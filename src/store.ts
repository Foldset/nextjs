import { Redis } from "@upstash/redis";
import type { ConfigStore } from "@foldset/core";

const REDIS_TTL = 60 * 60 * 3 + 60 * 30; // 3.5 hours

const API_BASE_URL = "https://api.foldset.com";

export interface RedisCredentials {
  url: string;
  token: string;
  tenantId: string;
}

export async function fetchRedisCredentials(
  apiKey: string,
): Promise<RedisCredentials> {
  const response = await fetch(`${API_BASE_URL}/v1/config/redis`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Redis credentials: ${response.status} ${response.statusText}`,
    );
  }

  const { data } = (await response.json()) as { data: RedisCredentials };
  return data;
}

export function createRedisStore(credentials: RedisCredentials): ConfigStore {
  const redis = new Redis({ url: credentials.url, token: credentials.token });
  const prefix = credentials.tenantId;

  return {
    async get(key) {
      return redis.get<string>(`${prefix}:${key}`);
    },
    async put(key, value) {
      await redis.set(`${prefix}:${key}`, value, { ex: REDIS_TTL });
    },
  };
}
