## MODIFIED Requirements

### Requirement: Session context
`buildContext` SHALL select the shared files and the files of the task's project. "Read now" SHALL have the rules, the `always` files, the `manual` files that the title or the first message names, and the `files` files with a glob that matches a task path. The task paths SHALL be the given paths and the paths named in the title and the first message (`namedPaths`: a token with a `/` or a file extension, with no URL, at most 200). "Read when relevant" SHALL list the `auto` files with their description, and "Read before you change matching files" SHALL list the other `files` files with their globs. When the size of "Read now" is over the load limit (default 40,000 characters), it SHALL drop files in the reverse priority order and give a warning for each dropped file. The text SHALL be at most 9,000 characters; a list that does not fit SHALL end with a warning line and the count of the files that are not listed.

#### Scenario: Over the budget
- **WHEN** the "Read now" files are 52,000 characters and the limit is 40,000
- **THEN** the context drops the files of the lowest priority until the sum fits, and each dropped file has a warning with its size and the limit

#### Scenario: Files mode
- **WHEN** a file has `apply: files` and `globs: ["src/api/**"]`, and the task path is `src/api/invoice.ts`
- **THEN** the file is in "Read now"

#### Scenario: Path named in the first message
- **WHEN** a file has `apply: files` and `globs: ["src/api/**"]`, no path is given, and the first message is "Fix the rounding in `src/api/invoice.ts`."
- **THEN** the file is in "Read now" with the reason "a task path matches src/api/**"

#### Scenario: URL is not a path
- **WHEN** the first message names only `https://example.com/src/api/x.ts`
- **THEN** no task path matches `src/api/**`
