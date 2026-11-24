// Runs scripts/leakcheck.sh in a temporary git repository.
// The test builds each leak string at run time, so this file holds no home path, email or token.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(dirname(fileURLToPath(import.meta.url)), "leakcheck.sh");

const home = (name: string): string => ["", "Users", name, "aw"].join("/");
const email = (user: string, domain: string): string => [user, domain].join("@");
const fakeToken = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let body = "";
  for (let i = 0; i < 36; i += 1) body += chars[(i * 7 + 3) % chars.length];
  return ["gh", "p_", body].join("");
};

let repo = "";

function git(...args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

function leakcheck(env: Record<string, string> = {}, args: string[] = []) {
  const clean = { ...process.env };
  delete clean.AW_LEAKCHECK_TERMS;
  delete clean.PRE_COMMIT_FROM_REF;
  delete clean.PRE_COMMIT_TO_REF;
  const result = spawnSync("bash", ["scripts/leakcheck.sh", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...clean, ...env },
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "aw-leakcheck-"));
  mkdirSync(join(repo, "scripts"));
  copyFileSync(script, join(repo, "scripts", "leakcheck.sh"));
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("scripts/leakcheck.sh", () => {
  it("passes on placeholder paths and allowed emails", () => {
    writeFileSync(
      join(repo, "ok.txt"),
      `${home("you")} ${home("runner")} /Users/<name>/x C:\\Users\\example\\aw\n` +
        `${email("noreply", "anthropic.com")} ${email("a", "example.com")}\n`,
    );
    const result = leakcheck();
    expect(result.output).toContain("leakcheck: OK");
    expect(result.status).toBe(0);
  });

  it("reports a real home path on a line that also has a placeholder path", () => {
    writeFileSync(join(repo, "mixed.txt"), `${home("you")} and ${home("alice")}\n`);
    const result = leakcheck();
    expect(result.output).toContain("mixed.txt:1: home path");
    expect(result.status).toBe(1);
  });

  it("reports a Windows home path with one or two backslashes", () => {
    const parts = ["C:", "Users", "bob", "aw"];
    writeFileSync(join(repo, "win.txt"), `${parts.join("\\")}\n${parts.join("\\\\")}\n`);
    const result = leakcheck();
    expect(result.output).toContain("win.txt:1: home path");
    expect(result.output).toContain("win.txt:2: home path");
  });

  it("reports an email address", () => {
    writeFileSync(join(repo, "mail.txt"), `${email("bob", "corp-mail.io")}\n`);
    const result = leakcheck();
    expect(result.output).toContain("mail.txt:1: email address");
    expect(result.status).toBe(1);
  });

  it("skips the deprecation text of pnpm-lock.yaml, and no other line of it", () => {
    writeFileSync(
      join(repo, "pnpm-lock.yaml"),
      `  glob@7.2.3:\n    deprecated: Old versions are not supported, contact ${email("maint", "pkg-mail.io")}\n` +
        `  other@1.0.0:\n    author: ${email("bob", "corp-mail.io")}\n`,
    );
    writeFileSync(join(repo, "notes.txt"), `    deprecated: ${email("carol", "corp-mail.io")}\n`);
    const result = leakcheck();
    expect(result.output).not.toContain("pnpm-lock.yaml:2");
    expect(result.output).toContain("pnpm-lock.yaml:4: email address");
    expect(result.output).toContain("notes.txt:1: email address");
    expect(result.status).toBe(1);
  });

  it("reports a token at the end of a file larger than the pipe buffer", () => {
    const filler = "a line of a large generated file with some filler text\n".repeat(4000);
    writeFileSync(join(repo, "big.txt"), `${filler}token: ${fakeToken()}\n`);
    const result = leakcheck();
    expect(result.output).toContain("big.txt:4001: possible secret");
    expect(result.status).toBe(1);
  });

  it("skips a binary file", () => {
    writeFileSync(join(repo, "bin.dat"), Buffer.from(`a\0b ${home("alice")}\n`));
    expect(leakcheck().status).toBe(0);
  });

  it("reports a private term from the file in AW_LEAKCHECK_TERMS", () => {
    const terms = join(mkdtempSync(join(tmpdir(), "aw-terms-")), "terms.local");
    writeFileSync(terms, "# private terms\n\nacme-internal\n");
    writeFileSync(join(repo, "demo.yaml"), "name: Acme-Internal\n");
    const result = leakcheck({ AW_LEAKCHECK_TERMS: terms });
    expect(result.output).toContain("demo.yaml:1: private term");
    expect(result.status).toBe(1);
    rmSync(dirname(terms), { recursive: true, force: true });
  });

  it("reports a leak in a file with a non-ASCII name or a double quote in the name", () => {
    // Git quotes these names by default (core.quotePath). The script must read the real file.
    writeFileSync(join(repo, "tài-liệu.txt"), `${home("alice")}\n`);
    writeFileSync(join(repo, 'with"quote.txt'), `${email("bob", "corp-mail.io")}\n`);
    writeFileSync(join(repo, "back\\slash.txt"), `token: ${fakeToken()}\n`);
    const untracked = leakcheck();
    expect(untracked.output).toContain("tài-liệu.txt:1: home path");
    expect(untracked.output).toContain('with"quote.txt:1: email address');
    expect(untracked.output).toContain("back\\slash.txt:1: possible secret");
    expect(untracked.status).toBe(1);

    git("add", ".");
    const staged = leakcheck();
    expect(staged.output).toContain("tài-liệu.txt:1: home path");
    expect(staged.output).toContain('with"quote.txt:1: email address');
    expect(staged.status).toBe(1);

    git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "names");
    const range = leakcheck({}, ["HEAD~1", "HEAD"]);
    expect(range.output).toContain("tài-liệu.txt:1: home path");
    expect(range.output).toContain('with"quote.txt:1: email address');
    expect(range.output).toContain("back\\slash.txt:1: possible secret");
    expect(range.status).toBe(1);
  });

  it("fails when it cannot read a listed file", () => {
    if (process.getuid?.() === 0) return; // root can read a file with mode 000
    const file = join(repo, "locked.txt");
    writeFileSync(file, "clean\n");
    chmodSync(file, 0o000);
    const result = leakcheck();
    chmodSync(file, 0o644);
    expect(result.output).toContain("locked.txt: cannot read the file");
    expect(result.status).toBe(1);
  });

  it("passes when a tracked file is deleted from the working tree", () => {
    writeFileSync(join(repo, "gone.txt"), "clean\n");
    git("add", "gone.txt");
    git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "gone");
    rmSync(join(repo, "gone.txt"));
    const result = leakcheck();
    expect(result.output).toContain("leakcheck: OK");
    expect(result.status).toBe(0);
  });

  it("scans a text file that is not valid UTF-8", () => {
    // Latin-1 bytes. GNU grep in a UTF-8 locale calls this file binary unless LC_ALL=C.
    const latin1 = Buffer.from(`caf\xe9 ${home("alice")}\n`, "latin1");
    writeFileSync(join(repo, "latin1.txt"), latin1);
    const result = leakcheck({ LC_ALL: "C.UTF-8", LANG: "C.UTF-8" });
    expect(result.output).toContain("latin1.txt:1: home path");
    expect(result.status).toBe(1);
  });

  it("scans the leak check script too", () => {
    const self = join(repo, "scripts", "leakcheck.sh");
    writeFileSync(self, `${readFileSync(self, "utf8")}# ${home("alice")}\n`);
    const result = leakcheck();
    expect(result.output).toContain("scripts/leakcheck.sh:");
    expect(result.output).toContain("home path");
    expect(result.status).toBe(1);
  });

  it("scans only the files that changed between two commits", () => {
    writeFileSync(join(repo, "old.txt"), `${home("carol")}\n`);
    git("add", "old.txt");
    git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "old");
    writeFileSync(join(repo, "new.txt"), "clean\n");
    git("add", "new.txt");
    git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "new");
    expect(leakcheck({}, ["HEAD~1", "HEAD"]).status).toBe(0);
    expect(leakcheck({}, ["HEAD~2", "HEAD~1"]).output).toContain("old.txt:1: home path");
  });
});
