import { getNeonAuth, neonAuthConfigured } from "@/lib/auth/neon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function dispatch(
  request: Request,
  context: Ctx,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
) {
  if (!neonAuthConfigured()) {
    return Response.json(
      { error: "Neon Auth is not configured. Set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET." },
      { status: 503 },
    );
  }
  try {
    const auth = getNeonAuth();
    if (!auth) {
      return Response.json({ error: "Neon Auth is not configured." }, { status: 503 });
    }
    return auth.handler()[method](request, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Neon Auth failed";
    return Response.json({ error: message }, { status: 503 });
  }
}

export const GET = (request: Request, context: Ctx) => dispatch(request, context, "GET");
export const POST = (request: Request, context: Ctx) => dispatch(request, context, "POST");
export const PUT = (request: Request, context: Ctx) => dispatch(request, context, "PUT");
export const DELETE = (request: Request, context: Ctx) => dispatch(request, context, "DELETE");
export const PATCH = (request: Request, context: Ctx) => dispatch(request, context, "PATCH");
