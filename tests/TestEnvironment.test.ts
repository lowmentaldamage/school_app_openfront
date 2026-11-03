// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

// Guards the test environment itself. Node 25 turned Web Storage on by default,
// where `localStorage` is a built-in global that evaluates to undefined unless
// --localstorage-file is passed, and it shadows the jsdom localStorage vitest
// installs. Without the --no-experimental-webstorage execArgv in vite.config.ts
// every test that touches UserSettings fails with "Cannot read properties of
// undefined (reading 'getItem')" -- hundreds of confusing failures instead of
// one clear one. This test is that one clear failure.
describe("test environment", () => {
  it("provides a working jsdom localStorage", () => {
    expect(typeof localStorage).toBe("object");

    localStorage.setItem("laukolaroser-test-probe", "value");
    expect(localStorage.getItem("laukolaroser-test-probe")).toBe("value");
    localStorage.removeItem("laukolaroser-test-probe");
    expect(localStorage.getItem("laukolaroser-test-probe")).toBeNull();
  });

  it("provides a working jsdom sessionStorage", () => {
    expect(typeof sessionStorage).toBe("object");

    sessionStorage.setItem("laukolaroser-test-probe", "value");
    expect(sessionStorage.getItem("laukolaroser-test-probe")).toBe("value");
    sessionStorage.removeItem("laukolaroser-test-probe");
    expect(sessionStorage.getItem("laukolaroser-test-probe")).toBeNull();
  });
});
