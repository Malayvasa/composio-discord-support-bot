import "dotenv/config";
import {
  cardToSearchText,
  findPrivacyFindings,
  loadSupportMemoryFile,
  validateSupportMemoryFile,
} from "../src/support/support-memory.js";

const memoryPath =
  process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length) ??
  "knowledge/support-memory/cards.json";

const memory = await loadSupportMemoryFile(memoryPath);
validateSupportMemoryFile(memory);

for (const card of memory.cards) {
  const findings = findPrivacyFindings(cardToSearchText(card));

  if (findings.length > 0) {
    throw new Error(
      [
        `Support memory card ${card.id} contains privacy-sensitive content:`,
        ...findings.map((finding) => `- ${finding.kind}: ${finding.value}`),
      ].join("\n")
    );
  }
}

console.log("[support-memory] validated", {
  path: memoryPath,
  source: memory.source,
  cards: memory.cards.length,
});
