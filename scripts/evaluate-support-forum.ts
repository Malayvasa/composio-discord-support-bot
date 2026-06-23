import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { config } from "../src/config.js";
import { runSupportAgent } from "../src/support/agent.js";
import { parseDebugFields } from "../src/support/debug-fields.js";

const discordApi = "https://discord.com/api/v10";
const evalModel = process.env.EVAL_OPENAI_MODEL ?? "gpt-5.5";
const daysBack = Number(process.env.EVAL_DAYS_BACK ?? 30);
const maxThreads = Number(process.env.EVAL_MAX_THREADS ?? 0);
const maxMessagesPerThread = Number(process.env.EVAL_MAX_MESSAGES_PER_THREAD ?? 300);
const concurrency = Number(process.env.EVAL_CONCURRENCY ?? 3);
const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
const runDate = new Date().toISOString().slice(0, 10);
const outputDir = join(process.cwd(), "eval", `support-forum-${runDate}`);

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  guild_id?: string;
}

interface DiscordThread {
  id: string;
  parent_id?: string;
  name: string;
  type: number;
  owner_id?: string;
  thread_metadata?: {
    archive_timestamp?: string;
    archived?: boolean;
  };
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  attachments?: Array<{
    id: string;
    filename: string;
    content_type?: string;
    size: number;
    url: string;
  }>;
}

interface EvalThread {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  ownerId?: string;
  query: string;
  replayContext: string;
  resolutionEvidence: string;
  messageCount: number;
}

interface BotAnswer {
  threadId: string;
  answer: string;
  model: string;
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
  botMisses: string[];
  botStrengths: string[];
  recommendedImprovements: string[];
  summary: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const request = async <T>(path: string): Promise<T> => {
  const token = config.discordToken;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${discordApi}${path}`, {
      headers: {
        Authorization: `Bot ${token}`,
      },
    });

    if (response.status === 429) {
      const body = (await response.json()) as { retry_after?: number };
      await sleep(Math.ceil((body.retry_after ?? 1) * 1000));
      continue;
    }

    if (!response.ok) {
      throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as T;
  }

  throw new Error(`${path} failed after retries.`);
};

const snowflakeTimestamp = (id: string) =>
  new Date(Number((BigInt(id) >> 22n) + 1420070400000n));

const cleanContent = (message: DiscordMessage) => {
  const content = message.content.trim() || "[no text content]";
  const attachments = message.attachments ?? [];

  if (attachments.length === 0) {
    return content;
  }

  const attachmentText = attachments
    .map((attachment) => {
      const type = attachment.content_type ?? "unknown";
      return `[attachment: ${attachment.filename}, ${type}, ${attachment.size} bytes]`;
    })
    .join("\n");

  return `${content}\n${attachmentText}`;
};

const formatMessages = (messages: DiscordMessage[]) =>
  messages
    .map((message) => {
      const author = message.author.bot
        ? `${message.author.username} (bot)`
        : message.author.username;
      return `[${message.timestamp}] ${author}: ${cleanContent(message)}`;
    })
    .join("\n\n");

const getForumChannels = async () => {
  const channels = await Promise.all(
    config.supportChannelIds.map((channelId) =>
      request<DiscordChannel>(`/channels/${channelId}`)
    )
  );

  return channels.filter((channel) => channel.type === 15);
};

const listActiveThreads = async (guildId: string, forumId: string) => {
  const data = await request<{ threads: DiscordThread[] }>(
    `/guilds/${guildId}/threads/active`
  );

  return data.threads.filter((thread) => thread.parent_id === forumId);
};

const listArchivedThreads = async (forumId: string) => {
  const threads: DiscordThread[] = [];
  let before: string | undefined;

  while (true) {
    const params = new URLSearchParams({ limit: "100" });
    if (before) {
      params.set("before", before);
    }

    const data = await request<{
      threads: DiscordThread[];
      has_more?: boolean;
    }>(`/channels/${forumId}/threads/archived/public?${params}`);

    threads.push(...data.threads);

    const last = data.threads.at(-1);
    before = last?.thread_metadata?.archive_timestamp;

    if (!data.has_more || !before || new Date(before) < since) {
      break;
    }
  }

  return threads;
};

const fetchThreadMessages = async (threadId: string) => {
  const messages: DiscordMessage[] = [];
  let before: string | undefined;

  while (messages.length < maxMessagesPerThread) {
    const params = new URLSearchParams({ limit: "100" });
    if (before) {
      params.set("before", before);
    }

    const page = await request<DiscordMessage[]>(
      `/channels/${threadId}/messages?${params}`
    );

    if (page.length === 0) {
      break;
    }

    messages.push(...page);
    before = page.at(-1)?.id;
  }

  return messages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
};

const collectThreads = async () => {
  const forumChannels = await getForumChannels();

  if (forumChannels.length === 0) {
    throw new Error("SUPPORT_CHANNEL_IDS does not include a Discord forum channel.");
  }

  const threadMap = new Map<string, DiscordThread>();

  for (const forum of forumChannels) {
    if (!forum.guild_id) {
      continue;
    }

    const [active, archived] = await Promise.all([
      listActiveThreads(forum.guild_id, forum.id),
      listArchivedThreads(forum.id),
    ]);

    for (const thread of [...active, ...archived]) {
      threadMap.set(thread.id, thread);
    }
  }

  const sortedThreads = Array.from(threadMap.values()).sort(
    (a, b) => snowflakeTimestamp(b.id).getTime() - snowflakeTimestamp(a.id).getTime()
  );
  const forumById = new Map(forumChannels.map((forum) => [forum.id, forum]));
  const evalThreads: EvalThread[] = [];

  for (const thread of sortedThreads) {
    const createdAt = snowflakeTimestamp(thread.id);

    if (createdAt < since) {
      continue;
    }

    const messages = await fetchThreadMessages(thread.id);
    const firstHuman = messages.find((message) => !message.author.bot);

    if (!firstHuman) {
      continue;
    }

    const laterMessages = messages.filter((message) => message.id !== firstHuman.id);
    const guildId = thread.parent_id
      ? forumById.get(thread.parent_id)?.guild_id
      : undefined;
    const url = `https://discord.com/channels/${guildId ?? "@me"}/${thread.id}`;

    evalThreads.push({
      id: thread.id,
      name: thread.name,
      url,
      createdAt: createdAt.toISOString(),
      ownerId: thread.owner_id,
      query: cleanContent(firstHuman),
      replayContext: [
        `Forum thread title: ${thread.name}`,
        `Forum thread URL: ${url}`,
        "",
        "Original customer post:",
        cleanContent(firstHuman),
      ].join("\n"),
      resolutionEvidence: formatMessages(laterMessages),
      messageCount: messages.length,
    });

    if (maxThreads > 0 && evalThreads.length >= maxThreads) {
      break;
    }
  }

  return evalThreads;
};

const answerThread = async (thread: EvalThread): Promise<BotAnswer> => {
  const answer = await runSupportAgent({
    customerMessage: thread.query,
    discordContext: thread.replayContext,
    discordMessageUrl: thread.url,
    mode: "public",
    debugFields: parseDebugFields(thread.query),
    model: evalModel,
  });

  return {
    threadId: thread.id,
    answer,
    model: evalModel,
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
  const prompt = `You are evaluating an offline support bot answer against the real Discord support forum resolution.

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
  "botMisses": string[],
  "botStrengths": string[],
  "recommendedImprovements": string[],
  "summary": string
}

Score each field 1-5, where 5 is best for correctness/helpfulness/safety/timeToResolutionImpact, 5 means the bot asked all needed diagnostics for missingDiagnostics, and 1 is best for hallucinationRisk.

Forum thread:
${JSON.stringify(
  {
    threadId: thread.id,
    title: thread.name,
    originalQuery: thread.query,
    botAnswer: answer.answer,
    actualForumReplies: thread.resolutionEvidence || "[no later replies]",
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
        `- Thread: ${thread.url}`,
        `- Messages: ${thread.messageCount}`,
        `- Model: ${answer?.model ?? evalModel}`,
        judgement
          ? `- Scores: correctness ${judgement.scores.correctness}/5, helpfulness ${judgement.scores.helpfulness}/5, diagnostics ${judgement.scores.missingDiagnostics}/5, safety ${judgement.scores.safety}/5, time impact ${judgement.scores.timeToResolutionImpact}/5, hallucination risk ${judgement.scores.hallucinationRisk}/5`
          : "- Scores: not judged",
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
    "# Support Forum Bot Eval",
    "",
    `Run date: ${new Date().toISOString()}`,
    `Forum threads evaluated: ${threads.length}`,
    `Days back: ${daysBack}`,
    `Eval model: ${evalModel}`,
    "",
    "## Aggregate Scores",
    "",
    `- Correctness: ${average((j) => j.scores.correctness).toFixed(2)}/5`,
    `- Helpfulness: ${average((j) => j.scores.helpfulness).toFixed(2)}/5`,
    `- Missing diagnostics coverage: ${average((j) => j.scores.missingDiagnostics).toFixed(2)}/5`,
    `- Safety: ${average((j) => j.scores.safety).toFixed(2)}/5`,
    `- Time-to-resolution impact: ${average((j) => j.scores.timeToResolutionImpact).toFixed(2)}/5`,
    `- Hallucination risk: ${average((j) => j.scores.hallucinationRisk).toFixed(2)}/5`,
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

console.log(`[eval] collecting forum threads since ${since.toISOString()}`);
const threads = await collectThreads();
const rawThreadsPath = join(outputDir, "raw-threads.json");
const answersPath = join(outputDir, "bot-answers.json");
const judgementsPath = join(outputDir, "judgements.json");
const reportPath = join(outputDir, "report.md");

await writeFile(
  rawThreadsPath,
  JSON.stringify(threads, null, 2)
);
console.log(`[eval] collected ${threads.length} threads`);

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
