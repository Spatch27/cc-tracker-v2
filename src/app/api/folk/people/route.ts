import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import {
  createFolkClientFromEnv,
  searchFolkPeople,
} from "@/lib/folk/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireFounderSession();
    const client = createFolkClientFromEnv();
    if (!client) {
      return Response.json({ people: [], folkConfigured: false });
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") ?? "").trim();

    const { items: people, strategy } = await searchFolkPeople(client, query);

    const mapped = people.map((p) => {
      const fullName =
        p.fullName?.trim() ||
        [p.firstName, p.lastName].filter(Boolean).join(" ").trim() ||
        p.emails[0] ||
        p.id;
      const linkedinUrl =
        p.urls.find((u) => u.toLowerCase().includes("linkedin.com")) ?? null;
      return {
        folkPersonId: p.id,
        fullName,
        email: p.emails[0] ?? null,
        jobTitle: p.jobTitle ?? null,
        folkCompanyId: p.companies[0]?.id ?? null,
        companyName: p.companies[0]?.name ?? null,
        linkedinUrl,
      };
    });

    const lower = query.toLowerCase();
    const filtered = lower
      ? mapped.filter((p) =>
          [p.fullName, p.email ?? "", p.jobTitle ?? "", p.companyName ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(lower),
        )
      : mapped;

    return Response.json({
      folkConfigured: true,
      searchStrategy: strategy,
      people: filtered.slice(0, 40),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
