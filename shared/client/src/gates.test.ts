// The shared gate text cases of contracts/fixtures/gates (openspec gate-full-context, decision 4).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  gateBody,
  gateContext,
  gateDecisions,
  gateHasBody,
  gateQuestions,
  questionAnswer,
  questionMode,
  recommendedOption,
  type ContextEvent,
  type GateDecision,
  type GateQuestion,
} from "./gates.ts";

interface Case {
  name: string;
  text: string;
  decisions: GateDecision[];
  body: string;
}

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../contracts/fixtures/gates/${name}`, import.meta.url)),
      "utf8",
    ),
  ) as T;

const cases = fixture<{ cases: Case[] }>("cases.json").cases;

describe("gate text (contracts/fixtures/gates)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(gateBody(c.text, c.decisions)).toBe(c.body);
  });

  it("reads only well-formed decisions", () => {
    expect(gateDecisions(undefined)).toEqual([]);
    expect(gateDecisions({ decisions: "x" })).toEqual([]);
    expect(
      gateDecisions({
        decisions: [
          { question: "Q", options: ["a", "b"], recommended: "a" },
          { question: "Bad", options: [1], recommended: "a" },
        ],
      }),
    ).toEqual([{ question: "Q", options: ["a", "b"], recommended: "a" }]);
  });
});

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
