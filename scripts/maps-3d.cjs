#!/usr/bin/env node
/**
 * All-maps 3D tool: renders every map (or the ones named) in the 3D look
 * through the dev-only module src/client/render3d/tools/MapPreviewPage.ts,
 * then
 *   --write   saves resources/maps/<map>/preview3d.webp (map picker image)
 *   always    checks each render (errors, shader failures, blank/black/
 *             washed-out images, missing land) and writes a report.
 *
 * Needs the dev server (`npm run dev`) and Playwright with Chromium
 * (`npx playwright install chromium` once, if not installed).
 *
 *   npm run maps:3d                       # check all maps
 *   npm run maps:3d -- --write            # check + regenerate previews
 *   npm run maps:3d -- --maps alps,world  # only these
 *   npm run maps:3d -- --base http://localhost:9000 --report out.json
 *
 * Exit code 1 when any map has a problem.
 */

const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

const ROOT = path.resolve(__dirname, "..");
const MAPS_DIR = path.join(ROOT, "resources", "maps");
const base = String(arg("base", "http://localhost:9000")).replace(/\/$/, "");
const write = arg("write", false) !== false;
const reportPath = path.resolve(
  String(arg("report", path.join(ROOT, "map-3d-report.json"))),
);
const only = arg("maps", null);
const maps = (
  only
    ? String(only).split(",")
    : fs
        .readdirSync(MAPS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
)
  .map((m) => m.trim().toLowerCase())
  .filter(Boolean)
  .sort();

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error(
    "Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium",
  );
  process.exit(2);
}

void (async () => {
  const browser = await chromium.launch({
    args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
  });
  const results = [];
  const started = Date.now();
  for (const [i, map] of maps.entries()) {
    const page = await browser.newPage({
      viewport: { width: 1220, height: 820 },
    });
    const consoleErrors = [];
    page.on("console", (m) => {
      if (
        m.type() === "error" ||
        /THREE\.WebGLProgram|GL_INVALID/.test(m.text())
      ) {
        consoleErrors.push(m.text().slice(0, 300));
      }
    });
    page.on("pageerror", (e) => consoleErrors.push(e.message.slice(0, 300)));
    let r;
    try {
      // Any same-origin page works; the map's own manifest is tiny.
      await page.goto(`${base}/maps/${encodeURIComponent(map)}/manifest.json`, {
        waitUntil: "load",
        timeout: 180000,
      });
      await page.evaluate((m) => (window.__mapPreviewMap = m), map);
      await page.addScriptTag({
        type: "module",
        url: "/src/client/render3d/tools/MapPreviewPage.ts",
      });
      await page.waitForFunction(
        () => window.__mapPreview !== undefined,
        null,
        {
          timeout: 300000,
        },
      );
      r = await page.evaluate(() => window.__mapPreview);
    } catch (e) {
      r = { ok: false, map, error: String(e.message ?? e).slice(0, 300) };
    }
    await page.close();

    const problems = [];
    if (!r.ok) problems.push(`render failed: ${r.error}`);
    else problems.push(...r.stats.problems);
    const glErrors = consoleErrors.filter((t) =>
      /THREE\.WebGLProgram|GL_INVALID|shader/i.test(t),
    );
    if (glErrors.length > 0) problems.push(`GL errors: ${glErrors[0]}`);

    let written = false;
    if (r.ok && write && problems.length === 0) {
      const b64 = r.dataUrl.replace(/^data:image\/webp;base64,/, "");
      if (r.dataUrl.startsWith("data:image/webp")) {
        fs.writeFileSync(
          path.join(MAPS_DIR, map, "preview3d.webp"),
          Buffer.from(b64, "base64"),
        );
        written = true;
      } else {
        problems.push("browser could not encode WebP");
      }
    }
    const entry = {
      map,
      ok: problems.length === 0,
      problems,
      ms: r.ok ? r.ms : null,
      size: r.ok ? `${r.width}x${r.height}` : null,
      stats: r.ok ? { ...r.stats, problems: undefined } : null,
      written,
    };
    results.push(entry);
    console.log(
      `[${i + 1}/${maps.length}] ${entry.ok ? "OK  " : "FAIL"} ${map}` +
        (entry.size ? ` ${entry.size} ${entry.ms}ms` : "") +
        (written ? " (preview written)" : "") +
        (problems.length ? ` — ${problems.join("; ")}` : ""),
    );
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  const report = {
    date: new Date().toISOString(),
    base,
    total: results.length,
    failed: failed.length,
    seconds: Math.round((Date.now() - started) / 1000),
    results,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `\n${results.length - failed.length}/${results.length} maps OK` +
      (failed.length
        ? `, ${failed.length} with problems: ${failed.map((f) => f.map).join(", ")}`
        : "") +
      `\nReport: ${path.relative(process.cwd(), reportPath)}`,
  );
  process.exit(failed.length ? 1 : 0);
})();
