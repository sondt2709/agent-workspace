// The shared gate text cases of contracts/fixtures/gates (openspec gate-full-context, decision 4).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentMessage,
  changeProposalTextSize,
  gateContext,
  gateHasBody,
  gateQuestions,
  loadProposalTextSize,
  PROPOSAL_TEXT,
  questionAnswer,
  questionMode,
  recommendedOption,
  type AgentMessage,
  type ContextEvent,
  type GateQuestion,
} from "./gates.ts";

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../contracts/fixtures/gates/${name}`, import.meta.url)),
      "utf8",
    ),
  ) as T;

describe("gate questions (contracts/fixtures/gates/questions.json)", () => {
  const q = fixture<{
    cases: {
      name: string;
      questions: GateQuestion[];
      mode: string;
      picks: string[][];
      answer: string;
    }[];
  }>("questions.json").cases;

  it.each(q.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(gateQuestions({ questions: c.questions })).toEqual(c.questions);
    expect(questionMode(c.questions)).toBe(c.mode);
    expect(questionAnswer(c.questions, c.picks)).toBe(c.answer);
  });

  it("reads only well-formed questions, with defaults", () => {
    expect(gateQuestions(undefined)).toEqual([]);
    expect(
      gateQuestions({
        questions: [
          { question: "Q", options: [{ label: "a" }, { description: "no label" }] },
          { question: 3, options: [] },
        ],
      }),
    ).toEqual([
      {
        question: "Q",
        header: null,
        multi_select: false,
        options: [{ label: "a", description: "" }],
      },
    ]);
  });
});

describe("recommended option (contracts/fixtures/gates/recommended.json)", () => {
  const cases = fixture<{ cases: { name: string; options: string[]; recommended: number }[] }>(
    "recommended.json",
  ).cases;

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(recommendedOption(c.options)).toBe(c.recommended);
  });
});

describe("gate context (contracts/fixtures/gates/context.json)", () => {
  const c = fixture<{
    body: {
      name: string;
      title: string;
      text: string;
      questions: GateQuestion[];
      has_body: boolean;
    }[];
    context: { name: string; events: ContextEvent[]; gate_event: string; context: string[] }[];
  }>("context.json");

  it.each(c.body.map((b) => [b.name, b] as const))("body: %s", (_name, b) => {
    expect(gateHasBody(b.title, b.text, b.questions)).toBe(b.has_body);
  });

  it.each(c.context.map((x) => [x.name, x] as const))("context: %s", (_name, x) => {
    expect(gateContext(x.events, x.gate_event).map((e) => e.text)).toEqual(x.context);
  });
});

describe("proposal text size (contracts/fixtures/gates/proposal-text-size.json)", () => {
  const f = fixture<{
    min: number;
    max: number;
    step: number;
    default: number;
    load: { saved: string | null; size: number }[];
    change: { size: number; action: "larger" | "smaller"; size_after: number }[];
  }>("proposal-text-size.json");
  it("has the limits of the fixture", () => {
    expect({ ...PROPOSAL_TEXT }).toEqual({
      min: f.min,
      max: f.max,
      step: f.step,
      default: f.default,
    });
  });
  it.each(f.load)("loads $saved as $size", ({ saved, size }) => {
    expect(loadProposalTextSize(saved)).toBe(size);
  });
  it.each(f.change)("$action from $size is $size_after", ({ size, action, size_after }) => {
    expect(changeProposalTextSize(size, action)).toBe(size_after);
  });
});

describe("agent messages (contracts/fixtures/activity/agent-message.json)", () => {
  const f = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../contracts/fixtures/activity/agent-message.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as { cases: { name: string; text: string; expected: AgentMessage | null }[] };
  it.each(f.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(agentMessage(c.text)).toEqual(c.expected);
  });
});
