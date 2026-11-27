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

## Test the Android UI
JVM tests do not find all layout bugs. Check each UI change in the app on an emulator.
- Use an emulator of your own. Never use an emulator that another session uses.
- Start awd with the fake agent (`AW_CLAUDE`). Pair the app as Pixel 9.
- Read the screen with `android layout --flat --no-metrics`, and check the screenshot too.
- Only one UiAutomation client can connect. Do not use `android layout`, `uiautomator dump` and Appium together.

Check these 2 frequent bugs on each screen that you change:
- A button is higher than the other items in its row. Compare the heights in `bounds`. `ControlHeightTest` sets 36 dp.
- A list jumps when you scroll up. Scroll up in small steps. Each row must keep its height (`ScrollBackTest`).

For each fix of these bugs, add a JVM test (`task android:screenshots`).
