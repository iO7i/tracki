import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Content-Security-Policy (A05). Enforced in production only — dev needs
// 'unsafe-eval' + websocket for HMR. script/style use 'unsafe-inline' because
// App Router emits inline hydration scripts and Tailwind injects inline styles;
// the high-value directives (frame-ancestors/object-src/base-uri/form-action,
// origin-locked default-src) are what this app's low-XSS surface actually needs.
// Tightening script-src to per-request nonces is a tracked follow-up.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join("; ");

// Applied to every response. HSTS is inert over plain HTTP (dev), so it's safe
// to send always; the CSP is gated to production.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Content-Security-Policy", value: csp }]
    : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ["@tracki/shared", "@tracki/ui", "@tracki/clickhouse", "@tracki/whatsapp"],
  serverExternalPackages: ["@clickhouse/client", "ioredis"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
