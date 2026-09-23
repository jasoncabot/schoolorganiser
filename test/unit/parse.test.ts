import { describe, expect, it } from "vitest";
import { parseExtraction, resolveDate } from "../../src/extract/parse";

describe("resolveDate", () => {
  const sent = "2026-09-23T10:00:00.000Z";

  it("uses a stated year, including two-digit years", () => {
    expect(resolveDate(7, 9, 2026, sent)).toBe("2026-09-07");
    expect(resolveDate(7, 9, 26, sent)).toBe("2026-09-07");
  });

  it("puts later months this year and earlier months next year", () => {
    expect(resolveDate(30, 9, null, sent)).toBe("2026-09-30");
    expect(resolveDate(11, 12, null, sent)).toBe("2026-12-11");
    expect(resolveDate(4, 1, null, sent)).toBe("2027-01-04");
    expect(resolveDate(21, 7, null, sent)).toBe("2027-07-21");
  });

  it("allows dates up to a month before the email (recent events)", () => {
    expect(resolveDate(1, 9, null, sent)).toBe("2026-09-01");
    expect(resolveDate(24, 8, null, sent)).toBe("2026-08-24");
    expect(resolveDate(22, 8, null, sent)).toBe("2027-08-22");
  });

  it("rejects impossible dates, and finds the next 29 February", () => {
    expect(resolveDate(30, 2, null, sent)).toBeNull();
    expect(resolveDate(31, 4, 2027, sent)).toBeNull();
    expect(resolveDate(29, 2, null, sent)).toBe("2028-02-29");
  });
});

describe("parseExtraction", () => {
  const item = {
    day: 16,
    month: 10,
    year: null,
    time: "08:15",
    kind: "event",
    title: "Trip",
    cost: null,
    location: null,
    school: null,
    child: "Year 3",
    confidence: "high",
  };

  it("resolves dates relative to when the email was sent", () => {
    expect(parseExtraction({ response: { items: [item] } }, "2025-09-29T15:10:00.000Z")).toEqual([
      {
        date: "2025-10-16",
        time: "08:15",
        kind: "event",
        title: "Trip",
        cost: null,
        location: null,
        school: null,
        child: "Year 3",
        confidence: "high",
        forChildren: [],
      },
    ]);
  });

  it("accepts numbers written as strings and drops unusable dates", () => {
    const items = parseExtraction(
      {
        response: {
          items: [
            { ...item, day: "16", month: "10" },
            { ...item, day: 0 },
            { ...item, month: 13 },
            { ...item, year: "next" },
          ],
        },
      },
      "2025-09-29T15:10:00.000Z",
    );
    expect(items?.map((i) => i.date)).toEqual(["2025-10-16"]);
  });

  it("returns null for answers with no items list", () => {
    expect(parseExtraction({ response: "no" }, "2025-09-29T15:10:00.000Z")).toBeNull();
    expect(parseExtraction(null, "2025-09-29T15:10:00.000Z")).toBeNull();
  });

  it("keeps the children each item is for", () => {
    const items = parseExtraction(
      { response: { items: [{ ...item, for: ["Ada", " Ben ", "", 7] }] } },
      "2025-09-29T15:10:00.000Z",
    );
    expect(items?.[0]?.forChildren).toEqual(["Ada", "Ben"]);
  });
});
