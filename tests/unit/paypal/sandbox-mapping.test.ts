import { describe, expect, it } from "vitest";
import { eventCodeToType, toPayPalError } from "@/server/paypal/sandbox";
import { PayPalError } from "@/server/paypal/types";

describe("sandbox error and event mapping", () => {
  it("prefers the specific PayPal issue code over the generic name", () => {
    const e = toPayPalError(
      {
        name: "UNPROCESSABLE_ENTITY",
        message: "The requested action could not be performed",
        debug_id: "abc123",
        details: [{ issue: "AUTHORIZATION_VOIDED", description: "Authorization has been voided." }],
      },
      422,
    );
    expect(e).toBeInstanceOf(PayPalError);
    expect(e.code).toBe("AUTHORIZATION_VOIDED");
    expect(e.message).toBe("Authorization has been voided.");
    expect(e.debugId).toBe("abc123");
    expect(e.retriable).toBe(false);
  });

  it("handles OAuth-style and empty error bodies", () => {
    expect(
      toPayPalError({ error: "invalid_client", error_description: "Client Authentication failed" }, 401).code,
    ).toBe("invalid_client");
    const e = toPayPalError(undefined, 503, "dbg");
    expect(e.code).toBe("HTTP_503");
    expect(e.debugId).toBe("dbg");
    expect(e.retriable).toBe(true);
  });

  it("maps transaction event codes", () => {
    expect(eventCodeToType("T0006")).toBe("capture");
    expect(eventCodeToType("T1107")).toBe("refund");
    expect(eventCodeToType("T1106")).toBe("authorization");
    expect(eventCodeToType("T0400")).toBe("payout");
    expect(eventCodeToType("T9999")).toBe("other");
    expect(eventCodeToType(undefined)).toBe("other");
  });
});
