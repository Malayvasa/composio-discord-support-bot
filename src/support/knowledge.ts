import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const knowledgeFiles = [
  "knowledge/composio-overview.md",
  "knowledge/sessions-debugging.md",
  "knowledge/auth-and-connected-accounts.md",
  "knowledge/debug-fields.md",
  "knowledge/discord-support-playbook.md",
  "knowledge/known-incidents-and-status.md",
  "knowledge/mcp-auth-triage.md",
  "knowledge/support-response-quality.md",
  "knowledge/diagnostics/logs.md",
  "knowledge/diagnostics/datadog.md",
  "knowledge/diagnostics/metabase.md",
  "knowledge/diagnostics/escalation.md",
];

export const loadKnowledge = async () => {
  const entries = await Promise.all(
    knowledgeFiles.map(async (relativePath) => {
      const content = await readFile(join(rootDir, relativePath), "utf8");
      return `# ${relativePath}\n\n${content.trim()}`;
    })
  );

  return entries.join("\n\n---\n\n");
};
