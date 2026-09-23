import { expect, test, type APIRequestContext } from "@playwright/test";
import { EXTRACTION_MODEL, extractionRequest } from "../../src/extract/prompt";

// The whole journey: forward, confirm, the Sunday run, the digest, the web page, stopping.
// Dates are in 2099 so links in the digest (valid for a year) outlive the real clock.
const PARENT = "e2e-journey@example.com";
const HELLO = "hello@school.example.com";
const SUBJECT = "Fwd: Year 5 museum trip";
const BODY =
  "Year 5 will visit the Science Museum on Thursday 15th October. The coach leaves at 9.15am.\n" +
  "The trip costs £12; please pay by Friday 23rd October.\n" +
  "Please bring a packed lunch in a named bag.";
// Mon 5 Oct 2099, 09:00 BST.
const SENT_AT = "2099-10-05T08:00:00.000Z";
// Sun 11 Oct 2099, 6pm BST: when the digest goes out.
const SUNDAY = "2099-10-11T17:00:00.000Z";

async function outbox(request: APIRequestContext): Promise<{ subject: string; text: string }[]> {
  return (await (await request.get(`/__test/outbox?to=${encodeURIComponent(PARENT)}`)).json()) as {
    subject: string;
    text: string;
  }[];
}

test("a forwarded letter reaches the Sunday digest and the web page, and the digest can be stopped", async ({
  page,
  request,
}) => {
  const raw = [
    `ARC-Authentication-Results: i=1; mx.cloudflare.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=${PARENT}`,
    `From: Parent <${PARENT}>`,
    `To: ${HELLO}`,
    `Subject: ${SUBJECT}`,
    "Message-ID: <journey@example.com>",
    "Date: Mon, 5 Oct 2099 09:00:00 +0100",
    "Content-Type: text/plain; charset=utf-8",
    "",
    BODY,
  ].join("\r\n");
  const delivered = await request.post(
    `/cdn-cgi/local/email?from=${encodeURIComponent(PARENT)}&to=${HELLO}`,
    { data: raw, headers: { "Content-Type": "message/rfc822" } },
  );
  expect(delivered.ok()).toBe(true);

  // The model's answer to exactly the request production will send.
  const registered = await request.post("/__test/ai", {
    data: {
      model: EXTRACTION_MODEL,
      inputs: extractionRequest({
        sentAt: SENT_AT,
        subject: SUBJECT,
        text: BODY,
        images: [],
        children: [],
      }),
      output: {
        response: {
          items: [
            {
              day: 15,
              month: 10,
              year: null,
              weekday: "Thursday",
              time: "09:15",
              kind: "event",
              title: "Year 5 trip to the Science Museum",
              cost: null,
              location: "Science Museum",
              school: null,
              child: "Year 5",
              confidence: "high",
              repeats: null,
              for: [],
              maybe: [],
            },
            {
              day: 23,
              month: 10,
              year: null,
              weekday: "Friday",
              time: null,
              kind: "payment",
              title: "Pay for the museum trip",
              cost: "£12",
              location: null,
              school: null,
              child: "Year 5",
              confidence: "high",
              repeats: null,
              for: [],
              maybe: [],
            },
          ],
          notes: [
            {
              text: "Bring a packed lunch in a named bag.",
              school: null,
              child: "Year 5",
              for: [],
              maybe: [],
            },
          ],
        },
      },
    },
  });
  expect(registered.ok()).toBe(true);

  // Confirm the address from the verification email.
  const verify = /\/verify\?token=\S+/.exec((await outbox(request)).at(-1)?.text ?? "")?.[0];
  expect(verify).toBeDefined();
  await page.goto(verify ?? "");
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await expect(page.getByRole("heading", { name: "You're all set" })).toBeVisible();

  // Sunday: the held email is read, then the digest goes out.
  const week = await request.post(
    `/__test/week?address=${encodeURIComponent(PARENT)}&now=${encodeURIComponent(SUNDAY)}`,
  );
  expect(await week.json()).toEqual({ processed: 1, sent: 1 });
  const digest = (await outbox(request)).at(-1);
  expect(digest?.subject).toBe("School this week: Mon 12 Oct to Sun 18 Oct");
  expect(digest?.text).toContain(
    "Thu 15 Oct\n- Year 5: Year 5 trip to the Science Museum, 9:15am, Science Museum\n",
  );
  expect(digest?.text).toContain("Coming up\n- Fri 23 Oct, Year 5: Pay for the museum trip, £12\n");
  // Notes go in the digest only from emails received in the last fortnight, and arrival uses
  // the real clock, so this 2099 digest leaves them out. Unit tests cover notes in the digest.
  expect(digest?.text).not.toContain("Worth knowing");

  // The web page shows the same, with where each item came from and what happened to the email.
  await page.goto("/household/upcoming");
  await expect(page.getByText("Year 5: Year 5 trip to the Science Museum")).toBeVisible();
  await expect(page.getByText("Year 5: Bring a packed lunch in a named bag.")).toBeVisible();
  await page.getByRole("link", { name: SUBJECT }).first().click();
  await expect(page.getByText("The coach leaves at 9.15am.")).toBeVisible();
  await page.goto("/household");
  await page.getByText("Activity", { exact: true }).click();
  await expect(page.getByText("2 items and 1 note found. No attachments.")).toBeVisible();

  // The digest's stop link asks first, then stops it; the household page offers to restart.
  const stop = /Stop these emails: (\S+)/.exec(digest?.text ?? "")?.[1];
  expect(stop).toBeDefined();
  await page.goto(stop ?? "");
  await page.getByRole("button", { name: "Stop weekly emails" }).click();
  await expect(page.getByRole("heading", { name: "Weekly emails stopped" })).toBeVisible();
  await page.goto("/household");
  await expect(page.getByRole("button", { name: "Start my weekly email again" })).toBeVisible();
});
