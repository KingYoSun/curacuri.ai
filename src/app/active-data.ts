import type { Phase1State } from "./store.js";
import type { AutoReply, Classification, FaqCandidate, Message } from "../shared/types.js";

export type ActiveWorkflowData = {
  readonly messages: readonly Message[];
  readonly classifications: readonly Classification[];
  readonly faqCandidates: readonly FaqCandidate[];
  readonly autoReplies: readonly AutoReply[];
};

export function activeMessages(messages: Iterable<Message>): readonly Message[] {
  return [...messages].filter((message) => message.deletedAt === null);
}

export function activeClassifications(
  classifications: Iterable<Classification>,
  messages: readonly Message[],
): readonly Classification[] {
  const activeMessageIds = new Set(messages.map((message) => message.id));
  return [...classifications].filter((classification) =>
    activeMessageIds.has(classification.messageId),
  );
}

export function activeFaqCandidates(
  faqCandidates: Iterable<FaqCandidate>,
  messages: readonly Message[],
): readonly FaqCandidate[] {
  const activeMessageIds = new Set(messages.map((message) => message.id));
  return [...faqCandidates].filter(
    (candidate) =>
      candidate.sourceMessageIds.length > 0 &&
      candidate.sourceMessageIds.every((messageId) => activeMessageIds.has(messageId)),
  );
}

export function activeAutoReplies(
  autoReplies: Iterable<AutoReply>,
  messages: readonly Message[],
  classifications: readonly Classification[],
): readonly AutoReply[] {
  const activeMessageIds = new Set(messages.map((message) => message.id));
  const activeClassificationIds = new Set(
    classifications.map((classification) => classification.id),
  );
  return [...autoReplies].filter(
    (reply) =>
      activeMessageIds.has(reply.messageId) && activeClassificationIds.has(reply.classificationId),
  );
}

export function activeWorkflowData(state: Phase1State): ActiveWorkflowData {
  const messages = activeMessages(state.messages.values());
  const classifications = activeClassifications(state.classifications.values(), messages);
  return {
    messages,
    classifications,
    faqCandidates: activeFaqCandidates(state.faqCandidates.values(), messages),
    autoReplies: activeAutoReplies(state.autoReplies.values(), messages, classifications),
  };
}
