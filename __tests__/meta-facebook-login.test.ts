import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConversations,
  getUserInfo,
  getUserMedia,
  sendCommentReply,
  sendPrivateReply,
  subscribeInstagramAccountToWebhooks,
} from "@/lib/meta/client";
import { getMissingInstagramOAuthEnv } from "@/lib/env";
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
import { resolvePageAccessToken } from "@/lib/meta/facebook-login";

const fetchMock = vi.fn();
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}
const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]));

describe("Meta client with Facebook Login (META_LOGIN=facebook)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("META_LOGIN", "facebook");
    vi.stubEnv("META_PAGE_ID", "PAGE1");
    vi.stubEnv("META_IG_USER_ID", "IG1");
    vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends the private reply through the Page on graph.facebook.com", async () => {
    respond({ recipient_id: "u", message_id: "m" });
    await sendPrivateReply("tok", "IG1", "C1", "oi");
    const url = urlOf();
    expect(url.host).toBe("graph.facebook.com");
    expect(url.pathname).toBe("/v25.0/PAGE1/messages");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ recipient: { comment_id: "C1" }, message: { text: "oi" } });
  });

  it("replies to a comment on graph.facebook.com", async () => {
    respond({ id: "r" });
    await sendCommentReply("tok", "C1", "Te mandei na DM! 📩");
    expect(urlOf().host).toBe("graph.facebook.com");
    expect(urlOf().pathname).toBe("/v25.0/C1/replies");
  });

  it("reads the Instagram account by id, not /me, and fills user_id", async () => {
    respond({ id: "IG1", username: "opcoesparainvestidores" });
    const user = await getUserInfo("tok");
    expect(urlOf().pathname).toBe("/v25.0/IG1");
    expect(urlOf().searchParams.get("fields")).not.toContain("user_id");
    expect(user.user_id).toBe("IG1");
  });

  it("lists media of the Instagram account", async () => {
    respond({ data: [] });
    await getUserMedia("tok");
    expect(urlOf().pathname).toBe("/v25.0/IG1/media");
  });

  it("lists Instagram conversations through the Page", async () => {
    respond({ data: [] });
    await getConversations("tok", "IG1");
    expect(urlOf().pathname).toBe("/v25.0/PAGE1/conversations");
    expect(urlOf().searchParams.get("platform")).toBe("instagram");
  });

  it("subscribes the Page to messaging webhooks", async () => {
    respond({ success: true });
    await subscribeInstagramAccountToWebhooks("IG1", "tok");
    expect(urlOf().pathname).toBe("/v25.0/PAGE1/subscribed_apps");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.subscribed_fields).toEqual(["messages", "messaging_postbacks"]);
  });

  it("trades the system-user token for the Page token", async () => {
    respond({ access_token: "PAGE_TOKEN", id: "PAGE1" });
    expect(await resolvePageAccessToken("SYSTEM_TOKEN")).toBe("PAGE_TOKEN");
    expect(urlOf().pathname).toBe("/v25.0/PAGE1");
    expect(urlOf().searchParams.get("fields")).toBe("access_token");
  });

  it("keeps the given token when the Page returns none", async () => {
    respond({ error: { message: "no", code: 100 } }, 400);
    expect(await resolvePageAccessToken("SYSTEM_TOKEN")).toBe("SYSTEM_TOKEN");
  });

  it("asks for the Page token and ids instead of the Instagram app", () => {
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "");
    vi.stubEnv("FACEBOOK_APP_SECRET", "s");
    vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
    vi.stubEnv("NEXTAUTH_SECRET", "n");
    vi.stubEnv("INSTAGRAM_APP_ID", "");
    expect(getMissingInstagramOAuthEnv()).toEqual(["META_PAGE_ACCESS_TOKEN"]);
  });
});

describe("Meta client with Instagram Login (default)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("META_LOGIN", "");
    vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps sending from the Instagram account on graph.instagram.com", async () => {
    respond({ recipient_id: "u", message_id: "m" });
    await sendPrivateReply("tok", "IG1", "C1", "oi");
    expect(urlOf().host).toBe("graph.instagram.com");
    expect(urlOf().pathname).toBe("/v25.0/IG1/messages");
  });

  it("keeps reading /me", async () => {
    respond({ id: "app", user_id: "IG1", username: "x" });
    await getUserInfo("tok");
    expect(urlOf().pathname).toBe("/v25.0/me");
  });
});
