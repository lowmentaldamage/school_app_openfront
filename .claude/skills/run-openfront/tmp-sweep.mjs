import { launch, gotoHome, openSoloModal } from "./driver.mjs";
const [S, mode] = process.argv.slice(2);
const phone = mode === "phone";
const { browser, page: p } = await launch({ viewport: phone ? { width: 390, height: 844 } : { width: 1400, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_|cosmetics|html-load|WebSocket/i.test(m.text())) errs.push("console " + m.text().slice(0, 160)); });
const shot = async (n) => { await p.screenshot({ path: `${S}/sw-${mode}-${n}.png`, timeout: 180000 }); };
const safe = async (name, fn) => { try { await fn(); } catch (e) { errs.push(`${name}: ${String(e).split("\n")[0]}`); } };
await gotoHome(p);
await shot("01-home");
await safe("help", async () => {
  await p.locator('[data-page="page-help"]').first().click(); await p.waitForTimeout(1500); await shot("02-help");
  await gotoHome(p);
});
await safe("settings", async () => {
  await p.locator('[data-page="page-settings"], [data-page="page-user-setting"]').first().click(); await p.waitForTimeout(1500); await shot("03-settings");
  await gotoHome(p);
});
await safe("solo", async () => { await openSoloModal(p); await p.waitForTimeout(1500); await shot("04-solo"); });
await safe("solo-scroll", async () => { await p.mouse.wheel(0, 1600); await p.waitForTimeout(800); await shot("05-solo-options"); });
await safe("editor", async () => {
  await gotoHome(p);
  await p.getByRole("button", { name: /map editor/i }).first().click(); await p.waitForTimeout(2500); await shot("06-editor");
  await p.locator("map-editor header button", { hasText: "Upload" }).click(); await p.waitForTimeout(800); await shot("07-editor-upload");
  await p.locator("map-editor header button", { hasText: "Close" }).click(); await p.waitForTimeout(800);
});
await safe("game", async () => {
  await gotoHome(p);
  await openSoloModal(p);
  await p.getByRole("button", { name: /start game/i }).click();
  await p.waitForTimeout(20000);
  await shot("08-spawn");
  const vp = p.viewportSize();
  await p.mouse.click(vp.width * 0.45, vp.height * 0.5);
  await p.waitForTimeout(15000);
  await shot("09-ingame");
  await p.keyboard.press("KeyI"); await p.waitForTimeout(1200); await shot("10-research");
  await p.keyboard.press("Escape"); await p.waitForTimeout(800);
  await p.mouse.click(vp.width * 0.45, vp.height * 0.5, { button: "right" }); await p.waitForTimeout(1500); await shot("11-radial");
});
console.log("ERRS " + JSON.stringify(errs, null, 1));
await browser.close();
