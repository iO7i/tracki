import { z } from "zod";
import { ORG_ROLES } from "./constants";

/**
 * Input contracts shared between the dashboard server actions today and the
 * public API once it is extracted in slice 1. Error messages are i18n keys —
 * the UI translates them; nothing user-facing is hardcoded here.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("errors.invalidEmail")
  .max(254, "errors.tooLong");

export const passwordSchema = z
  .string()
  .min(8, "errors.passwordTooShort")
  .max(128, "errors.tooLong");

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "errors.nameTooShort")
  .max(80, "errors.tooLong");

export const signupSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "errors.required").max(128, "errors.tooLong"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createOrgSchema = z.object({
  name: displayNameSchema,
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const createProjectSchema = z.object({
  name: displayNameSchema,
  siteUrl: z
    .string()
    .trim()
    .url("errors.invalidUrl")
    .max(2048, "errors.tooLong")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(ORG_ROLES).exclude(["owner"]),
});
export type InviteInput = z.infer<typeof inviteSchema>;

/** Public "Book a demo" / contact lead. Company + message are optional. */
export const demoRequestSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  company: z.string().trim().max(120, "errors.tooLong").optional().or(z.literal("")),
  message: z.string().trim().max(2000, "errors.tooLong").optional().or(z.literal("")),
});
export type DemoRequestInput = z.infer<typeof demoRequestSchema>;
