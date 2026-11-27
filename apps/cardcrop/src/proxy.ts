import { NextResponse, type NextRequest } from "next/server";
import { getNeonAuth, neonAuthConfigured } from "@/lib/auth/neon";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/password";

function isPublic(pathname: string) {
  return pathname === "/" || pathname === "/batch" || pathname === "/login" || pathname.startsWith("/api/auth");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (!pathname.startsWith("/api/") && neonAuthConfigured()) {
    try {
      const auth = getNeonAuth();
      if (auth) return auth.middleware({ loginUrl: "/login" })(request);
    } catch {
      // Neon Auth is misconfigured. Fall through to the password login page.
    }
  }

  if (pathname.startsWith("/api/") && neonAuthConfigured()) {
    try {
      const auth = getNeonAuth();
      if (auth) {
        const { data } = await auth.getSession();
        if (data?.user) return NextResponse.next();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neon Auth is unavailable";
      return NextResponse.json({ error: message }, { status: 503 });
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/",
    "/suite",
    "/suite/:path*",
    "/auto-enhance",
    "/auto-enhance/:path*",
    "/batch",
    "/batch/:path*",
    "/editor",
    "/editor/:path*",
    "/create",
    "/create/:path*",
    "/assistant",
    "/assistant/:path*",
    "/api/cards",
    "/api/cards/:path*",
    "/api/blob",
    "/api/replicate",
    "/api/ocr",
    "/api/assistant",
    "/api/restore",
    "/api/export",
    "/api/prices",
    "/api/batch",
    "/api/health",
    "/api/connectors",
    "/api/notify",
    "/api/images",
    "/api/runpod",
    "/api/runpod/:path*",
  ],
};
