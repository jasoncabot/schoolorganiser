import { expect, test, type APIRequestContext } from "@playwright/test";

const HELLO = "hello@school.example.com";

async function forward(request: APIRequestContext, from: string): Promise<void> {
  const raw = [
    `ARC-Authentication-Results: i=1; mx.cloudflare.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=${from}`,
    `From: Parent <${from}>`,
    `To: ${HELLO}`,
    "Subject: Fwd: Harvest festival",
    `Message-ID: <household-${from}>`,
    "Date: Mon, 6 Oct 2025 09:00:00 +0100",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Harvest festival is on Friday 10 October at 2pm.",
  ].join("\r\n");
  const response = await request.post(
    `/cdn-cgi/local/email?from=${encodeURIComponent(from)}&to=${HELLO}`,
    {
      data: raw,
      headers: { "Content-Type": "message/rfc822" },
    },
  );
  expect(response.ok()).toBe(true);
}

async function latestLink(request: APIRequestContext, to: string, path: string): Promise<string> {
  const sent = (await (
    await request.get(`/__test/outbox?to=${encodeURIComponent(to)}`)
  ).json()) as { text: string }[];
  const link = new RegExp(`${path.replace("?", "\\?")}\\S+`).exec(sent.at(-1)?.text ?? "")?.[0];
  if (link === undefined) throw new Error(`No ${path} link for ${to}`);
  return link;
}

test("a parent confirms, adds their children and invites another parent", async ({
  page,
  request,
}) => {
  const parent = "e2e-household@example.com";
  await forward(request, parent);
  await page.goto(await latestLink(request, parent, "/verify?token="));
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await expect(page.getByRole("heading", { name: "Next, add your children" })).toBeVisible();

  await page.getByRole("link", { name: "Add your children" }).click();
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("School").fill("Oakfield Primary");
  await page.getByLabel("Year group").selectOption({ label: "Year 3" });
  await page.getByLabel("Class (optional)").fill("Oak");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your household");
  await expect(page.getByText("Oakfield Primary")).toBeVisible();
  await expect(page.getByText("Year 3, Oak")).toBeVisible();

  await page.getByRole("link", { name: "Add a child" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a name");
  await page.getByRole("link", { name: "Back" }).click();

  await page.getByLabel("Invite someone").fill("e2e-partner@example.com");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText(
    "We've emailed e2e-partner@example.com a link to join.",
  );
});

test("a verified parent signs in with an emailed link and signs out", async ({ page, request }) => {
  const parent = "e2e-signin@example.com";
  await forward(request, parent);
  const verify = await latestLink(request, parent, "/verify?token=");
  await request.post("/verify", {
    form: { token: new URL(verify, "http://x").searchParams.get("token") ?? "" },
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email address").fill(parent);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your email");

  await page.goto(await latestLink(request, parent, "/sign-in/confirm?token="));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your household");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/household");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
});
