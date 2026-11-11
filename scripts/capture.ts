/**
 * README screenshots and raw clips for the demo video, recorded against a Leash deployment.
 *
 *   npm run capture -- --shots     docs/images/*.png
 *   npm run capture -- --video     video/*.webm: one clip per part of docs/VIDEO.md (git-ignored)
 *
 * CAPTURE_BASE_URL picks the deployment (default: the live demo). On a deployment that uses the
 * PayPal sandbox, JUDGE_BUYER_EMAIL / JUDGE_BUYER_PASSWORD log the test buyer in. Each run uses a
 * fresh café and costs one demo story's worth of Claude calls.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, devices, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { AI_TIMEOUT, approveHold, expectBecBlocked, runRestock } from "../tests/e2e/helpers";

const BASE = (process.env.CAPTURE_BASE_URL ?? "https://palkapalkaogurechik.onrender.com").replace(/\/$/, "");
const args = process.argv.slice(2);
const mode: "shots" | "video" = args.includes("--video") ? "video" : "shots";
const IMAGES = process.env.CAPTURE_DIR ?? "docs/images";
const VIDEO = process.env.CAPTURE_DIR ?? "video";

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);

async function desktop(
  browser: Browser,
  name: string,
  extra: { storageState?: Awaited<ReturnType<BrowserContext["storageState"]>> } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: BASE,
    storageState: extra.storageState,
    // Video frames are the viewport's size (Playwright pads, never scales), so record at 1920×1080.
    viewport: mode === "video" ? { width: 1920, height: 1080 } : { width: 1280, height: 860 },
    deviceScaleFactor: mode === "video" ? 1 : 2,
    recordVideo:
      mode === "video" ? { dir: path.join(VIDEO, name), size: { width: 1920, height: 1080 } } : undefined,
  });
  if (mode === "video") {
    // Leash's own pages at 125% so text reads on a phone-sized video; PayPal's pages stay as they are.
    await context.addInitScript((host) => {
      if (location.host !== host) return;
      const apply = () => document.documentElement?.style.setProperty("zoom", "1.25");
      apply();
      document.addEventListener("readystatechange", apply);
    }, new URL(BASE).host);
  }
  return context;
}

async function shot(page: Page, file: string, opts: { full?: boolean; maxHeight?: number } = {}) {
  if (mode !== "shots") return;
  // Let meters and fades finish animating.
  await page.waitForTimeout(1200);
  const out = path.join(IMAGES, file);
  if (opts.full) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const width = page.viewportSize()!.width;
    await page.screenshot({
      path: out,
      fullPage: true,
      clip: { x: 0, y: 0, width, height: Math.min(height, opts.maxHeight ?? 1800) },
    });
  } else {
    await page.screenshot({ path: out });
  }
  log(`saved ${out}`);
}

/** Pauses for the viewer in video mode; no-op for screenshots. */
const beat = (page: Page, ms = 1500) => (mode === "video" ? page.waitForTimeout(ms) : Promise.resolve());

async function scrollThrough(page: Page) {
  if (mode !== "video") return;
  await page.evaluate(async () => {
    const step = window.innerHeight / 3;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: "smooth" });
      await new Promise((r) => setTimeout(r, 700));
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

async function finish(context: BrowserContext, clip: string) {
  const pages = context.pages();
  await context.close();
  if (mode === "video") {
    for (const p of pages) {
      const video = p.video();
      if (video) {
        await video.saveAs(path.join(VIDEO, `${clip}.webm`));
        await video.delete();
      }
    }
    log(`saved ${VIDEO}/${clip}.webm`);
  }
}

async function main() {
  mkdirSync(mode === "video" ? VIDEO : IMAGES, { recursive: true });
  const browser = await chromium.launch({ slowMo: mode === "video" ? 120 : 0 });
  log(`${mode} from ${BASE}`);

  // Shot 1: the landing page.
  let ctx = await desktop(browser, "01-landing");
  let page = await ctx.newPage();
  await page.goto("/", { timeout: 120_000 });
  await beat(page);
  await scrollThrough(page);
  await finish(ctx, "01-landing");

  // Shots 2–5: rules → hold → agent run → fooled-agent replay, in one fresh café.
  ctx = await desktop(browser, "02-story");
  page = await ctx.newPage();
  await page.goto("/demo", { timeout: 120_000 });
  await beat(page);
  await page.getByRole("button", { name: "Compile my rules" }).click();
  const card = page.getByRole("region", { name: "Compiled rules" });
  await expect(card).toBeVisible({ timeout: AI_TIMEOUT });
  await card.scrollIntoViewIfNeeded();
  await beat(page, 2500);
  await shot(page, "rule-card.png");
  const appOrigin = new URL(page.url()).origin;
  await card.getByRole("button", { name: /fund the leash with PayPal/ }).click();
  await approveHold(page, appOrigin);
  await beat(page);
  log("hold approved");

  await runRestock(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await beat(page, 2500);
  await scrollThrough(page);
  await shot(page, "agent-console.png", { full: true, maxHeight: 2000 });
  log("restock finished");

  await expectBecBlocked(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await beat(page, 2500);
  await shot(page, "fooled-replay.png", { full: true, maxHeight: 1400 });
  const state = await ctx.storageState();
  await finish(ctx, "02-story");

  // Shot 6: the owner approves the $141 order on a phone and opens the signed receipt.
  const phone = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: BASE,
    storageState: state,
    recordVideo:
      mode === "video" ? { dir: path.join(VIDEO, "03-phone"), size: { width: 412, height: 915 } } : undefined,
  });
  page = await phone.newPage();
  await page.goto("/app");
  await page.getByRole("link", { name: "Review" }).first().click();
  await expect(page.getByRole("region", { name: "Why Leash is asking" })).toBeVisible();
  await beat(page, 2500);
  await shot(page, "phone-approval.png");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: /^Paid / })).toBeVisible({ timeout: 60_000 });
  await beat(page);
  await page.getByRole("link", { name: "Signed receipt" }).click();
  await expect(page.getByRole("heading", { name: "Verified" })).toBeVisible();
  await beat(page, 2500);
  await shot(page, "receipt-phone.png");
  await finish(phone, "03-phone");

  // Shots 7–10: Attack Lab, ledger, end of week, connect.
  ctx = await desktop(browser, "04-rest", { storageState: state });
  page = await ctx.newPage();
  await page.goto("/lab");
  await beat(page);
  const preset = page.getByRole("region", { name: "Hidden instructions on a supplier page" });
  await preset.scrollIntoViewIfNeeded();
  await beat(page);
  await preset.getByRole("button", { name: "Run this attack" }).click();
  await page.waitForURL(/\/lab\/runs\/lab_/);
  await expect(page.getByRole("status", { name: "Outcome" })).toContainText("Leash held.", {
    timeout: 90_000,
  });
  await beat(page, 2500);
  await shot(page, "attack-lab.png", { full: true, maxHeight: 1600 });
  log("lab run finished");

  await page.goto("/app/ledger");
  await beat(page);
  await page.getByLabel(/Ask the ledger/).fill("what did Leash block?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForTimeout(mode === "video" ? 6000 : 4000);
  await shot(page, "ledger.png");

  await page.goto("/app");
  await beat(page);
  const endWeek = page.getByRole("button", { name: /End week now/ });
  await endWeek.click();
  await expect(page.getByRole("status", { name: "Last week" })).toBeVisible({ timeout: 60_000 });
  await beat(page, 2500);
  await shot(page, "end-of-week.png");
  await page.goto("/app/ledger");
  await expect(page.getByRole("region", { name: "Reconciliation with PayPal" })).toBeVisible();
  await beat(page, 2000);

  await page.goto("/app/connect");
  await beat(page, 3000);
  await scrollThrough(page);
  await shot(page, "connect.png");

  await page.goto("/bench");
  await beat(page, 2000);
  await shot(page, "bench.png", { full: true, maxHeight: 1600 });
  await finish(ctx, "04-rest");

  await browser.close();
  log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
