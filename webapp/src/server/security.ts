import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isLoopbackHost } from "../../../src/core/http-config";

const SESSION_COOKIE = "soggfy_api_session";
const SESSION_TTL_SECONDS = 60 * 60;
const MAX_SESSIONS = 128;

export interface ApiSecurity {
  required: boolean;
  token?: string;
  loopbackOnly: boolean;
  sessions: Map<string, number>;
}

export function apiSecurityFromEnv(host: string, env: NodeJS.ProcessEnv = process.env): ApiSecurity {
  const token = env.SOGGFY_API_TOKEN?.trim();
  if (isLoopbackHost(host)) return { required: Boolean(token), token, loopbackOnly: true, sessions: new Map() };
  if (!token) throw new Error("SOGGFY_API_TOKEN is required when SOGGFY_HOST is not loopback");
  return { required: true, token, loopbackOnly: false, sessions: new Map() };
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function suppliedApiToken(req: Request): string {
  const authorization = req.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return bearer || req.headers.get("x-soggfy-token") || "";
}

function sessionDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cookieValue(req: Request, name: string): string {
  for (const pair of (req.headers.get("cookie") || "").split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

function pruneSessions(security: ApiSecurity): void {
  const now = Date.now();
  for (const [digest, expiresAt] of security.sessions) {
    if (expiresAt <= now) security.sessions.delete(digest);
  }
  while (security.sessions.size >= MAX_SESSIONS) {
    const oldest = security.sessions.keys().next().value;
    if (!oldest) break;
    security.sessions.delete(oldest);
  }
}

function suppliedTokenIsValid(req: Request, security: ApiSecurity): boolean {
  const supplied = suppliedApiToken(req);
  return Boolean(supplied && security.token && secureEqual(supplied, security.token));
}

function validSession(req: Request, security: ApiSecurity): boolean {
  pruneSessions(security);
  const session = cookieValue(req, SESSION_COOKIE);
  if (!session) return false;
  const expiresAt = security.sessions.get(sessionDigest(session));
  return typeof expiresAt === "number" && expiresAt > Date.now();
}

export function authorizeApiRequest(req: Request, security: ApiSecurity): boolean {
  if (!security.required) return true;
  if (!security.token) return false;
  return suppliedTokenIsValid(req, security) || validSession(req, security);
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function mutationBoundaryError(req: Request, method: string, security: ApiSecurity): Response | null {
  const requestUrl = new URL(req.url);
  if (security.loopbackOnly && !isLoopbackHost(requestUrl.hostname)) {
    return Response.json({ error: "Loopback API requests require a loopback request host" }, { status: 403 });
  }
  if (!MUTATION_METHODS.has(method.toUpperCase())) return null;

  const origin = req.headers.get("origin");
  if (origin !== null) {
    if (origin === "null") {
      return Response.json({ error: "Opaque browser origins may not mutate the API" }, { status: 403 });
    }
    try {
      if (new URL(origin).origin !== requestUrl.origin) {
        return Response.json({ error: "Cross-origin API mutation rejected" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Invalid Origin header" }, { status: 403 });
    }
  }

  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Cross-site API mutation rejected" }, { status: 403 });
  }

  const contentType = (req.headers.get("content-type") || "").split(";", 1)[0]!.trim().toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ error: "API mutations require application/json" }, { status: 415 });
  }
  return null;
}

function withSessionCookie(response: Response, security: ApiSecurity, req: Request): Response {
  pruneSessions(security);
  const session = randomBytes(32).toString("base64url");
  security.sessions.set(sessionDigest(session), Date.now() + SESSION_TTL_SECONDS * 1000);
  const headers = new Headers(response.headers);
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${session}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
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
        const boundaryError = mutationBoundaryError(req, method, security);
        if (boundaryError) return boundaryError;
        if (!authorizeApiRequest(req, security)) {
          return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
        }
        const response = await handler(req, ...args);
        return suppliedTokenIsValid(req, security) && !validSession(req, security)
          ? withSessionCookie(response, security, req)
          : response;
      };
    }
    protectedRoutes[path] = wrapped;
  }
  return protectedRoutes;
}
