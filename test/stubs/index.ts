// Local stand-ins for Workers AI and Email Service, used by Vitest and Playwright.
// They are deterministic and fail loudly: an AI request without a recorded fixture throws,
// so a changed prompt can never quietly reach the real model.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import aiFixtures from "../fixtures/ai.json";
import markdownFixtures from "../fixtures/markdown.json";
import { canonicalJson, sha256Hex } from "./hash";

interface StubEnv {
  OUTBOX: DurableObjectNamespace<Outbox>;
}

const ai: Record<string, unknown> = aiFixtures;
const markdown: Record<string, string> = markdownFixtures;

export class AiStub extends WorkerEntrypoint<StubEnv> {
  async run(model: string, inputs: Record<string, unknown>): Promise<unknown> {
    const key = await sha256Hex(canonicalJson({ model, inputs }));
    if (!(key in ai)) {
      throw new Error(
        `No AI fixture for ${model} (key ${key}). Record one in test/fixtures/ai.json.`,
      );
    }
    return ai[key];
  }

  async toMarkdown(
    files: MarkdownDocument | MarkdownDocument[],
  ): Promise<ConversionResponse | ConversionResponse[]> {
    const convert = async (file: MarkdownDocument): Promise<ConversionResponse> => {
      const key = await sha256Hex(new Uint8Array(await file.blob.arrayBuffer()));
      const data = markdown[key];
      if (data === undefined) {
        throw new Error(
          `No markdown fixture for ${file.name} (key ${key}). Record one in test/fixtures/markdown.json.`,
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
}

export interface SentEmail {
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}

export class EmailStub extends WorkerEntrypoint<StubEnv> {
  async send(message: SentEmail & { to: string | string[] }): Promise<{ messageId: string }> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
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
