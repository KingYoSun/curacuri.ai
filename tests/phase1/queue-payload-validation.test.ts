import { describe, expect, it } from "vitest";

import {
  QueuePayloadValidationError,
  validateQueuePayload,
} from "../../src/shared/queue-validation.js";

describe("queue payload validation", () => {
  it("accepts valid report and FAQ payloads", () => {
    expect(
      validateQueuePayload("report.weekly", {
        periodStart: "2026-05-18",
        periodEnd: "2026-05-24",
        channelIds: ["support"],
      }),
    ).toEqual({
      periodStart: "2026-05-18",
      periodEnd: "2026-05-24",
      channelIds: ["support"],
    });

    expect(
      validateQueuePayload("faq.generate", {
        messageIds: ["message-1"],
        periodStart: "2026-05-18",
      }),
    ).toEqual({
      messageIds: ["message-1"],
      periodStart: "2026-05-18",
    });
  });

  it("rejects invalid payloads with queue-specific errors", () => {
    expect(() => {
      validateQueuePayload("auto_reply.decide", {
        messageId: "message-1",
      });
    }).toThrow(QueuePayloadValidationError);
    expect(() => {
      validateQueuePayload("report.weekly", {
        periodStart: "2026/05/18",
        periodEnd: "2026-05-24",
        channelIds: ["support"],
      });
    }).toThrow("report.weekly payload invalid: periodStart must be YYYY-MM-DD");
  });

  it("requires ops.notify to identify a classification or messages", () => {
    expect(() => {
      validateQueuePayload("ops.notify", {});
    }).toThrow("ops.notify payload invalid: classificationId or messageIds is required");

    expect(validateQueuePayload("ops.notify", { messageIds: ["message-1"] })).toEqual({
      messageIds: ["message-1"],
    });
  });
});
