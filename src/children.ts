// Children and year groups. Year groups are stored as entered, with the school year they were
// entered in, and move up automatically each September (UK school years start on 1 September).

/** -1 is Nursery, 0 is Reception, 1–13 are Years 1–13. */
export type YearGroup = number;

export const YEAR_GROUPS: { value: YearGroup; label: string }[] = [
  { value: -1, label: "Nursery" },
  { value: 0, label: "Reception" },
  ...Array.from({ length: 13 }, (_, i) => ({ value: i + 1, label: `Year ${String(i + 1)}` })),
];

export interface Child {
  id: string;
  name: string;
  school: string;
  /** Year group in the school year that starts in `yearGroupAsOf`. */
  yearGroup: YearGroup;
  yearGroupAsOf: number;
  className: string | null;
}

/** The calendar year the current UK school year started in: 2026 for any date from 1 Sep 2026 to 31 Aug 2027. */
export function schoolYearStart(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return month >= 9 ? year : year - 1;
}

/** The child's year group now, or null once they'd be past Year 13. */
export function currentYearGroup(
  child: Pick<Child, "yearGroup" | "yearGroupAsOf">,
  now: Date,
): YearGroup | null {
  const current = child.yearGroup + (schoolYearStart(now) - child.yearGroupAsOf);
  return current > 13 ? null : current;
}

export function yearGroupLabel(yearGroup: YearGroup | null): string {
  if (yearGroup === null) return "Left school";
  return YEAR_GROUPS.find((y) => y.value === yearGroup)?.label ?? `Year ${String(yearGroup)}`;
}

export interface ChildInput {
  name: string;
  school: string;
  yearGroup: YearGroup;
  className: string | null;
}

/** Validates a submitted child form. Returns the input, or messages keyed by field. */
export function parseChildForm(
  form: FormData,
): ChildInput | { errors: Partial<Record<keyof ChildInput, string>> } {
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  };
  const name = field("name");
  const school = field("school");
  const yearGroupText = field("yearGroup");
  const className = field("className");
  const yearGroup = Number(yearGroupText);
  const errors: Partial<Record<keyof ChildInput, string>> = {};
  if (name === "" || name.length > 40)
    errors.name = "Enter a name, up to 40 characters (a nickname is fine)";
  if (school === "" || school.length > 100) errors.school = "Enter the school's name";
  if (yearGroupText === "" || !YEAR_GROUPS.some((y) => y.value === yearGroup))
    errors.yearGroup = "Choose a year group";
  if (className.length > 40) errors.className = "Class names can be up to 40 characters";
  if (Object.keys(errors).length > 0) return { errors };
  return { name, school, yearGroup, className: className === "" ? null : className };
}
