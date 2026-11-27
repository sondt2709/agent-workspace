## 1. Contract and docs

- [x] 1.1 Write the decision `docs/decisions/2026-11-27-inbox-and-tasks.md` (Inbox of messages, Tasks with Needs you, project filter, cards with no project, one collecting device); update `docs/design.md` 8.2 to 8.4 and 9 and `docs/prd.md` 6 and 8.7
- [x] 1.2 `shared/client`: `filterByProjects` and `projectFilterLabel`, with `contracts/fixtures/filters/projects.json` and tests

## 2. Desktop

- [x] 2.1 `AppShell.tsx` and `nav-model.ts`: the new sidebar items and counts, no project rows, the top bar "Needs you" opens Tasks › Needs you
- [x] 2.2 `ProjectFilter.tsx`: the chip, the search list, the route parameter `projects`
- [x] 2.3 `NeedsYou.tsx` from the "Needs you" part of `Inbox.tsx`, with the section "Updates"; `TaskViews.tsx`: Tasks with the tabs Needs you, Working and All, List and Board, and the filter
- [x] 2.4 `Projects.tsx` and `routes.tsx`: the Projects page, the redirects of the old project URLs, the project frame with Knowledge, Files and Settings
- [x] 2.5 `CommandMenu.tsx` and the screen keys: ⌘2 opens Tasks; the breadcrumb names
- [x] 2.6 Desktop tests for each new rule, each able to fail

## 3. Android

- [x] 3.1 `control`: `ProjectFilter` from the shared fixture, the Tasks tabs in `Navigation.kt`; tests
- [x] 3.2 `app`: Tasks with the tab row, the filter chip and its sheet; the item screen of Needs you

## 4. Verify

- [x] 4.1 `task check` (TypeScript and Android) and `task leakcheck`
- [x] 4.2 Screenshots after: desktop Tasks (3 tabs, filter open), Projects; phone Tasks
