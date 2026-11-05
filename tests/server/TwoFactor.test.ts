import { describe, expect, it } from "vitest";
import {
  adminTwoFactorRequired,
  base32Decode,
  base32Encode,
  issueTicket,
  newTotpSecret,
  otpauthUri,
  readTicket,
  TelegramCodes,
  totpCode,
  verifyTotp,
} from "../../src/server/selfhost/TwoFactor";

// RFC 6238 appendix B, SHA-1 key "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors (last 6 digits)", () => {
    expect(totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCode(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924");
    expect(totpCode(RFC_SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("base32 round-trips and ignores spaces/case", () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 77, 9]);
    const enc = base32Encode(buf);
    expect(base32Decode(enc).equals(buf)).toBe(true);
    expect(
      base32Decode(enc.toLowerCase().replace(/(.{4})/g, "$1 ")).equals(buf),
    ).toBe(true);
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("accepts the current and neighbouring steps only", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(
      true,
    );
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(
      true,
    );
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 3), now)).toBe(
      false,
    );
    expect(verifyTotp(RFC_SECRET, "abc", now)).toBe(false);
  });

  it("builds an otpauth link and reads the required setting", () => {
    expect(otpauthUri("ABCD", "boss")).toBe(
      "otpauth://totp/Laukolaroser%3Aboss?secret=ABCD&issuer=Laukolaroser&digits=6&period=30",
    );
    expect(adminTwoFactorRequired({ SELFHOST_ADMIN_2FA: "required" })).toBe(
      true,
    );
    expect(adminTwoFactorRequired({})).toBe(false);
  });
});

describe("second-step tickets", () => {
  const key = Buffer.alloc(32, 3);
  const data = { u: "boss", v: 2, d: "dev", n: "Phone" };

  it("round-trip, expire after 5 minutes, and reject tampering", () => {
    const t = issueTicket(data, key, 1000);
    expect(readTicket(t, key, 2000)).toMatchObject(data);
    expect(readTicket(t, key, 1000 + 5 * 60_000 + 1)).toBeNull();
    expect(readTicket(t, Buffer.alloc(32, 4), 2000)).toBeNull();
    const [body, sig] = t.split(".");
    const evil = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, "base64url").toString()),
        u: "x",
      }),
    ).toString("base64url");
    expect(readTicket(`${evil}.${sig}`, key, 2000)).toBeNull();
    expect(readTicket("junk", key, 2000)).toBeNull();
  });
});

describe("Telegram codes", () => {
  it("are single use and expire", () => {
    const codes = new TelegramCodes();
    const c = codes.issue("Boss", 0);
    expect(c).toMatch(/^\d{6}$/);
    expect(codes.check("boss", "999999x", 0)).toBe(false);
    expect(codes.check("boss", c, 1000)).toBe(true);
    expect(codes.check("boss", c, 1000)).toBe(false);
    const d = codes.issue("boss", 0);
    expect(codes.check("boss", d, 5 * 60_000 + 1)).toBe(false);
  });
});
