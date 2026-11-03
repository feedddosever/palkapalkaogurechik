"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/server/db/client";
import {
  clientKeyFor,
  executeLabRun,
  LabUnavailableError,
  prepareLabRun,
  type LabRequest,
  type PreparedLabRun,
} from "@/server/lab/runner";

export type LabLaunchState = { error?: string; values?: Record<string, string> };

const CUSTOM_FIELDS = [
  "surface",
  "fromName",
  "fromEmail",
  "subject",
  "body",
  "invoiceNumber",
  "invoiceAmount",
  "payTo",
  "productId",
  "text",
  "driver",
] as const;

/** Starts an Attack Lab run in a fresh sandbox and opens its live page. */
export async function launchLabAction(_prev: LabLaunchState, formData: FormData): Promise<LabLaunchState> {
  const scenario = String(formData.get("scenario") ?? "");
  const values = Object.fromEntries(CUSTOM_FIELDS.map((f) => [f, String(formData.get(f) ?? "")]));
  const req: LabRequest =
    scenario === "custom"
      ? {
          scenario: "custom",
          driver: values.driver === "claude" ? "claude" : "hijacked",
          custom:
            values.surface === "page"
              ? { surface: "page", productId: values.productId, text: values.text }
              : {
                  surface: "email",
                  fromName: values.fromName,
                  fromEmail: values.fromEmail,
                  subject: values.subject,
                  body: values.body,
                  invoiceNumber: values.invoiceNumber,
                  invoiceAmount: values.invoiceAmount,
                  payTo: values.payTo,
                },
        }
      : { scenario };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip");
  const db = await getDb();
  let prepared: PreparedLabRun;
  try {
    prepared = await prepareLabRun(db, req, { clientKey: clientKeyFor(ip) });
  } catch (err) {
    if (err instanceof LabUnavailableError) return { error: err.message, values };
    throw err;
  }
  after(async () => {
    await executeLabRun(await getDb(), prepared.labRunId);
  });
  redirect(`/lab/runs/${prepared.labRunId}`);
}
