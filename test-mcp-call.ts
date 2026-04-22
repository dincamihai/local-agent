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
  console.log("Result:", JSON.stringify(result, null, 2));
  await client.close();
}

main().catch(console.error);
