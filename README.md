# VRCMCP-stdio

VRChat のフレンド状況を確認できる [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) サーバーです。  
Claude などの AI アシスタントから、フレンドのオンライン状況・現在地・ステータスをそのまま聞けます。

## 機能

- フレンドのオンライン状況・現在インスタンスの確認
- お気に入りフレンドの一覧取得
- ニックネーム・通称での曖昧検索（表記揺れ対応）
- Gemini AI による検索クエリの推測（オプション）
- 別名（ニックネーム）の登録・削除

## 必要なもの

- Node.js 18 以上
- VRChat アカウント
- （オプション）Gemini API キー

## セットアップ

```bash
git clone <このリポジトリ>
cd VRCMCP-stdio
npm install
```

プロジェクトルートに `.env` ファイルを作成します。

```env
# 必須
VRCHAT_USERNAME=your_vrchat_username
VRCHAT_PASSWORD=your_vrchat_password

# オプション: TOTP シークレットを設定すると 2FA を自動処理します
VRCHAT_TOTP_SECRET=your_totp_secret

# オプション: AI 推測検索を有効にします
GEMINI_API_KEY=your_gemini_api_key
```

## MCP クライアントへの登録

### Claude Code

`~/.claude/settings.json` の `mcpServers` に追加します。

```json
{
  "mcpServers": {
    "vrcmcp": {
      "command": "node",
      "args": ["/absolute/path/to/VRCMCP-stdio/src/index.js"]
    }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（Mac）に追加します。

```json
{
  "mcpServers": {
    "vrcmcp": {
      "command": "node",
      "args": ["/absolute/path/to/VRCMCP-stdio/src/index.js"]
    }
  }
}
```

## 提供ツール一覧

| ツール名 | 説明 |
|---|---|
| `vrchat_login` | VRChat にログイン（2FA 対応） |
| `get_favorite_friends_status` | お気に入りフレンドのオンライン状況を取得 |
| `get_online_friends` | 現在オンラインのフレンド一覧を取得 |
| `get_friend_details` | 特定フレンドの詳細情報を取得 |
| `search_friend` | 名前・ニックネームでフレンドを検索 |
| `add_friend_alias` | フレンドに別名（ニックネーム）を登録 |
| `remove_friend_alias` | 登録した別名を削除 |
| `refresh_friend_index` | フレンドキャッシュを手動更新 |

## フレンド検索について

`search_friend` はニックネームや表記揺れに対応した曖昧検索を行います。

- カタカナ ↔ ひらがな、全角 ↔ 半角の正規化
- レーベンシュタイン距離による類似度マッチング
- `GEMINI_API_KEY` を設定すると、通称・愛称から AI がフレンドを推測
- AI 推測の結果は自動で別名登録され、次回から即マッチします
- 推測が間違っていた場合は `forceReInfer: true` で再推論できます

```
# 使用例（Claude に話しかけるイメージ）
「ぺんちゃんって今オンライン？」
「れいずちゃんどこにいる？」
```

## データファイル

| ファイル | 内容 |
|---|---|
| `friends-alias.json` | 登録した別名データ（永続） |
| `friends-cache.json` | フレンドリストのキャッシュ（5 分 TTL） |

これらのファイルはサーバー起動時に自動生成されます。`.gitignore` に追加することを推奨します。

## ステータスの見方

| 色 | ステータス |
|---|---|
| 🔵 | Join Me（いつでもどうぞ） |
| 🟢 | Active（アクティブ） |
| 🟠 | Ask Me（声かけてね） |
| 🔴 | Busy（取り込み中） |
| ⚫ | オフライン |

## ライセンス

MIT
