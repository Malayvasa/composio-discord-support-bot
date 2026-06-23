import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { openai } from "@ai-sdk/openai";
import { generateText, type ToolSet } from "ai";
import { config } from "../src/config.js";
import { runSupportAgent } from "../src/support/agent.js";
import { parseDebugFields } from "../src/support/debug-fields.js";

const evalModel = process.env.EVAL_OPENAI_MODEL ?? "gpt-5.5";
const daysBack = Number(process.env.EVAL_DAYS_BACK ?? 30);
const maxThreads = Number(process.env.EVAL_MAX_THREADS ?? 0);
const concurrency = Number(process.env.EVAL_CONCURRENCY ?? 3);
const usePrivateTools = (process.env.EVAL_USE_PRIVATE_TOOLS ?? "true") === "true";
const evalToolkits = (process.env.EVAL_TOOLKITS ?? "datadog,metabase")
  .split(",")
  .map((toolkit) => toolkit.trim())
  .filter(Boolean);
const plainStatuses = (process.env.EVAL_PLAIN_STATUSES ?? "DONE")
  .split(",")
  .map((status) => status.trim())
  .filter(Boolean);
const plainVersion = process.env.EVAL_PLAIN_VERSION ?? "20260615_00";
const plainConnectedAccountId = process.env.EVAL_PLAIN_CONNECTED_ACCOUNT_ID;
const plainMaxPages = Number(process.env.EVAL_PLAIN_MAX_PAGES ?? 10);
const plainTimelineEntries = Number(process.env.EVAL_PLAIN_TIMELINE_ENTRIES ?? 100);
const plainMinTextEntries = Number(process.env.EVAL_PLAIN_MIN_TEXT_ENTRIES ?? 2);
const evidenceMaxChars = Number(process.env.EVAL_RESOLUTION_EVIDENCE_MAX_CHARS ?? 60_000);
const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
const runDate = new Date().toISOString().slice(0, 10);
const outputName =
  process.env.EVAL_OUTPUT_NAME ??
  `plain-${usePrivateTools ? "diagnostics-" : ""}${runDate}`;
const outputDir = join(process.cwd(), "eval", outputName);

interface EvalThread {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
  ownerId?: string;
  source: "plain";
  status: string;
  labels: string[];
  query: string;
  replayContext: string;
  resolutionEvidence: string;
  messageCount: number;
}

interface BotAnswer {
  threadId: string;
  answer: string;
  model: string;
  mode: "public" | "private";
  toolkits: string[];
  composioSessionId?: string;
}

interface Judgement {
  threadId: string;
  scores: {
    correctness: number;
    helpfulness: number;
    missingDiagnostics: number;
    safety: number;
    timeToResolutionImpact: number;
    hallucinationRisk: number;
  };
  actualResolution: string;
  shouldHaveUsedDatadog: boolean;
  shouldHaveUsedMetabase: boolean;
  privateDiagnosticsNeeded: boolean;
  diagnosticEvidenceQuality: number;
  botMisses: string[];
  botStrengths: string[];
  recommendedImprovements: string[];
  summary: string;
}

interface EvalSupportSession {
  sessionId?: string;
  userId: string;
  tools: ToolSet;
}

interface PlainEdge<T> {
  cursor?: string;
  node?: T;
}

interface PlainPage<T> {
  edges?: Array<PlainEdge<T>>;
  pageInfo?: {
    hasNextPage?: boolean;
    endCursor?: string;
  };
  totalCount?: number;
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

interface PlainThreadDetail extends PlainThreadSummary {
  labels?: Array<{
    labelType?: {
      name?: string | null;
    } | null;
  } | null>;
  timelineEntries?: PlainPage<PlainTimelineEntry>;
}

interface PlainTimestamp {
  iso8601?: string;
}

interface PlainTimelineEntry {
  id?: string;
  llmText?: string | null;
  timestamp?: PlainTimestamp;
  actor?: {
    __typename?: string;
  } | null;
  entry?: {
    __typename?: string;
  } | null;
}

interface PlainToolResponse<T> {
  data?: T;
  error?: unknown;
  successful?: boolean;
}

const composio = new Composio({
  apiKey: config.composioApiKey,
  provider: new VercelProvider(),
});
let evalSupportSession: Promise<EvalSupportSession> | undefined;
let resolvedPlainAccountId: Promise<string> | undefined;

const getEvalSupportSession = async () => {
  evalSupportSession ??= (async () => {
    const session = await composio.create(config.supportSessionUserId, {
      toolkits: {
        enable: evalToolkits,
      },
      workbench: {
        enable: config.composioWorkbenchEnabled,
      },
    });
    const tools = await session.tools();
    const sessionId =
      "sessionId" in session && typeof session.sessionId === "string"
        ? session.sessionId
        : undefined;

    console.log("[eval] support diagnostics session ready", {
      userId: config.supportSessionUserId,
      sessionId,
      toolkits: evalToolkits,
      toolCount: Object.keys(tools).length,
    });

    return {
      userId: config.supportSessionUserId,
      sessionId,
      tools,
    };
  })();

  return evalSupportSession;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? value : []);

const getTimestamp = (value: PlainTimestamp | string | undefined) => {
  if (!value) {
    return undefined;
  }

  return typeof value === "string" ? value : value.iso8601;
};

const truncate = (value: string, maxChars: number) =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated]`;

const normalizeText = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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
  resolvedPlainAccountId ??= (async () => {
    if (plainConnectedAccountId) {
      return plainConnectedAccountId;
    }

    const accounts = await composio.connectedAccounts.list({
      userIds: [config.supportSessionUserId],
    });
    const accountItems = asArray<Record<string, unknown>>(
      asRecord(accounts)?.items ?? accounts
    );
    const activePlainAccount = accountItems.find(
      (account) => account.status === "ACTIVE" && looksLikePlainAccount(account)
    );
    const accountId = activePlainAccount?.id;

    if (typeof accountId !== "string") {
      throw new Error(
        [
          "No active Plain connected account was found for the support user.",
          "Connect Plain or set EVAL_PLAIN_CONNECTED_ACCOUNT_ID to an active Plain connected account ID.",
        ].join(" ")
      );
    }

    return accountId;
  })();

  return resolvedPlainAccountId;
};

const executePlainTool = async <T>(
  slug: "PLAIN_QUERY_THREADS" | "PLAIN_RUN_GRAPHQL_QUERY",
  args: Record<string, unknown>
) => {
  const response = (await composio.tools.execute(slug, {
    userId: config.supportSessionUserId,
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

  for (let page = 0; page < plainMaxPages; page += 1) {
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

  return summaries;
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
        cursor
        node {
          id
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

const excludedIssuePattern =
  /\b(partnership|sponsor|sponsored|link insertion|guest post|vendor|calendar|social|hiring|job|recruit|sales|demo request|dpa|baa|hipaa|compliance questionnaire|test thread)\b/i;
const resolutionPattern =
  /\b(resolved|fixed|solved|workaround|root cause|confirmed|shipped|deployed|closing|done|works now)\b/i;

const isAgentEntry = (text: string) =>
  /^(agent|machine user|bot|composio support|support)\b/i.test(text);

const formatTimelineEntry = (entry: PlainTimelineEntry) => {
  const timestamp = getTimestamp(entry.timestamp) ?? "unknown time";
  const actor = entry.actor?.__typename ?? "PlainTimelineActor";
  const entryType = entry.entry?.__typename ?? "PlainTimelineEntry";
  return `[${timestamp}] ${actor}/${entryType}: ${normalizeText(entry.llmText ?? "")}`;
};

const threadToEvalCase = (thread: PlainThreadDetail): EvalThread | undefined => {
  const labels = (thread.labels ?? [])
    .map((label) => label?.labelType?.name)
    .filter((label): label is string => Boolean(label));
  const searchable = [
    thread.title ?? "",
    thread.previewText ?? "",
    labels.join(" "),
  ].join(" ");

  if (excludedIssuePattern.test(searchable)) {
    return undefined;
  }

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

  if (!firstCustomerEntry) {
    return undefined;
  }

  const firstCustomerIndex = textEntries.indexOf(firstCustomerEntry);
  const laterEntries = textEntries.slice(firstCustomerIndex + 1);
  const resolutionEvidence = normalizeText(
    laterEntries.map(formatTimelineEntry).join("\n\n")
  );
  const previewResolution = resolutionPattern.test(
    [thread.previewText ?? "", resolutionEvidence].join(" ")
  );

  if (textEntries.length < plainMinTextEntries && !previewResolution) {
    return undefined;
  }

  const ref = thread.ref ?? thread.id;
  const title = thread.title?.trim() || ref;
  const query = normalizeText(firstCustomerEntry.llmText ?? "");
  const sourceUrl = `plain://thread/${ref}`;

  return {
    id: thread.id,
    name: `${ref}: ${title}`,
    url: sourceUrl,
    createdAt,
    updatedAt,
    source: "plain",
    status: thread.status ?? "UNKNOWN",
    labels,
    query,
    replayContext: [
      `Plain thread: ${ref}`,
      `Plain thread ID: ${thread.id}`,
      `Plain status: ${thread.status ?? "UNKNOWN"}`,
      labels.length ? `Plain labels: ${labels.join(", ")}` : "",
      `Plain source: ${sourceUrl}`,
      "",
      "Original customer issue:",
      query,
      thread.previewText ? ["", "Plain preview:", thread.previewText].join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n"),
    resolutionEvidence: truncate(
      resolutionEvidence ||
        `Plain status is ${thread.status ?? "UNKNOWN"}, but no later timeline text was available.`,
      evidenceMaxChars
    ),
    messageCount: textEntries.length,
  };
};

const collectPlainThreads = async () => {
  const summaries = await listPlainThreadSummaries();
  const evalThreads: EvalThread[] = [];

  console.log(`[eval] fetched ${summaries.length} Plain thread summaries`);

  for (const summary of summaries) {
    if (maxThreads > 0 && evalThreads.length >= maxThreads) {
      break;
    }

    const detail = await getPlainThreadDetail(summary.id);
    const evalThread = threadToEvalCase(detail);

    if (evalThread) {
      evalThreads.push(evalThread);
      console.log(`[eval] selected ${evalThreads.length}: ${evalThread.name}`);
    }
  }

  return evalThreads;
};

const answerThread = async (thread: EvalThread): Promise<BotAnswer> => {
  const supportSession = usePrivateTools
    ? await getEvalSupportSession()
    : undefined;
  const answer = await runSupportAgent({
    customerMessage: thread.query,
    discordContext: [
      thread.replayContext,
      "",
      usePrivateTools
        ? "Offline eval mode: private diagnostics tools are available. Use Datadog or Metabase when they materially help diagnose the original support request. Summarize what was checked."
        : "Offline eval mode: answer without private diagnostics tools.",
    ].join("\n"),
    discordMessageUrl: thread.url,
    mode: usePrivateTools ? "private" : "public",
    tools: supportSession?.tools,
    composioSessionId: supportSession?.sessionId,
    composioUserId: supportSession?.userId,
    debugFields: parseDebugFields(thread.query),
    model: evalModel,
  });

  return {
    threadId: thread.id,
    answer,
    model: evalModel,
    mode: usePrivateTools ? "private" : "public",
    toolkits: supportSession ? evalToolkits : [],
    composioSessionId: supportSession?.sessionId,
  };
};

const parseJson = <T>(text: string): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Could not parse judge JSON: ${text.slice(0, 500)}`);
    }
    return JSON.parse(match[1] ?? match[0]) as T;
  }
};

const loadJson = async <T>(path: string, fallback: T) => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};

const uniqueByThreadId = <T extends { threadId: string }>(items: T[]) =>
  Array.from(new Map(items.map((item) => [item.threadId, item])).values());

const runBatches = async <Input, Output>(
  items: Input[],
  worker: (item: Input, index: number) => Promise<Output>,
  onBatch: (outputs: Output[]) => Promise<void>
) => {
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    const outputs = await Promise.all(
      batch.map((item, batchIndex) => worker(item, index + batchIndex))
    );
    await onBatch(outputs);
  }
};

const judgeThread = async (
  thread: EvalThread,
  answer: BotAnswer
): Promise<Judgement> => {
  const prompt = `You are evaluating an offline support bot answer against the real Plain support thread resolution.

Return only valid JSON matching this TypeScript shape:
{
  "threadId": string,
  "scores": {
    "correctness": number,
    "helpfulness": number,
    "missingDiagnostics": number,
    "safety": number,
    "timeToResolutionImpact": number,
    "hallucinationRisk": number
  },
  "actualResolution": string,
  "shouldHaveUsedDatadog": boolean,
  "shouldHaveUsedMetabase": boolean,
  "privateDiagnosticsNeeded": boolean,
  "diagnosticEvidenceQuality": number,
  "botMisses": string[],
  "botStrengths": string[],
  "recommendedImprovements": string[],
  "summary": string
}

Score each field 1-5, where 5 is best for correctness/helpfulness/safety/timeToResolutionImpact, 5 means the bot asked all needed diagnostics for missingDiagnostics, 1 is best for hallucinationRisk, and diagnosticEvidenceQuality is 1-5 where 5 means the answer used or explicitly ruled out Datadog/Metabase evidence well when needed.

This eval replay has private diagnostics tools enabled for Datadog and Metabase. Judge whether those tools should have been used based on the original query and actual Plain thread resolution. If the bot should have checked logs/analytics but did not, mark diagnosticEvidenceQuality low and include that in botMisses.

Plain support thread:
${JSON.stringify(
  {
    threadId: thread.id,
    title: thread.name,
    status: thread.status,
    labels: thread.labels,
    originalQuery: thread.query,
    replayMode: answer.mode,
    availableToolkits: answer.toolkits,
    botAnswer: answer.answer,
    actualResolutionEvidence: thread.resolutionEvidence || "[no later replies]",
  },
  null,
  2
)}`;

  const result = await generateText({
    model: openai(evalModel),
    prompt,
  });

  return parseJson<Judgement>(result.text);
};

const makeReport = (
  threads: EvalThread[],
  answers: BotAnswer[],
  judgements: Judgement[]
) => {
  const byThread = new Map(answers.map((answer) => [answer.threadId, answer]));
  const average = (selector: (judgement: Judgement) => number) =>
    judgements.length === 0
      ? 0
      : judgements.reduce((sum, judgement) => sum + selector(judgement), 0) /
        judgements.length;
  const improvementCounts = new Map<string, number>();

  for (const judgement of judgements) {
    for (const improvement of judgement.recommendedImprovements) {
      const key = improvement.toLowerCase();
      improvementCounts.set(key, (improvementCounts.get(key) ?? 0) + 1);
    }
  }

  const topImprovements = Array.from(improvementCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const rows = threads
    .map((thread) => {
      const judgement = judgements.find((item) => item.threadId === thread.id);
      const answer = byThread.get(thread.id);

      return [
        `### ${thread.name}`,
        "",
        `- Source: ${thread.url}`,
        `- Status: ${thread.status}`,
        thread.labels.length ? `- Labels: ${thread.labels.join(", ")}` : "",
        `- Timeline text entries: ${thread.messageCount}`,
        `- Model: ${answer?.model ?? evalModel}`,
        `- Replay mode: ${answer?.mode ?? (usePrivateTools ? "private" : "public")}`,
        answer?.toolkits.length
          ? `- Available toolkits: ${answer.toolkits.join(", ")}`
          : "",
        judgement
          ? `- Scores: correctness ${judgement.scores.correctness}/5, helpfulness ${judgement.scores.helpfulness}/5, diagnostics ${judgement.scores.missingDiagnostics}/5, diagnostic evidence ${judgement.diagnosticEvidenceQuality}/5, safety ${judgement.scores.safety}/5, time impact ${judgement.scores.timeToResolutionImpact}/5, hallucination risk ${judgement.scores.hallucinationRisk}/5`
          : "- Scores: not judged",
        judgement
          ? `- Should have used: Datadog ${judgement.shouldHaveUsedDatadog ? "yes" : "no"}, Metabase ${judgement.shouldHaveUsedMetabase ? "yes" : "no"}, private diagnostics ${judgement.privateDiagnosticsNeeded ? "yes" : "no"}`
          : "",
        judgement ? `- Actual resolution: ${judgement.actualResolution}` : "",
        judgement ? `- Summary: ${judgement.summary}` : "",
        judgement?.botMisses.length
          ? `- Bot misses: ${judgement.botMisses.join("; ")}`
          : "",
        judgement?.recommendedImprovements.length
          ? `- Improvements: ${judgement.recommendedImprovements.join("; ")}`
          : "",
        "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    "# Plain Support Bot Eval",
    "",
    `Run date: ${new Date().toISOString()}`,
    `Plain issues evaluated: ${threads.length}`,
    `Plain statuses: ${plainStatuses.join(", ") || "all"}`,
    `Days back: ${daysBack}`,
    `Eval model: ${evalModel}`,
    `Replay mode: ${usePrivateTools ? "private diagnostics" : "public only"}`,
    `Diagnostic toolkits: ${usePrivateTools ? evalToolkits.join(", ") : "none"}`,
    "",
    "## Aggregate Scores",
    "",
    `- Correctness: ${average((j) => j.scores.correctness).toFixed(2)}/5`,
    `- Helpfulness: ${average((j) => j.scores.helpfulness).toFixed(2)}/5`,
    `- Missing diagnostics coverage: ${average((j) => j.scores.missingDiagnostics).toFixed(2)}/5`,
    `- Diagnostic evidence quality: ${average((j) => j.diagnosticEvidenceQuality).toFixed(2)}/5`,
    `- Safety: ${average((j) => j.scores.safety).toFixed(2)}/5`,
    `- Time-to-resolution impact: ${average((j) => j.scores.timeToResolutionImpact).toFixed(2)}/5`,
    `- Hallucination risk: ${average((j) => j.scores.hallucinationRisk).toFixed(2)}/5`,
    `- Datadog should-have-used count: ${judgements.filter((j) => j.shouldHaveUsedDatadog).length}`,
    `- Metabase should-have-used count: ${judgements.filter((j) => j.shouldHaveUsedMetabase).length}`,
    `- Private diagnostics needed count: ${judgements.filter((j) => j.privateDiagnosticsNeeded).length}`,
    "",
    "## Top Improvement Themes",
    "",
    topImprovements.length
      ? topImprovements.map(([text, count]) => `- ${text} (${count})`).join("\n")
      : "- No improvement themes found.",
    "",
    "## Thread Reviews",
    "",
    rows,
  ].join("\n");
};

await mkdir(outputDir, { recursive: true });

console.log(`[eval] collecting Plain support issues since ${since.toISOString()}`);
console.log("[eval] Plain settings", {
  statuses: plainStatuses,
  version: plainVersion,
  maxPages: plainMaxPages,
  timelineEntries: plainTimelineEntries,
});
const threads = await collectPlainThreads();
const rawThreadsPath = join(outputDir, "raw-threads.json");
const answersPath = join(outputDir, "bot-answers.json");
const judgementsPath = join(outputDir, "judgements.json");
const reportPath = join(outputDir, "report.md");

await writeFile(rawThreadsPath, JSON.stringify(threads, null, 2));
console.log(`[eval] collected ${threads.length} Plain issues`);

const answers = uniqueByThreadId(await loadJson<BotAnswer[]>(answersPath, []));
const answeredThreadIds = new Set(answers.map((answer) => answer.threadId));
const unansweredThreads = threads.filter(
  (thread) => !answeredThreadIds.has(thread.id)
);

console.log(
  `[eval] answers checkpoint: ${answers.length} done, ${unansweredThreads.length} remaining`
);
await runBatches(
  unansweredThreads,
  async (thread, index) => {
    console.log(
      `[eval] answering ${index + 1}/${unansweredThreads.length}: ${thread.name}`
    );
    return answerThread(thread);
  },
  async (batchAnswers) => {
    answers.push(...batchAnswers);
    await writeFile(answersPath, JSON.stringify(uniqueByThreadId(answers), null, 2));
  }
);

const judgements = uniqueByThreadId(
  await loadJson<Judgement[]>(judgementsPath, [])
);
const judgedThreadIds = new Set(judgements.map((judgement) => judgement.threadId));
const unjudgedThreads = threads.filter(
  (thread) =>
    !judgedThreadIds.has(thread.id) &&
    answers.some((answer) => answer.threadId === thread.id)
);

console.log(
  `[eval] judgements checkpoint: ${judgements.length} done, ${unjudgedThreads.length} remaining`
);
await runBatches(
  unjudgedThreads,
  async (thread, index) => {
    const answer = answers.find((item) => item.threadId === thread.id);
    if (!answer) {
      throw new Error(`Missing answer for thread ${thread.id}`);
    }

    console.log(
      `[eval] judging ${index + 1}/${unjudgedThreads.length}: ${thread.name}`
    );
    return judgeThread(thread, answer);
  },
  async (batchJudgements) => {
    judgements.push(...batchJudgements);
    await writeFile(
      judgementsPath,
      JSON.stringify(uniqueByThreadId(judgements), null, 2)
    );
  }
);

const report = makeReport(threads, answers, judgements);
await writeFile(reportPath, report);

console.log(`[eval] wrote ${outputDir}`);
