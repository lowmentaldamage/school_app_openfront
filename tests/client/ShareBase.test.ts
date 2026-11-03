import { describe, expect, it, vi } from "vitest";
import {
  ClientEnv,
  deriveShareBase,
  deriveShareOrigin,
} from "../../src/client/ClientEnv";
import { playerProfileUrl } from "../../src/client/utilities/PlayerProfileUrl";

// These two answer "where should a link that LEAVES this client point?" — the
// lobby invite a host copies, the game link in a history row, the profile link
// a player sends a friend, the domain the magic-link email comes back to.
//
// On the web the answer is the document itself. The case they exist for is the
// desktop shell, which serves the renderer from `app://laukolaroser/index.html`:
// a link built from window.location there resolves nowhere outside that one
// Electron app, and is not even a link the desktop client's own friends box
// will take back (it only unwraps http(s) URLs).

/** What ClientEnv reads out of BOOTSTRAP_CONFIG, as the helpers take it. */
function bootstrap(siteOrigin?: string, jwtAudience = "laukolaroser.com") {
  return () => ({ siteOrigin, jwtAudience });
}

/** A bootstrap that fails the test if the helper reads it at all. */
const forbidden = () => {
  throw new Error("BOOTSTRAP_CONFIG must not be required on the web path");
};

describe("deriveShareOrigin", () => {
  describe("web build: the document's own origin is shareable", () => {
    it("uses the document origin on https", () => {
      expect(
        deriveShareOrigin(bootstrap(), "https:", "https://laukolaroser.com"),
      ).toBe("https://laukolaroser.com");
    });

    it("keeps the port on local dev over http", () => {
      expect(
        deriveShareOrigin(bootstrap(), "http:", "http://localhost:9000"),
      ).toBe("http://localhost:9000");
    });

    it("never reads BOOTSTRAP_CONFIG on the web path", () => {
      // A plain web page — and a jsdom test rendering a copy button — must not
      // start requiring the bootstrap just to build a link to itself.
      expect(
        deriveShareOrigin(forbidden, "https:", "https://laukolaroser.com"),
      ).toBe("https://laukolaroser.com");
    });

    it("ignores an injected site host while the document is already on the web", () => {
      // A desktop build pointed at a dev server (LAUKOLAROSER_DEV_URL) loads over
      // http; its own origin is shareable, so nothing should redirect it.
      expect(
        deriveShareOrigin(
          bootstrap("https://laukolaroser.com"),
          "http:",
          "http://localhost:9000",
        ),
      ).toBe("http://localhost:9000");
    });
  });

  describe("desktop shell: app:// is not a shareable origin", () => {
    it("targets the injected site host over TLS", () => {
      expect(
        deriveShareOrigin(
          bootstrap("https://laukolaroser.com"),
          "app:",
          "app://laukolaroser",
        ),
      ).toBe("https://laukolaroser.com");
    });

    it("targets a staging deployment when that is what the build talks to", () => {
      expect(
        deriveShareOrigin(
          bootstrap("https://nightly.laukolaroser.dev", "laukolaroser.dev"),
          "app:",
          "app://laukolaroser",
        ),
      ).toBe("https://nightly.laukolaroser.dev");
    });

    it("never leaks the app:// origin", () => {
      expect(
        deriveShareOrigin(
          bootstrap("https://laukolaroser.com"),
          "app:",
          "app://laukolaroser",
        ),
      ).not.toContain("app:");
    });

    describe("a shell that injects no site host falls back to the audience", () => {
      it("uses the audience host over TLS", () => {
        expect(
          deriveShareOrigin(
            bootstrap(undefined, "laukolaroser.com"),
            "app:",
            "app://laukolaroser",
          ),
        ).toBe("https://laukolaroser.com");
      });

      it("keeps the localhost website on its dev port and scheme", () => {
        expect(
          deriveShareOrigin(
            bootstrap(undefined, "localhost"),
            "app:",
            "app://laukolaroser",
          ),
        ).toBe("http://localhost:9000");
      });
    });
  });
});

describe("deriveShareBase", () => {
  it("keeps the current path on the web, so a link copied from /c/CODE stays there", () => {
    expect(
      deriveShareBase(
        bootstrap(),
        "https:",
        "https://laukolaroser.com",
        "/c/abc",
      ),
    ).toBe("https://laukolaroser.com/c/abc");
  });

  it("drops the shell's local index.html path on desktop", () => {
    // The reported bug: the Steam build copied
    // app://laukolaroser/index.html#modal=profile&publicID=…
    const base = deriveShareBase(
      bootstrap("https://laukolaroser.com"),
      "app:",
      "app://laukolaroser",
      "/index.html",
    );
    expect(base).toBe("https://laukolaroser.com/");
    expect(base).not.toContain("index.html");
  });
});

describe("playerProfileUrl", () => {
  it("is the site's /player/<id> path off the share origin, not off window.location", () => {
    const shareOrigin = vi
      .spyOn(ClientEnv, "shareOrigin")
      .mockReturnValue("https://laukolaroser.com");
    try {
      expect(playerProfileUrl("aB3dE5fX")).toBe(
        "https://laukolaroser.com/player/aB3dE5fX",
      );
      expect(playerProfileUrl("a+b")).toBe(
        "https://laukolaroser.com/player/a%2Bb",
      );
    } finally {
      shareOrigin.mockRestore();
    }
  });

  it("drops the page's own path (a link copied from /c/CODE is still the profile)", () => {
    history.replaceState(null, "", "/c/abc");
    try {
      expect(playerProfileUrl("aB3dE5fX")).toBe(
        `${window.location.origin}/player/aB3dE5fX`,
      );
    } finally {
      history.replaceState(null, "", "/");
    }
  });
});
