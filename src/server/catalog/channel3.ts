import { CHANNEL3_FIXTURES } from "./fixtures/channel3";

/**
 * Channel3 product data API (https://api.trychannel3.com, POST /v1/search, GET /v1/products/{id}).
 * Types follow Channel3's v1 OpenAPI schema. Leash uses Channel3 as ground truth for:
 *   1. market prices (is the agent overpaying? how much did it save?)
 *   2. product classification (is this "oat milk" or a gift card?)
 * Without a key, a fixture client with the same response shape keeps everything working offline.
 */

export type C3Price = { price: number; compare_at_price: number | null; currency: string };

export type C3Offer = {
  url: string;
  domain: string;
  price: C3Price;
  availability: "InStock" | "OutOfStock";
  condition?: "new" | "used" | null;
  max_commission_rate?: number;
};

export type C3Category = {
  slug: string;
  title: string;
  path: { slug: string; title: string }[];
  has_children?: boolean;
};

export type C3Product = {
  id: string;
  title: string;
  description?: string | null;
  brands: { id: string; name: string }[];
  images: { url: string; cleaned_url?: string | null; is_main_image?: boolean; alt_text?: string | null }[];
  category: C3Category | null;
  key_features?: string[] | null;
  materials?: string[] | null;
  offers: C3Offer[];
  structured_attributes?: Record<string, string[]>;
  ratings?: { value: number; count: number; source_count: number } | null;
};

export type C3SearchRequest = {
  query: string;
  limit?: number;
  filters?: {
    price?: { min_price?: number | null; max_price?: number | null } | null;
    availability?: ("InStock" | "OutOfStock")[];
    conditions?: ("new" | "used")[];
    category_ids?: string[] | null;
  };
};

export type C3SearchResponse = { products: C3Product[]; next_page_token: string | null };

export interface Channel3Client {
  readonly mode: "live" | "fixture";
  search(req: C3SearchRequest): Promise<C3SearchResponse>;
  getProduct(productId: string): Promise<C3Product | null>;
}

export class Channel3Error extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "Channel3Error";
  }
}

const BASE = "https://api.trychannel3.com";
const CACHE_TTL_MS = 30 * 60 * 1000;

export class LiveChannel3 implements Channel3Client {
  readonly mode = "live" as const;
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(private readonly apiKey: string) {}

  async search(req: C3SearchRequest): Promise<C3SearchResponse> {
    const body = {
      query: req.query,
      limit: Math.min(req.limit ?? 20, 30),
      filters: {
        availability: ["InStock"],
        conditions: ["new"],
        ...req.filters,
      },
      config: { country: "US", currency: "USD", mode: "default" },
    };
    return this.cached(`search:${JSON.stringify(body)}`, () =>
      this.request<C3SearchResponse>("POST", "/v1/search", body),
    );
  }

  async getProduct(productId: string): Promise<C3Product | null> {
    try {
      return await this.cached(`product:${productId}`, () =>
        this.request<C3Product>(
          "GET",
          `/v1/products/${encodeURIComponent(productId)}?country=US&currency=USD`,
        ),
      );
    } catch (err) {
      if (err instanceof Channel3Error && err.status === 404) return null;
      throw err;
    }
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Channel3Error(
        res.status,
        `Channel3 ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }
}

/**
 * Offline Channel3: recorded-shape responses for the café's supply categories.
 * Matching is by keyword overlap with the fixture queries, so close queries still hit.
 */
export class FixtureChannel3 implements Channel3Client {
  readonly mode = "fixture" as const;

  async search(req: C3SearchRequest): Promise<C3SearchResponse> {
    const words = tokenize(req.query);
    let best: { score: number; products: C3Product[] } = { score: 0, products: [] };
    for (const fx of CHANNEL3_FIXTURES) {
      const fxWords = new Set(tokenize(fx.query));
      const score = words.filter((w) => fxWords.has(w)).length / Math.max(fxWords.size, 1);
      if (score > best.score) best = { score, products: fx.response.products };
    }
    if (best.score < 0.5) return { products: [], next_page_token: null };
    const { min_price, max_price } = req.filters?.price ?? {};
    const products = best.products
      .filter((p) =>
        p.offers.some(
          (o) =>
            (min_price == null || o.price.price >= min_price) &&
            (max_price == null || o.price.price <= max_price),
        ),
      )
      .slice(0, req.limit ?? 20);
    return { products, next_page_token: null };
  }

  async getProduct(productId: string): Promise<C3Product | null> {
    for (const fx of CHANNEL3_FIXTURES) {
      const p = fx.response.products.find((x) => x.id === productId);
      if (p) return p;
    }
    return null;
  }
}

const STOP = new Set(["the", "a", "of", "for", "and", "with", "x", "pack", "case"]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w));
}
