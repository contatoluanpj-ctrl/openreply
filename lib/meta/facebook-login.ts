import { prisma } from "@/lib/db/client";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { getUserInfo, subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";
import { facebookPageAccessToken } from "@/lib/meta/login-mode";
import { encryptToken } from "@/lib/meta/oauth";

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
  const token = facebookPageAccessToken();
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
