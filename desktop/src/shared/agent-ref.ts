// The `agent@device` check of the renderer (desktop-shell review 12). It is the `agentRef` rule of
// `@aw/schema` (shared/schema/src/common.ts); src/main/agent-ref.test.ts compares both. The renderer does not
// import `@aw/schema`, because that package has Node code.
const AGENT_REF = /^[a-z][a-z0-9-]*@[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True for an assignee that the assign route of awd accepts, for example `claude@ubuntu-01`. */
export function isAgentRef(text: string): boolean {
  return text.length <= 127 && AGENT_REF.test(text);
}
