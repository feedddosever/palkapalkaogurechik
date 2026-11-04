import { afterEach, describe, expect, it, vi } from "vitest";
import { Channel3Error, FixtureChannel3, LiveChannel3 } from "@/server/catalog/channel3";

afterEach(() => vi.unstubAllGlobals());

describe("fixture Channel3", () => {
  const c3 = new FixtureChannel3();

  it("matches close queries and returns the v1 response shape", async () => {
    const res = await c3.search({ query: "barista oat milk 32oz 6-pack" });
    expect(res.next_page_token).toBeNull();
    expect(res.products.length).toBeGreaterThanOrEqual(5);
    const p = res.products[0];
    expect(p).toMatchObject({
      id: expect.stringMatching(/^c3fx_/),
      title: expect.any(String),
      brands: [expect.objectContaining({ name: expect.any(String) })],
    });
    expect(p.offers[0]).toMatchObject({
      domain: expect.any(String),
      availability: "InStock",
      price: { currency: "USD" },
    });
    expect(p.category?.path.at(-1)?.title).toBe("Milk Substitutes");
  });

  it("returns nothing for unrelated queries and honours price filters", async () => {
    expect((await c3.search({ query: "snowboard" })).products).toEqual([]);
    const cheap = await c3.search({
      query: "espresso coffee beans 5 lb",
      filters: { price: { max_price: 44 } },
    });
    expect(cheap.products.every((p) => p.offers[0].price.price <= 44)).toBe(true);
  });

  it("looks products up by id", async () => {
    expect((await c3.getProduct("c3fx_giftcard_1"))?.category?.title).toBe("Gift Cards");
    expect(await c3.getProduct("nope")).toBeNull();
  });
});

describe("live Channel3 client", () => {
  it("POSTs /v1/search with x-api-key, US/USD config and in-stock new filters; caches", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ products: [], next_page_token: null }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const c3 = new LiveChannel3("test-key");
    await c3.search({ query: "oat milk", limit: 50 });
    await c3.search({ query: "oat milk", limit: 50 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.trychannel3.com/v1/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body as string)).toEqual({
      query: "oat milk",
      limit: 30,
      filters: { availability: ["InStock"], conditions: ["new"] },
      config: { country: "US", currency: "USD", mode: "default" },
    });
  });

  it("maps 404 product lookups to null and other failures to Channel3Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Product not found", { status: 404 })),
    );
    expect(await new LiveChannel3("k").getProduct("p1")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("You have used all of your free credits.", { status: 402 })),
    );
    await expect(new LiveChannel3("k").search({ query: "x" })).rejects.toBeInstanceOf(Channel3Error);
  });
});
