import { describe, expect, it } from "vitest";
import { namesAClass, parseExtraction, resolveDate } from "../../src/extract/parse";

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

  it("accepts a weekday that matches the date", () => {
    // 16 Oct 2025 is a Thursday.
    const [parsed] =
      parseExtraction(
        { response: { items: [{ ...item, weekday: "Thurs" }] } },
        "2025-09-29T15:10:00.000Z",
      ) ?? [];
    expect(parsed?.dateUnsure).toBe(false);
    expect(parsed?.confidence).toBe("high");
  });

  it("flags a date whose stated weekday doesn't match, and keeps the date", () => {
    const [parsed] =
      parseExtraction(
        { response: { items: [{ ...item, weekday: "Saturday" }] } },
        "2025-09-29T15:10:00.000Z",
      ) ?? [];
    expect(parsed?.date).toBe("2025-10-16");
    expect(parsed?.dateUnsure).toBe(true);
    expect(parsed?.confidence).toBe("low");
  });

  it("drops a time the letter doesn't state", () => {
    const parse = (time: string, text: string) =>
      parseExtraction({ response: { items: [{ ...item, time }] } }, "2025-09-29T15:10:00.000Z", {
        text,
        complete: true,
      })?.[0]?.time;
    expect(parse("15:30", "Judo club after school on Wednesdays.")).toBeNull();
    expect(parse("15:30", "Judo club from 3.30pm on Wednesdays.")).toBe("15:30");
    expect(parse("15:30", "Judo club 15:30 to 16:30.")).toBe("15:30");
    expect(parse("15:00", "Finish at 3pm.")).toBe("15:00");
    expect(parse("08:15", "Coach leaves at 8.15am.")).toBe("08:15");
    expect(parse("09:00", "Room 19:00 booked")).toBeNull();
    expect(parse("12:00", "Finish at midday.")).toBe("12:00");
  });

  it("drops an audience that's the school's own name", () => {
    const [parsed] =
      parseExtraction(
        {
          response: { items: [{ ...item, school: "Oakfield Primary", child: "Oakfield Primary" }] },
        },
        "2025-09-29T15:10:00.000Z",
      ) ?? [];
    expect(parsed?.child).toBeNull();
  });

  it("keeps times when page images may hold them", () => {
    const [parsed] =
      parseExtraction(
        { response: { items: [{ ...item, time: "15:30" }] } },
        "2025-09-29T15:10:00.000Z",
        {
          text: "Judo after school.",
          complete: false,
        },
      ) ?? [];
    expect(parsed?.time).toBe("15:30");
  });

  it("keeps an event's dates that the letter writes on the event's line", () => {
    const text =
      "OCTOBER\n1st - Census day\n5th-9th - Cycle to School week!\n6th - PTA AGM @ 7pm\n" +
      "Get your bikes ready for Cycle to School Week!";
    const cycle = { ...item, title: "Cycle to School week starts", time: null };
    const parsed = parseExtraction(
      {
        response: {
          items: [
            { ...item, day: 1, title: "School census day", time: null },
            { ...cycle, day: 1 },
            { ...cycle, day: 5 },
          ],
        },
      },
      "2025-09-29T15:10:00.000Z",
      { text, complete: false },
    );
    expect(parsed?.map((p) => [p.date, p.title])).toEqual([
      ["2025-10-01", "School census day"],
      ["2025-10-05", "Cycle to School week starts"],
    ]);
  });

  it("keeps every date when the text can't tell which is right", () => {
    const parsed = parseExtraction(
      {
        response: {
          items: [
            { ...item, day: 1, title: "Book fair", time: null },
            { ...item, day: 8, title: "Book fair", time: null },
          ],
        },
      },
      "2025-09-29T15:10:00.000Z",
      { text: "The book fair is coming soon.", complete: true },
    );
    expect(parsed).toHaveLength(2);
  });

  it("keeps how often a recurring event runs", () => {
    const [parsed] =
      parseExtraction(
        { response: { items: [{ ...item, repeats: "Every Wednesday until 9 December" }] } },
        "2025-09-29T15:10:00.000Z",
      ) ?? [];
    expect(parsed?.repeats).toBe("Every Wednesday until 9 December");
  });

  it("ignores a weekday that isn't one", () => {
    const [parsed] =
      parseExtraction(
        { response: { items: [{ ...item, weekday: "TBC" }] } },
        "2025-09-29T15:10:00.000Z",
      ) ?? [];
    expect(parsed?.dateUnsure).toBe(false);
  });

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
        dateUnsure: false,
        repeats: null,
        forChildren: [],
        maybeChildren: [],
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

describe("namesAClass", () => {
  it("spots class names but not year groups, key stages or the whole school", () => {
    for (const cls of ["Oak class", "Hazel", "Class 3B", "Robins"])
      expect(namesAClass(cls)).toBe(true);
    for (const notCls of [
      "Year 3",
      "Y6",
      "Yr 1",
      "Reception",
      "KS2",
      "Key Stage 1",
      "EYFS",
      "Whole school",
      "All pupils",
      null,
    ]) {
      expect(namesAClass(notCls)).toBe(false);
    }
  });
});
