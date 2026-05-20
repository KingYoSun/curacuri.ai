import { newId, nowIso } from "./ids.js";
import { type Classification, type FaqCandidate, type Message } from "../shared/types.js";

function isFaqSource(classification: Classification): boolean {
  return classification.labels.some((label) =>
    ["質問", "未回答質問", "高価値UGC", "新規参加者の困りごと", "公式回答待ち"].includes(label),
  );
}

export function generateFaqCandidates(
  messages: readonly Message[],
  classifications: readonly Classification[],
): readonly FaqCandidate[] {
  const classificationByMessage = new Map(
    classifications.map((classification) => [classification.messageId, classification]),
  );
  const sources = messages.filter((message) => {
    const classification = classificationByMessage.get(message.id);
    return classification === undefined ? false : isFaqSource(classification);
  });

  const byChannel = new Map<string, Message[]>();
  for (const message of sources) {
    const existing = byChannel.get(message.channelId) ?? [];
    existing.push(message);
    byChannel.set(message.channelId, existing);
  }

  return [...byChannel.entries()].map(([channelId, channelMessages]) => {
    const firstMessage = channelMessages[0];
    if (firstMessage === undefined) {
      throw new Error("FAQ source group cannot be empty");
    }
    const classification = classificationByMessage.get(firstMessage.id);
    const officialNeeded = classification?.labels.includes("公式回答待ち") === true;
    const now = nowIso();
    return {
      id: newId(),
      sourceMessageIds: channelMessages.map((message) => message.id),
      topic: `${firstMessage.channelName} のよくある確認事項`,
      currentAnswerStatus: officialNeeded ? "needs_official_answer" : "existing_faq_possible",
      draftQuestion: `${channelId} で繰り返し出ている質問・共有は何ですか？`,
      draftAnswer:
        "この回答文案は公式回答ではありません。投稿内容をもとに、運営確認後にFAQへ反映してください。",
      confidence: officialNeeded ? 0.72 : 0.82,
      status: officialNeeded ? "needs_review" : "candidate",
      createdAt: now,
      updatedAt: now,
    };
  });
}
