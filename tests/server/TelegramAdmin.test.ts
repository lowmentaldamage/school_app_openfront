import fs from "fs";
import os from "os";
import path from "path";
import { AccountStore } from "../../src/server/selfhost/AccountStore";
import {
  TelegramAdmin,
  telegramConfig,
} from "../../src/server/selfhost/TelegramAdmin";

const ADMIN = 4242;
const STRANGER = 777;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-admin-"));
  const store = AccountStore.inDir(dir);
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let updates: unknown[] = [];
  const api = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === "getUpdates") {
      const u = updates;
      updates = [];
      return u;
    }
    return true;
  };
  const bot = new TelegramAdmin(api, store, [ADMIN]);
  return {
    store,
    bot,
    calls,
    queue: (u: unknown[]) => (updates = u),
    sent: () => calls.filter((c) => c.method === "sendMessage"),
  };
}

describe("Telegram admin bot", () => {
  test("config reads the token and admin chat ids", () => {
    expect(telegramConfig({})).toBeNull();
    expect(
      telegramConfig({
        TELEGRAM_BOT_TOKEN: "123:abc",
        TELEGRAM_ADMIN_CHAT_ID: "4242, 99",
      }),
    ).toEqual({ token: "123:abc", adminChats: [4242, 99] });
  });

  test("an access request reaches the admin with Approve / Reject buttons", async () => {
    const t = setup();
    await t.bot.notifyRequest("luka");
    const m = t.sent()[0].params;
    expect(m.chat_id).toBe(ADMIN);
    expect(String(m.text)).toContain("luka");
    const kb = (
      m.reply_markup as { inline_keyboard: { callback_data: string }[][] }
    ).inline_keyboard[0].map((b) => b.callback_data);
    expect(kb).toEqual(["approve:luka", "reject:luka"]);
  });

  test("the Approve button approves; a stranger's press does nothing", async () => {
    const t = setup();
    t.store.request("luka", "secret123");
    t.queue([
      {
        update_id: 1,
        callback_query: {
          id: "q1",
          data: "approve:luka",
          message: { chat: { id: STRANGER }, message_id: 5 },
        },
      },
    ]);
    await t.bot.pollOnce(0);
    expect(t.store.find("luka")?.pending).toBe(true);
    t.queue([
      {
        update_id: 2,
        callback_query: {
          id: "q2",
          data: "approve:luka",
          message: { chat: { id: ADMIN }, message_id: 6 },
        },
      },
    ]);
    await t.bot.pollOnce(0);
    expect(t.store.find("luka")?.pending).toBe(false);
    expect(t.store.find("luka")?.disabled).toBe(false);
    const edit = t.calls.find((c) => c.method === "editMessageText");
    expect(String(edit?.params.text)).toContain("approved");
  });

  test("reject removes a request but never an approved player", () => {
    const t = setup();
    t.store.request("ana", "secret123");
    expect(t.bot.act("reject", "ana")).toContain("rejected");
    expect(t.store.find("ana")).toBeUndefined();
    t.store.create("boss", "secret123", "admin");
    expect(t.bot.act("reject", "boss")).toContain("not a request");
    expect(t.store.find("boss")).toBeDefined();
  });

  test("commands: /pending, /unlock, /players; strangers only get their chat id", async () => {
    const t = setup();
    t.store.request("ana", "secret123");
    t.store.create("mark", "secret123", "player");
    for (let i = 0; i < 10; i++) t.store.login("mark", "wrong");
    expect(t.store.find("mark")?.locked).toBe(true);
    t.queue([
      { update_id: 3, message: { chat: { id: ADMIN }, text: "/pending" } },
      { update_id: 4, message: { chat: { id: ADMIN }, text: "/unlock mark" } },
      { update_id: 5, message: { chat: { id: ADMIN }, text: "/players" } },
      { update_id: 6, message: { chat: { id: STRANGER }, text: "/start" } },
      {
        update_id: 7,
        message: { chat: { id: STRANGER }, text: "/approve ana" },
      },
    ]);
    await t.bot.pollOnce(0);
    expect(t.store.find("mark")?.locked).toBe(false);
    expect(t.store.find("ana")?.pending).toBe(true);
    const texts = t.sent().map((c) => `${c.params.chat_id}: ${c.params.text}`);
    expect(texts.some((x) => x.startsWith(`${ADMIN}: 🆕 ana`))).toBe(true);
    expect(texts.some((x) => x.includes("mark is unlocked"))).toBe(true);
    expect(texts.some((x) => x.includes("• ana (waiting)"))).toBe(true);
    expect(texts.filter((x) => x.startsWith(`${STRANGER}:`))).toEqual([
      `${STRANGER}: Your chat id is ${STRANGER}. Put it in TELEGRAM_ADMIN_CHAT_ID on the server and restart it.`,
    ]);
    // The next poll continues after the handled updates.
    await t.bot.pollOnce(0);
    const polls = t.calls.filter((c) => c.method === "getUpdates");
    const last = polls[polls.length - 1];
    expect(last?.params.offset).toBe(8);
  });
});
