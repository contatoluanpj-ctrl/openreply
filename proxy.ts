import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/automations",
  "/logs",
  "/settings",
  "/campaigns",
  "/inbox",
  "/overview",
  "/diagnostics",
  "/integrations",
];

// OPI: páginas públicas herdadas do OpenReply que a OPI não usa. Ficam escondidas
// (o código continua lá): quem entra vai para o login ou, com sessão, para o painel.
// /privacy, /terms, /data-deletion e /meta-review continuam abertas: a Meta exige.
const HIDDEN_PREFIXES = [
  "/templates",
  "/reports",
  "/manychat-alternative",
  "/comment-link-automation",
  "/instagram-comment-to-dm-templates",
  "/instagram-dm-automation-agencies",
];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isLogin = pathname === "/login";
  const isAuthenticated = hasSessionCookie(request);

  const isHidden =
    pathname === "/" ||
    HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isHidden) {
    return NextResponse.redirect(new URL(isAuthenticated ? "/dashboard" : "/login", request.url));
  }

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLogin && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/automations/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/campaigns/:path*",
    "/inbox/:path*",
    "/overview/:path*",
    "/diagnostics/:path*",
    "/integrations/:path*",
    "/",
    "/templates/:path*",
    "/reports/:path*",
    "/manychat-alternative",
    "/comment-link-automation",
    "/instagram-comment-to-dm-templates",
    "/instagram-dm-automation-agencies",
    "/login",
  ],
};
