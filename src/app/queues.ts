import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { queueNames, type QueueName, type QueuePayload } from "../shared/queue.js";
import type { QueuePublisher } from "./persistent-workflow.js";

export type QueueRuntime = QueuePublisher & {
  readonly connection: Redis;
  close(): Promise<void>;
};

export function createQueueRuntime(redisUrl: string): QueueRuntime {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = new Map<QueueName, Queue<QueuePayload>>();
  for (const queueName of queueNames) {
    queues.set(queueName, new Queue<QueuePayload>(queueName, { connection }));
  }
  return {
    connection,
    async add(queueName, payload) {
      const queue = queues.get(queueName);
      if (queue === undefined) {
        throw new Error(`unknown queue name: ${queueName}`);
      }
      const job = await queue.add(queueName, payload);
      return { id: job.id };
    },
    async close() {
      await Promise.all([...queues.values()].map((queue) => queue.close()));
      connection.disconnect();
    },
  };
}
