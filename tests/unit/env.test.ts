import { describe, expect, it } from "vitest";
import { deriveFeatures, parseEnv } from "@/server/env";

describe("env", () => {
  it("runs with zero configuration (all integrations offline)", () => {
    const env = parseEnv({});
    expect(env.PAYPAL_MODE).toBe("auto");
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(deriveFeatures(env)).toEqual({
      paypalLive: false,
      aiLive: false,
      channel3Live: false,
      agGridLicensed: false,
      postgres: false,
    });
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ ANTHROPIC_API_KEY: "  ", PAYPAL_CLIENT_ID: "" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(deriveFeatures(env).aiLive).toBe(false);
  });

  it("enables live integrations when keys are present", () => {
    const f = deriveFeatures(
      parseEnv({
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "secret",
        ANTHROPIC_API_KEY: "k",
        CHANNEL3_API_KEY: "c",
        DATABASE_URL: "postgres://x",
      }),
    );
    expect(f).toMatchObject({ paypalLive: true, aiLive: true, channel3Live: true, postgres: true });
  });

  it("PAYPAL_MODE=sim forces the simulator even with keys", () => {
    const f = deriveFeatures(
      parseEnv({ PAYPAL_MODE: "sim", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" }),
    );
    expect(f.paypalLive).toBe(false);
  });

  it("PAYPAL_MODE=sandbox without keys is a configuration error", () => {
    expect(() => deriveFeatures(parseEnv({ PAYPAL_MODE: "sandbox" }))).toThrow(/requires PAYPAL_CLIENT_ID/);
  });

  it("rejects invalid values with a readable message", () => {
    expect(() => parseEnv({ PAYPAL_MODE: "prod" })).toThrow(/PAYPAL_MODE/);
  });

  it("uses Render's public URL when APP_URL isn't set", () => {
    expect(parseEnv({ RENDER_EXTERNAL_URL: "https://leash.onrender.com" }).APP_URL).toBe(
      "https://leash.onrender.com",
    );
    expect(
      parseEnv({ APP_URL: "https://leash.example", RENDER_EXTERNAL_URL: "https://leash.onrender.com" })
        .APP_URL,
    ).toBe("https://leash.example");
  });
});
