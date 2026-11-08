import { prisma } from "@/lib/db/client";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { getUserInfo, subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";
import { getMetaGraphApiVersion } from "@/lib/env";
import { facebookPageAccessToken, facebookPageId } from "@/lib/meta/login-mode";
import { encryptToken } from "@/lib/meta/oauth";

/**
 * META_PAGE_ACCESS_TOKEN may hold the system-user token itself (what Business
 * Manager shows after "Gerar token") or the Page token derived from it. Asking
 * the Page for its access_token with either one returns the Page token, so the
 * owner never has to do the exchange by hand. If Meta returns none (the token
 * cannot see the Page), the original token is kept and the next call reports
 * the real permission error.
 */
export async function resolvePageAccessToken(token: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${getMetaGraphApiVersion()}/${facebookPageId()}`);
  url.searchParams.set("fields", "access_token");
  url.searchParams.set("access_token", token);
  try {
    const response = await fetch(url.toString());
    const data = (await response.json()) as { access_token?: string };
    return response.ok && data.access_token ? data.access_token : token;
  } catch {
    return token;
  }
}

export type FacebookLoginConnectResult =
  | { ok: true; instagramId: string; username: string; webhookSubscribed: boolean }
  | { ok: false; reason: "already_connected" };

/**
 * Connects the Instagram account behind META_PAGE_ACCESS_TOKEN to a workspace.
 * Facebook Login has no per-account OAuth round trip: the system-user Page
 * token in the env is the credential, it does not expire, so tokenExpiresAt
 * stays null and the refresh cron skips it.
 */
export async function connectFacebookLoginAccount(
  workspaceId: string
): Promise<FacebookLoginConnectResult> {
  const token = await resolvePageAccessToken(facebookPageAccessToken());
  const userInfo = await getUserInfo(token);
  const instagramId = userInfo.user_id ?? userInfo.id;

  const connection = await canConnectInstagramAccount({ workspaceId, instagramId });
  if (!connection.allowed) return { ok: false, reason: "already_connected" };

  let webhookSubscribed = false;
  try {
    const subscription = await subscribeInstagramAccountToWebhooks(instagramId, token);
    webhookSubscribed = Boolean(subscription.success);
  } catch (error) {
    console.warn("[Facebook Login] Page webhook subscription failed:", error);
  }

  const data = {
    username: userInfo.username,
    name: userInfo.name,
    accessToken: encryptToken(token),
    tokenExpiresAt: null,
    webhookSubscribed,
  };
  const existing = await prisma.instagramAccount.findUnique({ where: { instagramId } });
  if (existing) {
    const updated = await prisma.instagramAccount.updateMany({
      where: { id: existing.id, workspaceId, provider: "META" },
      data,
    });
    if (!updated.count) return { ok: false, reason: "already_connected" };
  } else {
    await prisma.instagramAccount.create({
      data: { ...data, workspaceId, instagramId, provider: "META" },
    });
  }
  return { ok: true, instagramId, username: userInfo.username, webhookSubscribed };
}
