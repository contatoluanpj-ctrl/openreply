import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl, getMissingInstagramOAuthEnv } from "@/lib/env";
import { createOAuthState, getAuthorizationUrl } from "@/lib/meta/oauth";
import { connectFacebookLoginAccount } from "@/lib/meta/facebook-login";
import { isFacebookLogin } from "@/lib/meta/login-mode";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=forbidden`);
  }

  // getAuthorizationUrl and createOAuthState call requireEnv, which throws.
  // Without this check an incomplete .env surfaces as a 500 on a plain <a>
  // navigation, which reads to the user as the button doing nothing at all.
  const missingEnv = getMissingInstagramOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}/settings?instagram=misconfigured&missing=${encodeURIComponent(
        missingEnv.join(",")
      )}`
    );
  }

  // Facebook Login: no OAuth round trip, the Page token in the env connects.
  if (isFacebookLogin()) {
    try {
      const result = await connectFacebookLoginAccount(context.workspaceId);
      if (!result.ok) {
        return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=already_connected`);
      }
      return NextResponse.redirect(`${getBaseUrl()}/dashboard?connected=true`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[Instagram Connect] Facebook Login failed:", error);
      return NextResponse.redirect(
        `${getBaseUrl()}/settings?instagram=failed&reason=${encodeURIComponent(message.slice(0, 200))}`
      );
    }
  }

  const redirectUri = `${getBaseUrl()}/api/instagram/callback`;
  const state = createOAuthState(context.workspaceId);

  return NextResponse.redirect(getAuthorizationUrl(redirectUri, state));
}
