import { Redis } from "@upstash/redis";
const API_BASE_URL = "https://api.foldset.com";
export async function fetchRedisCredentials(apiKey) {
    console.log("[foldset] Fetching Redis credentials from", API_BASE_URL);
    const response = await fetch(`${API_BASE_URL}/v1/config/redis`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
        console.error("[foldset] Failed to fetch Redis credentials:", response.status, response.statusText);
        throw new Error(`Failed to fetch Redis credentials: ${response.status} ${response.statusText}`);
    }
    const { data } = (await response.json());
    console.log("[foldset] Redis credentials fetched, tenantId:", data.tenantId);
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
            const fullKey = `${prefix}:${key}`;
            const value = await redis.get(fullKey);
            console.log("[foldset] Redis GET", fullKey, value ? `(${typeof value === "string" ? value.length : 0} chars)` : "(null)");
            return value;
        },
    };
}
