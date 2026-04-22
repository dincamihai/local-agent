import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "board-tui-mcp",
    env: { BOARD_TASKS_DIR: "/home/mihai/repos/board-tui/.tasks" },
  });
  await client.connect(transport);
  const result = await client.callTool({
    name: "list_delegated_tasks",
    arguments: { status: "queued" },
  });
  console.log("content[0].text first char:", JSON.stringify(result.content[0].text[0]));
  console.log("content[0].text first 10 chars:", JSON.stringify(result.content[0].text.substring(0, 10)));
  console.log("structuredContent keys:", Object.keys(result.structuredContent || {}));
  await client.close();
}

main().catch(console.error);
