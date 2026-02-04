import { WorkerCore } from "@foldset/core";
import { fetchRedisCredentials, createRedisStore } from "./store";
let cachedCore = null;
export async function getWorkerCore(apiKey) {
    if (cachedCore) {
        console.log("[foldset] Using cached WorkerCore");
        return cachedCore;
    }
    console.log("[foldset] Initializing WorkerCore, apiKey:", apiKey.slice(0, 12) + "...");
    const credentials = await fetchRedisCredentials(apiKey);
    const store = createRedisStore(credentials);
    cachedCore = new WorkerCore(store, {
        apiKey,
    });
    console.log("[foldset] WorkerCore initialized");
    return cachedCore;
}
