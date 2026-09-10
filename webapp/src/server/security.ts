import { createHash, timingSafeEqual } from "node:crypto";
import { isLoopbackHost } from "../../../src/core/http-config";

export interface ApiSecurity {
  required: boolean;
  token?: string;
}


export function apiSecurityFromEnv(host: string, env: NodeJS.ProcessEnv = process.env): ApiSecurity {
  if (isLoopbackHost(host)) return { required: false };
  const token = env.SOGGFY_API_TOKEN?.trim();
  if (!token) {
    throw new Error("SOGGFY_API_TOKEN is required when SOGGFY_HOST is not loopback");
  }
  return { required: true, token };
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SESSION_COOKIE = "soggfy_api_session";

function suppliedApiToken(req: Request): string {
  const authorization = req.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return bearer || req.headers.get("x-soggfy-token") || "";
}

function sessionDigest(token: string): string {
  return createHash("sha256").update(`soggfy-api-session:${token}`).digest("hex");
}

function cookieValue(req: Request, name: string): string {
  for (const pair of (req.headers.get("cookie") || "").split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

export function authorizeApiRequest(req: Request, security: ApiSecurity): boolean {
  if (!security.required) return true;
  if (!security.token) return false;
  const supplied = suppliedApiToken(req);
  if (supplied && secureEqual(supplied, security.token)) return true;
  const session = cookieValue(req, SESSION_COOKIE);
  return Boolean(session && secureEqual(session, sessionDigest(security.token)));
}

function withSessionCookie(response: Response, token: string): Response {
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionDigest(token)}; Path=/api; HttpOnly; SameSite=Strict`,
  );
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function protectApiRoutes(routes: Record<string, any>, security: ApiSecurity): Record<string, any> {
  const protectedRoutes: Record<string, any> = { ...routes };
  for (const [path, definition] of Object.entries(routes)) {
    if (!path.startsWith("/api/") || !definition || typeof definition !== "object") continue;
    const wrapped: Record<string, any> = { ...definition };
    for (const [method, handler] of Object.entries(definition)) {
      if (typeof handler !== "function") continue;
      wrapped[method] = async (req: Request, ...args: unknown[]) => {
        if (!authorizeApiRequest(req, security)) {
          return Response.json({ error: "Unauthorized" }, {
            status: 401,
            headers: { "Cache-Control": "no-store" },
          });
        }
        const response = await handler(req, ...args);
        if (security.required && security.token && suppliedApiToken(req)) {
          return withSessionCookie(response, security.token);
        }
        return response;
      };
    }
    protectedRoutes[path] = wrapped;
  }
  return protectedRoutes;
}