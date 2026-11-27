import { authenticateAgentTokenOnly } from "@/lib/agent-auth";
import { errorResponse } from "@/lib/api-auth";
import { handleMcpJsonRpc } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      error:
        "Use HTTP POST with JSON-RPC 2.0 messages and an Authorization: Bearer <agent-token> header.",
    },
    { status: 405 },
  );
}

export async function POST(request: Request) {
  try {
    const agent = await authenticateAgentTokenOnly(
      request.headers.get("authorization"),
    );
    const body = await request.json();
    const { status, body: rpcBody } = await handleMcpJsonRpc(body, { agent });
    if (rpcBody === null) {
      return new Response(null, { status });
    }
    return Response.json(rpcBody, { status });
  } catch (err) {
    return errorResponse(err);
  }
}
