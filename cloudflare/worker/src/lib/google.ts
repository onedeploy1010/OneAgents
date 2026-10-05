import type { Env } from "./env";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.readonly",
  "openid",
  "email",
  "profile"
] as const;

export function getGoogleRedirectUri(env: Env, fallback?: string): string {
  return (
    env.GOOGLE_OAUTH_REDIRECT_URI ??
    fallback ??
    "https://agents.one23x.org/oauth/google/callback"
  );
}

export function buildGoogleAuthUrl(
  env: Env,
  opts: { state: string; redirectUri?: string; scopes?: readonly string[] }
): string {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID not set");
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: opts.redirectUri ?? getGoogleRedirectUri(env),
    response_type: "code",
    scope: (opts.scopes ?? GOOGLE_DEFAULT_SCOPES).join(" "),
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
    hd: env.GOOGLE_WORKSPACE_DOMAIN ?? "one23x.org"
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(
  env: Env,
  code: string,
  redirectUri?: string
): Promise<GoogleTokens> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("google_oauth_client_not_configured");
  }
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri ?? getGoogleRedirectUri(env),
    grant_type: "authorization_code"
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok) {
    throw new Error(`google_token_exchange_failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokens;
}

export async function refreshAccessToken(
  env: Env,
  refreshToken: string
): Promise<GoogleTokens> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("google_oauth_client_not_configured");
  }
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok) {
    throw new Error(`google_token_refresh_failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokens;
}

export async function getAdminAccessToken(env: Env): Promise<string> {
  if (!env.GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN) {
    throw new Error("GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN not set");
  }
  const tokens = await refreshAccessToken(env, env.GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN);
  return tokens.access_token;
}
