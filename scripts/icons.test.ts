// The app icons are the output of scripts/icons.ts for the current source mark (openspec
// polish-app-icons): a changed mark with no new run of `pnpm icons:generate` fails here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { outputs, readMark, root, SOURCE, TRAY_MODULE } from "./icons.ts";

/** The RGBA pixels of a PNG. */
async function pixels(png: Buffer): Promise<{ width: number; height: number; data: Buffer }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

/** The mean difference of 2 PNGs per channel (0 to 255); a renderer of another build may differ a little. */
async function meanDiff(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([pixels(a), pixels(b)]);
  expect([x.width, x.height]).toEqual([y.width, y.height]);
  let sum = 0;
  for (let i = 0; i < x.data.length; i++) sum += Math.abs(x.data[i]! - y.data[i]!);
  return sum / x.data.length;
}

describe("app icons (scripts/icons.ts)", () => {
  it("reads the mark of the source", () => {
    const mark = readMark(readFileSync(join(root, SOURCE), "utf8"));
    expect(mark.clip).toBe("M0 0H24L0 24Z");
    expect([mark.gray, mark.light]).toEqual(["#8A8F98", "#F7F8F8"]);
    expect(() => readMark("<svg/>")).toThrow(/no <clipPath id="upper-left">/);
  });

  it("has each committed icon equal to the output for the current source", async () => {
    for (const out of await outputs()) {
      const path = join(root, out.path);
      if (out.kind === "text") {
        expect(readFileSync(path, "utf8"), `${out.path}: run pnpm icons:generate`).toBe(out.text);
      } else if (out.kind === "png") {
        expect(await meanDiff(readFileSync(path), out.png), out.path).toBeLessThan(1);
      } else {
        const text = readFileSync(path, "utf8");
        const base64 = /"([A-Za-z0-9+/=]+)"/.exec(text)?.[1] ?? "";
        expect(await meanDiff(Buffer.from(base64, "base64"), out.png), TRAY_MODULE).toBeLessThan(1);
      }
    }
  });

  it("makes a 1024 px macOS icon and a 32 px template image with alpha", async () => {
    const all = await outputs();
    const mac = all.find((o) => o.kind === "png")!;
    const tray = all.find((o) => o.kind === "tray")!;
    expect((await sharp(mac.png).metadata()).width).toBe(1024);
    const t = await pixels(tray.png);
    expect([t.width, t.height]).toEqual([32, 32]);
    // A template image: each pixel is black; only the alpha changes.
    for (let i = 0; i < t.data.length; i += 4)
      expect(t.data[i]! + t.data[i + 1]! + t.data[i + 2]!).toBe(0);
  });
});
