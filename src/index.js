import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env not found, rely on system environment variables
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VRChatAPI } from "./vrchat-api.js";
import { friendIndex } from "./friend-index.js";
import { getGeminiAPI } from "./gemini-api.js";

const server = new McpServer({
  name: "vrcmcp",
  version: "1.0.0",
});

server.resource(
  "guide",
  "vrcmcp://guide",
  { mimeType: "text/markdown", description: "vrcmcp tool usage guide" },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "text/markdown",
      text: `# vrcmcp usage

Auth: cookies persist in auth-data.json. Call tools directly; only use vrchat_login if a tool returns "2FA code required". Ask the user for the 6-digit code — never guess.

Search: search_friend accepts nicknames/typos (fuzzy + optional AI guess). AI hits auto-register as aliases; pass forceReInfer:true to redo if wrong.

IDs: get_friend_details needs userId (usr_...), not displayName. Use search_friend first to find the ID.

Tools: vrchat_login, get_favorite_friends_status, get_online_friends, get_friend_details, search_friend, add_friend_alias, remove_friend_alias, refresh_friend_index.`,
    }],
  })
);

let vrchatApi = null;

function getVRChatAPI() {
  if (!vrchatApi) {
    const username = process.env.VRCHAT_USERNAME;
    const password = process.env.VRCHAT_PASSWORD;
    const totp = process.env.VRCHAT_TOTP_SECRET;

    if (!username || !password) {
      throw new Error("VRCHAT_USERNAME and VRCHAT_PASSWORD environment variables are required");
    }

    vrchatApi = new VRChatAPI(username, password, totp);
  }
  return vrchatApi;
}

function getStatusEmoji(status) {
  switch (status) {
    case "join me":
      return "🔵";
    case "active":
      return "🟢";
    case "ask me":
      return "🟠";
    case "busy":
      return "🔴";
    default:
      return "⚫";
  }
}

// ログインツール
server.tool(
  "vrchat_login",
  "VRChatにログインします。通常は不要（Cookieで自動復元）。他ツールが '2FA code required' エラーを返したときだけ呼び、TOTPコードはユーザーに確認すること。",
  {
    totpCode: z.string().optional().describe("2FAのTOTPコード（必要な場合）"),
  },
  async ({ totpCode }) => {
    try {
      const api = getVRChatAPI();
      const result = await api.login(totpCode);
      return {
        content: [
          {
            type: "text",
            text: `ログイン成功: ${result.displayName} (${result.id})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `ログインエラー: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// お気に入りフレンドのオンライン状況を取得
server.tool(
  "get_favorite_friends_status",
  "お気に入りに登録しているフレンドのオンライン状況と現在のインスタンスを取得します。",
  {},
  async () => {
    try {
      const api = getVRChatAPI();
      await api.ensureLoggedIn();

      const favoriteFriends = await api.getFavoriteFriends();

      if (favoriteFriends.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "お気に入りのフレンドはいません。",
            },
          ],
        };
      }

      const statusList = favoriteFriends.map((friend) => {
        const status = friend.status || "offline";
        const statusDescription = friend.statusDescription || "";
        const location = friend.location || "offline";
        const instanceInfo = friend.instanceInfo;

        let locationText = "";
        if (location === "offline") {
          locationText = "オフライン";
        } else if (location === "private") {
          locationText = "プライベートワールド";
        } else if (instanceInfo) {
          locationText = `${instanceInfo.worldName || "Unknown World"} (${instanceInfo.instanceType || "unknown"})`;
          if (instanceInfo.userCount !== undefined) {
            locationText += ` [${instanceInfo.userCount}/${instanceInfo.capacity || "?"}人]`;
          }
        } else {
          locationText = location;
        }

        return {
          name: friend.displayName,
          status: status,
          statusDescription: statusDescription,
          location: locationText,
          platform: friend.platform || "unknown",
        };
      });

      const onlineFriends = statusList.filter(f => f.status !== "offline");
      const offlineFriends = statusList.filter(f => f.status === "offline");

      let resultText = `## お気に入りフレンドのオンライン状況\n\n`;
      resultText += `### オンライン (${onlineFriends.length}人)\n`;

      for (const friend of onlineFriends) {
        const statusEmoji = getStatusEmoji(friend.status);
        resultText += `- ${statusEmoji} **${friend.name}**\n`;
        if (friend.statusDescription) {
          resultText += `  - ステータス: ${friend.statusDescription}\n`;
        }
        resultText += `  - 場所: ${friend.location}\n`;
        resultText += `  - プラットフォーム: ${friend.platform}\n`;
      }

      resultText += `\n### オフライン (${offlineFriends.length}人)\n`;
      for (const friend of offlineFriends) {
        resultText += `- ⚫ ${friend.name}\n`;
      }

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `エラー: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// 特定のフレンドの詳細情報を取得
server.tool(
  "get_friend_details",
  "特定のフレンドの詳細情報を取得します。",
  {
    userId: z.string().describe("フレンドのユーザーID (usr_で始まる)"),
  },
  async ({ userId }) => {
    try {
      const api = getVRChatAPI();
      await api.ensureLoggedIn();

      const user = await api.getUser(userId);

      let resultText = `## ${user.displayName}の詳細情報\n\n`;
      resultText += `- **ユーザーID**: ${user.id}\n`;
      resultText += `- **ステータス**: ${getStatusEmoji(user.status)} ${user.status}\n`;
      if (user.statusDescription) {
        resultText += `- **ステータスメッセージ**: ${user.statusDescription}\n`;
      }
      resultText += `- **Bio**: ${user.bio || "なし"}\n`;
      resultText += `- **最終ログイン**: ${user.last_login || "不明"}\n`;

      if (user.location && user.location !== "offline" && user.location !== "private") {
        const instanceInfo = await api.getInstanceInfo(user.location);
        if (instanceInfo) {
          resultText += `\n### 現在のインスタンス\n`;
          resultText += `- **ワールド**: ${instanceInfo.worldName}\n`;
          resultText += `- **インスタンスタイプ**: ${instanceInfo.instanceType}\n`;
          resultText += `- **人数**: ${instanceInfo.userCount}/${instanceInfo.capacity}人\n`;
        }
      } else if (user.location === "private") {
        resultText += `\n### 現在のインスタンス\n- プライベートワールド\n`;
      } else {
        resultText += `\n### 現在のインスタンス\n- オフライン\n`;
      }

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `エラー: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// 全フレンドのオンライン一覧を取得
server.tool(
  "get_online_friends",
  "現在オンラインのフレンド一覧を取得します。",
  {},
  async () => {
    try {
      const api = getVRChatAPI();
      await api.ensureLoggedIn();

      const onlineFriends = await api.getOnlineFriends();

      if (onlineFriends.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "現在オンラインのフレンドはいません。",
            },
          ],
        };
      }

      let resultText = `## オンラインフレンド一覧 (${onlineFriends.length}人)\n\n`;

      for (const friend of onlineFriends) {
        const statusEmoji = getStatusEmoji(friend.status);
        resultText += `- ${statusEmoji} **${friend.displayName}**`;

        if (friend.location === "private") {
          resultText += ` - プライベートワールド`;
        } else if (friend.instanceInfo) {
          resultText += ` - ${friend.instanceInfo.worldName || "Unknown"}`;
        }
        resultText += `\n`;
      }

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `エラー: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// フレンドを検索（表記揺れ対応）
server.tool(
  "search_friend",
  "フレンドを名前で検索します。ニックネームや通称、表記揺れにも対応しています。見つからない場合はAIが推測し、結果を自動で別名登録します。推測が間違っていた場合は forceReInfer: true で再推論できます。",
  {
    query: z.string().describe("検索クエリ（名前、ニックネーム、通称など）"),
    useAI: z.boolean().optional().describe("見つからない場合にAIで推測するか（デフォルト: true）"),
    forceReInfer: z.boolean().optional().describe("前回のAI推測が間違っていた場合にtrueを指定すると、自動登録された別名を削除して再推論します"),
  },
  async ({ query, useAI = true, forceReInfer = false }) => {
    try {
      const api = getVRChatAPI();
      await api.ensureLoggedIn();

      // インデックスが古い場合は更新
      const lastUpdate = friendIndex.getLastUpdate();
      const needsUpdate = !lastUpdate || (Date.now() - lastUpdate.getTime()) > 5 * 60 * 1000;

      if (needsUpdate || friendIndex.getCount() === 0) {
        const allFriends = await api.getAllFriends();
        friendIndex.updateFriends(allFriends);
      }

      // forceReInfer: 自動登録された別名を消してAI再推論に回す
      if (forceReInfer) {
        friendIndex.removeAutoAlias(query);
      }

      // 検索実行
      const results = friendIndex.search(query);

      // 結果が見つからないか、スコアが低い場合はAIで推測
      const shouldUseAI = useAI && (results.length === 0 || (results.length > 0 && results[0].score < 0.8));

      if (shouldUseAI) {
        const gemini = getGeminiAPI();
        if (gemini) {
          const allFriends = friendIndex.getAllFriends();
          const aiGuess = await gemini.guessFriend(query, allFriends);

          if (aiGuess.found && aiGuess.userId) {
            let currentFriend;
            try {
              currentFriend = await api.getUser(aiGuess.userId);
            } catch {
              currentFriend = allFriends.find(f => f.id === aiGuess.userId);
            }

            if (currentFriend) {
              // AI推測結果を自動で別名登録
              friendIndex.addAlias(query, currentFriend.id, { auto: true });

              const statusEmoji = getStatusEmoji(currentFriend.status);
              let resultText = `## 「${query}」の検索結果 (AI推測)\n\n`;
              resultText += `🤖 **AIによる推測** (確信度: ${Math.round((aiGuess.confidence || 0.5) * 100)}%)\n`;
              resultText += `📝 この結果は自動で別名登録されました。間違っている場合は \`search_friend("${query}", forceReInfer: true)\` で再推論できます。\n\n`;

              resultText += `### ${statusEmoji} ${currentFriend.displayName}\n`;
              resultText += `- **ID**: ${currentFriend.id}\n`;
              resultText += `- **ステータス**: ${currentFriend.status || "offline"}`;
              if (currentFriend.statusDescription) {
                resultText += ` - ${currentFriend.statusDescription}`;
              }
              resultText += `\n`;

              if (!currentFriend.location || currentFriend.location === "offline") {
                resultText += `- **場所**: オフライン\n`;
              } else if (currentFriend.location === "private") {
                resultText += `- **場所**: プライベートワールド\n`;
              } else {
                const instanceInfo = await api.getInstanceInfo(currentFriend.location);
                if (instanceInfo) {
                  resultText += `- **場所**: ${instanceInfo.worldName} (${instanceInfo.instanceType}) [${instanceInfo.userCount || "?"}/${instanceInfo.capacity || "?"}人]\n`;
                } else {
                  resultText += `- **場所**: ${currentFriend.location}\n`;
                }
              }

              return {
                content: [
                  {
                    type: "text",
                    text: resultText,
                  },
                ],
              };
            }
          }
        }
      }

      if (results.length === 0) {
        let notFoundText = `「${query}」に一致するフレンドは見つかりませんでした。\n\n`;
        if (!getGeminiAPI()) {
          notFoundText += `💡 GEMINI_API_KEYを設定するとAIによる推測が有効になります。\n\n`;
        }
        notFoundText += `別名を追加するには add_friend_alias ツールを使用してください。`;

        return {
          content: [
            {
              type: "text",
              text: notFoundText,
            },
          ],
        };
      }

      // 上位の結果について詳細情報を取得
      const topResults = results.slice(0, 5);
      let resultText = `## 「${query}」の検索結果\n\n`;

      for (const friend of topResults) {
        let currentFriend;
        try {
          currentFriend = await api.getUser(friend.id);
        } catch {
          currentFriend = friend;
        }

        const statusEmoji = getStatusEmoji(currentFriend.status);
        const matchInfo = friend.matchType === "alias"
          ? `(別名「${friend.matchedAlias || query}」でマッチ)`
          : `(スコア: ${Math.round(friend.score * 100)}%)`;

        resultText += `### ${statusEmoji} ${currentFriend.displayName} ${matchInfo}\n`;
        resultText += `- **ID**: ${currentFriend.id}\n`;
        resultText += `- **ステータス**: ${currentFriend.status || "offline"}`;
        if (currentFriend.statusDescription) {
          resultText += ` - ${currentFriend.statusDescription}`;
        }
        resultText += `\n`;

        if (!currentFriend.location || currentFriend.location === "offline") {
          resultText += `- **場所**: オフライン\n`;
        } else if (currentFriend.location === "private") {
          resultText += `- **場所**: プライベートワールド\n`;
        } else {
          const instanceInfo = await api.getInstanceInfo(currentFriend.location);
          if (instanceInfo) {
            resultText += `- **場所**: ${instanceInfo.worldName} (${instanceInfo.instanceType}) [${instanceInfo.userCount || "?"}/${instanceInfo.capacity || "?"}人]\n`;
          } else {
            resultText += `- **場所**: ${currentFriend.location}\n`;
          }
        }

        const aliases = friendIndex.getAliasesForUser(friend.id);
        if (aliases.length > 0) {
          resultText += `- **登録済み別名**: ${aliases.join(", ")}\n`;
        }

        resultText += `\n`;
      }

      if (results.length > 5) {
        resultText += `\n*他${results.length - 5}件の候補があります*\n`;
      }

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `エラー: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// 別名を追加
server.tool(
  "add_friend_alias",
  "フレンドに別名（ニックネーム・通称）を追加します。追加した別名で検索できるようになります。",
  {
    userId: z.string().describe("フレンドのユーザーID (usr_で始まる)"),
    alias: z.string().describe("追加する別名（ニックネーム、通称など）"),
  },
  async ({ userId, alias }) => {
    try {
      const api = getVRChatAPI();
      await api.ensureLoggedIn();

      const user = await api.getUser(userId);

      friendIndex.addAlias(alias, userId);

      const allAliases = friendIndex.getAliasesForUser(userId);

      return {
        content: [
          {
            type: "text",
            text: `✅ 別名を追加しました\n\n- **ユーザー**: ${user.displayName}\n- **追加した別名**: ${alias}\n- **全ての別名**: ${allAliases.join(", ")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `エラー: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// 別名を削除
server.tool(
  "remove_friend_alias",
  "フレンドの別名を削除します。",
  {
    alias: z.string().describe("削除する別名"),
  },
  async ({ alias }) => {
    try {
      const deleted = friendIndex.removeAlias(alias);

      if (deleted) {
        return {
          content: [
            {
              type: "text",
              text: `✅ 別名「${alias}」を削除しました`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `❌ 別名「${alias}」は登録されていません`,
            },
          ],
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `エラー: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// フレンドインデックスを更新
server.tool(
  "refresh_friend_index",
  "フレンドリストのインデックスを更新します。新しいフレンドが追加された場合などに使用します。",
  {},
  async () => {
    try {
      const api = getVRChatAPI();
      await api.ensureLoggedIn();

      const allFriends = await api.getAllFriends();
      friendIndex.updateFriends(allFriends);

      return {
        content: [
          {
            type: "text",
            text: `✅ フレンドインデックスを更新しました\n\n- **登録フレンド数**: ${friendIndex.getCount()}人\n- **更新日時**: ${friendIndex.getLastUpdate().toLocaleString("ja-JP")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `エラー: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VRChat MCP Server (stdio) started");
}

main().catch(console.error);
