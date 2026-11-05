/**
 * Telegram admin bot for a private server: tells the admin about access
 * requests and locked accounts and lets them act from their phone.
 *
 * Set up (see docs/SelfHosting.md):
 *   TELEGRAM_BOT_TOKEN      token from @BotFather
 *   TELEGRAM_ADMIN_CHAT_ID  your chat id (comma-separate several); send
 *                           /start to the bot and it tells you yours
 *
 * Uses long polling (getUpdates), so it works on a home server behind a
 * router: no webhook, no open port. Only the listed chats can do anything;
 * everyone else only learns their own chat id.
 *
 * In the chat:
 *   - new request  → message with ✅ Approve / ❌ Reject buttons
 *   - locked login → message with 🔓 Unlock button
 *   /pending  requests waiting      /players  everyone
 *   /approve <name>  /reject <name>  /unlock <name>  /devices <name>
 *   /help
 */

import type { AccountStore, PublicAccount } from "./AccountStore";

export type TelegramApi = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

interface Update {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

export function telegramConfig(env = process.env): {
  token: string;
  adminChats: number[];
} | null {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) return null;
  const adminChats = (env.TELEGRAM_ADMIN_CHAT_ID ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n !== 0);
  return { token, adminChats };
}

/** The Bot API over fetch. */
export function httpTelegramApi(token: string): TelegramApi {
  return async (method, params) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(70_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: unknown };
    if (!json.ok) throw new Error(`telegram ${method} failed`);
    return json.result;
  };
}

const NAME = /^[A-Za-z0-9_.-]{1,64}$/;

function approveButtons(username: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `approve:${username}` },
        { text: "❌ Reject", callback_data: `reject:${username}` },
      ],
    ],
  };
}

function unlockButton(username: string) {
  return {
    inline_keyboard: [
      [{ text: "🔓 Unlock", callback_data: `unlock:${username}` }],
    ],
  };
}

const HELP = [
  "Laukolaroser admin bot",
  "/pending – access requests waiting",
  "/players – all players",
  "/approve <name> · /reject <name>",
  "/unlock <name> – after 10 wrong passwords",
  "/devices <name> – free their device slots",
].join("\n");

export class TelegramAdmin {
  private offset = 0;
  private stopped = false;

  constructor(
    private readonly api: TelegramApi,
    private readonly store: AccountStore,
    private readonly adminChats: readonly number[],
    private readonly log: (msg: string) => void = () => {},
  ) {}

  private isAdmin(chat: number): boolean {
    return this.adminChats.includes(chat);
  }

  private async sendAll(text: string, markup?: unknown): Promise<void> {
    for (const chat of this.adminChats) {
      try {
        await this.api("sendMessage", {
          chat_id: chat,
          text,
          ...(markup ? { reply_markup: markup } : {}),
        });
      } catch (e) {
        this.log(`telegram: could not message ${chat}: ${String(e)}`);
      }
    }
  }

  /** A player asked for access. */
  notifyRequest(username: string): Promise<void> {
    return this.sendAll(
      `🆕 Access request: ${username}`,
      approveButtons(username),
    );
  }

  /** A one-time admin sign-in code (two-step sign-in backup). */
  sendLoginCode(username: string, code: string): Promise<void> {
    return this.sendAll(
      `🔐 Sign-in code for ${username}: ${code}\nValid 5 minutes. If this was not you, change your password.`,
    );
  }

  /** An account locked after too many wrong passwords. */
  notifyLocked(username: string): Promise<void> {
    return this.sendAll(
      `🔒 ${username} is locked after too many wrong passwords.`,
      unlockButton(username),
    );
  }

  /** Handle one update (message or button press). */
  async handle(u: Update): Promise<void> {
    if (u.callback_query) {
      const q = u.callback_query;
      const chat = q.message?.chat.id ?? 0;
      if (!this.isAdmin(chat)) {
        await this.api("answerCallbackQuery", {
          callback_query_id: q.id,
          text: "Not allowed",
        });
        return;
      }
      const [action, name] = (q.data ?? "").split(":");
      const result = this.act(action, name ?? "");
      await this.api("answerCallbackQuery", {
        callback_query_id: q.id,
        text: result,
      });
      if (q.message) {
        await this.api("editMessageText", {
          chat_id: chat,
          message_id: q.message.message_id,
          text: result,
        });
      }
      return;
    }
    const msg = u.message;
    if (!msg?.text) return;
    const chat = msg.chat.id;
    const [cmd, arg = ""] = msg.text.trim().split(/\s+/, 2);
    const command = cmd.toLowerCase().replace(/@.*$/, "");
    if (!this.isAdmin(chat)) {
      if (command === "/start" || command === "/id") {
        await this.api("sendMessage", {
          chat_id: chat,
          text: `Your chat id is ${chat}. Put it in TELEGRAM_ADMIN_CHAT_ID on the server and restart it.`,
        });
      }
      return;
    }
    const reply = (text: string, markup?: unknown) =>
      this.api("sendMessage", {
        chat_id: chat,
        text,
        ...(markup ? { reply_markup: markup } : {}),
      });
    switch (command) {
      case "/start":
      case "/help":
        await reply(HELP);
        return;
      case "/pending": {
        const pending = this.store.list().filter((a) => a.pending);
        if (pending.length === 0) {
          await reply("No requests waiting.");
          return;
        }
        for (const a of pending) {
          await reply(`🆕 ${a.username}`, approveButtons(a.username));
        }
        return;
      }
      case "/players":
        await reply(playersText(this.store.list()));
        return;
      case "/approve":
      case "/reject":
      case "/unlock":
      case "/devices":
        await reply(this.act(command.slice(1), arg));
        return;
      default:
        await reply(HELP);
    }
  }

  /** Run an admin action; returns the text to show. */
  act(action: string, username: string): string {
    if (!NAME.test(username)) return "Give a player name.";
    const a = this.store.find(username);
    if (!a) return `No player called ${username}.`;
    try {
      switch (action) {
        case "approve":
          if (!a.pending) return `${a.username} is already approved.`;
          this.store.approve(a.username);
          return `✅ ${a.username} approved: they can log in now.`;
        case "reject":
          if (!a.pending) {
            return `${a.username} is not a request (use the in-game panel to remove players).`;
          }
          this.store.remove(a.username);
          return `❌ ${a.username}'s request was rejected.`;
        case "unlock":
          this.store.unlock(a.username);
          return `🔓 ${a.username} is unlocked.`;
        case "devices":
          this.store.removeDevice(a.username, null);
          return `📱 ${a.username}'s device slots are free again.`;
        default:
          return HELP;
      }
    } catch (e) {
      return `Could not do that: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** One long-poll round; returns how many updates were handled. */
  async pollOnce(timeoutSec = 50): Promise<number> {
    const updates = (await this.api("getUpdates", {
      offset: this.offset,
      timeout: timeoutSec,
      allowed_updates: ["message", "callback_query"],
    })) as Update[];
    for (const u of updates) {
      this.offset = Math.max(this.offset, u.update_id + 1);
      try {
        await this.handle(u);
      } catch (e) {
        this.log(`telegram: update failed: ${String(e)}`);
      }
    }
    return updates.length;
  }

  /** Poll until stop(); backs off when Telegram is unreachable. */
  async run(): Promise<void> {
    let wait = 1000;
    while (!this.stopped) {
      try {
        await this.pollOnce();
        wait = 1000;
      } catch (e) {
        this.log(`telegram: ${String(e)}; retrying`);
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(60_000, wait * 2);
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }
}

function playersText(list: PublicAccount[]): string {
  if (list.length === 0) return "No players yet.";
  return list
    .map((a) => {
      const tags = [
        a.role === "admin" ? "admin" : "",
        a.pending ? "waiting" : "",
        a.disabled && !a.pending ? "disabled" : "",
        a.locked ? "locked" : "",
      ].filter(Boolean);
      return `• ${a.username}${tags.length ? ` (${tags.join(", ")})` : ""}`;
    })
    .join("\n");
}

let instance: TelegramAdmin | null = null;

/** The running bot, if configured (master process only). */
export function telegramAdmin(): TelegramAdmin | null {
  return instance;
}

/** Start the bot when TELEGRAM_BOT_TOKEN is set. */
export function startTelegramAdmin(
  store: AccountStore,
  log: (msg: string) => void,
): TelegramAdmin | null {
  const cfg = telegramConfig();
  if (!cfg) return null;
  const bot = new TelegramAdmin(
    httpTelegramApi(cfg.token),
    store,
    cfg.adminChats,
    log,
  );
  instance = bot;
  if (cfg.adminChats.length === 0) {
    log(
      "telegram: no TELEGRAM_ADMIN_CHAT_ID yet; send /start to your bot to get it",
    );
  }
  void bot.run();
  return bot;
}
