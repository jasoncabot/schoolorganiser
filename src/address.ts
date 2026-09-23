import { DurableObject } from "cloudflare:workers";

/**
 * One per normalised email address (`idFromName(address)`).
 * Maps the address to its household and holds its verification state.
 * Behaviour arrives in plan step 3.
 */
export class Address extends DurableObject<Env> {}
