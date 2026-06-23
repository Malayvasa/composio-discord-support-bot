import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const runbookFiles = [
  "knowledge/composio-overview.md",
  "knowledge/sessions-debugging.md",
  "knowledge/auth-and-connected-accounts.md",
  "knowledge/discord-support-playbook.md",
  "knowledge/diagnostics/logs.md",
  "knowledge/diagnostics/datadog.md",
  "knowledge/diagnostics/metabase.md",
  "knowledge/diagnostics/escalation.md",
];

export const loadRunbooks = async () => {
  const entries = await Promise.all(
    runbookFiles.map(async (relativePath) => {
      const content = await readFile(join(rootDir, relativePath), "utf8");
      return `# ${relativePath}\n\n${content.trim()}`;
    })
  );

  return entries.join("\n\n---\n\n");
};

