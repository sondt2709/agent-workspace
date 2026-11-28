## Context

The approved prototype (`inbox-prototype` v6, 2026-11-27) moves "Needs you" into Tasks and makes the project a filter. The desktop has the routes `w/:ws/inbox`, `w/:ws/tasks` (All tasks) and the project frame `w/:ws/p/:project/{board,list,knowledge,files,settings}`. The phone has the routes Home, Inbox, Tasks and Devices. The old Inbox code (`Inbox.tsx`, `nav-model.ts` `inboxItems`, Kotlin `InboxItems`) already computes the "Needs you" rows and the groups.

## Goals / Non-Goals

**Goals:**
- One place for the items that need the person: Tasks › Needs you, on the desktop and the phone.
- A project filter that selects many projects and works the same in Tasks and in the Inbox.
- Keep the current URLs working: an old link opens the same content in the new place.

**Non-Goals:**
- No change to the task model. A task always has a project.
- No awd route and no file format change.
- No new phone bottom bar item.

## Decisions

1. **Reuse, do not rewrite.** The rows and the detail of the old Inbox tab "Needs you" move into `NeedsYou.tsx` with no change of behavior. `inboxItems` keeps its name and its fixture. Alternative: a new list model. Rejected: the shared fixture `contracts/fixtures/inbox/items.json` already tests both apps.
2. **Tabs in the route.** `?tab=needs|working|all` (default `needs`), `?view=list|board` for All, `?projects=<slug>,<slug>` for the filter. The route keeps the state for Back, as now.
3. **One filter rule in `shared/client`.** `filterByProjects(items, selected)`: an empty selection keeps all items; the value `none` selects the items with no project (the Inbox cards only). Kotlin `ProjectFilter` runs the same cases from `contracts/fixtures/filters/projects.json`.
4. **Old project URLs.** `p/:project` and `p/:project/board|list` redirect to `tasks?tab=all&view=board|list&projects=<project>`. `knowledge`, `files` and `settings` keep the project frame, which has only these 3 tabs. The Projects page links to them.
5. **Updates.** The old tab "Updates" becomes the section "Updates" at the end of Tasks › Needs you: the "Knowledge today" card and the offline devices with changes. Alternative: a fourth tab. Rejected: the prototype has 3 tabs.
6. **Phone bar.** The bar stays Home, Inbox, Tasks, Devices. The prototype showed "More" in place of Home, but Home has the "While you were away" summary (INB-09) and no screen for "More" exists. Tasks gets a tab row and a filter chip.

## Risks / Trade-offs

- [People use the old Inbox for gates] → The top bar "Needs you" button and the Tasks count show the same number; a push still opens the task.
- [Bookmarks of project boards] → Redirects keep them valid.
- [Phone bar differs from the prototype] → Listed in the PR for the person to confirm.

## Migration Plan

No data migration. The release is a major version (`feat!`), because the meaning of the Inbox screen changes.
