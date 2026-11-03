import { PartialGameRecord } from "@laukolaroser/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { finalizeGameRecord } from "../../src/server/Archive";

// The deployment stamps finalizeGameRecord adds before upload. `site` groups
// blue and green under one key, which infra uses as the region for its
// public-lobby join-rate baselines.

const partial = {
  info: {},
  version: "v0.0.2",
  turns: [],
} as unknown as PartialGameRecord;

describe("finalizeGameRecord", () => {
  beforeEach(() => {
    vi.stubEnv("GIT_COMMIT", "bfd5563a11111111111111111111111111111111");
    vi.stubEnv("DOMAIN", "laukolaroser.com");
    vi.stubEnv("SUBDOMAIN", "blue");
    vi.stubEnv("GAME_HOST", "");
    vi.stubEnv("GAME_DOMAIN", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  test("records the site the server registered under", () => {
    vi.stubEnv("SITE_HOST", "laukolaroser.com");
    expect(finalizeGameRecord(partial)).toMatchObject({
      subdomain: "blue",
      domain: "laukolaroser.com",
      site: "laukolaroser.com",
    });
  });

  test("falls back to the server's own host without a site host", () => {
    vi.stubEnv("SITE_HOST", "");
    expect(finalizeGameRecord(partial).site).toBe("blue.laukolaroser.com");
  });

  test("omits the site under local dev", () => {
    vi.stubEnv("SITE_HOST", "");
    vi.stubEnv("SUBDOMAIN", "");
    expect(finalizeGameRecord(partial).site).toBeUndefined();
  });
});
