export const SESSION_COOKIE_NAME = "tracki_session";

/** Sliding session lifetime: 30 days. */
export const SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 30;

/** Renew the session row when less than half its lifetime remains. */
export const SESSION_RENEWAL_THRESHOLD_MS = SESSION_LIFETIME_MS / 2;

export const INVITATION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 7;

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Roles allowed to manage members and invitations. */
export const MANAGER_ROLES: readonly OrgRole[] = ["owner", "admin"];

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";
