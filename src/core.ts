import { WorkerCore } from "@foldset/core";

import { fetchRedisCredentials, createRedisStore } from "./store";

let cachedCore: WorkerCore | null = null;

export async function getWorkerCore(apiKey: string): Promise<WorkerCore> {
  if (cachedCore) return cachedCore;

  const credentials = await fetchRedisCredentials(apiKey);
  const store = createRedisStore(credentials);
  cachedCore = new WorkerCore(store, {
    apiKey,
  });

  return cachedCore;
}
