import { addressStub, householdStub } from "../bindings";
import {
  currentYearGroup,
  parseChildForm,
  schoolYearStart,
  YEAR_GROUPS,
  yearGroupLabel,
  type Child,
  type ChildInput,
} from "../children";
import type { Deps } from "../deps";
import { invitationEmail } from "../email/outbound";
import { addDays } from "../retention";
import { signToken } from "../tokens";
import { html, page, type Html } from "./html";
import { readSession, sameOrigin, type Session } from "./session";
import { notAllowed, redirect } from "./sign-in";

/** How long an invitation link lasts. */
export const INVITE_DAYS = 7;

export interface InvitePayload {
  purpose: "invite";
  address: string;
  householdId: string;
  invitedBy: string;
  expires: string;
}

/** Routes under /household. Everything here needs a session. */
export async function householdRoutes(request: Request, env: Env, deps: Deps): Promise<Response> {
  const session = await readSession(request, env, deps);
  if (session === null) return redirect("/sign-in");
  if (request.method === "POST" && !sameOrigin(request, env)) return notAllowed();
  const path = new URL(request.url).pathname;
  const household = await householdStub(env, session.householdId);

  if (path === "/household" && request.method === "GET") return overview(env, deps, session);
  if (path === "/household/children/new" && request.method === "GET") {
    return childForm("Add a child", "/household/children", await schools(household));
  }
  if (path === "/household/children" && request.method === "POST") {
    const input = parseChildForm(await request.formData());
    if ("errors" in input)
      return childForm(
        "Add a child",
        "/household/children",
        await schools(household),
        input.errors,
        400,
      );
    const now = deps.clock.now();
    await household.addChild(deps.ids.next(), input, schoolYearStart(now), now.toISOString());
    return redirect("/household");
  }
  if (path === "/household/members" && request.method === "POST")
    return invite(request, env, deps, session);

  const child = /^\/household\/children\/([\w-]+)(\/remove)?$/.exec(path);
  if (child?.[1] !== undefined) {
    const id = child[1];
    const existing = (await household.children()).find((c) => c.id === id);
    if (existing === undefined) return new Response("Not found", { status: 404 });
    const action = `/household/children/${id}`;
    if (child[2] === "/remove") {
      if (request.method !== "POST") return notAllowed();
      await household.removeChild(id);
      return redirect("/household");
    }
    if (request.method === "GET") {
      const values: ChildInput = {
        name: existing.name,
        school: existing.school,
        yearGroup: currentYearGroup(existing, deps.clock.now()) ?? 13,
        className: existing.className,
      };
      return childForm(
        `Change ${existing.name}`,
        action,
        await schools(household),
        {},
        200,
        values,
        id,
      );
    }
    if (request.method === "POST") {
      const input = parseChildForm(await request.formData());
      if ("errors" in input)
        return childForm(
          `Change ${existing.name}`,
          action,
          await schools(household),
          input.errors,
          400,
          undefined,
          id,
        );
      await household.updateChild(id, input, schoolYearStart(deps.clock.now()));
      return redirect("/household");
    }
  }
  return new Response("Not found", { status: 404 });
}

async function overview(env: Env, deps: Deps, session: Session, notice?: Html): Promise<Response> {
  const household = await householdStub(env, session.householdId);
  const [children, members] = await Promise.all([household.children(), household.members()]);
  const now = deps.clock.now();
  const childRows = children.map(
    (c) =>
      html`<div class="summary-row">
        <dt>${c.name}</dt>
        <dd>
          ${c.school}<br />${yearGroupLabel(currentYearGroup(c, now))}${c.className === null ? "" : `, ${c.className}`}
        </dd>
        <dd class="summary-actions">
          <a href="/household/children/${c.id}">Change<span class="sr-only"> ${c.name}</span></a>
        </dd>
      </div>`,
  );
  const memberRows = members.map(
    (m) => html`<li>${m.address}${m.address === session.address ? " (you)" : ""}</li>`,
  );
  return page(
    "Your household",
    html`${notice ?? html``}
      <h1>Your household</h1>
      <h2>Children</h2>
      <p class="hint">
        We use these to work out which parts of each school email apply to your children.
      </p>
      ${children.length === 0 ? html`<p>You haven't added any children yet.</p>` : html`<dl class="summary-list">${childRows}</dl>`}
      <p><a href="/household/children/new" class="button">Add a child</a></p>
      <h2>Who gets the summary</h2>
      <ul class="list">
        ${memberRows}
      </ul>
      <form method="post" action="/household/members" novalidate>
        <label class="label" for="invite">Invite someone</label>
        <p class="hint">For example, another parent or carer. We'll email them a link to join.</p>
        <input
          class="input"
          id="invite"
          name="email"
          type="email"
          autocomplete="off"
          spellcheck="false"
        />
        <button type="submit" class="button-secondary">Send invitation</button>
      </form>
      <hr class="rule" />
      <p>Signed in as <strong>${session.address}</strong>.</p>
      <form method="post" action="/sign-out">
        <button type="submit" class="button-secondary">Sign out</button>
      </form>`,
  );
}

async function invite(request: Request, env: Env, deps: Deps, session: Session): Promise<Response> {
  const submitted = (await request.formData()).get("email");
  const address = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  const problem = (message: string): Promise<Response> =>
    overview(
      env,
      deps,
      session,
      html`<div class="error-summary" role="alert"><p>${message}</p></div>`,
    );
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
    return problem("Enter an email address, like name@example.com");
  const state = await addressStub(env, address).lookup();
  if (state.status === "verified") {
    return problem(
      state.householdId === session.householdId
        ? `${address} is already in your household`
        : `${address} already gets a summary for another household`,
    );
  }
  const now = deps.clock.now();
  const expires = addDays(now, INVITE_DAYS);
  const payload: InvitePayload = {
    purpose: "invite",
    address,
    householdId: session.householdId,
    invitedBy: session.address,
    expires: expires.toISOString(),
  };
  const link = `${env.APP_ORIGIN}/join?token=${encodeURIComponent(await signToken(payload, env.SIGNING_KEY))}`;
  const email = invitationEmail({
    link,
    invitedBy: session.address,
    expires,
    appOrigin: env.APP_ORIGIN,
  });
  await env.EMAIL.send({
    to: address,
    from: { email: env.SENDER_ADDRESS, name: "School Organiser" },
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  return overview(
    env,
    deps,
    session,
    html`<div class="notice" role="status">
      <p>We've emailed ${address} a link to join. It works for ${String(INVITE_DAYS)} days.</p>
    </div>`,
  );
}

/** The household's schools, for suggestions when adding a child. */
async function schools(household: { children(): Promise<Child[]> }): Promise<string[]> {
  return [...new Set((await household.children()).map((c) => c.school))].sort();
}

function childForm(
  title: string,
  action: string,
  knownSchools: string[],
  errors: Partial<Record<keyof ChildInput, string>> = {},
  status = 200,
  values?: ChildInput,
  id?: string,
): Response {
  const messages = Object.values(errors);
  const summary =
    messages.length === 0
      ? html``
      : html`<div class="error-summary" role="alert">
          ${messages.map((m) => html`<p>${m}</p>`)}
        </div>`;
  const error = (field: keyof ChildInput): Html => {
    const message = errors[field];
    return message === undefined ? html`` : html`<p class="field-error">${message}</p>`;
  };
  const options = YEAR_GROUPS.map((y) =>
    values?.yearGroup === y.value
      ? html`<option value="${String(y.value)}" selected>${y.label}</option>`
      : html`<option value="${String(y.value)}">${y.label}</option>`,
  );
  const remove =
    id === undefined
      ? html``
      : html`<form method="post" action="/household/children/${id}/remove">
          <button type="submit" class="button-secondary">Remove this child</button>
        </form>`;
  return page(
    title,
    html`<p><a href="/household">Back</a></p>
      <h1>${title}</h1>
      ${summary}
      <form method="post" action="${action}" novalidate>
        <label class="label" for="name">Name</label>
        <p class="hint">Shown in your summary. A nickname or initial is fine.</p>
        ${error("name")}
        <input
          class="input"
          id="name"
          name="name"
          value="${values?.name ?? ""}"
          autocomplete="off"
        />
        <label class="label" for="school">School</label>
        ${error("school")}
        <input
          class="input"
          id="school"
          name="school"
          list="schools"
          value="${values?.school ?? ""}"
          autocomplete="off"
        />
        <datalist id="schools">
          ${knownSchools.map((s) => html`<option value="${s}"></option>`)}
        </datalist>
        <label class="label" for="yearGroup">Year group</label>
        <p class="hint">This school year. It moves up automatically each September.</p>
        ${error("yearGroup")}
        <select class="select" id="yearGroup" name="yearGroup">
          <option value="">Choose a year group</option>
          ${options}
        </select>
        <label class="label" for="className">Class (optional)</label>
        <p class="hint">If letters use class names, for example Oak class.</p>
        ${error("className")}
        <input
          class="input"
          id="className"
          name="className"
          value="${values?.className ?? ""}"
          autocomplete="off"
        />
        <button type="submit" class="button">Save</button>
      </form>
      ${remove}`,
    status,
  );
}
