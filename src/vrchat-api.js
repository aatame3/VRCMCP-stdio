import * as https from "https";
import * as crypto from "crypto";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Entry } from "@napi-rs/keyring";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGACY_AUTH_FILE = join(__dirname, "..", "auth-data.json");

const KEYRING_SERVICE = "vrcmcp";
const KEYRING_ACCOUNT = "auth-cookies";

const API_BASE = "https://api.vrchat.cloud/api/1";
const USER_AGENT = "VRCMCP/1.0.0";
// VRChat公開APIキー
const API_KEY = "JlE5Jldo5Jibnk5O5hTx6XVqsJu4WJ26";

export class VRChatAPI {
  constructor(username, password, totpSecret = null) {
    this.username = username;
    this.password = password;
    this.totpSecret = totpSecret;
    this.authCookie = null;
    this.twoFactorCookie = null;
    this.currentUser = null;
    this.isLoggedIn = false;
    this.keyring = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
    this.migrateLegacyAuthFile();
    this.loadCookies();
  }

  migrateLegacyAuthFile() {
    if (!existsSync(LEGACY_AUTH_FILE)) return;
    try {
      const data = JSON.parse(readFileSync(LEGACY_AUTH_FILE, "utf-8"));
      if (data.authCookie) {
        this.authCookie = data.authCookie;
        this.twoFactorCookie = data.twoFactorCookie || null;
        this.saveCookies();
      }
      unlinkSync(LEGACY_AUTH_FILE);
      console.error("Migrated auth-data.json to OS keyring");
    } catch (e) {
      console.error("Failed to migrate auth-data.json:", e.message);
    }
  }

  loadCookies() {
    try {
      const stored = this.keyring.getPassword();
      if (!stored) return;
      const data = JSON.parse(stored);
      this.authCookie = data.authCookie || null;
      this.twoFactorCookie = data.twoFactorCookie || null;
    } catch (e) {
      console.error("Failed to load auth cookies from keyring:", e.message);
    }
  }

  saveCookies() {
    try {
      this.keyring.setPassword(JSON.stringify({
        authCookie: this.authCookie,
        twoFactorCookie: this.twoFactorCookie,
        savedAt: new Date().toISOString(),
      }));
    } catch (e) {
      console.error("Failed to save auth cookies to keyring:", e.message);
    }
  }

  async request(method, path, body = null, additionalHeaders = {}) {
    return new Promise((resolve, reject) => {
      // APIキーをクエリパラメータに追加
      const url = new URL(API_BASE + path);
      if (!url.searchParams.has("apiKey")) {
        url.searchParams.set("apiKey", API_KEY);
      }
      
      const headers = {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        ...additionalHeaders,
      };

      // Cookie設定
      const cookies = [];
      if (this.authCookie) {
        cookies.push(`auth=${this.authCookie}`);
      }
      if (this.twoFactorCookie) {
        cookies.push(`twoFactorAuth=${this.twoFactorCookie}`);
      }
      if (cookies.length > 0) {
        headers["Cookie"] = cookies.join("; ");
      }

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: method,
        headers: headers,
      };

      const req = https.request(options, (res) => {
        let data = "";
        
        // Cookie取得
        const setCookies = res.headers["set-cookie"];
        if (setCookies) {
          for (const cookie of setCookies) {
            if (cookie.startsWith("auth=")) {
              this.authCookie = cookie.split(";")[0].split("=")[1];
            }
            if (cookie.startsWith("twoFactorAuth=")) {
              this.twoFactorCookie = cookie.split(";")[0].split("=")[1];
            }
          }
        }

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(json.error?.message || `HTTP ${res.statusCode}`));
            } else {
              resolve(json);
            }
          } catch (e) {
            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            } else {
              resolve(data);
            }
          }
        });
      });

      req.on("error", reject);

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  generateTOTP(secret) {
    // Base32デコード
    const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const cleanSecret = secret.replace(/\s/g, "").toUpperCase();
    let bits = "";
    for (const char of cleanSecret) {
      const val = base32Chars.indexOf(char);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    const key = Buffer.from(bytes);

    // TOTP生成
    const time = Math.floor(Date.now() / 1000 / 30);
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigInt64BE(BigInt(time));

    const hmac = crypto.createHmac("sha1", key);
    hmac.update(timeBuffer);
    const hash = hmac.digest();

    const offset = hash[hash.length - 1] & 0x0f;
    const code =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);

    return (code % 1000000).toString().padStart(6, "0");
  }

  async login(totpCode = null) {
    // Basic認証でログイン
    const authString = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    
    try {
      const result = await this.request("GET", "/auth/user", null, {
        Authorization: `Basic ${authString}`,
      });

      // 2FA確認
      if (result.requiresTwoFactorAuth) {
        const twoFactorTypes = result.requiresTwoFactorAuth;
        
        if (twoFactorTypes.includes("totp") || twoFactorTypes.includes("otp")) {
          let code = totpCode;
          
          // TOTPシークレットがある場合は自動生成
          if (!code && this.totpSecret) {
            code = this.generateTOTP(this.totpSecret);
          }
          
          if (!code) {
            throw new Error("2FA code required. Please provide totpCode parameter or set VRCHAT_TOTP_SECRET environment variable.");
          }

          // 2FA認証
          const twoFactorPath = twoFactorTypes.includes("totp") ? "/auth/twofactorauth/totp/verify" : "/auth/twofactorauth/otp/verify";
          await this.request("POST", twoFactorPath, { code });

          // 再度ユーザー情報取得
          const userResult = await this.request("GET", "/auth/user");
          this.currentUser = userResult;
          this.isLoggedIn = true;
          this.saveCookies();
          return userResult;
        } else {
          throw new Error(`Unsupported 2FA type: ${twoFactorTypes.join(", ")}`);
        }
      }

      this.currentUser = result;
      this.isLoggedIn = true;
      this.saveCookies();
      return result;
    } catch (error) {
      this.isLoggedIn = false;
      throw error;
    }
  }

  async ensureLoggedIn() {
    if (this.isLoggedIn) return;

    // 保存済み Cookie があれば有効性を確認
    if (this.authCookie) {
      try {
        const result = await this.request("GET", "/auth/user");
        if (result && result.id) {
          this.currentUser = result;
          this.isLoggedIn = true;
          return;
        }
      } catch {
        // Cookie 無効 → 通常ログインへ
      }
    }

    await this.login();
  }

  async getFavoriteFriends() {
    // お気に入りフレンドのIDを取得
    const favorites = await this.request("GET", "/favorites?type=friend&n=100");
    
    if (!favorites || favorites.length === 0) {
      return [];
    }

    const favoriteIds = new Set(favorites.map((f) => f.favoriteId));

    // オンラインフレンド一覧から取得（1リクエストで最大100人）
    const onlineFriends = await this.request("GET", "/auth/user/friends?offline=false&n=100");
    
    // お気に入りかつオンラインのフレンドをフィルタ
    const favoriteFriends = onlineFriends.filter(f => favoriteIds.has(f.id));
    
    // インスタンス情報を追加（ユニークなlocationのみ取得）
    const locationCache = new Map();
    for (const friend of favoriteFriends) {
      if (friend.location && friend.location !== "offline" && friend.location !== "private") {
        try {
          if (!locationCache.has(friend.location)) {
            locationCache.set(friend.location, await this.getInstanceInfo(friend.location));
          }
          friend.instanceInfo = locationCache.get(friend.location);
        } catch (e) {
          // インスタンス情報取得失敗は無視
        }
      }
    }

    return favoriteFriends;
  }

  async getOnlineFriends() {
    // オンラインフレンドを取得
    const friends = await this.request("GET", "/auth/user/friends?offline=false&n=100");
    
    // インスタンス情報を追加
    for (const friend of friends) {
      if (friend.location && friend.location !== "offline" && friend.location !== "private") {
        try {
          friend.instanceInfo = await this.getInstanceInfo(friend.location);
        } catch (e) {
          // インスタンス情報取得失敗は無視
        }
      }
    }

    return friends;
  }

  async getAllFriends() {
    // オンライン・オフライン両方のフレンドを取得
    const allFriends = [];
    
    // オンラインフレンド
    let offset = 0;
    const limit = 100;
    while (true) {
      const onlineFriends = await this.request("GET", `/auth/user/friends?offline=false&n=${limit}&offset=${offset}`);
      if (!onlineFriends || onlineFriends.length === 0) break;
      allFriends.push(...onlineFriends);
      if (onlineFriends.length < limit) break;
      offset += limit;
    }
    
    // オフラインフレンド
    offset = 0;
    while (true) {
      const offlineFriends = await this.request("GET", `/auth/user/friends?offline=true&n=${limit}&offset=${offset}`);
      if (!offlineFriends || offlineFriends.length === 0) break;
      allFriends.push(...offlineFriends);
      if (offlineFriends.length < limit) break;
      offset += limit;
    }
    
    return allFriends;
  }

  async getUser(userId) {
    return await this.request("GET", `/users/${userId}`);
  }

  async getInstanceInfo(location) {
    if (!location || location === "offline" || location === "private") {
      return null;
    }

    try {
      // location形式: wrld_xxx:12345~region(xx)
      const [worldId, instancePart] = location.split(":");
      if (!worldId || !instancePart) {
        return null;
      }

      const instanceId = instancePart.split("~")[0];
      
      // ワールド情報を取得
      const world = await this.request("GET", `/worlds/${worldId}`);
      
      // インスタンス情報を取得
      let instance = null;
      try {
        instance = await this.request("GET", `/instances/${worldId}:${instancePart}`);
      } catch (e) {
        // インスタンス情報取得失敗
      }

      // インスタンスタイプを判定
      let instanceType = "public";
      if (instancePart.includes("~hidden")) {
        instanceType = "friends+";
      } else if (instancePart.includes("~friends")) {
        instanceType = "friends";
      } else if (instancePart.includes("~private")) {
        instanceType = "invite";
      } else if (instancePart.includes("~group")) {
        instanceType = "group";
      }

      return {
        worldId: worldId,
        worldName: world.name,
        instanceId: instanceId,
        instanceType: instanceType,
        userCount: instance?.userCount || instance?.n_users,
        capacity: world.capacity,
        location: location,
      };
    } catch (e) {
      console.error(`Failed to get instance info: ${e.message}`);
      return null;
    }
  }
}
