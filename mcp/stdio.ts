/**
 * Leash for stdio MCP clients (Claude Desktop and friends). A small bridge: it speaks MCP over
 * stdio and forwards every call to a Leash server's /api/mcp endpoint with your API key.
 *
 *   LEASH_URL=https://your-leash.example LEASH_API_KEY=leash_sk_… npm run mcp:stdio
 *
 * stdout carries the protocol; logs go to stderr.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

async function main() {
  const base = process.env.LEASH_URL ?? "http://localhost:3000";
  const apiKey = process.env.LEASH_API_KEY;
  if (!apiKey) {
    console.error("Set LEASH_API_KEY (create one in Leash under Connect an agent).");
    process.exit(1);
  }

  const upstream = new Client({ name: "leash-stdio-bridge", version: "1.0.0" });
  await upstream.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", base), {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    }),
  );

  const server = new Server(
    { name: "leash", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: upstream.getInstructions() },
  );
  server.setRequestHandler(ListToolsRequestSchema, (req) => upstream.listTools(req.params));
  server.setRequestHandler(CallToolRequestSchema, (req) => upstream.callTool(req.params));
  await server.connect(new StdioServerTransport());
  console.error(`Leash MCP bridge connected to ${base}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
