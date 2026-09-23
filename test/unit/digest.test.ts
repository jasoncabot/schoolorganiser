import { describe, expect, it } from "vitest";
import type { Child } from "../../src/children";
import { digestEmail, MAX_LINES, nextDigestTime, type DigestInput } from "../../src/email/digest";
import type { StoredItem, StoredNote } from "../../src/household";
import { londonTime, ukTime } from "../../src/uk-time";

describe("nextDigestTime", () => {
  it("is this Sunday at 6pm BST", () => {
    // Mon 6 Oct 2025, 09:00 BST.
    expect(nextDigestTime(new Date("2025-10-06T08:00:00.000Z")).toISOString()).toBe(
      "2025-10-12T17:00:00.000Z",
    );
  });

  it("is 6pm GMT on the Sunday the clocks go back", () => {
    expect(nextDigestTime(new Date("2025-10-20T08:00:00.000Z")).toISOString()).toBe(
      "2025-10-26T18:00:00.000Z",
    );
  });

  it("is 6pm BST on the Sunday the clocks go forward", () => {
    expect(nextDigestTime(new Date("2026-03-25T12:00:00.000Z")).toISOString()).toBe(
      "2026-03-29T17:00:00.000Z",
    );
  });

  it("is today on a Sunday before 6pm, and next week at or after it", () => {
    expect(nextDigestTime(new Date("2025-10-12T16:59:00.000Z")).toISOString()).toBe(
      "2025-10-12T17:00:00.000Z",
    );
    expect(nextDigestTime(new Date("2025-10-12T17:00:00.000Z")).toISOString()).toBe(
      "2025-10-19T17:00:00.000Z",
    );
  });

  it("uses the UK date late on Saturday night in summer", () => {
    // 23:30 UTC Saturday is 00:30 BST Sunday.
    expect(nextDigestTime(new Date("2026-06-13T23:30:00.000Z")).toISOString()).toBe(
      "2026-06-14T17:00:00.000Z",
    );
  });
});

describe("uk time", () => {
  it("formats times the UK way", () => {
    expect(["09:00", "08:15", "12:00", "00:30", "14:30"].map(ukTime)).toEqual([
      "9am",
      "8:15am",
      "12pm",
      "12:30am",
      "2:30pm",
    ]);
  });

  it("finds a UK wall-clock time in either season", () => {
    expect(londonTime("2025-07-01", 18).toISOString()).toBe("2025-07-01T17:00:00.000Z");
    expect(londonTime("2025-12-01", 18).toISOString()).toBe("2025-12-01T18:00:00.000Z");
  });
});

const ada: Child = {
  id: "c-ada",
  name: "Ada",
  school: "Elm Primary",
  yearGroup: 3,
  yearGroupAsOf: 2025,
  className: null,
};
const bo: Child = { ...ada, id: "c-bo", name: "Bo", school: "Ash High", yearGroup: 7 };

let seq = 0;
function item(overrides: Partial<StoredItem>): StoredItem {
  return {
    id: `i-${String(++seq)}`,
    messageId: "m-1",
    date: "2025-10-13",
    time: null,
    kind: "event",
    title: "Event",
    cost: null,
    location: null,
    school: null,
    child: null,
    confidence: "high",
    expiresAt: "2026-01-11T00:00:00.000Z",
    childIds: ["c-ada"],
    maybeChildIds: [],
    dateUnsure: false,
    repeats: null,
    source: { subject: "Fwd: Letter", receivedAt: "2025-10-08T08:00:00.000Z" },
    ...overrides,
  };
}

// Sunday 12 Oct 2025, 18:00 BST.
const SUNDAY = new Date("2025-10-12T17:00:00.000Z");

function digest(overrides: Partial<DigestInput>) {
  return digestEmail({
    now: SUNDAY,
    items: [],
    children: [ada, bo],
    unreadable: [],
    failed: [],
    notes: [],
    appOrigin: "https://school.example.com",
    stopLink: "https://school.example.com/stop?token=t",
    ...overrides,
  });
}

describe("digestEmail", () => {
  it("lists the week by day, then coming up", () => {
    const email = digest({
      items: [
        item({
          date: "2025-10-16",
          time: "08:15",
          title: "Year 3 trip to Chester Zoo",
          location: "Chester Zoo",
        }),
        item({ date: "2025-10-13", title: "PE kit", kind: "kit", childIds: ["c-ada", "c-bo"] }),
        item({
          date: "2025-10-13",
          title: "Harvest festival",
          child: "Oak class",
          childIds: [],
          maybeChildIds: ["c-ada"],
        }),
        item({ date: "2025-10-15", title: "Chess club", childIds: [] }),
        item({
          date: "2025-10-24",
          kind: "payment",
          title: "Pay for Ash High trip",
          cost: "£12",
          childIds: ["c-bo"],
        }),
        item({ date: "2025-10-24", kind: "event", title: "Disco" }),
        item({ date: "2025-11-10", kind: "deadline", title: "Too far ahead" }),
        item({ date: "2025-10-12", title: "Today, already sent last week" }),
      ],
    });
    expect(email.subject).toBe("School this week: Mon 13 Oct to Sun 19 Oct");
    expect(email.text).toBe(
      [
        "Week of Mon 13 Oct",
        "",
        "Mon 13 Oct",
        "- Ada and Bo: PE kit",
        "- Oak class (may be Ada's): Harvest festival",
        "",
        "Thu 16 Oct",
        "- Ada: Year 3 trip to Chester Zoo, 8:15am, Chester Zoo",
        "",
        "Coming up",
        "- Fri 24 Oct, Bo: Pay for Ash High trip, £12",
        "",
        "--",
        "Stop these emails: https://school.example.com/stop?token=t",
        "School Organiser · Forward school emails to hello@school.example.com",
        "Privacy: https://school.example.com/privacy",
      ].join("\n"),
    );
    expect(email.html).toContain("<h2");
    expect(email.html).toContain("Oak class (may be Ada&#39;s): Harvest festival");
    expect(email.html).toContain('href="https://school.example.com/stop?token=t"');
  });

  it("orders items by date and time, and drops repeats", () => {
    const email = digest({
      items: [
        item({ title: "Swimming", time: "09:00" }),
        item({ title: "Register", time: null }),
        item({ title: "swimming", time: "09:00" }),
        item({ title: "Swimming", time: "09:00", childIds: ["c-bo"] }),
      ],
    });
    expect(email.text).toContain("- Ada: Register\n- Ada: Swimming, 9am\n- Bo: Swimming, 9am\n\n");
  });

  it("flags a date whose weekday didn't match the letter", () => {
    expect(
      digest({ items: [item({ title: "Parents' evening", dateUnsure: true })] }).text,
    ).toContain("- Ada: Parents' evening (check the date)\n");
  });

  it("lists notes worth knowing, with who they're for, at most five", () => {
    const note = (text: string, overrides: Partial<StoredNote> = {}): StoredNote => ({
      id: text,
      messageId: "m-1",
      text,
      school: null,
      child: null,
      childIds: ["c-ada"],
      maybeChildIds: [],
      source: { subject: "Fwd: Club", receivedAt: "2025-10-08T08:00:00.000Z" },
      ...overrides,
    });
    const email = digest({
      notes: [
        note("Judo club on Wednesdays, £72 for 9 lessons; book with coach@example.com."),
        note("judo club on wednesdays, £72 for 9 lessons; book with coach@example.com."),
        note("Not for us.", { childIds: [] }),
        note("Oak class swimming kit needed.", {
          child: "Oak class",
          childIds: [],
          maybeChildIds: ["c-ada"],
        }),
        ...["One", "Two", "Three", "Four"].map((t) => note(`${t}.`, { childIds: ["c-bo"] })),
      ],
    });
    const lines = email.text.split("\n");
    const start = lines.indexOf("Worth knowing");
    expect(lines.slice(start, start + 7)).toEqual([
      "Worth knowing",
      "- Ada: Judo club on Wednesdays, £72 for 9 lessons; book with coach@example.com.",
      "- Oak class (may be Ada's): Oak class swimming kit needed.",
      "- Bo: One.",
      "- Bo: Two.",
      "- Bo: Three.",
      "Plus 1 more: https://school.example.com/household/upcoming",
    ]);
    expect(email.html).toContain(">Worth knowing</h2>");
  });

  it("says how often a recurring event runs", () => {
    const club = item({
      title: "Judo club starts",
      time: "15:15",
      repeats: "Every Wednesday until 9 December; not 28 October.",
    });
    expect(digest({ items: [club] }).text).toContain(
      "- Ada: Judo club starts, 3:15pm (Every Wednesday until 9 December; not 28 October)\n",
    );
  });

  it("says so in a quiet week", () => {
    const email = digest({});
    expect(email.text.split("\n").slice(0, 4)).toEqual([
      "Week of Mon 13 Oct",
      "",
      "Nothing on this week.",
      "",
    ]);
    expect(email.html).toContain("Nothing on this week.");
  });

  it("shows everything with its audience when no children are set up", () => {
    const email = digest({
      children: [],
      items: [
        item({ title: "Year 3 assembly", child: "Year 3", childIds: null }),
        item({ title: "INSET day", childIds: null }),
      ],
    });
    expect(email.text).toContain("- Year 3: Year 3 assembly\n- INSET day\n");
  });

  it("caps the lines and says how many more", () => {
    const week = Array.from({ length: MAX_LINES + 2 }, (_, i) =>
      item({ title: `Club ${String(i + 1).padStart(2, "0")}` }),
    );
    const email = digest({
      items: [...week, item({ date: "2025-10-24", kind: "deadline", title: "Forms" })],
    });
    const lines = email.text.split("\n");
    expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(MAX_LINES);
    expect(lines).toContain("Plus 2 more: https://school.example.com/household/upcoming");
    expect(lines).toContain("Coming up");
    expect(lines).toContain("Plus 1 more: https://school.example.com/household/upcoming");
    expect(email.html).toContain('<a href="https://school.example.com/household/upcoming"');
  });

  it("mentions emails it couldn't read", () => {
    expect(digest({ failed: [{ receivedAt: "2025-10-08T08:00:00.000Z" }] }).text).toContain(
      "We couldn't read an email forwarded on Wed 8 Oct. Try forwarding it again.",
    );
    const two = digest({
      failed: [
        { receivedAt: "2025-10-08T08:00:00.000Z" },
        { receivedAt: "2025-10-08T09:00:00.000Z" },
        { receivedAt: "2025-10-09T23:30:00.000Z" },
      ],
    });
    // 23:30 UTC on 9 Oct is 00:30 on Fri 10 Oct in the UK.
    expect(two.text).toContain(
      "We couldn't read 3 emails forwarded on Wed 8 Oct and Fri 10 Oct. Try forwarding them again.",
    );
  });

  it("mentions attachments it couldn't read", () => {
    const email = digest({
      unreadable: [
        { filename: "trip.ppt", subject: "Fwd: Trip", reason: "unsupported format" },
        { filename: "scan.heic", subject: null, reason: "unsupported format" },
        { filename: "Club letter.docx", subject: "Fwd: Club", reason: "not attached" },
      ],
    });
    expect(email.text).toContain(
      `We couldn't read trip.ppt (in "Fwd: Trip"), scan.heic. Check the original emails.`,
    );
    expect(email.text).toContain(
      `Club letter.docx (in "Fwd: Club") wasn't attached when forwarded. Forward again and choose to include attachments.`,
    );
  });
});
