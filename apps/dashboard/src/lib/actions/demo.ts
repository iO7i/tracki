"use server";

import { db } from "@/db";
import { demoRequests } from "@/db/schema";
import { allowRate } from "@/lib/redis";
import { demoRequestSchema } from "@tracki/shared";
import { headers } from "next/headers";

/** Like ActionState but also carries an explicit success so the form can show
 *  its thank-you state (a bare `undefined` can't distinguish initial vs done). */
export type DemoState = { ok: true } | { error: string } | undefined;

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Public "Book a demo" submission. No auth (a lead exists before any account);
 * rate-limited per IP to stop spam. Stores the lead for sales follow-up. On
 * success returns `undefined` and the form shows its thank-you state.
 */
export async function submitDemoAction(_prev: DemoState, formData: FormData): Promise<DemoState> {
  if (!(await allowRate(`demo:ip:${await clientIp()}`, 5, 600))) {
    return { error: "errors.tooMany" };
  }
  const parsed = demoRequestSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    company: formData.get("company"),
    message: formData.get("message"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "errors.generic" };
  }
  try {
    await db.insert(demoRequests).values({
      name: parsed.data.name,
      email: parsed.data.email,
      company: parsed.data.company ?? "",
      message: parsed.data.message ?? "",
      locale: localeFrom(formData),
    });
  } catch {
    return { error: "errors.generic" };
  }
  return { ok: true };
}
