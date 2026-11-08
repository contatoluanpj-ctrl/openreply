import { requireEnv } from "@/lib/env";

/**
 * Which Meta login the deployment uses.
 *
 * - "instagram" (default): Instagram API with Instagram Login. One OAuth round
 *   trip per account, calls go to graph.instagram.com.
 * - "facebook": Instagram API with Facebook Login for Business. Newer Meta apps
 *   only offer this one ("A configuração da API com login do Instagram não está
 *   disponível para apps mais recentes"). There is no OAuth round trip: a
 *   never-expiring Page access token (from a system user) is set in the env,
 *   calls go to graph.facebook.com, and messages are sent through the Page.
 *
 * Set META_LOGIN=facebook plus META_PAGE_ACCESS_TOKEN, META_PAGE_ID and
 * META_IG_USER_ID (the Instagram professional account linked to that Page).
 */
export function isFacebookLogin(): boolean {
  return (process.env.META_LOGIN ?? "").trim().toLowerCase() === "facebook";
}

export function facebookPageId(): string {
  return requireEnv("META_PAGE_ID");
}

export function facebookInstagramUserId(): string {
  return requireEnv("META_IG_USER_ID");
}

export function facebookPageAccessToken(): string {
  return requireEnv("META_PAGE_ACCESS_TOKEN");
}

export const FACEBOOK_LOGIN_ENV = [
  "META_PAGE_ACCESS_TOKEN",
  "META_PAGE_ID",
  "META_IG_USER_ID",
  "FACEBOOK_APP_SECRET",
  "ENCRYPTION_KEY",
  "NEXTAUTH_SECRET",
] as const;
