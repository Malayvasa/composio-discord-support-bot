import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import {
  cardToSearchText,
  findPrivacyFindings,
  findSourceSpecificPrivacyFindings,
  makeSupportMemoryCardId,
  supportMemoryCardSchema,
  supportMemoryFileSchema,
  type SupportMemoryCard,
  type SupportMemoryFile,
} from "../src/support/support-memory.js";

const required = (name: string) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
};

const composio = new Composio({
  apiKey: required("COMPOSIO_API_KEY"),
  provider: new VercelProvider(),
});

const supportUserId = process.env.SUPPORT_SESSION_USER_ID ?? "support-team";
const model = process.env.SUPPORT_MEMORY_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5";
const outputPath =
  process.env.SUPPORT_MEMORY_OUTPUT ??
  join("generated-support-memory", `cards-${new Date().toISOString().slice(0, 10)}.json`);
const maxThreads = Number(process.env.SUPPORT_MEMORY_MAX_THREADS ?? 10);
const daysBack = Number(process.env.SUPPORT_MEMORY_DAYS_BACK ?? 30);
const plainVersion = process.env.SUPPORT_MEMORY_PLAIN_VERSION ?? "20260615_00";
const plainStatuses = (process.env.SUPPORT_MEMORY_PLAIN_STATUSES ?? "DONE")
  .split(",")
  .map((status) => status.trim())
  .filter(Boolean);
const plainTimelineEntries = Number(
  process.env.SUPPORT_MEMORY_PLAIN_TIMELINE_ENTRIES ?? 40
);
const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

interface PlainPage<T> {
  edges?: Array<{ cursor?: string; node?: T }>;
  pageInfo?: {
    hasNextPage?: boolean;
    endCursor?: string;
  };
}

interface PlainTimestamp {
  iso8601?: string;
}

interface PlainThreadSummary {
  id: string;
  ref?: string;
  title?: string;
  status?: string;
  createdAt?: PlainTimestamp;
  updatedAt?: PlainTimestamp;
  previewText?: string | null;
}

interface PlainTimelineEntry {
  llmText?: string | null;
  timestamp?: PlainTimestamp;
  actor?: {
    __typename?: string;
  } | null;
  entry?: {
    __typename?: string;
  } | null;
}

interface PlainThreadDetail extends PlainThreadSummary {
  labels?: Array<{
    labelType?: {
      name?: string | null;
    } | null;
  } | null>;
  timelineEntries?: PlainPage<PlainTimelineEntry>;
}

interface PlainToolResponse<T> {
  data?: T;
  error?: unknown;
  successful?: boolean;
}

const supportMemoryDraftSchema = supportMemoryCardSchema.omit({ id: true });

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? value : []);

const getTimestamp = (value: PlainTimestamp | string | undefined) =>
  !value ? undefined : typeof value === "string" ? value : value.iso8601;

const normalizeText = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const truncate = (value: string, maxChars: number) =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated]`;

const looksLikePlainAccount = (account: Record<string, unknown>) => {
  const searchable = JSON.stringify({
    id: account.id,
    toolkit: account.toolkit,
    toolkitSlug: account.toolkitSlug,
    appName: account.appName,
    name: account.name,
  }).toLowerCase();

  return searchable.includes("plain");
};

const getPlainConnectedAccountId = async () => {
  if (process.env.SUPPORT_MEMORY_PLAIN_CONNECTED_ACCOUNT_ID) {
    return process.env.SUPPORT_MEMORY_PLAIN_CONNECTED_ACCOUNT_ID;
  }

  const accounts = await composio.connectedAccounts.list({
    userIds: [supportUserId],
  });
  const accountItems = asArray<Record<string, unknown>>(
    asRecord(accounts)?.items ?? accounts
  );
  const activePlainAccount = accountItems.find(
    (account) => account.status === "ACTIVE" && looksLikePlainAccount(account)
  );

  if (typeof activePlainAccount?.id !== "string") {
    throw new Error(
      [
        "No active Plain connected account was found for the support user.",
        "Connect Plain or set SUPPORT_MEMORY_PLAIN_CONNECTED_ACCOUNT_ID.",
      ].join(" ")
    );
  }

  return activePlainAccount.id;
};

const executePlainTool = async <T>(
  slug: "PLAIN_QUERY_THREADS" | "PLAIN_RUN_GRAPHQL_QUERY",
  args: Record<string, unknown>
) => {
  const response = (await composio.tools.execute(slug, {
    userId: supportUserId,
    connectedAccountId: await getPlainConnectedAccountId(),
    version: plainVersion,
    arguments: args,
  })) as PlainToolResponse<T>;

  if (response.error || response.successful === false) {
    throw new Error(`${slug} failed: ${JSON.stringify(response.error ?? response)}`);
  }

  return response.data as T;
};

const listPlainThreadSummaries = async () => {
  const summaries: PlainThreadSummary[] = [];
  let cursor: string | undefined;

  while (summaries.length < maxThreads) {
    const data = await executePlainTool<{
      threads?: PlainPage<PlainThreadSummary>;
    }>("PLAIN_QUERY_THREADS", {
      ...(cursor ? { cursor } : {}),
      ...(plainStatuses.length ? { statuses: plainStatuses } : {}),
    });
    const threads = data.threads;
    const edges = threads?.edges ?? [];

    summaries.push(
      ...edges
        .map((edge) => edge.node)
        .filter((thread): thread is PlainThreadSummary => Boolean(thread))
    );

    const nextCursor = threads?.pageInfo?.endCursor ?? edges.at(-1)?.cursor;

    if (!threads?.pageInfo?.hasNextPage || !nextCursor) {
      break;
    }

    cursor = nextCursor;
  }

  return summaries.slice(0, maxThreads);
};

const getPlainThreadDetail = async (threadId: string) => {
  const query = `query GetThread($threadId: ID!, $timelineFirst: Int!) {
  thread(threadId: $threadId) {
    id
    ref
    title
    status
    previewText
    createdAt { iso8601 }
    updatedAt { iso8601 }
    labels { labelType { name } }
    timelineEntries(first: $timelineFirst) {
      edges {
        node {
          llmText
          timestamp { iso8601 }
          actor { __typename }
          entry { __typename }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

  const data = await executePlainTool<{
    data?: {
      thread?: PlainThreadDetail;
    };
    thread?: PlainThreadDetail;
  }>("PLAIN_RUN_GRAPHQL_QUERY", {
    query,
    variables: {
      threadId,
      timelineFirst: plainTimelineEntries,
    },
  });
  const thread = data.data?.thread ?? data.thread;

  if (!thread) {
    throw new Error(`Plain thread ${threadId} was not returned by GraphQL.`);
  }

  return thread;
};

const isAgentEntry = (text: string) =>
  /^(agent|machine user|bot|composio support|support)\b/i.test(text);

const threadToSourceText = (thread: PlainThreadDetail) => {
  const createdAt = getTimestamp(thread.createdAt);
  const updatedAt = getTimestamp(thread.updatedAt);
  const relevantDate = updatedAt ?? createdAt;

  if (!createdAt || !relevantDate || new Date(relevantDate) < since) {
    return undefined;
  }

  const textEntries = (thread.timelineEntries?.edges ?? [])
    .map((edge) => edge.node)
    .filter((entry): entry is PlainTimelineEntry => Boolean(entry?.llmText?.trim()))
    .sort((a, b) => {
      const aTime = new Date(getTimestamp(a.timestamp) ?? 0).getTime();
      const bTime = new Date(getTimestamp(b.timestamp) ?? 0).getTime();
      return aTime - bTime;
    });

  const firstCustomerEntry =
    textEntries.find((entry) => !isAgentEntry(normalizeText(entry.llmText ?? ""))) ??
    textEntries[0];

  if (!firstCustomerEntry || textEntries.length < 2) {
    return undefined;
  }

  const firstCustomerIndex = textEntries.indexOf(firstCustomerEntry);
  const laterEntries = textEntries.slice(firstCustomerIndex + 1);
  const labels = (thread.labels ?? [])
    .map((label) => label?.labelType?.name)
    .filter((label): label is string => Boolean(label));

  return truncate(
    [
      `Title: ${thread.title ?? "Untitled support issue"}`,
      labels.length ? `Labels: ${labels.join(", ")}` : "",
      "",
      "Original customer report:",
      normalizeText(firstCustomerEntry.llmText ?? ""),
      "",
      "Later support timeline and resolution evidence:",
      laterEntries
        .map((entry) =>
          [
            `[${getTimestamp(entry.timestamp) ?? "unknown time"}]`,
            entry.actor?.__typename ?? "Actor",
            entry.entry?.__typename ?? "Entry",
            normalizeText(entry.llmText ?? ""),
          ].join(" ")
        )
        .join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n"),
    20_000
  );
};

const parseJson = <T>(text: string): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error(`Could not parse support-memory JSON: ${text.slice(0, 500)}`);
    }

    return JSON.parse(match[1] ?? match[0]) as T;
  }
};

const buildCard = async (sourceText: string): Promise<SupportMemoryCard | undefined> => {
  const prompt = `Convert this raw support case into one reusable, privacy-safe support-memory card.

Return only valid JSON matching this shape, with no "id":
{
  "title": string,
  "summary": string,
  "symptoms": string[],
  "likelyCauses": string[],
  "fixes": string[],
  "whenToUse": string[],
  "requiredEvidence": string[],
  "avoidMentioning": string[],
  "docsUrls": string[],
  "tags": string[],
  "confidence": "low" | "medium" | "high"
}

Rules:
- Generalize the issue pattern. Do not preserve customer names, emails, company names, Plain refs, thread IDs, request IDs, org IDs, project IDs, connected account IDs, auth config IDs, API keys, UUIDs, screenshots, or non-Composio URLs.
- Use generic placeholders only, such as ak_..., uak_..., ac_..., ca_..., pr_..., ok_....
- Keep only reusable symptoms, likely causes, fixes, and evidence to ask for.
- Include docs URLs only when they are official Composio docs URLs.
- If the case is not reusable for a Composio support bot, still return a low-confidence generic card.

Raw support case:
${sourceText}`;

  const result = await generateText({
    model: openai(model),
    prompt,
  });
  const draft = supportMemoryDraftSchema.parse(parseJson<unknown>(result.text));
  const card = supportMemoryCardSchema.parse({
    id: makeSupportMemoryCardId(draft),
    ...draft,
  });
  const findings = [
    ...findPrivacyFindings(cardToSearchText(card)),
    ...findSourceSpecificPrivacyFindings(cardToSearchText(card), sourceText),
  ];

  if (findings.length > 0) {
    console.warn("[support-memory] dropped unsafe card", {
      title: card.title,
      findings: findings.map((finding) => finding.kind),
    });
    return undefined;
  }

  return card;
};

console.log("[support-memory] collecting Plain cases", {
  statuses: plainStatuses,
  daysBack,
  maxThreads,
  outputPath,
});

const summaries = await listPlainThreadSummaries();
const cards: SupportMemoryCard[] = [];

for (const [index, summary] of summaries.entries()) {
  console.log(`[support-memory] processing ${index + 1}/${summaries.length}`);
  const detail = await getPlainThreadDetail(summary.id);
  const sourceText = threadToSourceText(detail);

  if (!sourceText) {
    continue;
  }

  const card = await buildCard(sourceText);

  if (card) {
    cards.push(card);
  }
}

const memory: SupportMemoryFile = supportMemoryFileSchema.parse({
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "plain_sanitized",
  cards,
});

const output = JSON.stringify(memory, null, 2);
const findings = findPrivacyFindings(output);

if (findings.length > 0) {
  throw new Error(
    [
      "Generated support memory contains privacy-sensitive content:",
      ...findings.map((finding) => `- ${finding.kind}: ${finding.value}`),
    ].join("\n")
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${output}\n`);
console.log("[support-memory] wrote sanitized cards", {
  outputPath,
  cards: cards.length,
});
