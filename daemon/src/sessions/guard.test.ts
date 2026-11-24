import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardReason, teammateGateReason, type GuardContext } from "./guard.ts";

const context: GuardContext = {
  home: "/home/user/.aw",
  userHome: "/home/user",
  workspaces: ["/home/user/AW/Personal"],
  credentialsDir: "/home/user/.aw/sessions/s1/credentials",
  cwd: "/home/user/.aw/worktrees/aw-AW-1",
};

const bash = (command: string) => guardReason("Bash", { command }, context);

describe("guardReason: Bash", () => {
  it("denies a person command, also in a wrapper", () => {
    for (const command of [
      "aw gate answer 01a2 Allow",
      'sh -c "aw gate answer g3 yes"',
      "bash -lc 'aw   task  assign AW-2 claude@ubuntu-01'",
      "true && aw session stop 01a2",
      "echo x | aw queue claude@ubuntu-01",
      "/opt/aw/bin/aw kb accept 1",
      "$(aw doctor)",
      "env -u AW_SESSION aw credential get stripe-test",
      "aw project edit billing-api --permission-mode skip",
      "node daemon/src/bin/aw.ts gate answer g3 yes",
      "/usr/local/lib/node_modules/@aw/daemon/bin/aw.js device approve 01a2",
    ]) {
      expect(bash(command), command).toMatch(/command of a person/);
    }
  });

  it("allows the agent commands and other words", () => {
    for (const command of [
      'aw ask "Which limit?"',
      "aw task create --title x --first-message y",
      "aw gate open --kind custom --title x",
      "echo 'the gate answer is in the thread'",
      "law gate answer",
      "npm test",
    ]) {
      expect(bash(command), command).toBeNull();
    }
  });

  it("denies the awd socket and the AW state folder, and allows the worktrees", () => {
    expect(bash("curl --unix-socket /home/user/.aw/run/awd.sock http://x/v1")).toMatch(/socket/);
    expect(bash("cat ~/.aw/sessions/s2/mcp-token")).toMatch(/state folder/);
    expect(bash("cat /home/user/.aw/keys/device")).toMatch(/state folder/);
    expect(bash('cat "$AW_HOME/identity.yaml"')).toMatch(/state folder/);
    expect(bash("cat $HOME/.aw/keys/device")).toMatch(/state folder/);
    expect(bash('cat "${HOME}/.aw/sessions/s2/mcp-token"')).toMatch(/state folder/);
    expect(bash("ls $HOME/.aw/worktrees/aw-AW-1")).toBeNull();
    expect(bash("ls $HOME/.aws/config")).toBeNull();
    expect(bash("cat /home/user/.aw/worktrees/aw-AW-1/README.md")).toBeNull();
    expect(bash("ls ~/.aws/config")).toBeNull();
    expect(bash("git log --oneline -3")).toBeNull();
  });

  it("denies a way out of the worktrees and the credentials, and allows the own credentials", () => {
    expect(bash("cat ~/.aw/worktrees/../keys/device")).toMatch(/state folder/);
    expect(bash("cat /home/user/.aw/worktrees/aw-AW-1/../../sessions/s2/mcp-token")).toMatch(
      /state folder/,
    );
    // The cwd is the worktree <home>/worktrees/aw-AW-1: ../../keys is in AW_HOME.
    expect(bash("cat ../../keys/device")).toMatch(/state folder/);
    expect(bash("cd .. && ls ../sessions")).toMatch(/state folder/);
    expect(bash("cat ../aw-AW-2/README.md")).toBeNull();
    expect(bash("cat ./src/../README.md")).toBeNull();
    // The own credentials, also by their path (the agent expands $AW_CREDENTIALS_DIR).
    expect(bash("cat /home/user/.aw/sessions/s1/credentials/stripe-test")).toBeNull();
    expect(bash('curl -H "X: $(cat ~/.aw/sessions/s1/credentials/stripe-test)" x')).toBeNull();
    expect(bash("cat /home/user/.aw/sessions/s1/credentials/../mcp-token")).toMatch(/state folder/);
    expect(bash("cat /home/user/.aw/sessions/s2/credentials/stripe-test")).toMatch(/state folder/);
  });

  it("denies the workspace folder", () => {
    expect(bash("echo x >> /home/user/AW/Personal/tasks/log/macbook-pro.jsonl")).toMatch(
      /workspace folder/,
    );
    expect(bash("echo x >> $HOME/AW/Personal/tasks/log/macbook-pro.jsonl")).toMatch(
      /workspace folder/,
    );
    expect(bash("echo x >> ~/AW/Personal/tasks/log/macbook-pro.jsonl")).toMatch(/workspace folder/);
  });
});

describe("guardReason: file tools", () => {
  it("denies an edit in AW_HOME or the workspace, and allows the worktree", () => {
    expect(
      guardReason("Write", { file_path: "/home/user/.aw/sessions/s1/settings.json" }, context),
    ).toMatch(/AW files/);
    expect(
      guardReason("Edit", { file_path: "/home/user/AW/Personal/tasks/workspace.yaml" }, context),
    ).toMatch(/workspace folder/);
    expect(guardReason("Write", { file_path: "src/app.ts" }, context)).toBeNull();
    expect(guardReason("Write", { file_path: "../../config.yaml" }, context)).toMatch(/AW files/);
    expect(guardReason("NotebookEdit", { notebook_path: "~/.aw/run/mcp.port" }, context)).toMatch(
      /AW files/,
    );
  });

  it("denies a read of the state folder, except the own credentials and the worktrees", () => {
    expect(guardReason("Read", { file_path: "/home/user/.aw/keys/device" }, context)).toMatch(
      /keys and tokens/,
    );
    expect(guardReason("Grep", { pattern: "x", path: "/home/user/.aw/sessions" }, context)).toMatch(
      /keys and tokens/,
    );
    expect(
      guardReason(
        "Read",
        { file_path: "/home/user/.aw/sessions/s1/credentials/stripe-test" },
        context,
      ),
    ).toBeNull();
    expect(guardReason("Read", { file_path: "README.md" }, context)).toBeNull();
    expect(guardReason("Read", { file_path: "/home/user/AW/Personal/x.md" }, context)).toBeNull();
  });

  it("checks the pattern of Glob when it is a path", () => {
    expect(guardReason("Glob", { pattern: "/home/user/.aw/**/*" }, context)).toMatch(
      /keys and tokens/,
    );
    expect(guardReason("Glob", { pattern: "~/.aw/sessions/*/mcp-token" }, context)).toMatch(
      /keys and tokens/,
    );
    expect(guardReason("Glob", { pattern: "../../keys/*" }, context)).toMatch(/keys and tokens/);
    expect(guardReason("Glob", { pattern: "src/**/*.ts" }, context)).toBeNull();
    expect(guardReason("Glob", { pattern: "**/*.md", path: "/home/user/.aw" }, context)).toMatch(
      /keys and tokens/,
    );
  });

  it("lets other tools run", () => {
    expect(guardReason("WebFetch", { url: "https://example.com" }, context)).toBeNull();
    expect(guardReason("AskUserQuestion", { questions: [] }, context)).toBeNull();
  });
});

describe("guardReason: symbolic links", () => {
  it("follows a link of the working folder into AW_HOME or the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-guard-"));
    try {
      const home = join(root, ".aw");
      const worktree = join(home, "worktrees", "aw-AW-1");
      const workspace = join(root, "AW", "Personal");
      await mkdir(join(home, "keys"), { recursive: true });
      await mkdir(join(home, "sessions", "s1", "credentials"), { recursive: true });
      await mkdir(worktree, { recursive: true });
      await mkdir(join(workspace, "tasks"), { recursive: true });
      await symlink(join(home, "keys"), join(worktree, "k"));
      await symlink(join(workspace, "tasks"), join(worktree, "t"));
      await symlink(join(home, "sessions"), join(home, "sessions", "s1", "credentials", "up"));
      const real: GuardContext = {
        home,
        userHome: root,
        workspaces: [workspace],
        credentialsDir: join(home, "sessions", "s1", "credentials"),
        cwd: worktree,
      };
      expect(guardReason("Write", { file_path: "k/device" }, real)).toMatch(/AW files/);
      expect(guardReason("Edit", { file_path: "k/new/file" }, real)).toMatch(/AW files/);
      expect(guardReason("Write", { file_path: "t/log/x.jsonl" }, real)).toMatch(/workspace/);
      expect(guardReason("Read", { file_path: "k/device" }, real)).toMatch(/keys and tokens/);
      expect(
        guardReason("Read", { file_path: join(real.credentialsDir!, "up", "s2", "token") }, real),
      ).toMatch(/keys and tokens/);
      expect(guardReason("Write", { file_path: "src/app.ts" }, real)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("guardReason: names in another case (final check fc1-8)", () => {
  it("denies the person commands and the AW folders in any case (macOS file systems)", () => {
    expect(bash("AW gate answer g3 yes")).toMatch(/command of a person/);
    expect(bash("cat ~/.AW/sessions/s2/mcp-token")).toMatch(/state folder/);
    expect(bash("cat /HOME/user/.Aw/keys/device")).toMatch(/state folder/);
    expect(bash("cat ~/aw/personal/tasks/x.md")).toMatch(/workspace folder/);
    expect(bash("CURL --unix-socket /home/user/.aw/run/AWD.SOCK http://x")).toMatch(/socket/);
    const read = (file_path: string) => guardReason("Read", { file_path }, context);
    const edit = (file_path: string) => guardReason("Edit", { file_path }, context);
    expect(read("/home/user/.AW/sessions/s2/mcp-token")).toMatch(/state folder/);
    expect(edit("/home/user/.AW/run/x")).toMatch(/through awd/);
    expect(edit("/home/user/aw/PERSONAL/tasks/x/log/ubuntu-01.jsonl")).toMatch(/workspace folder/);
    // The own credentials and the worktrees stay open.
    expect(read("/home/user/.aw/sessions/s1/credentials/STRIPE")).toBeNull();
    expect(edit("/home/user/.aw/worktrees/aw-AW-1/README.md")).toBeNull();
  });
});

describe("guardReason: the sync commands of a person (final check fc1-12)", () => {
  it("denies each sync command whose route is a person route", () => {
    for (const command of [
      "aw sync now",
      "aw sync pause",
      "aw sync resume",
      "aw sync peer add ubuntu-01 ABC",
      "aw sync peer remove ubuntu-01",
    ]) {
      expect(bash(command), command).toMatch(/command of a person/);
    }
    expect(bash("aw sync status")).toBeNull();
  });
});

describe("guardReason: a cd before a relative path (soc-15)", () => {
  it("denies a relative path into AW_HOME after a cd to the home folder", () => {
    expect(bash("cd ~ && cat .aw/keys/device")).toMatch(/state folder/);
    expect(bash("cd $HOME; cat .aw/sessions/s2/mcp-token")).toMatch(/state folder/);
    expect(bash("cd /home/user && cat .aw/run/mcp.port")).toMatch(/state folder/);
    // A cd with no folder goes to the home folder; $PWD is the folder before (review of fc1).
    expect(bash("cd; cat .aw/keys/device")).toMatch(/state folder/);
    expect(bash("cd && cat .aw/keys/device")).toMatch(/state folder/);
    expect(bash("cd $PWD/../.. && cat keys/device")).toMatch(/state folder/);
    expect(bash("cd ${PWD}/src && cat index.ts")).toBeNull();
    expect(bash("cd ~ && ls .aws")).toBeNull();
    expect(bash("cd ~ && cat .aw/worktrees/aw-AW-1/README.md")).toBeNull();
    expect(bash("cat README.md")).toBeNull();
  });
});

describe("teammateGateReason", () => {
  it("denies a gate tool of a teammate, and lets the lead open the gate", () => {
    const gate = { kind: "question", title: "Which?", text: "Which?", options: [] };
    expect(
      teammateGateReason({ kind: "tool_start", gate, agent: "ahelper-204629dffab38048" }),
    ).toMatch(/team lead/);
    expect(teammateGateReason({ kind: "tool_start", gate, agent: null })).toBeNull();
    expect(teammateGateReason({ kind: "tool_start", gate })).toBeNull();
    expect(
      teammateGateReason({ kind: "tool_start", gate: null, agent: "ahelper-204629dffab38048" }),
    ).toBeNull();
    expect(teammateGateReason({ kind: "stop" })).toBeNull();
  });
});
