import { describe, expect, it } from "vitest";
import type { Child } from "../../src/children";
import type { ExtractedItem } from "../../src/extract/prompt";
import { yearGroupsIn } from "../../src/extract/audience";
import { relevance } from "../../src/extract/relevance";

// Autumn term 2026: Ada is in Year 3 and Bo in Year 5 (their year groups were set this school year).
const NOW = new Date("2026-10-05T09:00:00.000Z");

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
    repeats: null,
    ...overrides,
  };
}

describe("relevance", () => {
  it("counts everything as relevant when there are no children", () => {
    expect(relevance(item({ forChildren: null }), [], NOW)).toEqual({
      childIds: null,
      maybeChildIds: [],
    });
  });

  it("maps names to ids, ignoring case and unknown names", () => {
    expect(
      relevance(
        item({ child: null, forChildren: ["ada", "Zed"], maybeChildren: ["BO"] }),
        [ada, bo],
        NOW,
      ),
    ).toEqual({
      childIds: ["c-ada"],
      maybeChildIds: ["c-bo"],
    });
  });

  it("makes a class item a maybe for a child with no class", () => {
    expect(
      relevance(item({ child: "Oak class", forChildren: ["Ada", "Bo"] }), [ada, bo], NOW),
    ).toEqual({
      childIds: ["c-bo"],
      maybeChildIds: ["c-ada"],
    });
  });

  it("keeps year-group items certain", () => {
    expect(
      relevance(item({ child: "Year 3", forChildren: ["Ada"] }), [ada, bo], NOW).childIds,
    ).toEqual(["c-ada"]);
  });

  it("rules out children not in the year groups an item names", () => {
    expect(
      relevance(
        item({ child: "EYFS & Y1", forChildren: [], maybeChildren: ["Ada", "Bo"] }),
        [ada, bo],
        NOW,
      ),
    ).toEqual({ childIds: [], maybeChildIds: [] });
    expect(
      relevance(item({ child: "Years 3-6", forChildren: ["Ada", "Bo"] }), [ada, bo], NOW),
    ).toEqual({ childIds: ["c-ada", "c-bo"], maybeChildIds: [] });
    expect(
      relevance(item({ child: "KS1", forChildren: ["Ada"] }), [ada, bo], NOW).childIds,
    ).toEqual([]);
  });

  it("doesn't list a child as both certain and maybe", () => {
    expect(relevance(item({ forChildren: ["Ada"], maybeChildren: ["Ada"] }), [ada], NOW)).toEqual({
      childIds: ["c-ada"],
      maybeChildIds: [],
    });
  });
});

describe("yearGroupsIn", () => {
  const years = (audience: string | null) => {
    const found = yearGroupsIn(audience);
    return found === null ? null : [...found].sort((a, b) => a - b);
  };

  it("reads year groups, ranges, lists and key stages", () => {
    expect(years("Year 4")).toEqual([4]);
    expect(years("Y1")).toEqual([1]);
    expect(years("EYFS & Y1")).toEqual([-1, 0, 1]);
    expect(years("Years 3-6")).toEqual([3, 4, 5, 6]);
    expect(years("Y3 to Y6")).toEqual([3, 4, 5, 6]);
    expect(years("Years 1, 2 and 3")).toEqual([1, 2, 3]);
    expect(years("Y5/Y6")).toEqual([5, 6]);
    expect(years("KS2")).toEqual([3, 4, 5, 6]);
    expect(years("Key Stage 1")).toEqual([1, 2]);
    expect(years("Reception")).toEqual([0]);
    expect(years("Nursery")).toEqual([-1]);
    expect(years("Sixth form")).toEqual([12, 13]);
  });

  it("can't rule anyone out for classes, the whole school or nothing", () => {
    expect(years("Oak class")).toBeNull();
    expect(years("Whole school")).toBeNull();
    expect(years("All pupils")).toBeNull();
    expect(years(null)).toBeNull();
  });
});
