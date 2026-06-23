import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const supportMemoryCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  symptoms: z.array(z.string().min(1)).min(1).max(8),
  likelyCauses: z.array(z.string().min(1)).min(1).max(8),
  fixes: z.array(z.string().min(1)).min(1).max(8),
  whenToUse: z.array(z.string().min(1)).min(1).max(8),
  requiredEvidence: z.array(z.string().min(1)).max(8),
  avoidMentioning: z.array(z.string().min(1)).min(1).max(8),
  docsUrls: z.array(z.string().url()).max(8),
  tags: z.array(z.string().min(1)).min(1).max(12),
  confidence: z.enum(["low", "medium", "high"]),
});

export const supportMemoryFileSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  source: z.enum(["curated", "plain_sanitized"]),
  cards: z.array(supportMemoryCardSchema),
});

export type SupportMemoryCard = z.infer<typeof supportMemoryCardSchema>;
export type SupportMemoryFile = z.infer<typeof supportMemoryFileSchema>;

export interface PrivacyFinding {
  kind: string;
  value: string;
}

const allowedGenericExamples = new Set([
  "ak_...",
  "uak_...",
  "ac_...",
  "ca_...",
  "pr_...",
  "ok_...",
]);

const sensitivePatterns: Array<{
  kind: string;
  pattern: RegExp;
  allow?: (value: string) => boolean;
}> = [
  {
    kind: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    kind: "api_key",
    pattern: /\b(?:ak|uak|sk|pk)_[A-Za-z0-9_-]{8,}\b/g,
    allow: (value) => allowedGenericExamples.has(value),
  },
  {
    kind: "org_id",
    pattern: /\b(?:ok|org)_[A-Za-z0-9_-]{6,}\b/g,
    allow: (value) => allowedGenericExamples.has(value),
  },
  {
    kind: "project_id",
    pattern: /\bpr_[A-Za-z0-9_-]{6,}\b/g,
    allow: (value) => allowedGenericExamples.has(value),
  },
  {
    kind: "auth_config_id",
    pattern: /\bac_[A-Za-z0-9_-]{6,}\b/g,
    allow: (value) => allowedGenericExamples.has(value),
  },
  {
    kind: "connected_account_id",
    pattern: /\bca_[A-Za-z0-9_-]{6,}\b/g,
    allow: (value) => allowedGenericExamples.has(value),
  },
  {
    kind: "plain_thread_id",
    pattern: /\b(?:T-\d{3,}|th_[A-Za-z0-9_-]{8,})\b/g,
  },
  {
    kind: "uuid",
    pattern:
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  },
  {
    kind: "non_composio_url",
    pattern: /https?:\/\/[^\s`'")>\]]+/gi,
    allow: (value) => {
      try {
        const hostname = new URL(value).hostname;
        const isComposioDocs =
          hostname === "docs.composio.dev" || hostname.endsWith(".composio.dev");
        const isGoogleOAuthScope =
          hostname === "www.googleapis.com" &&
          new URL(value).pathname.startsWith("/auth/");

        return isComposioDocs || isGoogleOAuthScope;
      } catch {
        return false;
      }
    },
  },
];

const uniqueFindings = (findings: PrivacyFinding[]) =>
  Array.from(
    new Map(findings.map((finding) => [`${finding.kind}:${finding.value}`, finding]))
      .values()
  );

export const findPrivacyFindings = (text: string): PrivacyFinding[] => {
  const findings: PrivacyFinding[] = [];

  for (const { kind, pattern, allow } of sensitivePatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];

      if (!allow?.(value)) {
        findings.push({ kind, value });
      }
    }
  }

  return uniqueFindings(findings);
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const extractCustomerNames = (sourceText: string) => {
  const names = new Set<string>();
  const patterns = [
    /([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3})\s+\(Customer\)/gu,
    /(?:from|by)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3})\b/gu,
  ];

  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      const name = match[1]?.trim();

      if (name && !/\b(?:Composio|Customer|Support|Team|Agent)\b/i.test(name)) {
        names.add(name);
      }
    }
  }

  return Array.from(names);
};

export const findSourceSpecificPrivacyFindings = (
  cardText: string,
  sourceText: string
): PrivacyFinding[] => {
  const findings: PrivacyFinding[] = [];

  for (const name of extractCustomerNames(sourceText)) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");

    if (pattern.test(cardText)) {
      findings.push({ kind: "customer_name", value: name });
    }
  }

  return uniqueFindings(findings);
};

export const redactSensitiveText = (text: string) => {
  let redacted = text;

  for (const { kind, pattern, allow } of sensitivePatterns) {
    redacted = redacted.replace(pattern, (value) => {
      if (allow?.(value)) {
        return value;
      }

      return `[redacted ${kind}]`;
    });
  }

  return redacted;
};

export const makeSupportMemoryCardId = (card: Omit<SupportMemoryCard, "id">) =>
  `card_${createHash("sha256")
    .update(
      JSON.stringify({
        title: card.title,
        symptoms: card.symptoms,
        fixes: card.fixes,
      })
    )
    .digest("hex")
    .slice(0, 16)}`;

export const cardToSearchText = (card: SupportMemoryCard) =>
  [
    card.title,
    card.summary,
    card.symptoms.join("\n"),
    card.likelyCauses.join("\n"),
    card.fixes.join("\n"),
    card.whenToUse.join("\n"),
    card.requiredEvidence.join("\n"),
    card.avoidMentioning.join("\n"),
    card.docsUrls.join("\n"),
    card.tags.join("\n"),
  ].join("\n");

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const tokenize = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_.:-]+/)
      .filter((token) => token.length >= 3)
  );

const scoreCard = (card: SupportMemoryCard, query: string) => {
  const queryTokens = tokenize(query);
  const cardTokens = tokenize(cardToSearchText(card));
  let score = 0;

  for (const token of queryTokens) {
    if (cardTokens.has(token)) {
      score += 1;
    }
  }

  for (const tag of card.tags) {
    if (query.toLowerCase().includes(tag.toLowerCase())) {
      score += 3;
    }
  }

  return score;
};

export const loadSupportMemoryFile = async (
  relativePath = "knowledge/support-memory/cards.json"
) => {
  const raw = await readFile(join(rootDir, relativePath), "utf8");
  return supportMemoryFileSchema.parse(JSON.parse(raw));
};

export const validateSupportMemoryFile = (memory: SupportMemoryFile) => {
  const findings = findPrivacyFindings(JSON.stringify(memory, null, 2));

  if (findings.length > 0) {
    throw new Error(
      [
        "Support memory contains privacy-sensitive content:",
        ...findings.map((finding) => `- ${finding.kind}: ${finding.value}`),
      ].join("\n")
    );
  }
};

export const selectSupportMemoryCards = (
  cards: SupportMemoryCard[],
  query: string,
  maxCards = 2
) => {
  const scored = cards
    .map((card) => ({ card, score: scoreCard(card, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  const topScore = scored[0]?.score ?? 0;
  const minimumScore = Math.max(3, Math.ceil(topScore * 0.5));

  return scored
    .filter(({ score }) => score >= minimumScore)
    .slice(0, maxCards)
    .map(({ card }) => card);
};

export const formatSupportMemoryCards = (cards: SupportMemoryCard[]) => {
  if (cards.length === 0) {
    return "No relevant sanitized support-memory cards found.";
  }

  return cards
    .map((card) =>
      [
        `## ${card.title}`,
        `Summary: ${card.summary}`,
        `Confidence: ${card.confidence}`,
        `Symptoms: ${card.symptoms.join("; ")}`,
        `Likely causes: ${card.likelyCauses.join("; ")}`,
        `Fixes: ${card.fixes.join("; ")}`,
        card.requiredEvidence.length
          ? `Useful evidence: ${card.requiredEvidence.join("; ")}`
          : "",
        `Avoid mentioning: ${card.avoidMentioning.join("; ")}`,
        card.docsUrls.length ? `Docs: ${card.docsUrls.join(", ")}` : "",
        `Tags: ${card.tags.join(", ")}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
};

export const loadRelevantSupportMemory = async (query: string) => {
  const memory = await loadSupportMemoryFile();
  validateSupportMemoryFile(memory);
  return formatSupportMemoryCards(selectSupportMemoryCards(memory.cards, query));
};
