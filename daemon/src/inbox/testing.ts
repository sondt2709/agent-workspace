// Test helpers of the Inbox: a source in memory with the shape of the Mattermost plugin.
import type {
  CollectInput,
  PostInput,
  Source,
  SourceConversation,
  SourceMessage,
} from "@aw/plugin-api";

/** A source in memory: the conversations, the posts and each post of a reply. */
export class FakeSource implements Source {
  readonly kind = "mattermost";
  readonly conversationList: SourceConversation[] = [
    { id: "dm-lan", name: "@lan.pham", kind: "direct", last_message_at: null },
    { id: "ch-billing", name: "~billing", kind: "channel", last_message_at: null },
    { id: "ch-random", name: "~random", kind: "channel", last_message_at: null },
  ];
  readonly messages: SourceMessage[] = [];
  readonly posts: { pendingId: string; text: string; root: string | null; id: string }[] = [];
  /** The posts that fail once with a network error (a crash before the reply result). */
  failNext = 0;

  me() {
    return Promise.resolve({ id: "u-alex", username: "alex" });
  }

  conversations() {
    return Promise.resolve(this.conversationList);
  }

  add(m: Partial<SourceMessage> & { id: string; conversation: string; text: string; at: string }) {
    this.messages.push({
      thread: null,
      author: "lan.pham",
      author_id: "u-lan",
      url: null,
      mine: false,
      mentions_me: /@alex\b/.test(m.text),
      my_thread: false,
      quote: null,
      ...m,
    });
  }

  collect(input: CollectInput) {
    const out: SourceMessage[] = [];
    const cursor: Record<string, number> = {};
    for (const { id, since } of input.conversations) {
      cursor[id] = since;
      for (const m of this.messages) {
        const at = Date.parse(m.at);
        if (m.conversation === id && at > since) {
          out.push(m);
          cursor[id] = Math.max(cursor[id], at);
        }
      }
    }
    return Promise.resolve({ messages: out, cursor });
  }

  /** The calls of post(): the real server drops a repeated pending id only for a short time. */
  postCalls = 0;

  post(input: PostInput) {
    this.postCalls += 1;
    const known = this.posts.find((p) => p.pendingId === input.pendingId);
    if (known) return Promise.resolve({ post: known.id, url: null });
    const id = `post-${this.posts.length + 1}`;
    this.posts.push({ pendingId: input.pendingId, text: input.text, root: input.root, id });
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(Object.assign(new Error("socket hang up"), { code: "network" }));
    }
    return Promise.resolve({ post: id, url: `https://chat.example.com/acme/pl/${id}` });
  }

  findPending(_conversation: string, pendingId: string) {
    const known = this.posts.find((p) => p.pendingId === pendingId);
    return Promise.resolve(known ? { post: known.id, url: null } : null);
  }
}
