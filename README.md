# VRCMCP-stdio

VRChat のフレンド状況を確認できる [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) サーバーです。  
Claude などの AI アシスタントから、フレンドのオンライン状況・現在地・ステータスをそのまま聞けます。

## 機能

- フレンドのオンライン状況・現在インスタンスの確認
- お気に入りフレンドの一覧取得
- ニックネーム・通称での曖昧検索（表記揺れ対応）
- Gemini AI による検索クエリの推測（オプション）
- 別名（ニックネーム）の登録・削除
- ログインセッションの自動復元（Cookie 永続化）

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

```bash
cp .env.example .env
```

```env
# 必須
VRCHAT_USERNAME=your_vrchat_username
VRCHAT_PASSWORD=your_vrchat_password

# オプション: TOTP シークレットを設定すると 2FA を完全自動化できます
# （未設定でも初回ログイン後はセッションが自動復元されます）
VRCHAT_TOTP_SECRET=your_totp_secret

# オプション: AI 推測検索を有効にします
GEMINI_API_KEY=your_gemini_api_key
```

## MCP クライアントへの登録

### Claude Code

以下のコマンドで登録します。

```bash
claude mcp add vrcmcp --scope user node /absolute/path/to/VRCMCP-stdio/src/index.js
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（Mac）の `mcpServers` に追加します。

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

## 初回ログイン

初回のみ `vrchat_login` ツールを呼び出す必要があります。  
2FA が有効な場合は認証アプリの 6 桁コードを渡してください。

```
vrchat_login(totpCode: "123456")
```

ログイン成功後は Cookie が `auth-data.json` に保存され、**次回以降は自動でセッションが復元**されます。

## 提供ツール一覧

| ツール名 | 説明 |
|---|---|
| `vrchat_login` | VRChat にログイン（2FA 対応・初回のみ） |
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
| `auth-data.json` | ログインセッションの Cookie（永続） |
| `friends-alias.json` | 登録した別名データ（永続） |
| `friends-cache.json` | フレンドリストのキャッシュ（5 分 TTL） |

これらのファイルはサーバー起動時に自動生成されます。`.gitignore` に追加済みです。

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
