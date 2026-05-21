import type {
  AutoReplyCategory,
  Classification,
  EscalationRule,
  EscalationRuleType,
  Message,
} from "../shared/types.js";

export const fixedEscalationLabels = [
  "公式回答待ち",
  "炎上兆候",
  "誤情報可能性",
  "ルール違反候補",
] as const;

export const sensitiveAutoReplyKeywords = [
  "法務",
  "広報",
  "料金",
  "障害",
  "ロードマップ",
  "アカウント",
  "課金",
  "セキュリティ",
  "APIキー",
  "トークン",
  "個人情報",
] as const;

export type AutoReplyRuleContext = {
  readonly message: Message;
  readonly classification: Classification;
  readonly category?: AutoReplyCategory;
};

export type MatchedEscalationRule = {
  readonly rule: EscalationRule;
  readonly reason: string;
};

function stringArray(condition: Record<string, unknown>, key: string): readonly string[] {
  const value = condition[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(condition: Record<string, unknown>, key: string): number | null {
  const value = condition[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function labelMatches(rule: EscalationRule, classification: Classification): boolean {
  const labels = stringArray(rule.condition, "labels");
  return labels.length > 0 && classification.labels.some((label) => labels.includes(label));
}

function categoryMatches(rule: EscalationRule, category: AutoReplyCategory | undefined): boolean {
  const categories = stringArray(rule.condition, "categories");
  return category !== undefined && categories.includes(category);
}

function keywordMatches(rule: EscalationRule, message: Message): boolean {
  const keywords = stringArray(rule.condition, "keywords");
  return keywords.length > 0 && keywords.some((keyword) => message.content.includes(keyword));
}

function importanceMatches(rule: EscalationRule, classification: Classification): boolean {
  const importances = stringArray(rule.condition, "importances");
  return importances.length > 0 && importances.includes(classification.importance);
}

function confidenceMatches(rule: EscalationRule, classification: Classification): boolean {
  const maxConfidence = numberValue(rule.condition, "maxConfidence");
  return maxConfidence !== null && classification.confidence <= maxConfidence;
}

function officialNeededMatches(classification: Classification): boolean {
  return (
    classification.labels.includes("公式回答待ち") ||
    classification.adminActionType === "reply_check" ||
    classification.adminActionType === "announcement_check"
  );
}

function privacyOrRuleMatches(message: Message, classification: Classification): boolean {
  return (
    classification.labels.includes("ルール違反候補") ||
    classification.adminActionType === "privacy_or_rule_check" ||
    sensitiveAutoReplyKeywords.some((keyword) => message.content.includes(keyword))
  );
}

function ruleMatches(rule: EscalationRule, context: AutoReplyRuleContext): boolean {
  const matchers: Record<EscalationRuleType, () => boolean> = {
    label: () => labelMatches(rule, context.classification),
    category: () => categoryMatches(rule, context.category),
    keyword: () => keywordMatches(rule, context.message),
    importance: () => importanceMatches(rule, context.classification),
    confidence: () => confidenceMatches(rule, context.classification),
    official_needed: () => officialNeededMatches(context.classification),
    privacy_or_rule: () => privacyOrRuleMatches(context.message, context.classification),
  };
  return matchers[rule.ruleType]();
}

export function matchAutoReplyEscalationRule(
  rules: readonly EscalationRule[],
  context: AutoReplyRuleContext,
): MatchedEscalationRule | null {
  const rule = rules.find((candidate) => candidate.enabled && ruleMatches(candidate, context));
  if (rule === undefined) {
    return null;
  }
  return {
    rule,
    reason: `エスカレーションルール(${rule.ruleType}/${rule.action})に一致しました。`,
  };
}
