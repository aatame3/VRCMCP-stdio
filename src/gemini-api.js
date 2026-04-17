import https from "https";

const GEMINI_API_BASE = "generativelanguage.googleapis.com";

export class GeminiAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async request(prompt) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        },
      });

      const options = {
        hostname: GEMINI_API_BASE,
        port: 443,
        path: `/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.apiKey}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            if (json.error) {
              reject(new Error(json.error.message));
            } else if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
              resolve(json.candidates[0].content.parts[0].text);
            } else {
              reject(new Error("No response from Gemini"));
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      });

      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }

  async guessFriend(query, friendList) {
    // トークン節約: displayNameとIDの下6文字だけ渡す
    const friendListText = friendList
      .map((f) => `${f.displayName}:${f.id.slice(-6)}`)
      .join("\n");

    const prompt = `あなたはVRChatのフレンド検索アシスタントです。
ユーザーが入力した検索クエリから、最も該当しそうなフレンドを1人特定してください。

検索クエリ: 「${query}」

以下を考慮して推測してください:
- ニックネーム・通称・愛称（例: 「ホゲホゲ」→「Hogehoge_official」）
- 読み方・発音（例: 「ふが」→「Fu ga」）
- 略称（例: 「ぴよ」→「ぴよぴよ☆」）
- 表記揺れ（ひらがな/カタカナ/ローマ字）
- 名前の一部分での検索

フレンドリスト（名前:ID末尾6桁）:
${friendListText}

回答はJSON形式のみで、説明不要:
見つかった場合: {"id":"ID末尾6桁","name":"フレンド名"}
見つからない場合: {"id":null}`;

    const response = await this.request(prompt);
    
    // JSONを抽出
    let jsonStr = response.trim();
    
    // マークダウンのコードブロックを除去
    if (jsonStr.includes("```")) {
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        jsonStr = match[1].trim();
      }
    }
    
    // JSON部分だけを抽出
    const jsonMatch = jsonStr.match(/\{[^}]+\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    try {
      const result = JSON.parse(jsonStr);
      
      if (result.id) {
        // ID末尾から完全なuserIdを復元
        const friend = friendList.find(f => f.id.endsWith(result.id));
        if (friend) {
          return {
            found: true,
            userId: friend.id,
            displayName: friend.displayName,
            confidence: result.confidence || 0.8,
          };
        }
      }
      return { found: false };
    } catch (e) {
      // フォールバック: 正規表現で抽出
      const idMatch = jsonStr.match(/"id"\s*:\s*"([a-f0-9]{6})"/);
      const nameMatch = jsonStr.match(/"name"\s*:\s*"([^"]+)"/);
      
      if (idMatch) {
        const friend = friendList.find(f => f.id.endsWith(idMatch[1]));
        if (friend) {
          return {
            found: true,
            userId: friend.id,
            displayName: friend.displayName,
            confidence: 0.7,
          };
        }
      }
      
      console.error("Failed to parse Gemini response:", response);
      return { found: false };
    }
  }
}

let geminiInstance = null;

export function getGeminiAPI() {
  if (!geminiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return null;
    }
    geminiInstance = new GeminiAPI(apiKey);
  }
  return geminiInstance;
}
