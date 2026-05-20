import { Worker } from "bullmq";
import { Redis } from "ioredis";

import { queueNames } from "../shared/queue.js";

const redisUrl = process.env.REDIS_URL;

if (redisUrl === undefined) {
  console.log("REDIS_URL is not set. Worker contract is loaded without queues.");
} else {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  for (const queueName of queueNames) {
    new Worker(
      queueName,
      async (job) => {
        console.log(`received ${queueName} job`, job.id, job.data);
        await Promise.resolve();
      },
      { connection },
    );
  }
  console.log(`curacuri.ai worker listening to ${String(queueNames.length)} queues`);
}
