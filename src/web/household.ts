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
import {
  childNames,
  describeItem,
  describeNote,
  relevantItems,
  relevantNotes,
} from "../email/digest";
import { invitationEmail, sendEmail } from "../email/outbound";
import { addDays } from "../retention";
import { signToken } from "../tokens";
import type { AttachmentOutcome } from "../extract/message";
import { MAX_ATTEMPTS, PAGE_NOTE_DAYS, type Activity } from "../household";
import { dayLabel, londonDate, ukDate, ukDateTime } from "../uk-time";
import { html, page, type Html } from "./html";
import { renderMarkdown } from "./markdown";
import { clearSessionCookie, readSession, sameOrigin, type Session } from "./session";
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
  if (path === "/household/upcoming" && request.method === "GET")
    return upcoming(env, deps, session);
  if (path === "/household/digest" && request.method === "POST") {
    const choice = (await request.formData()).get("digest");
    if (choice === "stop") {
      await household.stopDigest(session.address, deps.clock.now().toISOString());
    } else if (choice === "start") {
      await household.startDigest(session.address);
    }
    return redirect("/household");
  }
  const email = /^\/household\/emails\/([\w-]+)$/.exec(path);
  if (email?.[1] !== undefined && request.method === "GET")
    return storedEmail(env, session, email[1]);
  if (path === "/household/delete") return deleteData(request, env, session);
  if (path === "/household/leave") return leave(request, env, session);

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
  const [children, members, activity] = await Promise.all([
    household.children(),
    household.members(),
    household.activity(),
  ]);
  const now = deps.clock.now();
  const childRows = children.map(
    (c) =>
      html`<div class="summary-row">
        <dt>${c.name}</dt>
        <dd>
          ${c.school}<br />${yearGroupLabel(currentYearGroup(c, now))}${c.className === null ? "" : `, ${c.className}`}
          ${c.className === null ? html`<br /><span class="hint">Add a class if letters use class names</span>` : html``}
        </dd>
        <dd class="summary-actions">
          <a href="/household/children/${c.id}">Change<span class="sr-only"> ${c.name}</span></a>
        </dd>
      </div>`,
  );
  const memberRows = members.map(
    (m) =>
      html`<li>
        ${m.address}${m.address === session.address ? " (you)" : ""}${m.digestStoppedAt === null ? "" : ", weekly email stopped"}
      </li>`,
  );
  const stopped = members.find((m) => m.address === session.address)?.digestStoppedAt != null;
  const digestToggle = stopped
    ? html`<p>You've stopped the weekly email.</p>
        <form method="post" action="/household/digest">
          <button type="submit" name="digest" value="start" class="button">
            Start my weekly email again
          </button>
        </form>`
    : html`<form method="post" action="/household/digest">
        <button type="submit" name="digest" value="stop" class="button-secondary">
          Stop my weekly email
        </button>
      </form>`;
  const leaveLink =
    members.length > 1
      ? html`<li><a href="/household/leave">Leave this household</a></li>`
      : html``;
  return page(
    "Your household",
    html`${notice ?? html``}
      <h1>Your household</h1>
      <p><a href="/household/upcoming">See everything coming up</a></p>
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
      <h2>Your weekly email</h2>
      ${digestToggle}
      <details class="disclosure">
        <summary>Activity</summary>
        <p class="hint">
          Every email forwarded in the last 90 days, newest first, and what happened to it.
        </p>
        ${
          activity.length === 0
            ? html`<p>No emails yet.</p>`
            : html`<ol class="activity">
                ${activity.map(activityRow)}
              </ol>`
        }
      </details>
      <h2>Your data</h2>
      <ul class="list">
        ${leaveLink}
        <li><a href="/household/delete">Delete your household's data</a></li>
      </ul>
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
  await sendEmail(env, address, email);
  return overview(
    env,
    deps,
    session,
    html`<div class="notice" role="status">
      <p>We've emailed ${address} a link to join. It works for ${String(INVITE_DAYS)} days.</p>
    </div>`,
  );
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** What happened to an email, as a tag and a sentence or two, for the activity log and email page. */
function activityStatus(a: Activity): { tag: Html; detail: string; meta: string } {
  let tag: Html;
  let detail: string;
  if (a.status === "done") {
    tag = html`<span class="tag tag-done">Done</span>`;
    const attached = (a.attachments ?? []).filter((f) => f.outcome !== "missing");
    const missing = (a.attachments ?? []).filter((f) => f.outcome === "missing");
    const attachments =
      a.attachments === null
        ? "Attachments weren't recorded when this was read."
        : attached.length === 0
          ? "No attachments."
          : `${plural(attached.length, "attachment")}: ${attached.map((f) => `${f.filename} (${OUTCOME[f.outcome]})`).join(", ")}.`;
    detail = [
      `${plural(a.items, "item")} and ${plural(a.notes, "note")} found.`,
      attachments,
      missing.length > 0
        ? `Mentions ${missing.map((f) => f.filename).join(", ")}, but ${missing.length === 1 ? "it wasn't" : "they weren't"} attached.`
        : "",
      a.rereading ? "Reading again after a change." : "",
    ]
      .filter((p) => p !== "")
      .join(" ");
  } else if (a.status === "failed") {
    tag = html`<span class="tag tag-failed">Failed</span>`;
    detail = `Gave up${a.attempts > 0 ? ` after ${plural(a.attempts, "attempt")}` : ""}: ${a.lastError ?? "unknown error"}.`;
  } else if (a.attempts > 0) {
    tag = html`<span class="tag">Retrying</span>`;
    detail = `Attempt ${String(a.attempts)} of ${String(MAX_ATTEMPTS)} failed: ${a.lastError ?? "unknown error"}. We'll try again within 5 minutes.`;
  } else {
    tag = html`<span class="tag">Received</span>`;
    detail = "Waiting to be read.";
  }
  const meta = [
    `Received ${ukDateTime(new Date(a.receivedAt))}`,
    a.forwardedBy === null ? null : `from ${a.forwardedBy}`,
    a.processedAt === null ? null : `read ${ukDateTime(new Date(a.processedAt))}`,
  ]
    .filter((p) => p !== null)
    .join(", ");
  return { tag, detail, meta };
}

const OUTCOME: Record<AttachmentOutcome["outcome"], string> = {
  read: "read",
  skipped: "skipped as a logo",
  unreadable: "couldn't read",
  missing: "not attached",
};

function activityRow(a: Activity): Html {
  const { tag, detail, meta } = activityStatus(a);
  return html`<li>
    <p class="mb-1">
      <a href="/household/emails/${a.id}">${a.subject ?? "Subject not read yet"}</a>
    </p>
    <p class="mb-1 text-muted">${meta}</p>
    <p>${tag} ${detail}</p>
  </li>`;
}

/** Every relevant item from today on, grouped by day. */
async function upcoming(env: Env, deps: Deps, session: Session): Promise<Response> {
  const household = await householdStub(env, session.householdId);
  const [items, notes, children] = await Promise.all([
    household.items(),
    household.notes(),
    household.children(),
  ]);
  const now = deps.clock.now();
  const today = londonDate(now);
  const names = childNames(children);
  const line = (
    text: string,
    messageId: string,
    source: { subject: string | null; receivedAt: string } | null,
  ): Html => {
    const from =
      source === null
        ? html`From an email we no longer keep`
        : html`From
            <a href="/household/emails/${messageId}"
              >${source.subject ?? `an email received ${ukDate(new Date(source.receivedAt))}`}</a
            >`;
    return html`<li>
      ${text}<br />
      <span class="text-muted">${from}</span>
    </li>`;
  };
  const days = new Map<string, Html[]>();
  for (const item of relevantItems(items).filter((i) => i.date >= today)) {
    days.set(item.date, [
      ...(days.get(item.date) ?? []),
      line(describeItem(item, names), item.messageId, item.source),
    ]);
  }
  const noteCutoff = addDays(now, -PAGE_NOTE_DAYS).toISOString();
  const recentNotes = relevantNotes(notes.filter((n) => n.source.receivedAt >= noteCutoff));
  const worthKnowing =
    recentNotes.length === 0
      ? html``
      : html`<h2>Worth knowing</h2>
          <p class="hint">From emails in the last ${String(PAGE_NOTE_DAYS)} days, newest first.</p>
          <ul class="list">
            ${recentNotes.map((n) => line(describeNote(n, names), n.messageId, n.source))}
          </ul>`;
  const hello = `hello@${new URL(env.APP_ORIGIN).hostname}`;
  const body =
    days.size === 0 && recentNotes.length === 0
      ? html`<p>Nothing coming up yet. Forward school emails to <strong>${hello}</strong>.</p>`
      : [...days].map(
          ([date, lines]) =>
            html`<h2>${dayLabel(date)}</h2>
              <ul class="list">
                ${lines}
              </ul>`,
        );
  return page(
    "Coming up",
    html`<p><a href="/household">Back</a></p>
      <h1>Coming up</h1>
      ${worthKnowing} ${body}`,
  );
}

/** One forwarded email as we read it, so a parent can check an item against its letter. */
async function storedEmail(env: Env, session: Session, id: string): Promise<Response> {
  const household = await householdStub(env, session.householdId);
  const email = await household.emailDetails(id);
  if (email === null) return new Response("Not found", { status: 404 });
  const { activity, message } = email;
  const { tag, detail, meta } = activityStatus(activity);
  const names = childNames(await household.children());
  const title = message.subject ?? "Forwarded email";
  const read = (activity.attachments ?? []).filter((f) => f.outcome === "read");
  const sections =
    message.text === null
      ? []
      : splitSections(
          message.text,
          read.map((f) => f.filename),
        );
  const dated = email.items.map(
    (i) =>
      html`<li>
        ${dayLabel(i.date)}, ${describeItem(i, names)}${forUs(i) ? "" : " (not for your children)"}
      </li>`,
  );
  const notes = email.notes.map(
    (n) => html`<li>${describeNote(n, names)}${forUs(n) ? "" : " (not for your children)"}</li>`,
  );
  const attachments = (activity.attachments ?? []).map((f) => {
    const index = sections.findIndex((s) => s.title === f.filename);
    const name =
      index === -1
        ? html`${f.filename}`
        : html`<a href="#section-${String(index)}">${f.filename}</a>`;
    const why =
      f.outcome === "missing"
        ? "not attached: the forward left it out. Forward the email again with its attachments."
        : OUTCOME[f.outcome];
    return html`<li>${name}: ${why}</li>`;
  });
  return page(
    title,
    html`<p><a href="/household">Back to your household</a></p>
      <h1>${title}</h1>
      <p class="mb-1 text-muted">${meta}</p>
      <p>${tag} ${detail}</p>
      <h2>What we found</h2>
      ${
        dated.length === 0 && notes.length === 0
          ? html`<p>No dates or notes worth knowing.</p>`
          : html``
      }
      ${
        dated.length === 0
          ? html``
          : html`<h3>Dates</h3>
              <ul class="list">
                ${dated}
              </ul>`
      }
      ${
        notes.length === 0
          ? html``
          : html`<h3>Worth knowing</h3>
              <ul class="list">
                ${notes}
              </ul>`
      }
      ${
        attachments.length === 0
          ? html``
          : html`<h2>Attachments</h2>
              <ul class="list">
                ${attachments}
              </ul>`
      }
      <h2>The email as we read it</h2>
      ${
        sections.length === 0
          ? html`<p>We haven't read this email yet, or couldn't.</p>`
          : sections.map(
              (s, index) =>
                html`${s.title === null ? html`` : html`<h3 id="section-${String(index)}">Attachment: ${s.title}</h3>`}
                  <div class="email-text">${renderMarkdown(s.text)}</div>`,
            )
      }`,
  );
}

/** Whether an item or note is for the household's children, or might be. */
function forUs(x: { childIds: string[] | null; maybeChildIds: string[] }): boolean {
  return x.childIds === null || x.childIds.length > 0 || x.maybeChildIds.length > 0;
}

/**
 * Splits the text we read into the body and one section per attachment. readMessage() starts
 * each attachment's text with "Attachment: <filename>"; only files we read count, so a body
 * line that happens to start that way isn't mistaken for one.
 */
export function splitSections(
  text: string,
  filenames: string[],
): { title: string | null; text: string }[] {
  const sections: { title: string | null; text: string }[] = [];
  let current: { title: string | null; lines: string[] } = { title: null, lines: [] };
  for (const line of text.split("\n")) {
    const name = /^Attachment: (.+)$/.exec(line)?.[1];
    if (name !== undefined && filenames.includes(name)) {
      sections.push({ title: current.title, text: current.lines.join("\n") });
      current = { title: name, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push({ title: current.title, text: current.lines.join("\n") });
  return sections
    .map((s) => ({
      title: s.title,
      // toMarkdown starts a document with its filename as a heading; the section title says it.
      text:
        s.title === null
          ? s.text.trim()
          : s.text
              .trim()
              .replace(new RegExp(`^#\\s+${escapeRegExp(s.title)}\\s*\n?`), "")
              .trim(),
    }))
    .filter((s) => s.title !== null || s.text !== "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** GET asks for confirmation; POST deletes the household's data and forgets every member. */
async function deleteData(request: Request, env: Env, session: Session): Promise<Response> {
  const household = await householdStub(env, session.householdId);
  if (request.method === "GET") {
    const others = (await household.members()).length - 1;
    return page(
      "Delete your household's data",
      html`<p><a href="/household">Back</a></p>
        <h1>Delete your household's data</h1>
        <p>
          This deletes the emails you've forwarded, everything we read from them, your children's
          details and every address in the household. It can't be undone.
        </p>
        ${
          others > 0
            ? html`<p>
                ${others === 1 ? "The other person" : `The other ${String(others)} people`} in your
                household will stop getting the weekly email too. To remove only yourself,
                <a href="/household/leave">leave the household</a> instead.
              </p>`
            : html``
        }
        <form method="post" action="/household/delete">
          <button type="submit" class="button-warning">Delete everything</button>
        </form>`,
    );
  }
  if (request.method !== "POST") return notAllowed();
  const members = await household.deleteEverything();
  for (const address of members) await addressStub(env, address).forget();
  try {
    // Removes the agent's own tables and schedules. It aborts the object when done, which
    // can surface here as an error; our data is already gone by then.
    await household.destroy();
  } catch {
    // Nothing to do.
  }
  const response = page(
    "Data deleted",
    html`<h1>Your household's data is deleted</h1>
      <p>We've deleted everything we held for your household.</p>
      <p>To start again, forward a school email to us.</p>`,
  );
  response.headers.append("Set-Cookie", clearSessionCookie);
  return response;
}

/** GET asks for confirmation; POST removes the signed-in address from the household. */
async function leave(request: Request, env: Env, session: Session): Promise<Response> {
  const household = await householdStub(env, session.householdId);
  if ((await household.members()).length < 2) return redirect("/household/delete");
  if (request.method === "GET") {
    return page(
      "Leave this household",
      html`<p><a href="/household">Back</a></p>
        <h1>Leave this household</h1>
        <p>
          We'll forget <strong>${session.address}</strong> and stop sending it the weekly email. The
          household's emails and children stay for the people still in it.
        </p>
        <form method="post" action="/household/leave">
          <button type="submit" class="button-warning">Leave household</button>
        </form>`,
    );
  }
  if (request.method !== "POST") return notAllowed();
  await household.removeMember(session.address);
  await addressStub(env, session.address).forget();
  const response = page(
    "You've left",
    html`<h1>You've left the household</h1>
      <p>We've forgotten your address. To start again, forward a school email to us.</p>`,
  );
  response.headers.append("Set-Cookie", clearSessionCookie);
  return response;
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
