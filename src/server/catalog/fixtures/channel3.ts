import type { C3Category, C3Product, C3SearchResponse } from "../channel3";

/**
 * OFFLINE FIXTURES in Channel3's v1 search response shape. Brands and retailers are
 * fictional and prices are illustrative; they exist so Leash runs without a Channel3 key.
 * With CHANNEL3_API_KEY set, live Channel3 data replaces all of this.
 */

type Row = [title: string, brand: string, domain: string, price: number];

const cat = (...titles: string[]): C3Category => {
  const path = titles.map((t) => ({ slug: t.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: t }));
  const leaf = path[path.length - 1];
  return { slug: leaf.slug, title: leaf.title, path, has_children: false };
};

const COFFEE = cat("Food, Beverages & Tobacco", "Beverages", "Coffee");
const PLANT_MILK = cat("Food, Beverages & Tobacco", "Beverages", "Milk Substitutes");
const CUPS = cat("Business & Industrial", "Food Service", "Disposable Tableware", "Disposable Cups");
const LIDS = cat("Business & Industrial", "Food Service", "Disposable Tableware", "Disposable Lids");
const NAPKINS = cat("Business & Industrial", "Food Service", "Disposable Tableware", "Napkins");
const SANITIZER = cat("Business & Industrial", "Cleaning Supplies", "Sanitizers");
const GIFT_CARDS = cat("Arts & Entertainment", "Party & Celebration", "Gift Giving", "Gift Cards");

function response(prefix: string, category: C3Category, rows: Row[]): C3SearchResponse {
  const products: C3Product[] = rows.map(([title, brand, domain, price], i) => ({
    id: `c3fx_${prefix}_${i + 1}`,
    title,
    description: null,
    brands: [{ id: `brand_${brand.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, name: brand }],
    images: [],
    category,
    key_features: null,
    materials: null,
    offers: [
      {
        url: `https://${domain}/products/${prefix}-${i + 1}`,
        domain,
        price: { price, compare_at_price: null, currency: "USD" },
        availability: "InStock",
        condition: "new",
        max_commission_rate: 0.04,
      },
    ],
    structured_attributes: {},
    ratings: null,
  }));
  return { products, next_page_token: null };
}

export const CHANNEL3_FIXTURES: { query: string; response: C3SearchResponse }[] = [
  {
    query: "espresso coffee beans 5 lb",
    response: response("espresso", COFFEE, [
      ["Espresso Roast Whole Bean Coffee, 5 lb Bag", "Morning Mill", "cafe-depot.example", 39.99],
      ["Italian Espresso Blend, Whole Bean, 5 lb", "Ridgeline Roasting", "roastersmarket.example", 43.5],
      ["Dark Espresso Whole Bean Coffee 5 lbs", "Harbor & Hearth", "restaurantsupply.example", 44.4],
      ["Classic Espresso Beans, 80 oz", "Copperline Coffee", "bulkcafe.example", 45.0],
      ["Single Origin Espresso, Whole Bean, 5 Pound", "Altura Roasters", "roastersmarket.example", 47.25],
      ["Organic Espresso Blend Coffee Beans 5lb", "Greenfield Organics", "cafe-depot.example", 49.99],
      ["Espresso Blend, Whole Bean, 12 oz", "Copperline Coffee", "bulkcafe.example", 13.99],
    ]),
  },
  {
    query: "drip coffee beans 5 lb",
    response: response("drip", COFFEE, [
      ["House Blend Whole Bean Coffee, 5 lb", "Morning Mill", "cafe-depot.example", 33.99],
      ["Medium Roast Drip Coffee Beans, 5 lb Bag", "Ridgeline Roasting", "roastersmarket.example", 36.5],
      ["Breakfast Blend Whole Bean, 5 lbs", "Harbor & Hearth", "restaurantsupply.example", 37.99],
      ["Colombian Whole Bean Coffee, 5 Pound", "Altura Roasters", "roastersmarket.example", 39.95],
    ]),
  },
  {
    query: "barista oat milk 32 oz 6 pack",
    response: response("oat", PLANT_MILK, [
      ["Barista Oat Milk, 32 fl oz (Pack of 6)", "Mill & Grain", "cafe-depot.example", 21.99],
      ["Oat Milk Barista Blend, 32 oz, 6 Pack", "Northfield Oats", "restaurantsupply.example", 23.94],
      ["Barista Series Oat Beverage, 6 x 32 fl oz", "Daybreak Dairy-Free", "bulkcafe.example", 24.5],
      ["Original Barista Oat Milk 32 oz, Case of 6", "Oat Theory", "cafe-depot.example", 25.99],
      [
        "Extra Creamy Oat Milk for Baristas, 32 fl oz (6 Pack)",
        "Mill & Grain",
        "roastersmarket.example",
        26.4,
      ],
      ["Barista Oat Milk, 32 oz, 12 Pack", "Northfield Oats", "restaurantsupply.example", 59.4],
    ]),
  },
  {
    query: "12 oz compostable hot cups 1000 count",
    response: response("cups", CUPS, [
      ["12 oz Compostable Hot Cups, 1000 ct", "GreenWare", "greenpackaging.example", 54.99],
      ["Paper Hot Coffee Cups 12 oz, 1,000 Count", "CupCraft", "restaurantsupply.example", 57.5],
      ["Eco Hot Cups 12oz PLA Lined, 1000 ct Case", "Leaf & Loop", "greenpackaging.example", 59.99],
      ["12 oz Double Wall Hot Cups, 1000 Count", "CupCraft", "cafe-depot.example", 62.0],
      ["Compostable 12 oz Coffee Cups, 1000 pcs", "Terra Serve", "bulkcafe.example", 64.95],
    ]),
  },
  {
    query: "12 oz sip lids 1000 count",
    response: response("lids", LIDS, [
      ["Sip Lids for 12-16 oz Hot Cups, 1000 ct", "GreenWare", "greenpackaging.example", 31.99],
      ["Hot Cup Sip-Through Lids 12 oz, 1,000 Count", "CupCraft", "restaurantsupply.example", 33.5],
      ["Compostable Lids for 12 oz Cups, 1000 pcs", "Terra Serve", "bulkcafe.example", 35.0],
      ["Dome Sip Lids 12oz, 1000 ct Case", "Leaf & Loop", "cafe-depot.example", 36.75],
    ]),
  },
  {
    query: "recycled napkins case 4000",
    response: response("napkins", NAPKINS, [
      ["Recycled Beverage Napkins, 4000 ct Case", "Terra Serve", "bulkcafe.example", 27.99],
      ["Brown Recycled Napkins, 4,000 Count", "GreenWare", "greenpackaging.example", 29.99],
      ["1-Ply Recycled Napkins, Case of 4000 ct", "CupCraft", "restaurantsupply.example", 31.5],
      ["Eco Napkins 100% Recycled, 4000 pcs", "Leaf & Loop", "cafe-depot.example", 34.0],
    ]),
  },
  {
    query: "food safe sanitizer concentrate gallon 4 pack",
    response: response("sanitizer", SANITIZER, [
      ["Food Contact Sanitizer Concentrate, 1 Gallon, 4 Pack", "CleanPro", "cleanpro.example", 42.99],
      ["No-Rinse Food Surface Sanitizer, 4 x 1 gal", "Kitchen Guard", "restaurantsupply.example", 45.5],
      ["Quat Sanitizer Concentrate, 1 Gal (Case of 4)", "CleanPro", "cafe-depot.example", 47.0],
      ["Food-Safe Sanitizing Concentrate, 4 Gallons", "SaniSure", "bulkcafe.example", 49.99],
    ]),
  },
  {
    query: "digital gift card 100",
    response: response("giftcard", GIFT_CARDS, [
      ["$100 Digital Gift Card (Email Delivery)", "GiftHub", "gifthub.example", 100.0],
      ["Coffee Shop eGift Card, $100", "Brewly", "brewly.example", 100.0],
    ]),
  },
];
