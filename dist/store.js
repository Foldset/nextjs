import { Redis } from "@upstash/redis";
const API_BASE_URL = "https://api.foldset.com";
export async function fetchRedisCredentials(apiKey) {
    const response = await fetch(`${API_BASE_URL}/v1/config/redis`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch Redis credentials: ${response.status} ${response.statusText}`);
    }
    const { data } = (await response.json());
    return data;
}
export function createRedisStore(credentials) {
    const redis = new Redis({
        url: credentials.url,
        token: credentials.token,
        automaticDeserialization: false,
    });
    const prefix = credentials.tenantId;
    return {
        async get(key) {
            return redis.get(`${prefix}:${key}`);
        },
    };
}
