import "dotenv/config";
import { Composio } from "@composio/core";

const apiKey = process.env.COMPOSIO_API_KEY;
const userId = process.env.SUPPORT_SESSION_USER_ID ?? "support-team";
const toolkits =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ["datadog", "metabase"];

if (!apiKey) {
  console.error("COMPOSIO_API_KEY is required.");
  process.exit(1);
}

const composio = new Composio({ apiKey });
const session = await composio.create(userId, {
  toolkits: {
    enable: toolkits,
  },
  workbench: {
    enable: false,
  },
});

console.log(`Support user ID: ${userId}`);
console.log(`Session ID: ${session.sessionId}`);

for (const toolkit of toolkits) {
  const connectionRequest = await session.authorize(toolkit);

  console.log("");
  console.log(`Toolkit: ${toolkit}`);
  console.log(`Connection request ID: ${connectionRequest.id}`);

  if (connectionRequest.redirectUrl) {
    console.log(`Connect URL: ${connectionRequest.redirectUrl}`);
  } else {
    console.log("No redirect URL returned. The toolkit may already be connected.");
  }
}

console.log("");
console.log("Open each Connect URL, finish auth, then restart the bot if it is already running.");
