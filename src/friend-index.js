import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALIAS_FILE = join(__dirname, "..", "friends-alias.json");
const CACHE_FILE = join(__dirname, "..", "friends-cache.json");

export class FriendIndex {
  constructor() {
    this.friends = new Map(); // userId -> friendData
    this.aliases = new Map(); // alias -> { userId, auto }
    this.lastUpdate = null;
    this.loadAliases();
    this.loadCache();
  }

  // 別名ファイルを読み込み
  loadAliases() {
    try {
      if (existsSync(ALIAS_FILE)) {
        const data = JSON.parse(readFileSync(ALIAS_FILE, "utf-8"));
        for (const [alias, value] of Object.entries(data)) {
          // Support legacy format (alias -> userId string) and new format (alias -> { userId, auto })
          if (typeof value === "string") {
            this.aliases.set(alias, { userId: value, auto: false });
          } else {
            this.aliases.set(alias, value);
          }
        }
      }
    } catch (e) {
      console.error("Failed to load aliases:", e.message);
    }
  }

  // 別名ファイルを保存
  saveAliases() {
    try {
      const data = Object.fromEntries(this.aliases);
      writeFileSync(ALIAS_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save aliases:", e.message);
    }
  }

  // キャッシュを読み込み
  loadCache() {
    try {
      if (existsSync(CACHE_FILE)) {
        const data = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
        this.friends = new Map(Object.entries(data.friends || {}));
        this.lastUpdate = data.lastUpdate ? new Date(data.lastUpdate) : null;
      }
    } catch (e) {
      console.error("Failed to load cache:", e.message);
    }
  }

  // キャッシュを保存
  saveCache() {
    try {
      const data = {
        friends: Object.fromEntries(this.friends),
        lastUpdate: new Date().toISOString(),
      };
      writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
      this.lastUpdate = new Date();
    } catch (e) {
      console.error("Failed to save cache:", e.message);
    }
  }

  // フレンドリストを更新
  updateFriends(friendList) {
    for (const friend of friendList) {
      this.friends.set(friend.id, {
        id: friend.id,
        displayName: friend.displayName,
        status: friend.status,
        statusDescription: friend.statusDescription,
        location: friend.location,
        platform: friend.platform,
        isFavorite: friend.isFavorite || false,
        lastSeen: new Date().toISOString(),
      });
    }
    this.saveCache();
  }

  // 別名を追加
  addAlias(alias, userId, { auto = false } = {}) {
    const normalizedAlias = this.normalize(alias);
    this.aliases.set(normalizedAlias, { userId, auto });
    this.saveAliases();
  }

  // 別名を削除
  removeAlias(alias) {
    const normalizedAlias = this.normalize(alias);
    const deleted = this.aliases.delete(normalizedAlias);
    if (deleted) {
      this.saveAliases();
    }
    return deleted;
  }

  // クエリに紐づく自動登録別名を削除
  removeAutoAlias(alias) {
    const normalizedAlias = this.normalize(alias);
    const entry = this.aliases.get(normalizedAlias);
    if (entry && entry.auto) {
      this.aliases.delete(normalizedAlias);
      this.saveAliases();
      return true;
    }
    return false;
  }

  // ユーザーの別名一覧を取得
  getAliasesForUser(userId) {
    const result = [];
    for (const [alias, entry] of this.aliases) {
      if (entry.userId === userId) {
        result.push(alias);
      }
    }
    return result;
  }

  // 文字列を正規化（検索用）
  normalize(str) {
    if (!str) return "";
    
    let normalized = str.toLowerCase();
    
    // カタカナをひらがなに変換
    normalized = normalized.replace(/[\u30A1-\u30F6]/g, (char) => {
      return String.fromCharCode(char.charCodeAt(0) - 0x60);
    });
    
    // 全角英数を半角に変換
    normalized = normalized.replace(/[\uFF01-\uFF5E]/g, (char) => {
      return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
    });
    
    // 特殊文字・記号を削除
    normalized = normalized.replace(/[_\-\s・．.。、,!！?？]/g, "");
    
    // アクセント記号を削除
    normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    return normalized;
  }

  // 類似度を計算（レーベンシュタイン距離ベース）
  similarity(str1, str2) {
    const s1 = this.normalize(str1);
    const s2 = this.normalize(str2);
    
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;
    
    // 部分一致チェック
    if (s1.includes(s2) || s2.includes(s1)) {
      const shorter = Math.min(s1.length, s2.length);
      const longer = Math.max(s1.length, s2.length);
      return shorter / longer * 0.9; // 部分一致は少し低めのスコア
    }
    
    // レーベンシュタイン距離
    const matrix = [];
    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s2.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    const distance = matrix[s1.length][s2.length];
    const maxLen = Math.max(s1.length, s2.length);
    return 1 - distance / maxLen;
  }

  // フレンドを検索
  search(query, threshold = 0.4) {
    const results = [];
    const normalizedQuery = this.normalize(query);
    
    // 1. 別名から完全一致を探す
    if (this.aliases.has(normalizedQuery)) {
      const entry = this.aliases.get(normalizedQuery);
      const friend = this.friends.get(entry.userId);
      if (friend) {
        results.push({ ...friend, matchType: "alias", autoAlias: entry.auto, score: 1.0 });
        return results; // 別名完全一致なら即返す
      }
    }

    // 2. 別名から部分一致・類似検索
    for (const [alias, entry] of this.aliases) {
      const score = this.similarity(query, alias);
      if (score >= threshold) {
        const friend = this.friends.get(entry.userId);
        if (friend && !results.find(r => r.id === entry.userId)) {
          results.push({ ...friend, matchType: "alias", matchedAlias: alias, autoAlias: entry.auto, score });
        }
      }
    }
    
    // 3. 表示名から検索
    for (const [userId, friend] of this.friends) {
      if (results.find(r => r.id === userId)) continue; // 既に追加済み
      
      const score = this.similarity(query, friend.displayName);
      if (score >= threshold) {
        results.push({ ...friend, matchType: "displayName", score });
      }
    }
    
    // スコア順にソート
    results.sort((a, b) => b.score - a.score);
    
    return results;
  }

  // 全フレンド取得
  getAllFriends() {
    return Array.from(this.friends.values());
  }

  // フレンド数を取得
  getCount() {
    return this.friends.size;
  }

  // 最終更新日時を取得
  getLastUpdate() {
    return this.lastUpdate;
  }
}

// シングルトンインスタンス
export const friendIndex = new FriendIndex();
