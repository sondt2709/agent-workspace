# CLAUDE.md

Guidance for Claude Code in this repository.

Agent Workspace (AW) lets a person manage the work of AI coding agents from the desktop app or the phone.
The agents run on the person's own computers and keep working while the laptop is closed.

Read `docs/principles.md` first and obey it. The rules for all coding agents are in `AGENTS.md`:

@AGENTS.md

## Only for Claude Code
- Use the OpenSpec skills for each change: `/opsx:propose`, `/opsx:apply`, `/opsx:verify`, `/opsx:archive`.
- The AW plugin in `plugins/agent-claude/plugin/` registers the AW MCP server `aw`. Keep `"name": "aw"` in its `.claude-plugin/plugin.json`, so the tools are `mcp__plugin_aw_aw__*`; a contract test checks it. Do not register the server again in a project `.mcp.json`.
- Keep each `SKILL.md` of the plugin below 6,000 characters. A test checks it.
- Never run `git commit` or `git push` unless a maintainer asks for it.
