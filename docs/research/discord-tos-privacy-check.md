# Discord ToS / Privacy 確認メモ

確認日: 2026-05-19

## 目的

curacuri.ai Dogfood
Alpha 以降の前提として、Discord投稿を読み取り、分類し、週次レポートに使う場合の規約・プライバシー上の注意点を整理する。これは法務判断ではなく、実装前に確認すべき設計制約のメモである。

## 確認した公式ソース

- Discord Developer Terms of Service:
  <https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service>
- Discord Developer Policy:
  <https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy>
- Discord Message Resource: <https://docs.discord.com/developers/resources/message>
- Discord Terms of Service: <https://discord.com/terms>
- Discord Privacy Policy: <https://discord.com/privacy>
- Message Content Intent Review Policy:
  <https://support-dev.discord.com/hc/en-us/articles/5324827539479-Message-Content-Intent-Review-Policy>
- App Directory App Content Requirements Policy:
  <https://support-dev.discord.com/hc/en-us/articles/9489299950487-App-Directory-App-Content-Requirements-Policy>

## フェーズ別実装前提

| フェーズ      | 実装前提                                                                         |
| ------------- | -------------------------------------------------------------------------------- |
| Dogfood Alpha | 自前Discord、疑似ログ、サンプルログで検証し、外部導入と一般Hosted公開はしない    |
| Closed Beta   | 信頼できる少数協力者に限定し、導入告知・保存期間・削除依頼導線を個別確認する     |
| Hosted Beta   | 公開プライバシーポリシー、削除依頼導線、Developer Portal登録を整えてから公開する |

## 共通設計制約

| 項目                   | 実装前提                                                           | 理由                                                                                                    |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Message Content Intent | 投稿本文を読むには privileged intent が必要になる前提で設計する    | Discord docs では未承認アプリは `content`, `embeds`, `attachments`, `components` が空になるとされている |
| 100サーバー以上の運用  | 大規模化前に verification / privileged intent review を想定する    | Message Content Intent Review Policy が大規模Botの本文アクセスを審査対象としている                      |
| 読み取り対象           | 管理者が明示した公開チャンネルのみ                                 | 監視感を避け、データ最小化を守るため                                                                    |
| DM                     | 初期は読まない                                                     | ユーザー期待とプライバシーリスクが高い。proposal.md の方針とも一致する                                  |
| 保存期間               | サーバーごとに設定し、初期値を短めにする                           | API Data は目的上不要になったら削除する必要がある                                                       |
| 削除リクエスト         | 管理者または対象ユーザーからの削除依頼に対応する導線を用意する     | Developer Terms はユーザー削除要求時の API Data 削除を求めている                                        |
| プライバシーポリシー   | Hosted公開前に公開URLを用意し、Developer Portal に登録する         | Developer Terms / App Directory Policy が公開プライバシーポリシーを要求する                             |
| AIモデル学習           | Discord API経由のmessage contentをモデル学習に使わない             | Developer Policy は明示許諾なしの message content によるAI/MLモデル学習を禁止している                   |
| LLM分類                | 入力は分類・要約の一時処理として扱い、学習利用しない設定を優先する | 規約・利用者説明・監視感ゼロ設計の整合性を保つため                                                      |

## 禁止または避けること

- Discordのプライバシー、安全性、セキュリティ機能を迂回する実装。
- ユーザーやサーバーの許可なく、ユーザーやサーバーに代わって処理を開始すること。
- Discordサービス上のデータをスクレイピングすること。
- Discord API経由で取得したmessage contentを、Discordの明示許可なくAI/MLモデル学習に使うこと。
- サービス目的に不要になったAPI Dataを保存し続けること。
- DMを読む、またはDMを読むように見える説明。
- ユーザー単位のスコアリング、危険ユーザー判定、処分自動化を初期機能として入れること。

## ユーザー告知に含める項目

- curacuri.ai は、運営が質問・要望・不具合報告を見落とさないためのAI書記であること。
- 読み取り対象チャンネルの一覧。
- 分析対象外チャンネルの指定方法。
- DMは読まないこと。
- 保存する情報の種類。
- 保存期間。
- 削除リクエストの連絡先または手順。
- 自動回答、自動BAN、ユーザー評価を行わないこと。
- 管理者向けに整理・共有する用途であること。

## Dogfood Alpha 必須要件

- 読み取り専用モードを初期状態にする。
- 対象チャンネルを明示的に選択させる。
- 管理者専用通知チャンネルを明示的に選択させる。
- 分析対象外チャンネルを設定できるようにする。
- DM非対応をUIと告知テンプレートに明記する。
- 保存期間を設定できるようにする。
- LLMに送るデータは必要最小限にする。
- レポートや通知では、ユーザー評価ではなく投稿・話題・運営確認事項として表現する。

## Hosted公開前の必須要件

- 公開プライバシーポリシーを用意し、Developer Portal に登録する。
- 削除依頼導線を公開し、管理者または対象ユーザーからの依頼に対応できるようにする。
- 日本国内向けHosted版の個人情報保護法上の整理を行う。
- 共有推論を使う場合は、LLMプロバイダごとのデータ保持・学習利用設定を確認する。

## 要確認

- 日本国内向けHosted版の個人情報保護法上の整理。
- 協力者から実ログ提供を受ける場合の同意文面。
- LLMプロバイダごとのデータ保持・学習利用設定。
- App Review / privileged intent review で、週次レポート生成が message content access の core
  functionality として十分説明できるか。
- 削除リクエスト時に、分類結果、週報、集計値、バックアップからどこまで削除すべきか。

## 実装時の推奨文言

避ける表現:

- 監視
- スコアリング
- 危険ユーザー
- 問題ユーザー
- 自動判定
- 取り締まり

使う表現:

- 記録
- 整理
- 受付
- 共有
- 見落とし防止
- 運営確認
- 声を届ける
- 書記
