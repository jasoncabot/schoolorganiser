import type { YearGroup } from "../children";

// Year groups named in an item's audience ("EYFS & Y1", "Years 3-6", "KS2"), so code can check
// the model's choice of children: it sometimes lists a Year 4 child for a Year 1 event.

const KEY_STAGES: Record<string, YearGroup[]> = {
  "1": [1, 2],
  "2": [3, 4, 5, 6],
  "3": [7, 8, 9],
  "4": [10, 11],
  "5": [12, 13],
};

/**
 * The year groups an audience names (Nursery is -1, Reception 0), or null if it names none or
 * also means everyone (a class name, "whole school"): then code can't rule anyone out.
 */
export function yearGroupsIn(audience: string | null): Set<YearGroup> | null {
  if (audience === null) return null;
  const text = audience.toLowerCase();
  if (/\b(whole|all|every)\b/.test(text)) return null;
  const groups = new Set<YearGroup>();
  const add = (from: number, to = from): void => {
    for (let y = Math.min(from, to); y <= Math.max(from, to); y++) if (y <= 13) groups.add(y);
  };
  // "Years 3-6", "Y3 to Y6", "Year 3 – 6"
  for (const m of text.matchAll(
    /\b(?:years?|yrs?|y)\s*(\d{1,2})\s*(?:-|–|to)\s*(?:years?|yrs?|y)?\s*(\d{1,2})\b/g,
  )) {
    add(Number(m[1]), Number(m[2]));
  }
  // "Year 1", "Y1", "Years 1, 2 and 3", "Y1/Y2"
  for (const m of text.matchAll(
    /\b(?:years?|yrs?|y)\s*(\d{1,2}(?:\s*(?:,|and|&|\/)\s*(?:years?|yrs?|y)?\s*\d{1,2})*)\b/g,
  )) {
    for (const n of (m[1] ?? "").match(/\d{1,2}/g) ?? []) add(Number(n));
  }
  for (const m of text.matchAll(/\b(?:ks|key\s*stage)\s*([1-5])\b/g)) {
    for (const y of KEY_STAGES[m[1] ?? ""] ?? []) add(y);
  }
  if (/\b(eyfs|early years|foundation stage)\b/.test(text)) add(-1, 0);
  if (/\bnursery\b/.test(text)) add(-1);
  if (/\breception\b|\brec\b/.test(text)) add(0);
  if (/\bsixth form\b/.test(text)) add(12, 13);
  return groups.size === 0 ? null : groups;
}
