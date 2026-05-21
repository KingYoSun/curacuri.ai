import type { Phase1State } from "./store.js";
import type { AutoReply, Classification, FaqCandidate, Message } from "../shared/types.js";

export type ActiveWorkflowData = {
  readonly messages: readonly Message[];
  readonly classifications: readonly Classification[];
  readonly faqCandidates: readonly FaqCandidate[];
  readonly autoReplies: readonly AutoReply[];
};

export type ActiveWorkflowFilters = {
  readonly messageIds?: readonly string[];
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly channelIds?: readonly string[];
};

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function matchesMessageFilters(message: Message, filters: ActiveWorkflowFilters): boolean {
  const messageIds = filters.messageIds === undefined ? undefined : new Set(filters.messageIds);
  if (messageIds !== undefined && !messageIds.has(message.id)) {
    return false;
  }

  const channelIds = filters.channelIds === undefined ? undefined : new Set(filters.channelIds);
  if (channelIds !== undefined && !channelIds.has(message.channelId)) {
    return false;
  }

  const periodStart = nonEmptyString(filters.periodStart);
  const periodEnd = nonEmptyString(filters.periodEnd);
  const postedDate = message.postedAt.slice(0, 10);
  if (periodStart !== undefined && postedDate < periodStart) {
    return false;
  }
  if (periodEnd !== undefined && postedDate > periodEnd) {
    return false;
  }

  return true;
}

export function activeMessages(messages: Iterable<Message>): readonly Message[] {
  return [...messages].filter((message) => message.deletedAt === null);
}

export function filteredActiveMessages(
  messages: Iterable<Message>,
  filters: ActiveWorkflowFilters = {},
): readonly Message[] {
  return activeMessages(messages).filter((message) => matchesMessageFilters(message, filters));
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

export function activeWorkflowData(
  state: Phase1State,
  filters: ActiveWorkflowFilters = {},
): ActiveWorkflowData {
  const messages = filteredActiveMessages(state.messages.values(), filters);
  const classifications = activeClassifications(state.classifications.values(), messages);
  return {
    messages,
    classifications,
    faqCandidates: activeFaqCandidates(state.faqCandidates.values(), messages),
    autoReplies: activeAutoReplies(state.autoReplies.values(), messages, classifications),
  };
}
