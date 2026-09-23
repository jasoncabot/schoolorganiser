import { currentYearGroup, type Child } from "../children";
import { yearGroupsIn } from "./audience";
import { namesAClass } from "./parse";
import type { ExtractedItem } from "./prompt";

/** The parts of an item or note that say who it's for. */
export type Audience = Pick<ExtractedItem, "child" | "forChildren" | "maybeChildren">;

export interface Relevance {
  /** Children the item is for, or null when the household had none set up (relevant to all). */
  childIds: string[] | null;
  /** Children it may be for. */
  maybeChildIds: string[];
}

/**
 * Maps the model's children's names to ids, then checks them, because the model guesses:
 * - an item for named year groups is only for children in them (at `now`), certain or maybe;
 * - an item that names a class can only be a "maybe" for a child whose class we don't know.
 */
export function relevance(item: Audience, children: Child[], now: Date): Relevance {
  if (children.length === 0) return { childIds: null, maybeChildIds: [] };
  const years = yearGroupsIn(item.child);
  const inYears = (c: Child): boolean => {
    const year = currentYearGroup(c, now);
    return years === null || (year !== null && years.has(year));
  };
  const ids = (names: string[]): string[] => {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    return children.filter((c) => wanted.has(c.name.toLowerCase()) && inYears(c)).map((c) => c.id);
  };
  let sure = ids(item.forChildren ?? []);
  let maybe = ids(item.maybeChildren);
  if (namesAClass(item.child)) {
    const classUnknown = new Set(children.filter((c) => c.className === null).map((c) => c.id));
    maybe = [...maybe, ...sure.filter((id) => classUnknown.has(id))];
    sure = sure.filter((id) => !classUnknown.has(id));
  }
  return { childIds: sure, maybeChildIds: [...new Set(maybe)].filter((id) => !sure.includes(id)) };
}
