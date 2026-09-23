interface UntypedAi {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/**
 * Calls a Workers AI model with a request built by src/extract/prompt.ts. The binding's typed
 * overloads need the per-model input type, but prompt.ts stays free of Workers types so the
 * evaluation script can run it in Node; this is the one place the two meet. (Call `run` as a
 * method: on an RPC binding, even `.bind` is a remote call.)
 */
export function runModel(ai: Ai, model: string, inputs: Record<string, unknown>): Promise<unknown> {
  return (ai as unknown as UntypedAi).run(model, inputs);
}
