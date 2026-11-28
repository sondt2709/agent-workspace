// The source interface of the Inbox (openspec inbox-mattermost, design 2; docs/architecture.md 6.2).
// A source reads the messages of one account of a chat tool and posts the replies of a person.
// Only the awd of the collecting device calls it. The agent never calls a source.

export type ConversationKind = "direct" | "group" | "channel";

/** The account of the token. */
export interface SourceUser {
  id: string;
  username: string;
}

/** A conversation that the account can read. */
export interface SourceConversation {
  id: string;
  /** The name to show: `~billing`, `@lan.pham`, `Lan, Minh, Alex`. */
  name: string;
  kind: ConversationKind;
  /** The time of the last message, ISO 8601, or null. */
  last_message_at: string | null;
}

/** One message of a source, word for word. */
export interface SourceMessage {
  id: string;
  conversation: string;
  /** The root message of the thread, or null for a message with no thread. */
  thread: string | null;
  author: string;
  /** The user id of the author. */
  author_id: string;
  at: string;
  text: string;
  url: string | null;
  /** True for a message of the account itself. */
  mine: boolean;
  /** True when the message mentions the account (`@username`, `@all`, `@channel`, `@here`). */
  mentions_me: boolean;
  /** True when the account wrote the root message of the thread. */
  my_thread: boolean;
  /** The first characters of the root message, for a reply in a thread. */
  quote: string | null;
}

/** The read position of each conversation: the newest time in ms that the collector saw. */
export type SourceCursor = Record<string, number>;

export interface CollectInput {
  /** The conversations to read: each with its cursor time in ms. */
  conversations: { id: string; since: number }[];
}

export interface CollectResult {
  messages: SourceMessage[];
  cursor: SourceCursor;
}

export interface PostInput {
  conversation: string;
  /** The root of the thread for a reply in the thread, else null. */
  root: string | null;
  text: string;
  /** The idempotency key: the reply id of AW (Mattermost `pending_post_id`). */
  pendingId: string;
}

export interface PostResult {
  post: string;
  url: string | null;
}

/** A source plugin: one account of a chat tool. */
export interface Source {
  readonly kind: string;
  me(): Promise<SourceUser>;
  conversations(): Promise<SourceConversation[]>;
  collect(input: CollectInput): Promise<CollectResult>;
  post(input: PostInput): Promise<PostResult>;
  /** The post of an earlier `post` with this idempotency key, or null (a retry after a crash). */
  findPending(conversation: string, pendingId: string): Promise<PostResult | null>;
}

/** The error of a source call, with a code that awd can show. */
export interface SourceErrorInfo {
  code: "unauthorized" | "not_found" | "network" | "server";
  message: string;
}
