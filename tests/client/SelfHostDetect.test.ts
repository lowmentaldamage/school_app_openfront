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
