import { afterEach, describe, expect, it, vi } from "vitest";

async function load(body: unknown, ok = true) {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body })),
  );
  const mod = await import("../../src/client/selfhost/SelfHostSession");
  await mod.detectSelfHost();
  return mod;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("own-server detection", () => {
  it("private mode: self-hosted and own server", async () => {
    const m = await load({ enabled: true, ownServer: true });
    expect(m.isSelfHosted()).toBe(true);
    expect(m.isOwnServer()).toBe(true);
  });

  it("public mode: no accounts, but still an own server", async () => {
    const m = await load({ enabled: false, ownServer: true });
    expect(m.isSelfHosted()).toBe(false);
    expect(m.isOwnServer()).toBe(true);
  });

  it("no status endpoint: neither", async () => {
    const m = await load({}, false);
    expect(m.isSelfHosted()).toBe(false);
    expect(m.isOwnServer()).toBe(false);
  });
});

describe("self-host device id and synced settings", () => {
  test("device id is stable and well formed; names are readable", async () => {
    const m = await import("../../src/client/selfhost/SelfHostSession");
    const a = m.deviceId();
    expect(a).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(m.deviceId()).toBe(a);
    expect(
      m.deviceName("Mozilla/5.0 (Linux; Android 14) Mobile LaukolaroserApp"),
    ).toBe("Android phone (app)");
    expect(m.deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "Windows PC",
    );
  });

  test("graphics settings stay on the device; the rest syncs", async () => {
    const m = await import("../../src/client/selfhost/SelfHostSession");
    expect(m.isSyncedSettingKey("settings.darkMode")).toBe(true);
    expect(m.isSyncedSettingKey("settings.dayNightCycle")).toBe(true);
    expect(m.isSyncedSettingKey("settings.graphicsOverrides")).toBe(false);
    expect(m.isSyncedSettingKey("laukolaroser.session")).toBe(false);
  });
});
