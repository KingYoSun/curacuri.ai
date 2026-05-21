# Discord MCP 実接続検証

この手順は、Phase
1 の Discord 実接続手動検証を Codex から繰り返し実行するためのものです。SaseQ/discord-mcp は curacuri.ai の AI書記 bot ではなく、人間の検証操作を代替する
**検証者役bot** として使います。

## 前提

- 検証用 Discord サーバーだけで実行する。
- curacuri.ai 本体用 bot と検証者役botは別の Discord Application にする。
- 通常ユーザーアカウントの自動操作、Discord Web UI の自動操作、self-bot 型実装は使わない。
- 検証者役botの投稿を取り込む設定は、本番・Hosted用途では有効化しない。

## curacuri.ai bot 側の設定

curacuri.ai
bot は、通常どおり bot 投稿を無視します。検証者役botの投稿だけを例外的に取り込むには、次のすべてを満たす必要があります。

```sh
CURACURI_ENV=dogfood
DISCORD_TEST_ALLOW_BOT_AUTHORS=true
DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS=<検証者役botのuser ID>
NODE_ENV=development
```

`CURACURI_ENV=production` または `NODE_ENV=production` では起動時に失敗します。
`DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS` はカンマ区切りで複数指定できます。

## SaseQ/discord-mcp の起動

検証者役botには、最初は以下の権限だけを付けます。

- View Channel
- Send Messages
- Read Message History
- Add Reactions

チャンネル作成、権限変更、Webhook検証が必要な場合だけ、検証用サーバーで権限を追加します。

`.env` に検証者役bot用の値を設定します。`DISCORD_MCP_TOKEN` は、curacuri.ai本体用の `DISCORD_TOKEN`
とは別の Discord Application の token にします。

```sh
DISCORD_MCP_TOKEN=<検証者役bot token>
DISCORD_MCP_GUILD_ID=<検証用guild ID>
DISCORD_MCP_PORT=8085
```

専用Composeで起動します。

```sh
docker compose -f docker-compose.discord-mcp.yml up -d
docker compose -f docker-compose.discord-mcp.yml ps
```

Codex から使う場合は、HTTP MCP endpoint を登録します。

```sh
codex mcp add discord-mcp --url http://localhost:8085/mcp
codex mcp list
```

停止する場合は次を使います。

```sh
docker compose -f docker-compose.discord-mcp.yml down
```

## 検証シナリオ

1. curacuri.ai の API、worker、bot を起動する。
2. Dashboard で `guild_settings.target_channel_ids`、`excluded_channel_ids`、
   `admin_notification_channel_id` を検証用チャンネルIDに更新する。
3. SaseQ/discord-mcp から対象チャンネルへ投稿し、`discord.ingest` に入ることを確認する。
4. 除外チャンネルへ投稿し、DB/queueに入らないことを確認する。
5. curacuri.ai bot へDMを送り、DB/queueに入らないことを確認する。
6. `DISCORD_DRY_RUN=false`
   で、管理者通知が実 Discord の管理者通知チャンネルへ投稿されることを確認する。
7. `intake_only`、`faq_assist`、`approval_required`
   の各モードで、許可された範囲だけ返信されることを確認する。
8. 高重要度、公式回答待ち、誤情報可能性、ルール違反候補が自動返信されず、管理者確認に回ることを確認する。

検証が終わったら、`DISCORD_TEST_ALLOW_BOT_AUTHORS=false` に戻し、検証者役botの権限を外します。
