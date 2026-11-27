import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import {
  createFolkClientFromEnv,
  searchFolkCompanies,
} from "@/lib/folk/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireFounderSession();
    const client = createFolkClientFromEnv();
    if (!client) {
      return Response.json({ companies: [], folkConfigured: false });
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") ?? "").trim();

    const { items: companies, strategy } = await searchFolkCompanies(
      client,
      query,
    );

    const mapped = companies.map((c) => {
      const domain =
        c.urls
          .find((u) => !u.toLowerCase().includes("linkedin.com"))
          ?.replace(/^https?:\/\//i, "")
          .replace(/\/.*$/, "") ?? null;
      return {
        folkCompanyId: c.id,
        name: c.name,
        domain,
        industries: c.industries ?? [],
      };
    });

    const lower = query.toLowerCase();
    const filtered = lower
      ? mapped.filter((c) =>
          [c.name, c.domain ?? "", c.industries.join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(lower),
        )
      : mapped;

    return Response.json({
      folkConfigured: true,
      searchStrategy: strategy,
      companies: filtered.slice(0, 40),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
