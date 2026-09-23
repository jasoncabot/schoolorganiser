import { Agent } from "agents";

/**
 * One per household. Holds members, children, schools, messages, items and digest history.
 * Behaviour arrives in plan steps 3 onwards.
 */
export class Household extends Agent<Env> {}
