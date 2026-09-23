// Local stand-ins for Workers AI and Email Service, used by Vitest and Playwright.
// They are deterministic and fail loudly: an AI request without a recorded fixture throws,
// so a changed prompt can never quietly reach the real model.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import aiFixtures from "../fixtures/ai.json";
import markdownFixtures from "../fixtures/markdown.json";
import { canonicalJson, sha256Hex } from "./hash";

interface StubEnv {
  OUTBOX: DurableObjectNamespace<Outbox>;
  FIXTURES: DurableObjectNamespace<Fixtures>;
}

const ai: Record<string, unknown> = aiFixtures;
const markdown: Record<string, string> = markdownFixtures;

/** Key for an AI request: the same model and inputs always give the same key. */
export function aiKey(model: string, inputs: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalJson({ model, inputs }));
}

export class AiStub extends WorkerEntrypoint<StubEnv> {
  private get fixtures(): DurableObjectStub<Fixtures> {
    return this.env.FIXTURES.getByName("fixtures");
  }

  async run(model: string, inputs: Record<string, unknown>): Promise<unknown> {
    const key = await aiKey(model, inputs);
    const registered = await this.fixtures.get(`ai:${key}`);
    if (registered !== null) return JSON.parse(registered) as unknown;
    if (key in ai) return ai[key];
    throw new Error(
      `No AI fixture for ${model} (key ${key}). Register one in the test or record it in test/fixtures/ai.json.`,
    );
  }

  async toMarkdown(
    files: MarkdownDocument | MarkdownDocument[],
  ): Promise<ConversionResponse | ConversionResponse[]> {
    const convert = async (file: MarkdownDocument): Promise<ConversionResponse> => {
      const key = await sha256Hex(new Uint8Array(await file.blob.arrayBuffer()));
      const data = (await this.fixtures.get(`markdown:${key}`)) ?? markdown[key];
      if (data === undefined) {
        throw new Error(
          `No markdown fixture for ${file.name} (key ${key}). Register one in the test or record it in test/fixtures/markdown.json.`,
        );
      }
      return {
        id: key,
        name: file.name,
        mimeType: file.blob.type,
        format: "markdown",
        tokens: 0,
        data,
      };
    };
    return Array.isArray(files) ? Promise.all(files.map(convert)) : convert(files);
  }

  /** Test-only: what run(model, inputs) should return. */
  async registerRun(
    model: string,
    inputs: Record<string, unknown>,
    output: unknown,
  ): Promise<void> {
    await this.fixtures.set(`ai:${await aiKey(model, inputs)}`, JSON.stringify(output));
  }

  /** Test-only: what toMarkdown should return for a file with these bytes. */
  async registerMarkdown(bytes: Uint8Array, data: string): Promise<void> {
    await this.fixtures.set(`markdown:${await sha256Hex(bytes)}`, data);
  }
}

/** Fixtures registered by tests at runtime. Keys are content hashes, so tests can't collide. */
export class Fixtures extends DurableObject<StubEnv> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: StubEnv) {
    super(ctx, env);
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS fixtures (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }

  get(key: string): string | null {
    return (
      this.sql.exec<{ value: string }>("SELECT value FROM fixtures WHERE key = ?", key).toArray()[0]
        ?.value ?? null
    );
  }

  set(key: string, value: string): void {
    this.sql.exec("INSERT OR REPLACE INTO fixtures (key, value) VALUES (?, ?)", key, value);
  }
}

type Recipient = string | { email: string; name?: string };

export interface SentEmail {
  to: string[];
  from: Recipient;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}

export class EmailStub extends WorkerEntrypoint<StubEnv> {
  async send(
    message: Omit<SentEmail, "to"> & { to: Recipient | Recipient[] },
  ): Promise<{ messageId: string }> {
    const to = (Array.isArray(message.to) ? message.to : [message.to]).map((r) =>
      typeof r === "string" ? r : r.email,
    );
    const sent: SentEmail = { ...message, to };
    for (const recipient of to) {
      await this.env.OUTBOX.getByName(recipient.toLowerCase()).record(sent);
    }
    const messageId = `stub-${await sha256Hex(canonicalJson(sent))}`;
    return { messageId };
  }

  /** Test-only: everything sent to one address, oldest first. */
  async sentTo(address: string): Promise<SentEmail[]> {
    return this.env.OUTBOX.getByName(address.toLowerCase()).list();
  }
}

/** One per recipient, so tests using different addresses never see each other's mail. */
export class Outbox extends DurableObject<StubEnv> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: StubEnv) {
    super(ctx, env);
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS sent (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)",
    );
  }

  record(message: SentEmail): void {
    this.sql.exec("INSERT INTO sent (body) VALUES (?)", JSON.stringify(message));
  }

  list(): SentEmail[] {
    return this.sql
      .exec<{ body: string }>("SELECT body FROM sent ORDER BY seq")
      .toArray()
      .map((row) => JSON.parse(row.body) as SentEmail);
  }
}

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<StubEnv>;
