import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateKey, bearerToken } from "@/server/agents/keys";
import { getDb } from "@/server/db/client";
import { buildLeashMcpServer } from "@/server/mcp/server";

/**
 * Leash's MCP endpoint (Streamable HTTP, stateless JSON). Authenticate with
 * `Authorization: Bearer leash_sk_…` (create a key on /app/connect).
 */
async function handle(req: Request): Promise<Response> {
  const db = await getDb();
  const key = await authenticateKey(db, bearerToken(req));
  if (!key) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid Leash API key." }, id: null },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="leash"' } },
    );
  }
  const server = buildLeashMcpServer(db, key);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close().catch(() => undefined);
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
