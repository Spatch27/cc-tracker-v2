import { describe, expect, it, vi } from "vitest";
import { FolkApiError, FolkRestClient } from "@/lib/folk/client";

describe("FolkRestClient", () => {
  it("sends Authorization Bearer header and parses cursor pagination", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("https://api.folk.app/v1/people");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer test-secret-token",
      );
      return new Response(
        JSON.stringify({
          data: {
            items: [
              {
                id: "per_1",
                fullName: "Jane Doe",
                emails: ["jane@acme.com"],
              },
            ],
            pagination: {
              nextLink: "https://api.folk.app/v1/people?cursor=cur_2",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const client = new FolkRestClient({
      apiKey: "test-secret-token",
      fetchFn: fetchMock as unknown as typeof fetch,
      baseDelayMs: 1,
    });

    const res = await client.listPeople({ limit: 10 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.id).toBe("per_1");
    expect(res.pagination?.nextCursor).toBe("cur_2");
  });

  it("retries on HTTP 429 and never leaks the API key in errors", async () => {
    const secret = "folk_super_secret_98765";
    let attempts = 0;

    const fetchMock = vi.fn(async () => {
      attempts += 1;
      if (attempts < 2) {
        return new Response("Rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return new Response(
        JSON.stringify({ data: { items: [], pagination: {} } }),
        { status: 200 },
      );
    });

    const client = new FolkRestClient({
      apiKey: secret,
      fetchFn: fetchMock as unknown as typeof fetch,
      baseDelayMs: 1,
      maxRetries: 3,
    });

    const result = await client.listGroups();
    expect(attempts).toBe(2);
    expect(result.items).toEqual([]);

    const failingFetch = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    const failClient = new FolkRestClient({
      apiKey: secret,
      fetchFn: failingFetch as unknown as typeof fetch,
      baseDelayMs: 1,
    });

    try {
      await failClient.listUsers();
      expect.unreachable("Expected FolkApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(FolkApiError);
      expect((err as Error).message).not.toContain(secret);
    }
  });

  it("uses singular custom-fields paths and entity.id query param for interactions", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({ data: { items: [], pagination: {} } }),
        { status: 200 },
      );
    });

    const client = new FolkRestClient({
      apiKey: "test-secret",
      fetchFn: fetchMock as unknown as typeof fetch,
      baseDelayMs: 1,
    });

    await client.listGroupCustomFields("grp_123", "person");
    await client.listInteractions({
      entityId: "per_456",
      timeframe: "past",
      importedTypes: "email",
    });

    expect(requestedUrls[0]).toBe(
      "https://api.folk.app/v1/groups/grp_123/custom-fields/person",
    );
    expect(requestedUrls[1]).toContain("entity.id=per_456");
    expect(requestedUrls[1]).toContain("importedTypes=email");
  });
});
