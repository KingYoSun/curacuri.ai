# ADR 0002: Phase 1 Dogfood Alpha アプリケーション構成

## ステータス

採用

## 文脈

Phase 1 Dogfood
Alpha では、「1週間分のDiscordを5分で把握できる」体験を、自前Discord、疑似ログ、サンプルログで検証できる状態にする。これまでのハーネスでは、アプリケーション API、DB
schema、Redis queue 名、Discord Bot の振る舞いを意図的に未定義としていたため、Phase
1 実装に合わせて長く残る契約を記録する必要がある。

## 決定

- Phase 1 は単一Discordサーバー向けの self-host Dogfood Alpha として実装する。
- Hosted、OAuth導入ウィザード、マルチテナント、複数guild管理は Phase 1 から外す。
- `guild_settings`、`messages`、`classifications`、`admin_notifications`、`auto_reply_policies`、`auto_reply_escalation_rules`、`auto_replies`、`faq_candidates`、`weekly_reports`、`admin_feedback`
  のDB schemaを導入する。
- Redis / BullMQ queue 契約として
  `discord.ingest`、`message.classify`、`ops.notify`、`auto_reply.decide`、`auto_reply.send`、`faq.generate`、`report.weekly`
  を導入する。
- 自動返信は初期値 `disabled`
  とし、ON/OFF、許可チャンネル、許可ラベル、許可カテゴリ、confidence閾値、エスカレーション条件、実行ログ、承認必須モードを Phase
  1 で扱う。
- 実装元は
  `proposal.md`、`docs/classification/label-taxonomy-v0.md`、`docs/prompts/classification-v0.md`、`docs/prompts/auto-reply-v0.md`、`docs/templates/weekly-report-v0.md`
  とする。

## 影響

- Phase
  1 のAPI、DB、queue、Bot、管理画面の境界が固定され、以後の実装者が仕様外に範囲を広げにくくなる。
- 外部公開や複数guild対応は後続フェーズの判断として残る。
- 自動返信は補助返信として限定され、公式回答が必要な話題は管理者確認に回る。
- サンプルログ取り込みとインメモリ実行経路により、PostgreSQL/Redis/Discordなしでも中核処理をテストできる。
