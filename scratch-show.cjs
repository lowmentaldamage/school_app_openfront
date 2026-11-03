const { chromium } = require("playwright");
const fs = require("fs");
const shots = { far: { zoom: 1 }, close: { zoom: 2.4 } };
(async () => {
  const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  for (const [name, o] of Object.entries(shots)) {
    const page = await browser.newPage({ viewport: { width: 1220, height: 820 } });
    const errs = [];
    page.on("console", (m) => { if (/THREE|GL_INVALID|shader|ERROR/i.test(m.text())) errs.push(m.text().slice(0, 600)); });
    await page.goto("http://localhost:9000/maps/europe/manifest.json");
    await page.evaluate((s) => { window.__showcase = s; }, o);
    await page.addScriptTag({ type: "module", url: "/src/client/render3d/tools/ModelShowcasePage.ts" });
    await page.waitForFunction(() => window.__showcaseResult !== undefined, null, { timeout: 300000 });
    const r = await page.evaluate(() => window.__showcaseResult);
    if (!r.ok) { console.log(name, "FAIL", r.error); continue; }
    fs.writeFileSync("/tmp/claude-0/-home-user-school-app-openfront/9bff1bc6-bfb3-5b75-8b32-7245f83be11d/scratchpad/mk-" + name + ".png", Buffer.from(r.dataUrl.split(",")[1], "base64"));
    console.log("DONE", name, errs.slice(0, 2).join(" | "));
    await page.close();
  }
  await browser.close();
})();
