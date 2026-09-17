import { expect, test } from "bun:test";
import { apiSecurityFromEnv, authorizeApiRequest, protectApiRoutes } from "../security";

test("loopback API stays local and tokenless by default", () => {
  const security = apiSecurityFromEnv("127.0.0.1", {});
  expect(security.required).toBe(false);
  expect(authorizeApiRequest(new Request("http://127.0.0.1/api/jobs"), security)).toBe(true);
});

test("non-loopback API requires configured bearer token", async () => {
  expect(() => apiSecurityFromEnv("0.0.0.0", {})).toThrow("SOGGFY_API_TOKEN");
  const security = apiSecurityFromEnv("0.0.0.0", { SOGGFY_API_TOKEN: "secret-token" });
  expect(authorizeApiRequest(new Request("http://host/api/jobs"), security)).toBe(false);
  expect(authorizeApiRequest(new Request("http://host/api/jobs", {
    headers: { authorization: "Bearer secret-token" },
  }), security)).toBe(true);

  const routes = protectApiRoutes({ "/api/jobs": { GET: () => new Response("ok") } }, security);
  expect((await routes["/api/jobs"].GET(new Request("http://host/api/jobs"))).status).toBe(401);
});
test("authorized API request establishes an HttpOnly session cookie usable by media requests", async () => {
  const security = apiSecurityFromEnv("0.0.0.0", { SOGGFY_API_TOKEN: "secret-token" });
  const routes = protectApiRoutes({ "/api/stream": { GET: () => new Response("audio") } }, security);
  const first = await routes["/api/stream"].GET(new Request("http://host/api/stream", {
    headers: { authorization: "Bearer secret-token" },
  }));
  const cookie = first.headers.get("set-cookie");
  expect(cookie).toContain("soggfy_api_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  expect(cookie).toContain("Max-Age=3600");
  expect(cookie).not.toContain("; Secure");
  const pair = cookie!.split(";", 1)[0]!;
  expect(authorizeApiRequest(new Request("http://host/api/stream", { headers: { cookie: pair } }), security)).toBe(true);

  const second = await routes["/api/stream"].GET(new Request("http://host/api/stream", {
    headers: { authorization: "Bearer secret-token" },
  }));
  expect(second.headers.get("set-cookie")!.split(";", 1)[0]).not.toBe(pair);
  security.sessions.clear();
  expect(authorizeApiRequest(new Request("http://host/api/stream", { headers: { cookie: pair } }), security)).toBe(false);

  const secureResponse = await routes["/api/stream"].GET(new Request("https://host/api/stream", {
    headers: { authorization: "Bearer secret-token" },
  }));
  expect(secureResponse.headers.get("set-cookie")).toContain("; Secure");
});


test("configured loopback token is honored", async () => {
  const security = apiSecurityFromEnv("127.0.0.1", { SOGGFY_API_TOKEN: "loopback-secret" });
  expect(security.required).toBe(true);
  expect(authorizeApiRequest(new Request("http://127.0.0.1/api/jobs"), security)).toBe(false);
  expect(authorizeApiRequest(new Request("http://127.0.0.1/api/jobs", {
    headers: { authorization: "Bearer loopback-secret" },
  }), security)).toBe(true);
});

test("API mutations enforce origin and JSON content type while allowing origin-less native clients", async () => {
  const security = apiSecurityFromEnv("127.0.0.1", {});
  let mutations = 0;
  const routes = protectApiRoutes({
    "/api/x": {
      POST: async (req: Request) => {
        await req.json();
        mutations += 1;
        return Response.json({ ok: true });
      },
    },
  }, security);
  const post = routes["/api/x"].POST;
  const json = JSON.stringify({ value: 1 });

  expect((await post(new Request("http://127.0.0.1/api/x", {
    method: "POST", headers: { origin: "https://untrusted.example", "content-type": "application/json" }, body: json,
  }))).status).toBe(403);
  expect((await post(new Request("http://127.0.0.1/api/x", {
    method: "POST", headers: { origin: "null", "content-type": "application/json" }, body: json,
  }))).status).toBe(403);
  expect((await post(new Request("http://127.0.0.1/api/x", {
    method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "text/plain" }, body: json,
  }))).status).toBe(415);
  expect((await post(new Request("http://127.0.0.1/api/x", {
    method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "application/json" }, body: json,
  }))).status).toBe(200);
  expect((await post(new Request("http://127.0.0.1/api/x", {
    method: "POST", headers: { "content-type": "application/json" }, body: json,
  }))).status).toBe(200);
  expect(mutations).toBe(2);
});

test("loopback mutation rejects a non-loopback request hostname even when Origin matches it", async () => {
  const security = apiSecurityFromEnv("127.0.0.1", {});
  const routes = protectApiRoutes({
    "/api/x": { POST: () => Response.json({ ok: true }) },
  }, security);
  const response = await routes["/api/x"].POST(new Request("http://attacker.example/api/x", {
    method: "POST",
    headers: { origin: "http://attacker.example", "content-type": "application/json" },
    body: "{}",
  }));
  expect(response.status).toBe(403);
});

test("loopback API rejects a non-loopback request hostname for reads as well", async () => {
  const security = apiSecurityFromEnv("127.0.0.1", {});
  const routes = protectApiRoutes({
    "/api/x": { GET: () => Response.json({ secret: true }) },
  }, security);
  const response = await routes["/api/x"].GET(new Request("http://attacker.example/api/x"));
  expect(response.status).toBe(403);
});
