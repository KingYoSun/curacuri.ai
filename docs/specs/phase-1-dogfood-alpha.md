# Phase 1 Dogfood Alpha 実装仕様

## 目的

Phase 1 Dogfood
Alpha では、curacuri.ai の中核体験である「1週間分のDiscordを5分で把握できる」状態を、自前Discord、疑似ログ、サンプルログで検証できる形にする。

このフェーズは外部公開のための最小機能版ではなく、分類、重要通知、FAQ候補、週次運営レポート、管理者フィードバック、限定自動返信が一通りつながり、運営者が毎週確認したいと判断できる体験を作るための実装である。

Phase 2 は協力者環境での評価・調整フェーズにする。大規模または重要な新規機能実装は Phase
1 で完了させる。

Phase 1 で扱わないものは以下とする。

- Hosted公開
- 不特定多数の外部Discordへの導入
- マルチテナント運用
- 複数Discordサーバー管理
- Discord OAuth導入ウィザード
- 公式回答の完全自動化
- 自動モデレーション、自動BAN、ユーザースコアリング
- DMの読み取り

## 成功条件

Phase 1 は、次の状態を満たしたら完了とする。

- Discord投稿またはサンプルログを取り込める。
- 取り込んだ投稿に対して、日本語Discord分類ラベル v0 に基づく分類が保存される。
- 重要投稿または重要トピックが、管理者通知候補として生成される。
- 繰り返し質問、高価値UGC、未回答質問からFAQ候補が生成される。
- 週次運営レポートの短い版と詳細版が生成される。
- 管理者が通知、FAQ候補、週次レポート、自動返信にフィードバックを残せる。
- 自動返信のON/OFF、許可範囲、エスカレーション条件を管理画面で設定できる。
- `intake_only` と `faq_assist` で低リスクな返信が送信される。
- `approval_required` で回答案が生成され、管理者承認後に送信される。
- 公式回答が必要な話題は自動返信せず、管理者へエスカレーションされる。
- 管理者が週次レポートの短い版を5分以内で確認できる。
- UI、通知、レポートで「監視」「スコアリング」「危険ユーザー」などの表現を使わない。

## 参照元

実装時は、次のドキュメントを正とする。

- プロダクト方針: `proposal.md`
- 分類ラベル: `docs/classification/label-taxonomy-v0.md`
- 分類プロンプト: `docs/prompts/classification-v0.md`
- 自動返信プロンプト: `docs/prompts/auto-reply-v0.md`
- 週次レポート: `docs/templates/weekly-report-v0.md`
- 規約・プライバシー確認: `docs/research/discord-tos-privacy-check.md`
- ハーネス運用: `docs/harness.md`

## システム構成

Phase 1 では、単一Discordサーバーを対象にした self-host 構成を採用する。

```text
Discord Bot / Sample Importer
  -> Redis / BullMQ
  -> Worker
  -> PostgreSQL
  -> Hono API
  -> Vite React Dashboard
```

### コンポーネント

| コンポーネント | 役割                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `bot`          | Discord Gateway から対象チャンネルの投稿を受け取り、取り込みqueueへ送る。DMと分析対象外チャンネルは無視する。 |
| `worker`       | 投稿分類、重要通知生成、FAQ候補生成、週次レポート生成、自動返信判定、回答案生成、保存期間処理を実行する。     |
| `api`          | 管理画面向けHono APIを提供する。設定、一覧、フィードバック、レポート生成要求を扱う。                          |
| `dashboard`    | Alpha用管理画面を提供する。設定、通知、FAQ候補、週次レポート、フィードバックを扱う。                          |
| `shared`       | 型、DTO、分類ラベル、重要度、設定値、LLM出力schema、queue payload schemaを共有する。                          |
| `postgres`     | 投稿、分類、通知、FAQ候補、週次レポート、フィードバックを保存する。                                           |
| `redis`        | BullMQのqueue backendとして使う。                                                                             |

Docker Compose は Phase 1 実装で追加する。ただし、この仕様書作成時点では Docker Compose、DB
migration、package依存は追加しない。

## データ境界

### 基本方針

- Phase 1 は単一Discordサーバーを前提にする。
- 対象チャンネルは管理者が明示した公開チャンネルだけにする。
- 分析対象外チャンネルは取り込まない。
- DMは取り込まない。
- 削除リクエスト対象データは分類、通知、レポート生成に使わない。
- Discord API経由のmessage contentをモデル学習に使わない設定を優先する。
- 投稿者個人の評価や採点は保存しない。
- 自動返信は対象チャンネル、対象ラベル、回答カテゴリ、信頼できるFAQ/Docs参照、confidence、エスカレーション条件で制限する。
- 自動返信の本文、判定理由、送信状態、管理者フィードバックは監査と改善のために保存する。

### DB schema案

実装時は migration として次のテーブルを導入する。

#### `guild_settings`

単一guildのAlpha設定を保存する。

| カラム                           | 型          | 内容                                                                                   |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `id`                             | UUID        | 設定ID。                                                                               |
| `guild_id`                       | text        | Discord guild ID。Phase 1では1件のみを想定する。                                       |
| `target_channel_ids`             | text[]      | 分析対象チャンネルID。                                                                 |
| `excluded_channel_ids`           | text[]      | 分析対象外チャンネルID。                                                               |
| `admin_notification_channel_id`  | text        | 管理者通知チャンネルID。                                                               |
| `retention_days`                 | integer     | 投稿本文と分類結果の保存期間。                                                         |
| `character_name`                 | text        | 表示上のキャラクター名。初期値は `クラクリAI`。                                        |
| `character_tone`                 | text        | 管理者向け文体設定。初期値は `丁寧な書記`。                                            |
| `auto_reply_mode`                | text        | `disabled`, `intake_only`, `faq_assist`, `approval_required`。                         |
| `auto_reply_allowed_channel_ids` | text[]      | 自動返信を許可するチャンネルID。                                                       |
| `auto_reply_allowed_labels`      | text[]      | 自動返信候補にできる分類ラベル。初期値は `質問`, `新規参加者の困りごと`, `高価値UGC`。 |
| `auto_reply_allowed_categories`  | text[]      | 許可する回答カテゴリ。初期値は `intake`, `channel_guide`, `faq_reference`。            |
| `auto_reply_escalation_rules`    | jsonb       | 自動返信せず運営者へ回す条件。                                                         |
| `auto_reply_min_confidence`      | numeric     | 自動送信に必要な最小confidence。初期値は0.80。                                         |
| `created_at`                     | timestamptz | 作成日時。                                                                             |
| `updated_at`                     | timestamptz | 更新日時。                                                                             |

#### `messages`

取り込んだDiscord投稿またはサンプルログ投稿を保存する。

| カラム           | 型          | 内容                                                 |
| ---------------- | ----------- | ---------------------------------------------------- |
| `id`             | UUID        | 内部ID。                                             |
| `source`         | text        | `discord` または `sample_log`。                      |
| `guild_id`       | text        | Discord guild ID。サンプルログでは固定値を使う。     |
| `channel_id`     | text        | Discord channel IDまたはサンプルチャンネルID。       |
| `channel_name`   | text        | 表示用チャンネル名。                                 |
| `message_id`     | text        | Discord message ID。サンプルログでは疑似ID。         |
| `thread_id`      | text        | スレッドID。無い場合はnull。                         |
| `author_id_hash` | text        | 投稿者IDのハッシュ。生のユーザーIDは保存しない。     |
| `content`        | text        | 投稿本文。保存期間対象。                             |
| `posted_at`      | timestamptz | Discord上の投稿日時またはサンプル上の日時。          |
| `ingested_at`    | timestamptz | 取り込み日時。                                       |
| `deleted_at`     | timestamptz | 削除リクエストまたは保持期限処理で論理削除した日時。 |

#### `classifications`

投稿分類結果を保存する。

| カラム                | 型          | 内容                                                                                                                   |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`                  | UUID        | 分類ID。                                                                                                               |
| `message_id`          | UUID        | `messages.id`。                                                                                                        |
| `labels`              | text[]      | 分類ラベル。空にしない。                                                                                               |
| `importance`          | text        | `low`, `medium`, `high`, `critical`。                                                                                  |
| `admin_action_needed` | boolean     | 管理者確認が必要か。                                                                                                   |
| `admin_action_type`   | text        | `none`, `weekly_report`, `reply_check`, `bug_triage`, `faq_candidate`, `announcement_check`, `privacy_or_rule_check`。 |
| `confidence`          | numeric     | 0.0から1.0。                                                                                                           |
| `reason`              | text        | 分類理由。投稿者への返信文ではない。                                                                                   |
| `suggested_summary`   | text        | 週報や通知に使える短い要約。                                                                                           |
| `model_name`          | text        | 分類に使ったモデル名。                                                                                                 |
| `raw_output`          | jsonb       | LLMの生出力。parse失敗調査用。                                                                                         |
| `created_at`          | timestamptz | 作成日時。                                                                                                             |

#### `admin_notifications`

管理者通知候補と送信状態を保存する。

| カラム               | 型          | 内容                                                                                                                             |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | UUID        | 通知ID。                                                                                                                         |
| `notification_type`  | text        | `official_reply`, `bug_cluster`, `complaint_increase`, `misinformation`, `fire_risk`, `privacy_or_rule`, `unanswered_question`。 |
| `message_ids`        | UUID[]      | 関連投稿ID。単一投稿でも配列で扱う。                                                                                             |
| `title`              | text        | 通知タイトル。                                                                                                                   |
| `body`               | text        | 管理者向け通知本文。                                                                                                             |
| `importance`         | text        | `high` または `critical` を基本にする。                                                                                          |
| `status`             | text        | `pending`, `sent`, `dismissed`, `failed`。                                                                                       |
| `sent_to_channel_id` | text        | 送信先管理者チャンネルID。                                                                                                       |
| `sent_at`            | timestamptz | Discordに送信した日時。                                                                                                          |
| `created_at`         | timestamptz | 作成日時。                                                                                                                       |

#### `auto_reply_policies`

自動返信の許可範囲を保存する。Phase 1 では単一guildに対して1件を基本にする。

| カラム                   | 型          | 内容                                                                                                      |
| ------------------------ | ----------- | --------------------------------------------------------------------------------------------------------- |
| `id`                     | UUID        | policy ID。                                                                                               |
| `guild_id`               | text        | Discord guild ID。                                                                                        |
| `enabled`                | boolean     | 自動返信を有効にするか。`auto_reply_mode = disabled` の場合は常にfalse扱いにする。                        |
| `mode`                   | text        | `disabled`, `intake_only`, `faq_assist`, `approval_required`。                                            |
| `allowed_channel_ids`    | text[]      | 自動返信を許可するチャンネルID。                                                                          |
| `allowed_labels`         | text[]      | 自動返信候補にできる分類ラベル。                                                                          |
| `allowed_categories`     | text[]      | `intake`, `channel_guide`, `faq_reference`, `clarifying_question`, `approved_answer`。                    |
| `blocked_categories`     | text[]      | 自動返信しないカテゴリ。初期値は `legal`, `pr`, `pricing`, `incident`, `roadmap`, `account`, `security`。 |
| `min_confidence`         | numeric     | 自動送信に必要な最小confidence。                                                                          |
| `require_source_for_faq` | boolean     | FAQ補助に信頼できるFAQ/Docs参照を必須にするか。初期値はtrue。                                             |
| `created_at`             | timestamptz | 作成日時。                                                                                                |
| `updated_at`             | timestamptz | 更新日時。                                                                                                |

#### `auto_reply_escalation_rules`

自動返信せず、管理者確認に回す条件を保存する。

| カラム       | 型          | 内容                                                                                               |
| ------------ | ----------- | -------------------------------------------------------------------------------------------------- |
| `id`         | UUID        | rule ID。                                                                                          |
| `guild_id`   | text        | Discord guild ID。                                                                                 |
| `rule_type`  | text        | `label`, `category`, `keyword`, `importance`, `confidence`, `official_needed`, `privacy_or_rule`。 |
| `condition`  | jsonb       | 条件本体。例: `{ "labels": ["公式回答待ち"], "importance": ["high", "critical"] }`。               |
| `action`     | text        | `notify_admin`, `draft_for_approval`, `do_not_reply`。                                             |
| `enabled`    | boolean     | 有効か。                                                                                           |
| `created_at` | timestamptz | 作成日時。                                                                                         |
| `updated_at` | timestamptz | 更新日時。                                                                                         |

#### `auto_replies`

自動返信候補、送信済み返信、承認待ち回答案を保存する。

| カラム              | 型          | 内容                                                                                   |
| ------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `id`                | UUID        | 自動返信ID。                                                                           |
| `message_id`        | UUID        | 対象投稿ID。                                                                           |
| `classification_id` | UUID        | 対象分類ID。                                                                           |
| `mode`              | text        | 判定時の自動返信モード。                                                               |
| `reply_category`    | text        | `intake`, `channel_guide`, `faq_reference`, `clarifying_question`, `approved_answer`。 |
| `body`              | text        | 返信本文または回答案。                                                                 |
| `source_refs`       | jsonb       | FAQ/Docs/過去回答などの参照元。無い場合は空配列。                                      |
| `confidence`        | numeric     | 0.0から1.0。                                                                           |
| `decision_reason`   | text        | 返信する、承認待ちにする、エスカレーションする理由。                                   |
| `status`            | text        | `drafted`, `pending_approval`, `sent`, `escalated`, `blocked`, `failed`。              |
| `sent_message_id`   | text        | Discordに送信した返信message ID。                                                      |
| `approved_by`       | text        | 承認者IDのハッシュ。承認不要モードではnull。                                           |
| `sent_at`           | timestamptz | 送信日時。                                                                             |
| `created_at`        | timestamptz | 作成日時。                                                                             |

#### `faq_candidates`

FAQ候補を保存する。

| カラム                  | 型          | 内容                                                                                |
| ----------------------- | ----------- | ----------------------------------------------------------------------------------- |
| `id`                    | UUID        | FAQ候補ID。                                                                         |
| `source_message_ids`    | UUID[]      | 関連投稿ID。                                                                        |
| `topic`                 | text        | 質問または論点。                                                                    |
| `current_answer_status` | text        | `unknown`, `answered_in_thread`, `needs_official_answer`, `existing_faq_possible`。 |
| `draft_question`        | text        | FAQ質問文案。                                                                       |
| `draft_answer`          | text        | FAQ回答文案。公式確定ではない。                                                     |
| `confidence`            | numeric     | 0.0から1.0。                                                                        |
| `status`                | text        | `candidate`, `accepted`, `rejected`, `needs_review`。                               |
| `created_at`            | timestamptz | 作成日時。                                                                          |
| `updated_at`            | timestamptz | 更新日時。                                                                          |

#### `weekly_reports`

週次運営レポートを保存する。

| カラム                 | 型          | 内容                                                          |
| ---------------------- | ----------- | ------------------------------------------------------------- |
| `id`                   | UUID        | レポートID。                                                  |
| `period_start`         | date        | 対象期間開始日。                                              |
| `period_end`           | date        | 対象期間終了日。                                              |
| `target_channel_ids`   | text[]      | 対象チャンネルID。                                            |
| `excluded_channel_ids` | text[]      | 対象外チャンネルID。                                          |
| `message_count`        | integer     | 集計対象投稿数。                                              |
| `short_body`           | text        | 5分確認用の短い版。                                           |
| `detailed_body`        | text        | 詳細版。                                                      |
| `metrics`              | jsonb       | 未回答質問数、バグ報告候補数、要望数、不満数、FAQ候補数など。 |
| `status`               | text        | `generating`, `ready`, `failed`。                             |
| `created_at`           | timestamptz | 作成日時。                                                    |

#### `admin_feedback`

管理者フィードバックを保存する。

| カラム          | 型          | 内容                                                                               |
| --------------- | ----------- | ---------------------------------------------------------------------------------- |
| `id`            | UUID        | フィードバックID。                                                                 |
| `target_type`   | text        | `classification`, `notification`, `faq_candidate`, `weekly_report`, `auto_reply`。 |
| `target_id`     | UUID        | 対象ID。                                                                           |
| `feedback_kind` | text        | `useful`, `unnecessary`, `misclassified`, `missed`。                               |
| `note`          | text        | 任意メモ。                                                                         |
| `created_at`    | timestamptz | 作成日時。                                                                         |

### Redis / BullMQ queue契約

queue payload は `shared` のschemaで検証し、DB ID参照を基本にする。

| Queue名             | Producer               | Consumer | Payload方針                                                                                    |
| ------------------- | ---------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `discord.ingest`    | `bot`, sample importer | `worker` | Discord eventまたはサンプル投稿を正規化し、`messages` へ保存する。                             |
| `message.classify`  | `worker`               | `worker` | `messageId` を受け取り、分類を実行して `classifications` に保存する。                          |
| `ops.notify`        | `worker`, `api`        | `worker` | `classificationId` または集約対象IDを受け取り、通知候補を作成・送信する。                      |
| `auto_reply.decide` | `worker`               | `worker` | `messageId` と `classificationId` を受け取り、返信可否、承認要否、エスカレーションを判定する。 |
| `auto_reply.send`   | `worker`, `api`        | `worker` | `autoReplyId` を受け取り、許可済みまたは承認済みの返信をDiscordへ送信する。                    |
| `faq.generate`      | `worker`, `api`        | `worker` | 期間またはmessage ID群を受け取り、FAQ候補を生成する。                                          |
| `report.weekly`     | `api`, scheduler       | `worker` | 対象期間とchannel ID群を受け取り、週次レポートを生成する。                                     |

再試行は worker 側で扱う。LLM出力のJSON parse失敗、API rate limit、Discord送信失敗は `failed`
状態を保存し、管理画面で確認できるようにする。

## 機能仕様

### Discord Bot

Botは対象チャンネルの投稿を取り込み、管理者通知チャンネルへの通知と、許可された範囲の自動返信を行う。

- `guild_settings.target_channel_ids` に含まれる公開チャンネルだけを処理する。
- `guild_settings.excluded_channel_ids` に含まれるチャンネルは常に無視する。
- DMは無視し、DBにもqueueにも入れない。
- 管理者通知チャンネルへの送信は `admin_notifications.status = pending` のものだけを対象にする。
- ユーザー投稿への返信は `auto_reply_policies` と `auto_reply_escalation_rules` を通過した
  `auto_replies` だけを対象にする。
- `disabled` ではユーザー投稿に返信しない。
- `intake_only` では受付・運営確認待ち・チャンネル案内だけを返信する。
- `faq_assist` では信頼できるFAQ/Docs/承認済みFAQ候補を参照できる場合だけ補助返信する。
- `approval_required` では回答案だけを生成し、管理者承認後に送信する。
- Message Content Intent が必要になる前提で、READMEまたは導入手順に明記する。

### サンプルログ取り込み

Discord実接続なしでDogfood体験を検証できるよう、`datasets/samples/discord-jp-v0.jsonl`
を取り込む導線を用意する。

- `POST /api/import/sample-log` から取り込める。
- サンプル投稿ごとに疑似 `guild_id`, `channel_id`, `message_id`, `posted_at` を付与する。
- 取り込み後は実Discord投稿と同じ分類、通知、FAQ候補、週次レポートの処理に流す。
- 重複取り込みを避けるため、サンプル由来の疑似message IDは決定的に生成する。

### 投稿分類

分類は `docs/prompts/classification-v0.md` の入出力を実装元にする。

ラベルは次の14種を使う。

```text
質問
未回答質問
公式回答待ち
バグ報告
要望
不満
称賛
雑談
炎上兆候
誤情報可能性
ルール違反候補
高価値UGC
新規参加者の困りごと
古参の重要指摘
```

分類出力は以下を満たす必要がある。

- `labels` は空にしない。該当がなければ `雑談` にする。
- 1投稿に複数ラベルを付けてよい。
- `importance` は `low`, `medium`, `high`, `critical` のいずれかにする。
- `admin_action_needed` は管理者確認が必要な場合だけ `true` にする。
- `reason` は分類理由であり、返信文にしない。
- `suggested_summary` はユーザー名を含めず、投稿内容の要点だけにする。

`炎上兆候`、`誤情報可能性`、`ルール違反候補` は断定ではなく運営確認候補として扱う。

### 重要通知

通知疲れを避けるため、Phase 1 の管理者通知は以下に絞る。

- 公式回答が必要そうな質問。
- 複数人から出ている不具合報告。
- 急増している不満。
- 誤情報が広がりそうな投稿。
- 炎上兆候。
- APIキー、個人情報、トークンなどを含む可能性がある投稿。
- 初心者が導線でつまずいており、FAQ化または案内改善が必要そうな投稿。
- 昨日以前の質問が未回答のまま残っている投稿。

通知文は管理者向けに書き、ユーザー個人を評価しない。本文では「運営確認」「見落とし防止」「声を届ける」を使い、「監視」「危険ユーザー」「スコアリング」は使わない。

### FAQ候補生成

FAQ候補は、次の投稿群から生成する。

- `質問` が繰り返されている投稿。
- `未回答質問`。
- `高価値UGC`。
- `新規参加者の困りごと`。
- `公式回答待ち` のうち、回答方針を明文化すべきもの。

FAQ回答文案は公式回答として扱わない。管理画面では候補として表示し、`accepted`, `rejected`,
`needs_review` の状態を管理できるようにする。

### 限定自動返信

Phase 1 では自動返信の設計だけでなく、Dogfood可能な実行まで実装する。初期状態は `disabled`
とし、管理者が明示的にONにした場合だけ送信する。

#### モード

| モード              | 挙動                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `disabled`          | ユーザー投稿へ返信しない。分類、通知、週報、FAQ候補だけを行う。                                          |
| `intake_only`       | 「記録しました」「運営確認に回します」「適切なチャンネルはこちらです」のような受付・案内だけを返信する。 |
| `faq_assist`        | 信頼できるFAQ/Docs/承認済みFAQ候補を参照できる場合だけ、出典付きの補助返信を行う。                       |
| `approval_required` | 返信案を生成して管理画面に出し、管理者承認後に送信する。                                                 |

#### 許可範囲

自動返信は、次の条件をすべて満たす場合だけ候補にする。

- 投稿チャンネルが `auto_reply_allowed_channel_ids` に含まれる。
- 分類ラベルが `auto_reply_allowed_labels` に含まれる。
- 回答カテゴリが `auto_reply_allowed_categories` に含まれる。
- `importance` が `low` または `medium` である。
- `confidence` が `auto_reply_min_confidence` 以上である。
- `faq_assist` では `source_refs` にFAQ/Docs/承認済みFAQ候補が1件以上ある。
- エスカレーション条件に該当しない。

#### エスカレーション条件

以下に該当する場合は自動返信せず、管理者通知または承認待ち回答案に回す。

- `公式回答待ち`, `炎上兆候`, `誤情報可能性`, `ルール違反候補` が付いている。
- `importance` が `high` または `critical`。
- 法務、広報、料金、障害、ロードマップ、個別アカウント、課金、セキュリティ、ルール処分に関わる。
- APIキー、個人情報、トークンなどの露出可能性がある。
- LLM出力のconfidenceが閾値未満。
- 投稿本文だけでは安全に答えられない。
- 公式回答と誤認される可能性が高い。

#### 返信文ルール

- AIキャラクターの補助返信であり、公式回答ではないことを必要に応じて明示する。
- 断定できない場合は「運営確認に回します」とする。
- 料金、障害、ロードマップ、法務、広報は回答しない。
- ユーザーを評価、採点、注意、処分しない。
- 返信は短く、受付・案内・FAQ参照に留める。
- 「監視」「スコアリング」「危険ユーザー」は使わない。

### 週次運営レポート

週次レポートは `docs/templates/weekly-report-v0.md` を実装元にする。

短い版には以下を含める。

- 対象期間
- 対象チャンネル
- 集計対象投稿数
- まず確認したいこと3件以内
- 今週の主要トピック
- 見落とし防止メモ
- 運営確認が必要そうな声
- コミュニティ温度感

詳細版には以下を含める。

- 要約
- 今週の主要トピック
- 未回答質問
- 要望
- 不満・戸惑い
- バグ報告候補
- 称賛・ポジティブ反応
- FAQ候補
- 運営確認が必要な話題
- 前週との差分
- 次の推奨アクション

低確信度の項目は推測で補わず、「要追加確認」と書く。

### Alpha管理画面

管理画面はPhase 1のDogfood運用に必要な範囲だけを持つ。

- 対象チャンネル設定。
- 分析対象外チャンネル設定。
- 管理者通知チャンネル設定。
- 保存期間設定。
- キャラクター名・口調設定。
- 自動返信モード表示と設定。
- 自動返信ON/OFF切り替え。
- 自動返信を許可するチャンネル、ラベル、回答カテゴリ、最小confidenceの設定。
- エスカレーション条件の設定。
- 自動返信ログ、送信状態、ブロック理由、承認待ち回答案の確認。
- `approval_required` の回答案承認・却下。
- 投稿分類一覧。
- 管理者通知一覧。
- FAQ候補一覧。
- 週次レポート一覧と詳細表示。
- 通知、FAQ候補、週次レポートへのフィードバック入力。
- ユーザー向け告知テンプレートの表示。

自動返信モードは `disabled`, `intake_only`, `faq_assist`, `approval_required` をPhase
1で実装する。初期値は `disabled` とし、ONにした場合も許可範囲とエスカレーション条件を必ず通す。

### 管理者フィードバック

管理者は以下のフィードバックを残せる。

- `useful`: 有用。
- `unnecessary`: 不要。
- `misclassified`: 誤分類。
- `missed`: 見逃し。
- `unsafe_or_too_much`: 自動返信として不適切、または踏み込みすぎ。
- `needs_escalation`: 自動返信ではなく運営確認に回すべき。

フィードバックはPhase
1では学習を自動更新しない。プロンプト、ルール、分類器改善のためのレビュー材料として蓄積する。

### ユーザー向け告知テンプレート

管理画面またはドキュメントから、導入告知テンプレートを参照できるようにする。

テンプレートは以下を明記する。

- 指定された公開チャンネルの投稿だけを対象にする。
- DMは読まない。
- ユーザーを評価、採点、自動処分しない。
- 目的は質問、要望、不具合報告、不満を運営が見落とさないようにすること。
- 自動返信のON/OFF、返信する範囲、返信しない条件。
- 自動返信はAIキャラクターの補助回答であり、公式回答とは分離されること。
- 公式判断が必要なものは自動返信せず、運営者確認に回すこと。

## API仕様

APIはAlpha管理画面とローカル検証のために提供する。認証はPhase
1ではself-host前提の最小構成とし、公開Hosted向けのOAuthや複雑な権限管理は導入しない。

| Method | Path                               | 内容                                                                                   |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`                      | API、DB、Redisの疎通状態を返す。                                                       |
| `GET`  | `/api/settings`                    | `guild_settings` を返す。                                                              |
| `PUT`  | `/api/settings`                    | 対象チャンネル、除外チャンネル、通知チャンネル、保存期間、キャラクター設定を更新する。 |
| `GET`  | `/api/auto-reply/policy`           | 自動返信モード、ON/OFF、許可範囲、エスカレーション条件を返す。                         |
| `PUT`  | `/api/auto-reply/policy`           | 自動返信モード、ON/OFF、許可範囲、エスカレーション条件を更新する。                     |
| `GET`  | `/api/auto-replies`                | 自動返信ログ、送信状態、承認待ち回答案を返す。                                         |
| `POST` | `/api/auto-replies/:id/approve`    | `approval_required` の回答案を承認し、送信queueへ流す。                                |
| `POST` | `/api/auto-replies/:id/reject`     | 承認待ち回答案を却下する。                                                             |
| `POST` | `/api/auto-replies/:id/feedback`   | 自動返信への管理者フィードバックを保存する。                                           |
| `POST` | `/api/import/sample-log`           | サンプルJSONLを取り込み、分類queueへ流す。                                             |
| `GET`  | `/api/messages`                    | 取り込み済み投稿を期間、チャンネル、ラベルで検索する。                                 |
| `GET`  | `/api/classifications`             | 分類結果一覧を返す。                                                                   |
| `GET`  | `/api/notifications`               | 管理者通知一覧を返す。                                                                 |
| `POST` | `/api/notifications/:id/feedback`  | 通知への管理者フィードバックを保存する。                                               |
| `GET`  | `/api/faq-candidates`              | FAQ候補一覧を返す。                                                                    |
| `POST` | `/api/faq-candidates/:id/feedback` | FAQ候補への管理者フィードバックまたは採用状態を保存する。                              |
| `POST` | `/api/reports/weekly`              | 対象期間を指定して週次レポート生成jobを作成する。                                      |
| `GET`  | `/api/reports/weekly`              | 週次レポート一覧を返す。                                                               |
| `GET`  | `/api/reports/weekly/:id`          | 週次レポート詳細を返す。                                                               |
| `POST` | `/api/reports/weekly/:id/feedback` | 週次レポートへの管理者フィードバックを保存する。                                       |

## 共有型

`shared` には最低限、次の型を置く。

```ts
type ClassificationLabel =
  | "質問"
  | "未回答質問"
  | "公式回答待ち"
  | "バグ報告"
  | "要望"
  | "不満"
  | "称賛"
  | "雑談"
  | "炎上兆候"
  | "誤情報可能性"
  | "ルール違反候補"
  | "高価値UGC"
  | "新規参加者の困りごと"
  | "古参の重要指摘";

type Importance = "low" | "medium" | "high" | "critical";

type AdminActionType =
  | "none"
  | "weekly_report"
  | "reply_check"
  | "bug_triage"
  | "faq_candidate"
  | "announcement_check"
  | "privacy_or_rule_check";

type AutoReplyMode = "disabled" | "intake_only" | "faq_assist" | "approval_required";

type AutoReplyCategory =
  | "intake"
  | "channel_guide"
  | "faq_reference"
  | "clarifying_question"
  | "approved_answer";

type AutoReplyStatus = "drafted" | "pending_approval" | "sent" | "escalated" | "blocked" | "failed";

type EscalationAction = "notify_admin" | "draft_for_approval" | "do_not_reply";

type FeedbackKind =
  | "useful"
  | "unnecessary"
  | "misclassified"
  | "missed"
  | "unsafe_or_too_much"
  | "needs_escalation";
```

## テスト計画

### Unit tests

- 分類ラベル定義と `docs/classification/label-taxonomy-v0.md` のラベル一覧が一致する。
- LLM分類出力JSONをparse、validateできる。
- `labels` が空の場合はvalidation errorになる。
- `importance` と `admin_action_type` が許可値以外の場合はvalidation errorになる。
- 対象チャンネル、除外チャンネル、DMのフィルタが正しく動く。
- 重要通知条件が意図通りに判定される。
- 自動返信モードが `disabled` の場合、ユーザー向け投稿処理が呼ばれない。
- `intake_only` が受付・案内以外の本文を生成しない。
- `faq_assist` が参照元なしで返信しない。
- `approval_required` が自動送信せず、承認待ち回答案を作る。
- エスカレーション条件に該当する投稿が自動返信されない。
- 週次レポート生成で短い版と詳細版の必須セクションが埋まる。

### Integration tests

- `datasets/samples/discord-jp-v0.jsonl` を取り込み、`messages` と `message.classify`
  job が作成される。
- 分類jobを実行すると `classifications` が保存される。
- `high` または `critical` の対象投稿から `admin_notifications` が生成される。
- 繰り返し質問または高価値UGCから `faq_candidates` が生成される。
- 許可された低リスク投稿から `auto_replies` が生成され、モードに応じて送信または承認待ちになる。
- 公式回答待ち、高重要度、低confidence、セキュリティ関連の投稿が `escalated` または `blocked`
  になる。
- 週次レポート生成APIから `report.weekly` job が作成され、`weekly_reports` が `ready` になる。
- 通知、FAQ候補、週次レポート、自動返信に対する `admin_feedback` が保存される。

### Docker Compose smoke

Phase 1 実装後、Docker Composeで以下を確認する。

- `postgres` と `redis` が起動する。
- `api`, `worker`, `dashboard` が起動する。
- `GET /api/health` が成功する。
- サンプルログ投入から分類、通知候補、FAQ候補、自動返信候補、週次レポート閲覧まで実行できる。

### Discord実接続確認

Discord実接続は、必要な環境変数がある場合だけ手動で確認する。

- 対象チャンネルの投稿が取り込まれる。
- 分析対象外チャンネルの投稿が取り込まれない。
- DMが取り込まれない。
- 管理者通知チャンネルにのみ通知が投稿される。
- `disabled` ではユーザー投稿への自動返信が発生しない。
- `intake_only` では受付・案内だけが送信される。
- `faq_assist` では参照元付きのFAQ補助だけが送信される。
- 公式回答待ちや高リスク投稿は自動返信されず、管理者へエスカレーションされる。

### 品質ゲート

引き渡し前に必ず以下を実行する。

```sh
pnpm check
```

## 実装前に必要なADR

Phase 1 実装では、アプリケーション API、DB schema、Redis queue 契約、Discord
Bot の振る舞いを初めて定義する。そのため、実装前に `docs/adr/` へ Phase
1 アプリケーション構成 ADR を追加する。

ADRには最低限、以下を記録する。

- 単一DiscordサーバーDogfood Alphaとして実装する判断。
- Hosted、OAuth導入ウィザード、マルチテナントをPhase 1から外す判断。
- DB schema と queue 契約を導入する判断。
- 自動返信のON/OFF、許可範囲、エスカレーション条件、実行ログ、承認必須モードをPhase
  1で実装する判断。
- `proposal.md`、分類taxonomy、分類プロンプト、週次レポートテンプレートを実装元にする判断。

## 実装対象外

次回以降の実装者が誤って範囲を広げないよう、Phase 1では以下を実装しない。

- Hosted Free
- 招待制Hosted
- 外部協力者Discordへの導入
- Discord OAuth導入ウィザード
- 複数guild管理
- Slack、Notion、GitHub Issuesなどの外部連携
- 公式回答の完全自動投稿
- 自動モデレーション、自動BAN、自動ロール操作
- ユーザーごとの信頼度、危険度、スコア
- 本格的な共同体記憶

## Assumptions

- ドキュメントとUI文言は日本語で書く。
- Phase 1 はDogfood Alphaであり、外部導入やHosted公開は扱わない。
- OpenAI APIまたはOpenAI互換APIを最初のLLM実装対象にする。
- pgvectorは採用可能なスタックとして維持するが、Phase 1ではFAQ候補生成に必要な範囲だけで使う。
- 管理者フィードバックは自動学習には使わず、改善レビューの材料として保存する。
- 自動返信はPhase 1で実装するが、初期値は `disabled`
  とし、ONにするには管理者の明示設定を必須にする。
- 実装コード、package依存、Docker Compose、DB migration はこの仕様書作成作業では追加しない。
