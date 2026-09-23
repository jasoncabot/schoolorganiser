import { describe, expect, it } from "vitest";
import { layoutPage, readPdfText, type TextRun } from "../../src/extract/pdf";
import { pdf } from "../helpers/mime";

const run = (text: string, x: number, y: number, width = text.length * 5): TextRun => ({
  text,
  x,
  y,
  width,
});

describe("layoutPage", () => {
  it("reads a calendar grid column by column, so each month heads its own dates", () => {
    const page = [
      run("Dates for the year", 150, 560, 300),
      run("SEPTEMBER", 50, 520),
      run("OCTOBER", 300, 520),
      run("30th - Year 3 trip", 50, 500),
      run("1st - Harvest", 300, 500),
      run("6th - Open evening @ 7pm", 300, 480),
      run("JANUARY", 50, 400),
      run("FEBRUARY", 300, 400),
      run("4th - Inset day", 50, 380),
      run("9th - Safer internet day", 300, 380),
    ];
    expect(layoutPage(page).split("\n")).toEqual([
      "Dates for the year",
      "SEPTEMBER",
      "30th - Year 3 trip",
      "JANUARY",
      "4th - Inset day",
      "",
      "OCTOBER",
      "1st - Harvest",
      "6th - Open evening @ 7pm",
      "FEBRUARY",
      "9th - Safer internet day",
    ]);
  });

  it("joins runs on the same line and keeps a single column in order", () => {
    const page = [
      run("Dear", 50, 700),
      run("Parents,", 80, 700.5),
      run("Sports day is on Friday.", 50, 680),
    ];
    expect(layoutPage(page)).toBe("Dear Parents,\nSports day is on Friday.");
  });

  it("returns nothing for an empty page", () => {
    expect(layoutPage([])).toBe("");
  });
});

describe("readPdfText", () => {
  it("reads a PDF's text layer in the Workers runtime", async () => {
    const text = await readPdfText(
      pdf([
        { text: "Oakfield Primary School", x: 50, y: 540 },
        {
          text: "Harvest festival will be held on Friday 10th October at 2pm in the school hall.",
          x: 50,
          y: 520,
        },
        { text: "Please send in tins or packets of food by Wednesday 8th October.", x: 50, y: 505 },
      ]),
    );
    expect(text).toBe(
      "Page 1\nOakfield Primary School\nHarvest festival will be held on Friday 10th October at 2pm in the school hall.\nPlease send in tins or packets of food by Wednesday 8th October.",
    );
  });

  it("gives up on a PDF with almost no text (probably a scan)", async () => {
    expect(await readPdfText(pdf([{ text: "Scan", x: 50, y: 540 }]))).toBeNull();
  });

  it("gives up on something that isn't a PDF", async () => {
    expect(await readPdfText(new TextEncoder().encode("not a pdf"))).toBeNull();
  });
});
