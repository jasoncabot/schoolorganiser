import { escape } from "../web/html";
import { ukDate } from "../uk-time";

// Emails we send. Plain and brief (see CLAUDE.md), styled per docs/design.md, always with a
// plain-text part. We send from a no-reply address; replies are dropped.

/** The web page's colours (src/styles/app.css), inlined because email clients drop stylesheets. */
export const COLOURS = {
  page: "#fdf9f2",
  ink: "#221a20",
  muted: "#5e5559",
  rule: "#cfc6bd",
  brand: "#4a2545",
  accent: "#d9a441",
  link: "#7a2e70",
};

export interface OutboundEmail {
  subject: string;
  text: string;
  html: string;
}

/** An email whose main job is one link: verification, sign-in, invitation. */
function linkEmail(options: {
  subject: string;
  heading: string;
  /** Paragraphs before the button. In the plain-text part the last one ends with a colon and the link follows. */
  before: string[];
  button: string;
  link: string;
  /** Paragraphs after the button. */
  after: string[];
  /** A quieter final paragraph, e.g. "If this wasn't you, ignore this email." */
  note: string;
  appOrigin: string;
}): OutboundEmail {
  const hello = `hello@${new URL(options.appOrigin).hostname}`;
  const text = [
    options.heading,
    "",
    ...options.before.flatMap((p, i) =>
      i === options.before.length - 1 ? [p.replace(/\.$/, ":")] : [p, ""],
    ),
    options.link,
    "",
    ...options.after.flatMap((p) => [p, ""]),
    options.note,
    "",
    "--",
    `School Organiser · Forward school emails to ${hello}`,
    `Privacy: ${options.appOrigin}/privacy`,
  ].join("\n");
  const paragraph = (p: string, margin = 16): string =>
    `<p style="margin:0 0 ${String(margin)}px">${escape(p)}</p>`;
  const html = [
    ...options.before.map((p, i) => paragraph(p, i === options.before.length - 1 ? 24 : 16)),
    `<p style="margin:0 0 24px"><a href="${escape(options.link)}" style="display:inline-block;background:${COLOURS.brand};color:${COLOURS.page};font-weight:bold;text-decoration:none;padding:10px 16px;border-radius:6px">${escape(options.button)}</a></p>`,
    ...options.after.map((p) => paragraph(p)),
    `<p style="margin:0 0 16px;color:${COLOURS.muted}">${escape(options.note)}</p>`,
  ].join("\n");
  return {
    subject: options.subject,
    text,
    html: layout(options.heading, html, options.appOrigin, hello),
  };
}

export function verificationEmail(options: {
  link: string;
  expires: Date;
  appOrigin: string;
}): OutboundEmail {
  return linkEmail({
    subject: "Confirm your email for School Organiser",
    heading: "Confirm your email",
    before: [
      "We received a school email you forwarded to School Organiser.",
      "To start getting a short summary every Sunday evening, confirm your address.",
    ],
    button: "Confirm my email",
    link: options.link,
    after: [
      `This link works until ${ukDate(options.expires)}. If you don't confirm, we'll delete what you sent by then.`,
    ],
    note: "If this wasn't you, ignore this email.",
    appOrigin: options.appOrigin,
  });
}

export function signInEmail(options: { link: string; appOrigin: string }): OutboundEmail {
  return linkEmail({
    subject: "Sign in to School Organiser",
    heading: "Sign in",
    before: ["Use this link to sign in to School Organiser."],
    button: "Sign in",
    link: options.link,
    after: ["The link works for 30 minutes."],
    note: "If you didn't ask to sign in, ignore this email. Nobody can sign in without it.",
    appOrigin: options.appOrigin,
  });
}

/** The shared email shell. `stopLink`, for the digest, adds a stop link to the footer. */
export function layout(
  heading: string,
  body: string,
  appOrigin: string,
  hello: string,
  stopLink?: string,
): string {
  const font = `"Inter Tight", Arial, Helvetica, sans-serif`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>@font-face{font-family:"Inter Tight";font-weight:100 900;src:url("${escape(appOrigin)}/assets/fonts/inter-tight.woff2") format("woff2")}</style>
</head>
<body style="margin:0;padding:0;background:${COLOURS.page};color:${COLOURS.ink};font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<div style="background:${COLOURS.brand};border-bottom:4px solid ${COLOURS.accent};padding:12px 16px">
<span style="font-family:${escape(font)};font-weight:bold;font-size:20px;color:${COLOURS.page}">School Organiser</span>
</div>
<div style="max-width:560px;padding:24px 16px">
<h1 style="font-family:${escape(font)};font-weight:bold;font-size:28px;line-height:1.2;margin:0 0 16px">${escape(heading)}</h1>
${body}
<hr style="border:0;border-top:1px solid ${COLOURS.rule};margin:24px 0 12px">
<p style="margin:0;font-size:14px;color:${COLOURS.muted}">Forward school emails to ${escape(hello)} · <a href="${escape(appOrigin)}/privacy" style="color:${COLOURS.link}">Privacy</a>${stopLink === undefined ? "" : ` · <a href="${escape(stopLink)}" style="color:${COLOURS.link}">Stop these emails</a>`}</p>
</div>
</body>
</html>`;
}

export function invitationEmail(options: {
  link: string;
  invitedBy: string;
  expires: Date;
  appOrigin: string;
}): OutboundEmail {
  return linkEmail({
    subject: "You're invited to School Organiser",
    heading: "Join a household",
    before: [
      `${options.invitedBy} has invited you to get their household's weekly school summary: a short email every Sunday evening about the week ahead.`,
      "Join to start getting it.",
    ],
    button: "Join",
    link: options.link,
    after: [`This link works until ${ukDate(options.expires)}.`],
    note: "If you weren't expecting this, ignore this email and we won't contact you again.",
    appOrigin: options.appOrigin,
  });
}
