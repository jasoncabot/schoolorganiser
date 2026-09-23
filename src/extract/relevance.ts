import type { Child } from "../children";
import { namesAClass } from "./parse";
import type { ExtractedItem } from "./prompt";

export interface Relevance {
  /** Children the item is for, or null when the household had none set up (relevant to all). */
  childIds: string[] | null;
  /** Children it may be for. */
  maybeChildIds: string[];
}

/**
 * Maps the model's children's names to ids. An item that names a class can only be a "maybe"
 * for a child whose class we don't know, whatever the model said: the model guesses otherwise.
 */
export function relevance(item: ExtractedItem, children: Child[]): Relevance {
  if (children.length === 0) return { childIds: null, maybeChildIds: [] };
  const ids = (names: string[]): string[] => {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    return children.filter((c) => wanted.has(c.name.toLowerCase())).map((c) => c.id);
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
