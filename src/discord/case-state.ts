import { formatDebugFields, type DebugFields } from "../support/debug-fields.js";

export interface SupportCaseState {
  threadId: string;
  sourceMessageUrl?: string;
  route?: string;
  originalMessage?: string;
  fields: DebugFields;
  composioSessionId?: string;
  composioUserId?: string;
  lastCustomerMessage?: string;
  lastAssistantReply?: string;
  updatedAt: string;
}

const supportCases = new Map<string, SupportCaseState>();

const now = () => new Date().toISOString();

export const getSupportCaseState = (threadId: string) =>
  supportCases.get(threadId);

export const upsertSupportCaseState = (
  threadId: string,
  update: Partial<Omit<SupportCaseState, "threadId" | "updatedAt">>
) => {
  const previous = supportCases.get(threadId);
  const { fields, ...rest } = update;
  const next: SupportCaseState = {
    threadId,
    ...previous,
    ...rest,
    fields: {
      ...(previous?.fields ?? {}),
      ...(fields ?? {}),
    },
    updatedAt: now(),
  };

  supportCases.set(threadId, next);
  return next;
};

const normalizeReply = (reply: string) => reply.trim().replace(/\s+/g, " ");

export const isDuplicateCaseReply = (
  threadId: string,
  reply: string
) => {
  const previousReply = supportCases.get(threadId)?.lastAssistantReply;

  return Boolean(
    previousReply && normalizeReply(previousReply) === normalizeReply(reply)
  );
};

export const formatSupportCaseState = (state: SupportCaseState) =>
  [
    "Private support case state:",
    `- Discord private thread ID: ${state.threadId}`,
    state.sourceMessageUrl
      ? `- Original Discord message URL: ${state.sourceMessageUrl}`
      : "",
    state.route ? `- Route: ${state.route}` : "",
    state.composioSessionId
      ? `- Composio support session ID: ${state.composioSessionId}`
      : "",
    state.composioUserId
      ? `- Composio support user ID: ${state.composioUserId}`
      : "",
    "- Accumulated debug fields:",
    formatDebugFields(state.fields)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
    state.originalMessage
      ? [
          "- Original customer message:",
          "```txt",
          state.originalMessage,
          "```",
        ].join("\n")
      : "",
    state.lastCustomerMessage
      ? [
          "- Latest staff/customer follow-up:",
          "```txt",
          state.lastCustomerMessage,
          "```",
        ].join("\n")
      : "",
    state.lastAssistantReply
      ? [
          "- Previous assistant reply in this case:",
          "```txt",
          state.lastAssistantReply,
          "```",
        ].join("\n")
      : "",
    "- Treat this as one ongoing investigation. Do not ask again for a field already listed above.",
  ]
    .filter(Boolean)
    .join("\n");
