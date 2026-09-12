const SESSION_KEY = "soggfy.apiToken";

function inputUrl(input: RequestInfo | URL, pageUrl: string): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), pageUrl);
}

export function apiRequestInit(
  input: RequestInfo | URL,
  init: RequestInit = {},
  token: string | null,
  pageUrl: string,
): RequestInit {
  if (!token) return init;
  const page = new URL(pageUrl);
  const url = inputUrl(input, pageUrl);
  if (url.origin !== page.origin || !url.pathname.startsWith("/api/")) return init;
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("x-soggfy-token", token);
  return { ...init, headers };
}

export function installApiAuthentication(): void {
  const url = new URL(window.location.href);
  const supplied = url.searchParams.get("token");
  if (supplied) {
    window.sessionStorage.setItem(SESSION_KEY, supplied);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  const token = supplied || window.sessionStorage.getItem(SESSION_KEY);
  if (!token) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    nativeFetch(input, apiRequestInit(input, init, token, window.location.href))) as typeof window.fetch;
}