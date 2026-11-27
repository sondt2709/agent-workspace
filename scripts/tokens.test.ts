// The phone tokens are the output of scripts/tokens.ts for the current desktop tokens (openspec
// phone-desktop-parity): a changed @aw/ui token with no new run of `pnpm tokens:generate` fails here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { argb, kotlin, OUTPUT, root } from "./tokens.ts";

describe("phone tokens (scripts/tokens.ts)", () => {
  it("writes #RRGGBB and rgba() as Compose ARGB literals", () => {
    expect(argb("#08090a")).toBe("0xFF08090A");
    expect(argb("rgba(255,255,255,0.08)")).toBe("0x14FFFFFF");
    expect(argb("rgba(0, 0, 0, 0.6)")).toBe("0x99000000");
    expect(() => argb("hsl(0 0% 0%)")).toThrow(/#RRGGBB or rgba/);
  });

  it("has the committed AwTokens.kt equal to the output for the current tokens", () => {
    expect(readFileSync(join(root, OUTPUT), "utf8"), `${OUTPUT}: run pnpm tokens:generate`).toBe(
      kotlin(),
    );
  });

  it("writes each color of both schemes and the radii", () => {
    const text = kotlin();
    expect(text).toContain("    val accent = Color(0xFFF0B429)");
    expect(text).toContain("    val accent = Color(0xFF8F5200)");
    expect(text).toContain("    val hover = Color(0x0AFFFFFF)");
    expect(text).toContain("    val md = 8.dp");
    expect(text).not.toContain("shadow");
  });
});
