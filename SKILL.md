---
name: vrcmcp
description: Use when the user asks about VRChat friends — online status, current instance, who's where, or searching by nickname. Routes to the vrcmcp MCP server tools.
---

# vrcmcp — VRChat Friend Status

VRChat のフレンド状況を取得する MCP サーバー。Claude Code からは `mcp__vrcmcp__*` 系のツールで呼び出せる。

## 重要: ツール呼び出しの前提

ツール名は**固定**なので、ToolSearch で毎回探す必要はない。以下の 8 個を直接呼び出せる：

| ツール名 | 役割 |
|---|---|
| `mcp__vrcmcp__vrchat_login` | 初回ログイン（2FA 対応） |
| `mcp__vrcmcp__get_favorite_friends_status` | お気に入りフレンドの状況一覧 |
| `mcp__vrcmcp__get_online_friends` | オンラインフレンド全員 |
| `mcp__vrcmcp__get_friend_details` | 特定ユーザーの詳細（要 userId） |
| `mcp__vrcmcp__search_friend` | 名前・通称で検索（AI 推測あり） |
| `mcp__vrcmcp__add_friend_alias` | 別名登録 |
| `mcp__vrcmcp__remove_friend_alias` | 別名削除 |
| `mcp__vrcmcp__refresh_friend_index` | フレンドキャッシュ更新 |

スキーマが未ロードなら `ToolSearch` で `select:mcp__vrcmcp__<name>` を使うが、**一度ロードしたら同じセッション中は再検索不要**。

### ツールが見つからない場合

`ToolSearch` で `mcp__vrcmcp__*` が 1 つもヒットしない場合、MCP サーバーが登録されていない。ユーザーに以下を案内すること：

```bash
claude mcp add vrcmcp --scope user node /Users/aatame3/VRCMCP-stdio/src/index.js
```

登録後は Claude Code の再起動または `/mcp` での再接続が必要。`npm install` が未実行だと接続失敗するので、その場合は `cd /Users/aatame3/VRCMCP-stdio && npm install` も案内する。

## 認証フロー

1. サーバー起動時、`auth-data.json` に保存された Cookie があれば自動で復元される
2. Cookie が有効ならログイン不要、そのまま各ツールを呼べる
3. Cookie が無効/未保存なら、ツール実行時に `2FA code required` エラーが出る
4. その場合 `vrchat_login` を呼ぶ。2FA コードが必要ならユーザーに聞く
5. ログイン成功後、Cookie が自動保存される

**ユーザーの質問に対して、いきなり `vrchat_login` を呼ばない。** まず目的のツールを叩いてみて、認証エラーが出たときだけログインする。

## 典型的な質問と対応ツール

| ユーザーの聞き方 | 使うツール |
|---|---|
| 「ぺんぺんってオンライン？」「〜さんどこにいる？」 | `search_friend` |
| 「お気に入りの人誰が起きてる？」 | `get_favorite_friends_status` |
| 「今誰がオンライン？」 | `get_online_friends` |
| 「このユーザー ID の人の詳細」 | `get_friend_details` |
| 「〜を別名 X で登録して」 | `add_friend_alias` |

## search_friend の挙動

- 名前・ニックネーム・通称でフレンドを曖昧検索
- 正規化（カタカナ↔ひらがな、全角↔半角、記号除去）
- レーベンシュタイン距離でスコアリング
- スコア < 0.8 または結果 0 件のとき、`GEMINI_API_KEY` があれば AI が推測
- AI 推測ヒットは**自動で別名登録される**（次回以降は即マッチ）
- AI 推測が間違っていたら `forceReInfer: true` で再推論（自動登録を削除してやり直す）

## データファイル（プロジェクトルート、すべて .gitignore 済み）

- `auth-data.json` — ログイン Cookie
- `friends-alias.json` — 別名データ
- `friends-cache.json` — フレンドリストのキャッシュ（5 分 TTL）

## アンチパターン

- ❌ 毎ターン ToolSearch する → 一度ロードすれば OK
- ❌ 何も聞かれていないのに `vrchat_login` を先に呼ぶ → Cookie で復元されているはず、まず目的のツールから
- ❌ 認証エラーが出たとき、勝手に TOTP を予測/生成する → ユーザーに 6 桁コードを聞く
- ❌ `get_friend_details` に displayName を渡す → `userId` (usr_ で始まる) 必須
