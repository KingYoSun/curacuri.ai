import { Pool } from "pg";

import { nowIso } from "../ids.js";
import { createDefaultAutoReplyPolicy, createDefaultSettings } from "../settings.js";
import { createPhase1State, listByCreatedAt, listByIngestedAt } from "../store.js";
import type { Phase1State } from "../store.js";
import type {
  AdminFeedback,
  AdminNotification,
  AutoReply,
  AutoReplyCategory,
  AutoReplyMode,
  AutoReplyPolicy,
  Classification,
  ClassificationLabel,
  CurrentAnswerStatus,
  EscalationRule,
  FaqCandidate,
  FaqCandidateStatus,
  FeedbackKind,
  GuildSettings,
  Importance,
  LlmGenerationRun,
  Message,
  MessageSource,
  NotificationStatus,
  NotificationType,
  WeeklyReport,
  WeeklyReportMetrics,
  WeeklyReportStatus,
} from "../../shared/types.js";
import type { MessageFilters, Phase1Repository } from "./types.js";

type DbRow = Record<string, unknown>;

function rows(result: { readonly rows: readonly unknown[] }): readonly DbRow[] {
  return result.rows.map((row) => row as DbRow);
}

function text(row: DbRow, key: string): string {
  const value = row[key];
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  throw new Error(`DB column ${key} is not text`);
}

function nullableText(row: DbRow, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function numberValue(row: DbRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number.parseFloat(value);
  }
  throw new Error(`DB column ${key} is not number`);
}

function booleanValue(row: DbRow, key: string): boolean {
  const value = row[key];
  if (typeof value === "boolean") {
    return value;
  }
  throw new Error(`DB column ${key} is not boolean`);
}

function textArray(row: DbRow, key: string): readonly string[] {
  const value = row[key];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return [];
}

function jsonRecord(row: DbRow, key: string): Record<string, unknown> {
  const value = row[key];
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function jsonArray(row: DbRow, key: string): readonly unknown[] {
  const value = row[key];
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

function dateOnly(row: DbRow, key: string): string {
  return text(row, key).slice(0, 10);
}

function mapSettings(row: DbRow, escalationRules: readonly EscalationRule[]): GuildSettings {
  return {
    id: text(row, "id"),
    guildId: text(row, "guild_id"),
    targetChannelIds: textArray(row, "target_channel_ids"),
    excludedChannelIds: textArray(row, "excluded_channel_ids"),
    adminNotificationChannelId: text(row, "admin_notification_channel_id"),
    retentionDays: numberValue(row, "retention_days"),
    characterName: text(row, "character_name"),
    characterTone: text(row, "character_tone"),
    autoReplyMode: text(row, "auto_reply_mode") as AutoReplyMode,
    autoReplyAllowedChannelIds: textArray(row, "auto_reply_allowed_channel_ids"),
    autoReplyAllowedLabels: textArray(
      row,
      "auto_reply_allowed_labels",
    ) as readonly ClassificationLabel[],
    autoReplyAllowedCategories: textArray(
      row,
      "auto_reply_allowed_categories",
    ) as readonly AutoReplyCategory[],
    autoReplyEscalationRules: escalationRules,
    autoReplyMinConfidence: numberValue(row, "auto_reply_min_confidence"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapPolicy(row: DbRow, escalationRules: readonly EscalationRule[]): AutoReplyPolicy {
  return {
    id: text(row, "id"),
    guildId: text(row, "guild_id"),
    enabled: booleanValue(row, "enabled"),
    mode: text(row, "mode") as AutoReplyMode,
    allowedChannelIds: textArray(row, "allowed_channel_ids"),
    allowedLabels: textArray(row, "allowed_labels") as readonly ClassificationLabel[],
    allowedCategories: textArray(row, "allowed_categories") as readonly AutoReplyCategory[],
    blockedCategories: textArray(row, "blocked_categories"),
    minConfidence: numberValue(row, "min_confidence"),
    requireSourceForFaq: booleanValue(row, "require_source_for_faq"),
    escalationRules,
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapEscalationRule(row: DbRow): EscalationRule {
  return {
    id: text(row, "id"),
    guildId: text(row, "guild_id"),
    ruleType: text(row, "rule_type") as EscalationRule["ruleType"],
    condition: jsonRecord(row, "condition"),
    action: text(row, "action") as EscalationRule["action"],
    enabled: booleanValue(row, "enabled"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapMessage(row: DbRow): Message {
  return {
    id: text(row, "id"),
    source: text(row, "source") as MessageSource,
    guildId: text(row, "guild_id"),
    channelId: text(row, "channel_id"),
    channelName: text(row, "channel_name"),
    messageId: text(row, "message_id"),
    threadId: nullableText(row, "thread_id"),
    authorIdHash: text(row, "author_id_hash"),
    content: text(row, "content"),
    postedAt: text(row, "posted_at"),
    ingestedAt: text(row, "ingested_at"),
    deletedAt: nullableText(row, "deleted_at"),
  };
}

function mapClassification(row: DbRow): Classification {
  return {
    id: text(row, "id"),
    messageId: text(row, "message_id"),
    labels: textArray(row, "labels") as readonly ClassificationLabel[],
    importance: text(row, "importance") as Importance,
    adminActionNeeded: booleanValue(row, "admin_action_needed"),
    adminActionType: text(row, "admin_action_type") as Classification["adminActionType"],
    confidence: numberValue(row, "confidence"),
    reason: text(row, "reason"),
    suggestedSummary: text(row, "suggested_summary"),
    modelName: text(row, "model_name"),
    rawOutput: jsonRecord(row, "raw_output"),
    createdAt: text(row, "created_at"),
  };
}

function mapNotification(row: DbRow): AdminNotification {
  return {
    id: text(row, "id"),
    notificationType: text(row, "notification_type") as NotificationType,
    messageIds: textArray(row, "message_ids"),
    title: text(row, "title"),
    body: text(row, "body"),
    importance: text(row, "importance") as AdminNotification["importance"],
    status: text(row, "status") as NotificationStatus,
    sentToChannelId: text(row, "sent_to_channel_id"),
    sentMessageId: nullableText(row, "sent_message_id"),
    sentAt: nullableText(row, "sent_at"),
    failureReason: nullableText(row, "failure_reason"),
    createdAt: text(row, "created_at"),
  };
}

function mapAutoReply(row: DbRow): AutoReply {
  return {
    id: text(row, "id"),
    messageId: text(row, "message_id"),
    classificationId: text(row, "classification_id"),
    mode: text(row, "mode") as AutoReplyMode,
    replyCategory: text(row, "reply_category") as AutoReplyCategory,
    body: text(row, "body"),
    sourceRefs: jsonArray(row, "source_refs") as AutoReply["sourceRefs"],
    confidence: numberValue(row, "confidence"),
    decisionReason: text(row, "decision_reason"),
    status: text(row, "status") as AutoReply["status"],
    sentMessageId: nullableText(row, "sent_message_id"),
    approvedBy: nullableText(row, "approved_by"),
    sentAt: nullableText(row, "sent_at"),
    createdAt: text(row, "created_at"),
  };
}

function mapFaq(row: DbRow): FaqCandidate {
  return {
    id: text(row, "id"),
    sourceMessageIds: textArray(row, "source_message_ids"),
    topic: text(row, "topic"),
    currentAnswerStatus: text(row, "current_answer_status") as CurrentAnswerStatus,
    draftQuestion: text(row, "draft_question"),
    draftAnswer: text(row, "draft_answer"),
    confidence: numberValue(row, "confidence"),
    status: text(row, "status") as FaqCandidateStatus,
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapReport(row: DbRow): WeeklyReport {
  return {
    id: text(row, "id"),
    periodStart: dateOnly(row, "period_start"),
    periodEnd: dateOnly(row, "period_end"),
    targetChannelIds: textArray(row, "target_channel_ids"),
    excludedChannelIds: textArray(row, "excluded_channel_ids"),
    messageCount: numberValue(row, "message_count"),
    shortBody: text(row, "short_body"),
    detailedBody: text(row, "detailed_body"),
    metrics: jsonRecord(row, "metrics") as unknown as WeeklyReportMetrics,
    status: text(row, "status") as WeeklyReportStatus,
    createdAt: text(row, "created_at"),
  };
}

function mapRun(row: DbRow): LlmGenerationRun {
  return {
    id: text(row, "id"),
    taskType: text(row, "task_type") as LlmGenerationRun["taskType"],
    targetId: text(row, "target_id"),
    status: text(row, "status") as LlmGenerationRun["status"],
    modelName: text(row, "model_name"),
    errorCode: nullableText(row, "error_code"),
    errorMessage: nullableText(row, "error_message"),
    rawOutput: row.raw_output === null ? null : jsonRecord(row, "raw_output"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapFeedback(row: DbRow): AdminFeedback {
  return {
    id: text(row, "id"),
    targetType: text(row, "target_type") as AdminFeedback["targetType"],
    targetId: text(row, "target_id"),
    feedbackKind: text(row, "feedback_kind") as FeedbackKind,
    note: text(row, "note"),
    createdAt: text(row, "created_at"),
  };
}

export class PostgresPhase1Repository implements Phase1Repository {
  readonly #pool: Pool;

  constructor(databaseUrl: string) {
    this.#pool = new Pool({ connectionString: databaseUrl });
  }

  async ensureSeed(): Promise<void> {
    const settings = createDefaultSettings();
    const policy = createDefaultAutoReplyPolicy(settings);
    await this.#pool.query(
      `INSERT INTO guild_settings (
        id, guild_id, target_channel_ids, excluded_channel_ids, admin_notification_channel_id,
        retention_days, character_name, character_tone, auto_reply_mode,
        auto_reply_allowed_channel_ids, auto_reply_allowed_labels,
        auto_reply_allowed_categories, auto_reply_escalation_rules,
        auto_reply_min_confidence, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (guild_id) DO NOTHING`,
      [
        settings.id,
        settings.guildId,
        settings.targetChannelIds,
        settings.excludedChannelIds,
        settings.adminNotificationChannelId,
        settings.retentionDays,
        settings.characterName,
        settings.characterTone,
        settings.autoReplyMode,
        settings.autoReplyAllowedChannelIds,
        settings.autoReplyAllowedLabels,
        settings.autoReplyAllowedCategories,
        JSON.stringify(settings.autoReplyEscalationRules),
        settings.autoReplyMinConfidence,
        settings.createdAt,
        settings.updatedAt,
      ],
    );
    await this.#pool.query(
      `INSERT INTO auto_reply_policies (
        id, guild_id, enabled, mode, allowed_channel_ids, allowed_labels, allowed_categories,
        blocked_categories, min_confidence, require_source_for_faq, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (guild_id) DO NOTHING`,
      [
        policy.id,
        policy.guildId,
        policy.enabled,
        policy.mode,
        policy.allowedChannelIds,
        policy.allowedLabels,
        policy.allowedCategories,
        policy.blockedCategories,
        policy.minConfidence,
        policy.requireSourceForFaq,
        policy.createdAt,
        policy.updatedAt,
      ],
    );
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async loadState(): Promise<Phase1State> {
    const state = createPhase1State();
    state.settings = await this.getSettings();
    state.autoReplyPolicy = await this.getAutoReplyPolicy();
    state.messages.clear();
    state.classifications.clear();
    state.notifications.clear();
    state.autoReplies.clear();
    state.faqCandidates.clear();
    state.weeklyReports.clear();
    state.llmGenerationRuns.clear();
    state.feedback.clear();
    for (const message of await this.listMessages()) state.messages.set(message.id, message);
    for (const item of await this.listClassifications()) state.classifications.set(item.id, item);
    for (const item of await this.listNotifications()) state.notifications.set(item.id, item);
    for (const item of await this.listAutoReplies()) state.autoReplies.set(item.id, item);
    for (const item of await this.listFaqCandidates()) state.faqCandidates.set(item.id, item);
    for (const item of await this.listWeeklyReports()) state.weeklyReports.set(item.id, item);
    for (const item of await this.listLlmRuns()) state.llmGenerationRuns.set(item.id, item);
    for (const item of await this.listFeedback()) state.feedback.set(item.id, item);
    return state;
  }

  async saveState(state: Phase1State): Promise<void> {
    await this.updateSettings(state.settings);
    await this.updateAutoReplyPolicy(state.autoReplyPolicy);
    await this.replaceEscalationRules(
      state.autoReplyPolicy.guildId,
      state.autoReplyPolicy.escalationRules,
    );
    for (const message of state.messages.values()) await this.upsertMessage(message);
    for (const item of state.classifications.values()) await this.saveClassification(item);
    for (const item of state.notifications.values()) await this.saveNotification(item);
    for (const item of state.autoReplies.values()) await this.saveAutoReply(item);
    for (const item of state.faqCandidates.values()) await this.saveFaqCandidate(item);
    for (const item of state.weeklyReports.values()) await this.saveWeeklyReport(item);
    for (const item of state.llmGenerationRuns.values()) await this.saveLlmRun(item);
    for (const item of state.feedback.values()) await this.saveFeedback(item);
  }

  async getSettings(): Promise<GuildSettings> {
    const result = await this.#pool.query(
      "SELECT * FROM guild_settings ORDER BY created_at LIMIT 1",
    );
    const row = rows(result)[0];
    if (row === undefined) throw new Error("guild_settings seed is missing");
    return mapSettings(row, await this.listEscalationRules(text(row, "guild_id")));
  }

  async updateSettings(settings: GuildSettings): Promise<GuildSettings> {
    const updatedAt = nowIso();
    const result = await this.#pool.query(
      `UPDATE guild_settings SET
        target_channel_ids=$2, excluded_channel_ids=$3, admin_notification_channel_id=$4,
        retention_days=$5, character_name=$6, character_tone=$7, auto_reply_mode=$8,
        auto_reply_allowed_channel_ids=$9, auto_reply_allowed_labels=$10,
        auto_reply_allowed_categories=$11, auto_reply_escalation_rules=$12,
        auto_reply_min_confidence=$13, updated_at=$14
      WHERE id=$1 RETURNING *`,
      [
        settings.id,
        settings.targetChannelIds,
        settings.excludedChannelIds,
        settings.adminNotificationChannelId,
        settings.retentionDays,
        settings.characterName,
        settings.characterTone,
        settings.autoReplyMode,
        settings.autoReplyAllowedChannelIds,
        settings.autoReplyAllowedLabels,
        settings.autoReplyAllowedCategories,
        JSON.stringify(settings.autoReplyEscalationRules),
        settings.autoReplyMinConfidence,
        updatedAt,
      ],
    );
    const row = rows(result)[0];
    if (row === undefined) throw new Error("settings update failed");
    return mapSettings(row, settings.autoReplyEscalationRules);
  }

  async getAutoReplyPolicy(): Promise<AutoReplyPolicy> {
    const result = await this.#pool.query(
      "SELECT * FROM auto_reply_policies ORDER BY created_at LIMIT 1",
    );
    const row = rows(result)[0];
    if (row === undefined) throw new Error("auto_reply_policies seed is missing");
    return mapPolicy(row, await this.listEscalationRules(text(row, "guild_id")));
  }

  async updateAutoReplyPolicy(policy: AutoReplyPolicy): Promise<AutoReplyPolicy> {
    const updatedAt = nowIso();
    const result = await this.#pool.query(
      `UPDATE auto_reply_policies SET
        enabled=$2, mode=$3, allowed_channel_ids=$4, allowed_labels=$5,
        allowed_categories=$6, min_confidence=$7, require_source_for_faq=$8, updated_at=$9
      WHERE id=$1 RETURNING *`,
      [
        policy.id,
        policy.enabled,
        policy.mode,
        policy.allowedChannelIds,
        policy.allowedLabels,
        policy.allowedCategories,
        policy.minConfidence,
        policy.requireSourceForFaq,
        updatedAt,
      ],
    );
    const row = rows(result)[0];
    if (row === undefined) throw new Error("auto reply policy update failed");
    return mapPolicy(row, policy.escalationRules);
  }

  async listEscalationRules(guildId?: string): Promise<readonly EscalationRule[]> {
    const result =
      guildId === undefined
        ? await this.#pool.query("SELECT * FROM auto_reply_escalation_rules ORDER BY created_at")
        : await this.#pool.query(
            "SELECT * FROM auto_reply_escalation_rules WHERE guild_id=$1 ORDER BY created_at",
            [guildId],
          );
    return rows(result).map(mapEscalationRule);
  }

  async replaceEscalationRules(
    guildId: string,
    rules: readonly EscalationRule[],
  ): Promise<readonly EscalationRule[]> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM auto_reply_escalation_rules WHERE guild_id=$1", [guildId]);
      for (const rule of rules) {
        await client.query(
          `INSERT INTO auto_reply_escalation_rules (
            id, guild_id, rule_type, condition, action, enabled, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            rule.id,
            guildId,
            rule.ruleType,
            JSON.stringify(rule.condition),
            rule.action,
            rule.enabled,
            rule.createdAt,
            rule.updatedAt,
          ],
        );
      }
      await client.query(
        `UPDATE guild_settings
         SET auto_reply_escalation_rules=$2, updated_at=$3
         WHERE guild_id=$1`,
        [guildId, JSON.stringify(rules), nowIso()],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.listEscalationRules(guildId);
  }

  async upsertMessage(
    message: Message,
  ): Promise<{ readonly message: Message; readonly created: boolean }> {
    const result = await this.#pool.query(
      `INSERT INTO messages (
        id, source, guild_id, channel_id, channel_name, message_id, thread_id,
        author_id_hash, content, posted_at, ingested_at, deleted_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (source, guild_id, message_id) DO UPDATE SET
        channel_id=EXCLUDED.channel_id,
        channel_name=EXCLUDED.channel_name,
        thread_id=EXCLUDED.thread_id,
        author_id_hash=EXCLUDED.author_id_hash,
        content=EXCLUDED.content,
        posted_at=EXCLUDED.posted_at
      RETURNING *, (xmax = 0) AS created`,
      [
        message.id,
        message.source,
        message.guildId,
        message.channelId,
        message.channelName,
        message.messageId,
        message.threadId,
        message.authorIdHash,
        message.content,
        message.postedAt,
        message.ingestedAt,
        message.deletedAt,
      ],
    );
    const row = rows(result)[0];
    if (row === undefined) throw new Error("message upsert failed");
    return { message: mapMessage(row), created: booleanValue(row, "created") };
  }

  async getMessage(id: string): Promise<Message | null> {
    const result = await this.#pool.query("SELECT * FROM messages WHERE id=$1", [id]);
    const row = rows(result)[0];
    return row === undefined ? null : mapMessage(row);
  }

  async listMessages(filters: MessageFilters = {}): Promise<readonly Message[]> {
    const clauses = ["m.deleted_at IS NULL"];
    const values: string[] = [];
    if (filters.periodStart !== undefined) {
      values.push(filters.periodStart);
      clauses.push(`m.posted_at >= $${String(values.length)}`);
    }
    if (filters.periodEnd !== undefined) {
      values.push(filters.periodEnd);
      clauses.push(`m.posted_at <= $${String(values.length)}`);
    }
    if (filters.channelId !== undefined) {
      values.push(filters.channelId);
      clauses.push(`m.channel_id = $${String(values.length)}`);
    }
    if (filters.label !== undefined) {
      values.push(filters.label);
      clauses.push(`EXISTS (
        SELECT 1 FROM classifications c WHERE c.message_id = m.id AND $${String(values.length)} = ANY(c.labels)
      )`);
    }
    const result = await this.#pool.query(
      `SELECT m.* FROM messages m WHERE ${clauses.join(" AND ")} ORDER BY m.ingested_at DESC`,
      values,
    );
    return rows(result).map(mapMessage);
  }

  async listClassifications(): Promise<readonly Classification[]> {
    const result = await this.#pool.query("SELECT * FROM classifications ORDER BY created_at DESC");
    return rows(result).map(mapClassification);
  }

  async getClassification(id: string): Promise<Classification | null> {
    const result = await this.#pool.query("SELECT * FROM classifications WHERE id=$1", [id]);
    const row = rows(result)[0];
    return row === undefined ? null : mapClassification(row);
  }

  async findClassificationByMessageId(messageId: string): Promise<Classification | null> {
    const result = await this.#pool.query(
      "SELECT * FROM classifications WHERE message_id=$1 ORDER BY created_at DESC LIMIT 1",
      [messageId],
    );
    const row = rows(result)[0];
    return row === undefined ? null : mapClassification(row);
  }

  async saveClassification(item: Classification): Promise<void> {
    await this.#pool.query(
      `INSERT INTO classifications (
        id, message_id, labels, importance, admin_action_needed, admin_action_type,
        confidence, reason, suggested_summary, model_name, raw_output, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        labels=EXCLUDED.labels, importance=EXCLUDED.importance,
        admin_action_needed=EXCLUDED.admin_action_needed,
        admin_action_type=EXCLUDED.admin_action_type, confidence=EXCLUDED.confidence,
        reason=EXCLUDED.reason, suggested_summary=EXCLUDED.suggested_summary,
        model_name=EXCLUDED.model_name, raw_output=EXCLUDED.raw_output`,
      [
        item.id,
        item.messageId,
        item.labels,
        item.importance,
        item.adminActionNeeded,
        item.adminActionType,
        item.confidence,
        item.reason,
        item.suggestedSummary,
        item.modelName,
        JSON.stringify(item.rawOutput),
        item.createdAt,
      ],
    );
  }

  async listNotifications(): Promise<readonly AdminNotification[]> {
    const result = await this.#pool.query(
      "SELECT * FROM admin_notifications ORDER BY created_at DESC",
    );
    return rows(result).map(mapNotification);
  }

  async getNotification(id: string): Promise<AdminNotification | null> {
    const result = await this.#pool.query("SELECT * FROM admin_notifications WHERE id=$1", [id]);
    const row = rows(result)[0];
    return row === undefined ? null : mapNotification(row);
  }

  async saveNotification(item: AdminNotification): Promise<void> {
    await this.#pool.query(
      `INSERT INTO admin_notifications (
        id, notification_type, message_ids, title, body, importance, status,
        sent_to_channel_id, sent_message_id, sent_at, failure_reason, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        status=EXCLUDED.status, sent_message_id=EXCLUDED.sent_message_id,
        sent_at=EXCLUDED.sent_at, failure_reason=EXCLUDED.failure_reason`,
      [
        item.id,
        item.notificationType,
        item.messageIds,
        item.title,
        item.body,
        item.importance,
        item.status,
        item.sentToChannelId,
        item.sentMessageId,
        item.sentAt,
        item.failureReason,
        item.createdAt,
      ],
    );
  }

  async markNotificationSent(id: string, sentMessageId: string): Promise<void> {
    await this.#pool.query(
      "UPDATE admin_notifications SET status='sent', sent_message_id=$2, sent_at=$3, failure_reason=NULL WHERE id=$1",
      [id, sentMessageId, nowIso()],
    );
  }

  async markNotificationFailed(id: string, reason: string): Promise<void> {
    await this.#pool.query(
      "UPDATE admin_notifications SET status='failed', failure_reason=$2 WHERE id=$1",
      [id, reason],
    );
  }

  async dismissNotification(id: string): Promise<void> {
    await this.#pool.query(
      "UPDATE admin_notifications SET status='dismissed', failure_reason=NULL WHERE id=$1",
      [id],
    );
  }

  async listAutoReplies(): Promise<readonly AutoReply[]> {
    const result = await this.#pool.query("SELECT * FROM auto_replies ORDER BY created_at DESC");
    return rows(result).map(mapAutoReply);
  }

  async getAutoReply(id: string): Promise<AutoReply | null> {
    const result = await this.#pool.query("SELECT * FROM auto_replies WHERE id=$1", [id]);
    const row = rows(result)[0];
    return row === undefined ? null : mapAutoReply(row);
  }

  async saveAutoReply(item: AutoReply): Promise<void> {
    await this.updateAutoReply(item);
  }

  async updateAutoReply(item: AutoReply): Promise<void> {
    await this.#pool.query(
      `INSERT INTO auto_replies (
        id, message_id, classification_id, mode, reply_category, body, source_refs,
        confidence, decision_reason, status, sent_message_id, approved_by, sent_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO UPDATE SET
        body=EXCLUDED.body, source_refs=EXCLUDED.source_refs, confidence=EXCLUDED.confidence,
        decision_reason=EXCLUDED.decision_reason, status=EXCLUDED.status,
        sent_message_id=EXCLUDED.sent_message_id, approved_by=EXCLUDED.approved_by,
        sent_at=EXCLUDED.sent_at`,
      [
        item.id,
        item.messageId,
        item.classificationId,
        item.mode,
        item.replyCategory,
        item.body,
        JSON.stringify(item.sourceRefs),
        item.confidence,
        item.decisionReason,
        item.status,
        item.sentMessageId,
        item.approvedBy,
        item.sentAt,
        item.createdAt,
      ],
    );
  }

  async listFaqCandidates(): Promise<readonly FaqCandidate[]> {
    const result = await this.#pool.query("SELECT * FROM faq_candidates ORDER BY created_at DESC");
    return rows(result).map(mapFaq);
  }

  async getFaqCandidate(id: string): Promise<FaqCandidate | null> {
    const result = await this.#pool.query("SELECT * FROM faq_candidates WHERE id=$1", [id]);
    const row = rows(result)[0];
    return row === undefined ? null : mapFaq(row);
  }

  async updateFaqCandidateStatus(id: string, status: FaqCandidate["status"]): Promise<void> {
    await this.#pool.query("UPDATE faq_candidates SET status=$2, updated_at=$3 WHERE id=$1", [
      id,
      status,
      nowIso(),
    ]);
  }

  async updateFaqCandidate(item: FaqCandidate): Promise<FaqCandidate> {
    await this.saveFaqCandidate(item);
    return item;
  }

  async replaceFaqCandidates(items: readonly FaqCandidate[]): Promise<void> {
    await this.#pool.query("DELETE FROM faq_candidates");
    for (const item of listByCreatedAt(items)) {
      await this.saveFaqCandidate(item);
    }
  }

  async saveFaqCandidate(item: FaqCandidate): Promise<void> {
    await this.#pool.query(
      `INSERT INTO faq_candidates (
        id, source_message_ids, topic, current_answer_status, draft_question, draft_answer,
        confidence, status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        source_message_ids=EXCLUDED.source_message_ids, topic=EXCLUDED.topic,
        current_answer_status=EXCLUDED.current_answer_status,
        draft_question=EXCLUDED.draft_question, draft_answer=EXCLUDED.draft_answer,
        confidence=EXCLUDED.confidence, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
      [
        item.id,
        item.sourceMessageIds,
        item.topic,
        item.currentAnswerStatus,
        item.draftQuestion,
        item.draftAnswer,
        item.confidence,
        item.status,
        item.createdAt,
        item.updatedAt,
      ],
    );
  }

  async listWeeklyReports(): Promise<readonly WeeklyReport[]> {
    const result = await this.#pool.query("SELECT * FROM weekly_reports ORDER BY created_at DESC");
    return rows(result).map(mapReport);
  }

  async getWeeklyReport(id: string): Promise<WeeklyReport | null> {
    const result = await this.#pool.query("SELECT * FROM weekly_reports WHERE id=$1", [id]);
    const row = rows(result)[0];
    return row === undefined ? null : mapReport(row);
  }

  async saveWeeklyReport(item: WeeklyReport): Promise<void> {
    await this.#pool.query(
      `INSERT INTO weekly_reports (
        id, period_start, period_end, target_channel_ids, excluded_channel_ids,
        message_count, short_body, detailed_body, metrics, status, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        short_body=EXCLUDED.short_body, detailed_body=EXCLUDED.detailed_body,
        metrics=EXCLUDED.metrics, status=EXCLUDED.status`,
      [
        item.id,
        item.periodStart,
        item.periodEnd,
        item.targetChannelIds,
        item.excludedChannelIds,
        item.messageCount,
        item.shortBody,
        item.detailedBody,
        JSON.stringify(item.metrics),
        item.status,
        item.createdAt,
      ],
    );
  }

  async listLlmRuns(status?: LlmGenerationRun["status"]): Promise<readonly LlmGenerationRun[]> {
    const result =
      status === undefined
        ? await this.#pool.query("SELECT * FROM llm_generation_runs ORDER BY created_at DESC")
        : await this.#pool.query(
            "SELECT * FROM llm_generation_runs WHERE status=$1 ORDER BY created_at DESC",
            [status],
          );
    return rows(result).map(mapRun);
  }

  async getLlmRun(id: string): Promise<LlmGenerationRun | null> {
    const result = await this.#pool.query("SELECT * FROM llm_generation_runs WHERE id=$1", [id]);
    const row = rows(result)[0];
    return row === undefined ? null : mapRun(row);
  }

  async saveLlmRun(item: LlmGenerationRun): Promise<void> {
    await this.#pool.query(
      `INSERT INTO llm_generation_runs (
        id, task_type, target_id, status, model_name, error_code, error_message,
        raw_output, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        status=EXCLUDED.status, error_code=EXCLUDED.error_code,
        error_message=EXCLUDED.error_message, raw_output=EXCLUDED.raw_output,
        updated_at=EXCLUDED.updated_at`,
      [
        item.id,
        item.taskType,
        item.targetId,
        item.status,
        item.modelName,
        item.errorCode,
        item.errorMessage,
        item.rawOutput === null ? null : JSON.stringify(item.rawOutput),
        item.createdAt,
        item.updatedAt,
      ],
    );
  }

  async saveFeedback(item: AdminFeedback): Promise<void> {
    await this.#pool.query(
      `INSERT INTO admin_feedback (
        id, target_type, target_id, feedback_kind, note, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET feedback_kind=EXCLUDED.feedback_kind, note=EXCLUDED.note`,
      [item.id, item.targetType, item.targetId, item.feedbackKind, item.note, item.createdAt],
    );
  }

  async listFeedback(): Promise<readonly AdminFeedback[]> {
    const result = await this.#pool.query("SELECT * FROM admin_feedback ORDER BY created_at DESC");
    return rows(result).map(mapFeedback);
  }

  async logicalDeleteExpiredMessages(retentionDays: number): Promise<number> {
    const result = await this.#pool.query(
      `UPDATE messages SET content='', deleted_at=now()
      WHERE deleted_at IS NULL AND ingested_at < now() - ($1::int * interval '1 day')`,
      [retentionDays],
    );
    return result.rowCount ?? 0;
  }
}

export function listStateMessagesForApi(state: Phase1State): readonly Message[] {
  return listByIngestedAt(state.messages.values()).filter((message) => message.deletedAt === null);
}
