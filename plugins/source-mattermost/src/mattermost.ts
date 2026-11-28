// The Mattermost source (openspec inbox-mattermost, design 1 and 2): the one adapter module around
// `Client4` of `@mattermost/client`, the official REST client (API v4). Only the awd of the
// collecting device uses it, with the personal access token of the person.
import type {
  CollectInput,
  CollectResult,
  ConversationKind,
  PostInput,
  PostResult,
  Source,
  SourceConversation,
  SourceErrorInfo,
  SourceMessage,
  SourceUser,
} from "@aw/plugin-api";
import { Client4 } from "@mattermost/client";
import type { ServerChannel } from "@mattermost/types/channels";
import type { Post } from "@mattermost/types/posts";
import type { UserProfile } from "@mattermost/types/users";

/** The post prop that holds the reply id of AW: `findPending` looks for it (design 7). */
export const REPLY_PROP = "aw_reply";
/** The most posts that one collect reads in one conversation. */
const MAX_POSTS_PER_COLLECT = 1000;
/** The posts that `findPending` reads: the newest of the conversation. */
const PENDING_SCAN = 100;
const QUOTE_CHARS = 200;

export class SourceError extends Error implements SourceErrorInfo {
  readonly code: SourceErrorInfo["code"];

  constructor(code: SourceErrorInfo["code"], message: string) {
    super(message);
    this.name = "SourceError";
    this.code = code;
  }
}

/** The error code of a failed `Client4` call. */
function sourceError(error: unknown): SourceError {
  const status = (error as { status_code?: number }).status_code;
  const text = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403) return new SourceError("unauthorized", text);
  if (status === 404) return new SourceError("not_found", text);
  if (status === undefined || status === 0) return new SourceError("network", text);
  return new SourceError("server", text);
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw sourceError(error);
  }
}

function kindOf(channel: ServerChannel): ConversationKind {
  if (channel.type === "D") return "direct";
  if (channel.type === "G") return "group";
  return "channel";
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** True when the text mentions the user: `@username` or a mention of the whole channel. */
export function mentions(text: string, username: string): boolean {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^\\w.-])@(${escaped}|all|channel|here)(?![\\w-]|\\.[\\w])`, "i");
  return pattern.test(text);
}

export interface MattermostOptions {
  /** The server URL, for example `https://chat.example.com`. */
  url: string;
  token: string;
  /** A client for tests; else a new `Client4`. */
  client?: Client4;
}

export class MattermostSource implements Source {
  readonly kind = "mattermost";
  readonly #client: Client4;
  readonly #url: string;
  #me: UserProfile | null = null;
  #team: string | null = null;
  readonly #names = new Map<string, string>();
  readonly #channels = new Map<string, ServerChannel>();
  readonly #roots = new Map<string, Post>();

  constructor(options: MattermostOptions) {
    this.#url = options.url.replace(/\/+$/, "");
    this.#client = options.client ?? new Client4();
    this.#client.setUrl(this.#url);
    this.#client.setToken(options.token);
  }

  async #profile(): Promise<UserProfile> {
    this.#me ??= await call(() => this.#client.getMe());
    return this.#me;
  }

  async me(): Promise<SourceUser> {
    const me = await this.#profile();
    return { id: me.id, username: me.username };
  }

  async #userNames(ids: string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !this.#names.has(id));
    if (missing.length === 0) return;
    const users = await call(() => this.#client.getProfilesByIds(missing));
    for (const user of users) this.#names.set(user.id, user.username);
  }

  /** The name to show of a channel: `~billing`, `@lan.pham`, or the names of a group. */
  async #nameOf(channel: ServerChannel, me: UserProfile): Promise<string> {
    if (channel.type === "D") {
      const other = channel.name.split("__").find((id) => id !== me.id) ?? me.id;
      await this.#userNames([other]);
      return `@${this.#names.get(other) ?? other}`;
    }
    if (channel.type === "G") return channel.display_name;
    return `~${channel.name}`;
  }

  async conversations(): Promise<SourceConversation[]> {
    const me = await this.#profile();
    const teams = await call(() => this.#client.getMyTeams());
    this.#team = teams[0]?.name ?? null;
    const seen = new Map<string, ServerChannel>();
    for (const team of teams) {
      for (const channel of await call(() => this.#client.getMyChannels(team.id, false))) {
        if (channel.delete_at === 0) seen.set(channel.id, channel);
      }
    }
    const result: SourceConversation[] = [];
    for (const channel of seen.values()) {
      this.#channels.set(channel.id, channel);
      result.push({
        id: channel.id,
        name: await this.#nameOf(channel, me),
        kind: kindOf(channel),
        last_message_at: channel.last_post_at > 0 ? isoOf(channel.last_post_at) : null,
      });
    }
    return result.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async #root(id: string): Promise<Post | null> {
    const known = this.#roots.get(id);
    if (known) return known;
    try {
      const post = await this.#client.getPost(id);
      this.#roots.set(id, post);
      return post;
    } catch (error) {
      const failure = sourceError(error);
      if (failure.code === "not_found") return null;
      throw failure;
    }
  }

  #link(post: Post): string | null {
    return this.#team === null ? null : `${this.#url}/${this.#team}/pl/${post.id}`;
  }

  async collect(input: CollectInput): Promise<CollectResult> {
    const me = await this.#profile();
    if (this.#team === null) await this.conversations();
    const messages: SourceMessage[] = [];
    const cursor: Record<string, number> = {};
    for (const { id, since } of input.conversations) {
      cursor[id] = since;
      const list = await call(() => this.#client.getPostsSince(id, since));
      const posts = list.order
        .map((postId) => list.posts[postId]!)
        // getPostsSince gives edited and deleted posts too: only new posts (design 5).
        .filter((post) => post.create_at > since)
        .sort((a, b) => a.create_at - b.create_at)
        .slice(0, MAX_POSTS_PER_COLLECT);
      for (const post of posts) this.#roots.set(post.id, post);
      await this.#userNames(posts.map((post) => post.user_id));
      for (const post of posts) {
        cursor[id] = Math.max(cursor[id], post.create_at);
        if (post.delete_at > 0 || post.type.startsWith("system_")) continue;
        const root = post.root_id === "" ? null : await this.#root(post.root_id);
        messages.push({
          id: post.id,
          conversation: id,
          thread: post.root_id === "" ? null : post.root_id,
          author: this.#names.get(post.user_id) ?? post.user_id,
          author_id: post.user_id,
          at: isoOf(post.create_at),
          text: post.message,
          url: this.#link(post),
          mine: post.user_id === me.id,
          mentions_me: mentions(post.message, me.username),
          my_thread: root !== null && root.user_id === me.id,
          quote: root === null ? null : root.message.slice(0, QUOTE_CHARS),
        });
      }
    }
    return { messages, cursor };
  }

  async post(input: PostInput): Promise<PostResult> {
    if (this.#team === null) await this.conversations();
    const post = await call(() =>
      this.#client.createPost({
        channel_id: input.conversation,
        root_id: input.root ?? "",
        message: input.text,
        // The server returns the first post for a repeat of this id in a short time.
        pending_post_id: input.pendingId,
        props: { [REPLY_PROP]: input.pendingId },
      } as Partial<Post> as Post),
    );
    return { post: post.id, url: this.#link(post) };
  }

  async findPending(conversation: string, pendingId: string): Promise<PostResult | null> {
    if (this.#team === null) await this.conversations();
    const list = await call(() => this.#client.getPosts(conversation, 0, PENDING_SCAN));
    for (const id of list.order) {
      const post = list.posts[id]!;
      const props = post.props as Record<string, unknown> | undefined;
      if (props?.[REPLY_PROP] === pendingId && post.delete_at === 0) {
        return { post: post.id, url: this.#link(post) };
      }
    }
    return null;
  }
}
