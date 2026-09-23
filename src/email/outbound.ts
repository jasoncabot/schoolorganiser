import { escape } from "../web/html";

// Emails we send. Plain and brief (see CLAUDE.md), styled per docs/design.md, always with a
// plain-text part. We send from a no-reply address; replies are dropped.

export interface OutboundEmail {
  subject: string;
  text: string;
  html: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Tue 30 Sep" in UK time. Built from numeric parts with our own names, because en-GB month
 * abbreviations vary between ICU versions ("Sep" vs "Sept").
 */
export function ukDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const [year, month, day] = [get("year"), get("month"), get("day")];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday] ?? ""} ${String(day)} ${MONTHS[month - 1] ?? ""}`;
}

export function verificationEmail(options: {
  link: string;
  expires: Date;
  appOrigin: string;
}): OutboundEmail {
  const expires = ukDate(options.expires);
  const hello = `hello@${new URL(options.appOrigin).hostname}`;
  const text = [
    "Confirm your email",
    "",
    "We received a school email you forwarded to School Organiser.",
    "",
    "To start getting a short summary every Sunday evening, confirm your address:",
    options.link,
    "",
    `This link works until ${expires}. If you don't confirm, we'll delete what you sent by then.`,
    "",
    "If this wasn't you, ignore this email.",
    "",
    "--",
    `School Organiser · Forward school emails to ${hello}`,
    `Privacy: ${options.appOrigin}/privacy`,
  ].join("\n");

  return {
    subject: "Confirm your email for School Organiser",
    text,
    html: layout(
      "Confirm your email",
      `<p style="margin:0 0 16px">We received a school email you forwarded to School Organiser.</p>
<p style="margin:0 0 24px">To start getting a short summary every Sunday evening, confirm your address.</p>
<p style="margin:0 0 24px"><a href="${escape(options.link)}" style="display:inline-block;background:#00703c;color:#ffffff;font-weight:bold;text-decoration:none;padding:10px 16px;box-shadow:0 2px 0 #002d18">Confirm my email</a></p>
<p style="margin:0 0 16px">This link works until ${escape(expires)}. If you don't confirm, we'll delete what you sent by then.</p>
<p style="margin:0 0 16px;color:#505a5f">If this wasn't you, ignore this email.</p>`,
      options.appOrigin,
      hello,
    ),
  };
}

function layout(heading: string, body: string, appOrigin: string, hello: string): string {
  const font = `"Inter Tight", Arial, Helvetica, sans-serif`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>@font-face{font-family:"Inter Tight";font-weight:100 900;src:url("${escape(appOrigin)}/assets/fonts/inter-tight.woff2") format("woff2")}</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#0b0c0c;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<div style="background:#0b0c0c;border-bottom:8px solid #1d70b8;padding:12px 16px">
<span style="font-family:${escape(font)};font-weight:bold;font-size:20px;color:#ffffff">School Organiser</span>
</div>
<div style="max-width:560px;padding:24px 16px">
<h1 style="font-family:${escape(font)};font-weight:bold;font-size:28px;line-height:1.2;margin:0 0 16px">${escape(heading)}</h1>
${body}
<hr style="border:0;border-top:1px solid #b1b4b6;margin:24px 0 12px">
<p style="margin:0;font-size:14px;color:#505a5f">Forward school emails to ${escape(hello)} · <a href="${escape(appOrigin)}/privacy" style="color:#1d70b8">Privacy</a></p>
</div>
</body>
</html>`;
}
