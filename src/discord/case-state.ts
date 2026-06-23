import {
  formatDebugFields,
  type DebugFieldKey,
  type DebugFields,
} from "../support/debug-fields.js";

export interface SupportCaseState {
  threadId: string;
  sourceMessageUrl?: string;
  route?: string;
  originalMessage?: string;
  fields: DebugFields;
  composioSessionId?: string;
  composioUserId?: string;
  confirmedFields?: DebugFieldKey[];
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
  const { confirmedFields, fields, ...rest } = update;
  const next: SupportCaseState = {
    threadId,
    ...previous,
    ...rest,
    fields: {
      ...(previous?.fields ?? {}),
      ...(fields ?? {}),
    },
    confirmedFields: Array.from(
      new Set([...(previous?.confirmedFields ?? []), ...(confirmedFields ?? [])])
    ),
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

const fieldLabelPatterns: Record<DebugFieldKey, RegExp> = {
  project_id: /\b(project(?:\s+id)?|pr_|proj_)\b/i,
  org_id: /\b(org(?:anization)?(?:\s+id)?|ok_)\b/i,
  org_member_email: /\b(email|member)\b/i,
  user_id: /\b(user(?:\s+id)?)\b/i,
  environment: /\b(environment|env)\b/i,
  time_window: /\b(time\s*window|timeframe|window)\b/i,
  toolkit: /\btoolkit\b/i,
  tool: /\btool(?:\s+slug)?\b/i,
  connected_account_id: /\b(connected\s+account|ca_)\b/i,
  session_id: /\bsession(?:\s+id)?\b/i,
  request_id: /\b(request(?:\s+id)?|req(?:\s+id)?)\b/i,
  log_id: /\blog(?:\s+id)?\b/i,
  trace_id: /\btrace(?:\s+id)?\b/i,
  route: /\b(route|endpoint)\b/i,
  error: /\berror\b/i,
};

export const isStaleConfirmationRequest = (
  state: SupportCaseState,
  reply: string
) => {
  if (!state.confirmedFields?.length) {
    return false;
  }

  const asksToConfirm =
    /\b(confirm|double-check|verify|whether|is this|is that|is it)\b/i.test(
      reply
    );

  return (
    asksToConfirm &&
    state.confirmedFields.some((field) => fieldLabelPatterns[field].test(reply))
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
    state.confirmedFields?.length
      ? `- Confirmed debug fields: ${state.confirmedFields
          .map((field) => `@${field}`)
          .join(", ")}`
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
          "- Latest private-thread follow-up:",
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
    "- Treat this as one ongoing investigation. Do not ask again for a field already listed above, and never ask to confirm a field listed as confirmed.",
  ]
    .filter(Boolean)
    .join("\n");
