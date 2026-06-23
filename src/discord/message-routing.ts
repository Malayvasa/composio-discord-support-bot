import { ChannelType, type Client, type Message } from "discord.js";
import { config } from "../config.js";

export const isPrivateThread = (message: Message) =>
  message.channel.type === ChannelType.PrivateThread;

export const isPublicThread = (message: Message) =>
  message.channel.type === ChannelType.PublicThread ||
  message.channel.type === ChannelType.AnnouncementThread;

export const getParentChannelId = (message: Message) =>
  "parentId" in message.channel ? message.channel.parentId : undefined;

const getThreadOwnerId = (message: Message) =>
  "ownerId" in message.channel ? message.channel.ownerId : undefined;

export const getChannelName = (message: Message) =>
  "name" in message.channel && typeof message.channel.name === "string"
    ? message.channel.name
    : undefined;

const isAllowedForumThreadOwner = (message: Message) => {
  if (!isPublicThread(message) || config.supportForumAuthorIds.length === 0) {
    return true;
  }

  const ownerId = getThreadOwnerId(message);
  return ownerId ? config.supportForumAuthorIds.includes(ownerId) : false;
};

export const shouldRespond = (client: Client, message: Message) => {
  if (message.author.bot) {
    return false;
  }

  if (isPrivateThread(message)) {
    return true;
  }

  if (!message.guild) {
    return true;
  }

  const mentioned = client.user ? message.mentions.has(client.user) : false;
  const parentChannelId = getParentChannelId(message);
  const inConfiguredSupportSurface =
    config.supportChannelIds.length === 0 ||
    config.supportChannelIds.includes(message.channel.id) ||
    (parentChannelId
      ? config.supportChannelIds.includes(parentChannelId)
      : false);
  const inRestrictedForumThread =
    isPublicThread(message) &&
    typeof parentChannelId === "string" &&
    config.supportChannelIds.includes(parentChannelId) &&
    !isAllowedForumThreadOwner(message);

  if (inRestrictedForumThread) {
    return false;
  }

  const command = message.content.trim().startsWith("!support");
  return mentioned || command || inConfiguredSupportSurface;
};

export const isExplicitRequest = (client: Client, message: Message) => {
  const mentioned = client.user ? message.mentions.has(client.user) : false;
  const command = message.content.trim().startsWith("!support");

  return mentioned || command;
};

export const isAutoForumPost = (message: Message) => {
  const parentChannelId = getParentChannelId(message);

  return (
    isPublicThread(message) &&
    typeof parentChannelId === "string" &&
    config.supportChannelIds.includes(parentChannelId)
  );
};

export const isLikelyNonSupportPost = (
  message: Message,
  customerMessage: string
) => {
  const text = `${getChannelName(message) ?? ""} ${customerMessage}`.toLowerCase();

  return /\b(hiring|job application|job specialist|remote role|rlhf|we'?re hiring|approved to be judge|hackathon judge)\b/i.test(
    text
  );
};

export const isGenericDiagnosticsFollowup = (message: string) =>
  /^(what can you tell me|what do you see|what is happening|what's happening|any update|update\??|can you check|check this|continue|go on|what happened|thoughts\??)\??$/i.test(
    message.trim()
  );

export const shouldTagStaff = (
  message: Message,
  customerMessage: string,
  answer: string,
  staffUserIds: string[]
) => {
  if (staffUserIds.length === 0 || isPrivateThread(message)) {
    return false;
  }

  const text = `${getChannelName(message) ?? ""} ${customerMessage} ${answer}`.toLowerCase();

  return /\b(staff action|needs staff|fully blocked|urgent|production is blocked|prod is blocked|outage|incident|security|billing|refund|frozen|cannot upgrade|can't upgrade|5\d\d|503|service down|api down|unresponsive|provider bug|toolkit bug|maintainer)\b/i.test(
    text
  );
};

export const formatStaffMentions = (staffUserIds: string[]) =>
  staffUserIds.map((userId) => `<@${userId}>`).join(" ");

export const cleanCustomerMessage = (client: Client, message: Message) => {
  let content = message.content.trim();

  if (client.user) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "");
  }

  return content.replace(/^!support\s*/i, "").trim();
};
