import { Queue, type Job } from "bullmq";
import { Redis } from "ioredis";

import {
  queueNames,
  type FailedQueueJob,
  type QueueName,
  type QueuePayload,
} from "../shared/queue.js";
import { validateQueuePayload } from "../shared/queue-validation.js";
import type { QueuePublisher } from "./persistent-workflow.js";

export type QueueRuntime = QueuePublisher & {
  readonly connection: Redis;
  listFailedJobs(): Promise<readonly FailedQueueJob[]>;
  retryFailedJob(queueName: QueueName, jobId: string): Promise<boolean>;
  close(): Promise<void>;
};

function failedQueueJob(queueName: QueueName, job: Job<QueuePayload>): FailedQueueJob | null {
  if (job.id === undefined) {
    return null;
  }
  return {
    queueName,
    id: job.id,
    name: job.name,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
    data: job.data,
  };
}

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
      const job = await queue.add(queueName, validateQueuePayload(queueName, payload));
      return { id: job.id };
    },
    async listFailedJobs() {
      const failed = await Promise.all(
        [...queues.entries()].map(async ([queueName, queue]) => {
          const jobs = await queue.getJobs(["failed"], 0, 49, false);
          return jobs
            .map((job) => failedQueueJob(queueName, job))
            .filter((job): job is FailedQueueJob => job !== null);
        }),
      );
      return failed
        .flat()
        .sort((a, b) => (b.finishedOn ?? b.timestamp) - (a.finishedOn ?? a.timestamp));
    },
    async retryFailedJob(queueName, jobId) {
      const queue = queues.get(queueName);
      if (queue === undefined) {
        throw new Error(`unknown queue name: ${queueName}`);
      }
      const job = await queue.getJob(jobId);
      if (job === undefined) {
        return false;
      }
      await job.retry("failed");
      return true;
    },
    async close() {
      await Promise.all([...queues.values()].map((queue) => queue.close()));
      connection.disconnect();
    },
  };
}
