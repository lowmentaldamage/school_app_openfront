import { afterEach, describe, expect, it } from "vitest";
import { ServerEnv } from "../../src/server/ServerEnv";

describe("ServerEnv.offline", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is on for self-hosted servers (private or public) and OFFLINE_API=1", () => {
    delete process.env.OFFLINE_API;
    delete process.env.SELF_HOSTED;
    expect(ServerEnv.offline()).toBe(false);
    process.env.SELF_HOSTED = "1";
    expect(ServerEnv.offline()).toBe(true);
    process.env.SELF_HOSTED = "0";
    expect(ServerEnv.offline()).toBe(true);
    delete process.env.SELF_HOSTED;
    process.env.OFFLINE_API = "1";
    expect(ServerEnv.offline()).toBe(true);
  });
});
