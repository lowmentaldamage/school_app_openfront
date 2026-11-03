/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";

// siteOrigin() names the WEBSITE a page belongs to, for links that leave the
// game (the desktop shell opening account settings in a browser). A
// server-rendered web page carries BOTH serverHost (one deployment,
// blue.laukolaroser.com) and siteHost (the apex it was rendered behind), and only
// the second is a site; the desktop shell injects serverHost alone, and there
// it is the site.
function setBootstrapConfig(
  overrides: { serverHost?: string; siteHost?: string } = {},
) {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "laukolaroser.com",
    instanceId: "d",
    gitCommit: "t",
    ...overrides,
  };
  ClientEnv.reset();
}

afterEach(() => {
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
});

describe("ClientEnv.siteOrigin", () => {
  it("prefers the apex over the deployment host on a server-rendered page", () => {
    setBootstrapConfig({
      serverHost: "blue.laukolaroser.com",
      siteHost: "laukolaroser.com",
    });
    expect(ClientEnv.siteOrigin()).toBe("https://laukolaroser.com");
  });

  it("falls back to serverHost, which is the site on the desktop shell", () => {
    setBootstrapConfig({ serverHost: "nightly.laukolaroser.dev" });
    expect(ClientEnv.siteOrigin()).toBe("https://nightly.laukolaroser.dev");
  });

  it("is undefined when the page names no site at all", () => {
    setBootstrapConfig();
    expect(ClientEnv.siteOrigin()).toBeUndefined();
  });
});
