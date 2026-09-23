import type { Deps } from "../deps";
import { html, page } from "./html";
import { readSession } from "./session";
import { redirect } from "./sign-in";

/** The signed-in household's page. Children and members arrive in the next part of step 6. */
export async function householdPage(request: Request, env: Env, deps: Deps): Promise<Response> {
  const session = await readSession(request, env, deps);
  if (session === null) return redirect("/sign-in");
  return page(
    "Your household",
    html`<h1>Your household</h1>
      <p>Signed in as <strong>${session.address}</strong>.</p>
      <form method="post" action="/sign-out">
        <button type="submit" class="button-secondary">Sign out</button>
      </form>`,
  );
}
