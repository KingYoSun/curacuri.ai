import { fixedEscalationLabels } from "./auto-reply-rules.js";
import type { AutoReplyPolicy, Classification } from "../shared/types.js";

function hasAllowedLabel(policy: AutoReplyPolicy, classification: Classification): boolean {
  return classification.labels.some((label) => policy.allowedLabels.includes(label));
}

function hasFixedEscalationLabel(classification: Classification): boolean {
  return fixedEscalationLabels.some((label) => classification.labels.includes(label));
}

function isHighImportance(classification: Classification): boolean {
  return classification.importance === "high" || classification.importance === "critical";
}

function isLowValueSmallTalk(classification: Classification): boolean {
  return (
    classification.labels.length === 1 &&
    classification.labels[0] === "雑談" &&
    classification.importance === "low" &&
    !classification.adminActionNeeded
  );
}

export function shouldCreateAutoReplyDecision(
  classification: Classification,
  policy: AutoReplyPolicy,
): boolean {
  if (isLowValueSmallTalk(classification)) {
    return false;
  }

  if (
    !hasAllowedLabel(policy, classification) &&
    !classification.adminActionNeeded &&
    !isHighImportance(classification) &&
    !hasFixedEscalationLabel(classification)
  ) {
    return false;
  }

  return true;
}
