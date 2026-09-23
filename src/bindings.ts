import { getAgentByName } from "agents";
import type { Address } from "./address";
import type { Household } from "./household";

/** The Address Durable Object for one normalised email address. */
export function addressStub(env: Env, address: string): DurableObjectStub<Address> {
  return env.ADDRESS.getByName(address);
}

/** The Household agent. Agents must be fetched with getAgentByName so they know their name. */
export function householdStub(
  env: Env,
  householdId: string,
): Promise<DurableObjectStub<Household>> {
  return getAgentByName(env.HOUSEHOLD, householdId);
}
