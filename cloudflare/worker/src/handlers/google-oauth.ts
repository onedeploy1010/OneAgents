import type { Env } from "../lib/env";
import { json, timingSafeEqual } from "../lib/http";
import { buildGoogleAuthUrl, exchangeCodeForTokens, getGoogleRedirectUri } from "../lib/google";
import { sendTelegram } from "../lib/telegram";

export async function handleGoogleOAuthStart(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_BOOTSTRAP_KEY) {
    return json({ ok: false, error: "admin_disabled" }, { status: 503 });
  }
  const url = new URL(request.url);
  const providedKey =
    url.searchParams.get("admin_key") ?? request.headers.get("x-admin-key") ?? "";
  if (!timingSafeEqual(providedKey, env.ADMIN_BOOTSTRAP_KEY)) {
    return json({ ok: false, error: "admin_unauthorized" }, { status: 401 });
  }
  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    return json({ ok: false, error: "google_oauth_client_id_not_configured" }, { status: 500 });
  }
  const state = crypto.randomUUID();
  const redirectUri = url.searchParams.get("redirect_uri") ?? getGoogleRedirectUri(env);
  const authUrl = buildGoogleAuthUrl(env, { state, redirectUri });
  return Response.redirect(authUrl, 302);
}

export async function handleGoogleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return htmlResponse(
      `<h1>❌ 授权失败</h1><p>Google 返回错误:<code>${escapeHtml(errorParam)}</code></p>`,
      400
    );
  }
  if (!code) {
    return htmlResponse("<h1>❌ 缺少 code 参数</h1>", 400);
  }

  try {
    const tokens = await exchangeCodeForTokens(env, code, getGoogleRedirectUri(env));
    if (!tokens.refresh_token) {
      return htmlResponse(
        [
          "<h1>⚠️ Google 没返回 refresh_token</h1>",
          "<p>通常是因为该账号之前已经授权过此 app。处理方法:</p>",
          "<ol>",
          '  <li>打开 <a href="https://myaccount.google.com/permissions" target="_blank">https://myaccount.google.com/permissions</a></li>',
          "  <li>找到 OneAgents(或 GCP 项目名)并 <b>移除访问权限</b></li>",
          "  <li>重新访问 <code>/oauth/google/start?admin_key=...</code></li>",
          "</ol>"
        ].join("\n"),
        400
      );
    }

    const tgResult = await sendTelegram(
      env,
      "🔐 Google OAuth refresh_token",
      [
        "admin@one23x.org 授权成功。请把下面的 refresh_token 存到 worker secret:",
        "",
        "```",
        tokens.refresh_token,
        "```",
        "",
        "执行:",
        "```",
        `echo "${tokens.refresh_token}" | npx wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN`,
        "```",
        "",
        `scope: ${tokens.scope}`,
        `expires_in(access_token): ${tokens.expires_in}s`
      ].join("\n")
    );

    return htmlResponse(
      [
        "<h1>✅ Google OAuth 授权成功</h1>",
        tgResult.skipped
          ? '<p style="color:#c00"><b>⚠️ Telegram 没配置,refresh_token 未发送。</b>请查看 worker logs(<code>wrangler tail</code>)取 refresh_token,再存到 secret。</p>'
          : "<p>refresh_token 已通过 Telegram 发到 default chat。在终端执行:</p>",
        '<pre>echo "&lt;refresh_token&gt;" | npx wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN</pre>',
        `<p><small>scope: <code>${escapeHtml(tokens.scope)}</code></small></p>`
      ].join("\n")
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("google_oauth_callback_error", msg);
    return htmlResponse(
      `<h1>❌ Token 交换失败</h1><pre>${escapeHtml(msg)}</pre>`,
      500
    );
  }
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>OneAgents OAuth</title><style>body{font-family:system-ui,-apple-system,sans-serif;padding:40px;max-width:640px;margin:0 auto;line-height:1.6;color:#222}pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px}code{background:#f4f4f4;padding:2px 6px;border-radius:3px;font-size:13px}h1{font-size:20px}a{color:#06c}</style>${body}`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
