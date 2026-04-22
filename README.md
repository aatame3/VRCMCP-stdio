# VRCMCP-stdio

VRChat のフレンド状況を確認できる [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) サーバーです。  
Claude などの AI アシスタントから、フレンドのオンライン状況・現在地・ステータスをそのまま聞けます。

## ⚠️ 免責事項・利用上の注意（必ず読んでね）

### このツールについて

- これは **Vibe Coding で作られた個人用ツール**です。動作は **無保証**で、不具合・アカウントへの影響・その他いかなる損害についても作者は責任を負いません。**自己責任**でご利用ください。
- VRChat API は公式にドキュメント化されておらず、仕様変更・エンドポイント削除などで本ツールが予告なく動かなくなることがあります。
- 本プロジェクトは VRChat Inc. とは一切関係ありません（非公式・非提携・非承認）。"VRChat" は VRChat Inc. の商標であり、本プロジェクト内の表記は説明目的での使用です。 / This project is not affiliated with, endorsed by, or sponsored by VRChat Inc. "VRChat" is a trademark of VRChat Inc.

### VRChat API 利用について

VRChat 公式の [Creator Guidelines](https://hello.vrchat.com/creator-guidelines) では、サードパーティから API を叩くこと自体は許容されていますが、**「破壊的（disruptive）な使い方をした場合、開発者およびそのアプリの利用者全員に対してモデレーション（警告・BAN を含む）を行う」**と明記されています。

本ツールは「個人が自分のアカウントで、常識的な頻度で自分のフレンド状況を確認する」用途を想定しています。**常識の範囲を超えた使い方はしないでください。** ガイドラインに反する使い方をした場合、**最悪アカウント BAN のリスクがあります。**

## 機能

- フレンドのオンライン状況・現在インスタンスの確認
- お気に入りフレンドの一覧取得
- ニックネーム・通称での曖昧検索（表記揺れ対応）
- Gemini AI による検索クエリの推測（オプション）
- 別名（ニックネーム）の登録・削除
- ログインセッションの自動復元（Cookie を OS キーリングに安全に保存）

## 必要なもの

- Node.js 18 以上
- VRChat アカウント
- OS キーリング（macOS Keychain / Windows Credential Manager / Linux は libsecret）
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
> [!WARNING]
> 本ツールは VRChat のユーザー名とパスワードを `.env` に平文で保存します。万が一の漏洩に備え、**VRChat アカウント側で必ず二段階認証（2FA）を有効化することを強く推奨します。** 


```env
# 必須
VRCHAT_USERNAME=your_vrchat_username
VRCHAT_PASSWORD=your_vrchat_password

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

> [!NOTE]
> どうせMCPサーバーさえセットアップすればあとは勝手にLLMがよしなにしてくれるので、人間様は読まなくてもいいかもしれません。

初回のみ `vrchat_login` ツールを呼び出す必要があります。  
2FA が有効な場合は認証アプリの 6 桁コードを渡してください。

```
vrchat_login(totpCode: "123456")
```

ログイン成功後、セッション Cookie は **OS のキーリング**（macOS Keychain など）に安全に保存され、**次回以降は自動でセッションが復元**されます。

旧バージョンで作成された `auth-data.json` がある場合は、初回起動時に自動でキーリングに移行され、ファイルは削除されます。

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
# 使用例 
「ほげちゃんって今オンライン？」
「ふがさんどこにいる？」
```

## データの保存場所

| 保存先 | 内容 |
|---|---|
| OS キーリング（サービス名 `vrcmcp`） | ログインセッションの Cookie |
| `friends-alias.json` | 登録した別名データ（永続） |
| `friends-cache.json` | フレンドリストのキャッシュ（5 分 TTL） |

JSON ファイルはサーバー起動時に自動生成されます。

## ステータスの見方

| 色 | ステータス |
|---|---|
| 🔵 | Join Me（いつでもどうぞ） |
| 🟢 | Active（アクティブ） |
| 🟠 | Ask Me（声かけてね） |
| 🔴 | Busy（取り込み中） |
| ⚫ | オフライン |

## ライセンス

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0)

Copyright (c) 2026 aatame3

本ソフトウェアを改変・再配布する場合、またはネットワーク経由でサービスとして提供する場合は、同じ AGPL-3.0 のもとでソースコードを公開する必要があります。詳細は `LICENSE` を参照してください。
