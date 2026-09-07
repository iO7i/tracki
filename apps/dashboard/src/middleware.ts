import { SESSION_COOKIE_NAME } from "@tracki/shared/constants";
import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

/** App areas that require a session cookie (full validation happens server-side). */
const PROTECTED = /^\/(ar|en)\/orgs(\/.*)?$/;

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PROTECTED.test(pathname) && !request.cookies.get(SESSION_COOKIE_NAME)) {
    const locale = pathname.split("/")[1] ?? routing.defaultLocale;
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
