import { describe, expect, it } from "vitest";
import {
  currentYearGroup,
  parseChildForm,
  schoolYearStart,
  yearGroupLabel,
} from "../../src/children";

describe("school years", () => {
  it("start on 1 September, UK time", () => {
    expect(schoolYearStart(new Date("2026-08-31T22:59:59.000Z"))).toBe(2025);
    expect(schoolYearStart(new Date("2026-08-31T23:00:00.000Z"))).toBe(2026);
    expect(schoolYearStart(new Date("2027-01-15T12:00:00.000Z"))).toBe(2026);
  });

  it("move year groups up each September", () => {
    const child = { yearGroup: 3, yearGroupAsOf: 2026 };
    expect(currentYearGroup(child, new Date("2027-07-20T12:00:00.000Z"))).toBe(3);
    expect(currentYearGroup(child, new Date("2027-09-02T12:00:00.000Z"))).toBe(4);
    expect(
      currentYearGroup(
        { yearGroup: 13, yearGroupAsOf: 2026 },
        new Date("2027-09-02T12:00:00.000Z"),
      ),
    ).toBeNull();
    expect(
      currentYearGroup(
        { yearGroup: -1, yearGroupAsOf: 2026 },
        new Date("2027-09-02T12:00:00.000Z"),
      ),
    ).toBe(0);
  });

  it("label year groups", () => {
    expect([-1, 0, 1, 13, null].map(yearGroupLabel)).toEqual([
      "Nursery",
      "Reception",
      "Year 1",
      "Year 13",
      "Left school",
    ]);
  });
});

describe("parseChildForm", () => {
  const form = (fields: Record<string, string>): FormData => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  it("tidies up valid input", () => {
    expect(
      parseChildForm(
        form({ name: "  Ada ", school: "Oakfield   Primary", yearGroup: "3", className: "" }),
      ),
    ).toEqual({
      name: "Ada",
      school: "Oakfield Primary",
      yearGroup: 3,
      className: null,
    });
  });

  it("explains what's missing", () => {
    expect(parseChildForm(form({ name: "", school: "", yearGroup: "14" }))).toEqual({
      errors: {
        name: "Enter a name, up to 40 characters (a nickname is fine)",
        school: "Enter the school's name",
        yearGroup: "Choose a year group",
      },
    });
  });
});
