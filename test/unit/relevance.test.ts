import { describe, expect, it } from "vitest";
import type { Child } from "../../src/children";
import type { ExtractedItem } from "../../src/extract/prompt";
import { relevance } from "../../src/extract/relevance";

const ada: Child = {
  id: "c-ada",
  name: "Ada",
  school: "Elm Primary",
  yearGroup: 3,
  yearGroupAsOf: 2026,
  className: null,
};
const bo: Child = { ...ada, id: "c-bo", name: "Bo", yearGroup: 5, className: "Hazel" };

function item(overrides: Partial<ExtractedItem>): ExtractedItem {
  return {
    date: "2026-10-06",
    time: null,
    kind: "event",
    title: "Trip",
    cost: null,
    location: null,
    school: "Elm Primary",
    child: "Year 3",
    confidence: "high",
    forChildren: [],
    maybeChildren: [],
    dateUnsure: false,
    ...overrides,
  };
}

describe("relevance", () => {
  it("counts everything as relevant when there are no children", () => {
    expect(relevance(item({ forChildren: null }), [])).toEqual({
      childIds: null,
      maybeChildIds: [],
    });
  });

  it("maps names to ids, ignoring case and unknown names", () => {
    expect(
      relevance(item({ forChildren: ["ada", "Zed"], maybeChildren: ["BO"] }), [ada, bo]),
    ).toEqual({
      childIds: ["c-ada"],
      maybeChildIds: ["c-bo"],
    });
  });

  it("makes a class item a maybe for a child with no class", () => {
    expect(relevance(item({ child: "Oak class", forChildren: ["Ada", "Bo"] }), [ada, bo])).toEqual({
      childIds: ["c-bo"],
      maybeChildIds: ["c-ada"],
    });
  });

  it("keeps year-group items certain", () => {
    expect(relevance(item({ child: "Year 3", forChildren: ["Ada"] }), [ada, bo]).childIds).toEqual([
      "c-ada",
    ]);
  });

  it("doesn't list a child as both certain and maybe", () => {
    expect(relevance(item({ forChildren: ["Ada"], maybeChildren: ["Ada"] }), [ada])).toEqual({
      childIds: ["c-ada"],
      maybeChildIds: [],
    });
  });
});
