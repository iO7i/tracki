import { Redis } from "ioredis";
import { config } from "./config.js";

/** Lazy singletons. Pub/sub needs a dedicated connection (subscriber mode). */
let main: Redis | null = null;
let subscriber: Redis | null = null;

export function redis(): Redis {
  if (!main) main = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  return main;
}

export function redisSubscriber(): Redis {
  if (!subscriber) subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  return subscriber;
}

export async function closeRedis(): Promise<void> {
  await Promise.all([main?.quit(), subscriber?.quit()]);
  main = null;
  subscriber = null;
}
