import { describe, expect, it } from "vitest";
import { readPptx } from "../../src/extract/pptx";
import { pptx } from "../helpers/mime";

describe("readPptx", () => {
  it("reads slides in number order, with their notes", async () => {
    const bytes = await pptx(
      [
        ["Sports day", "Friday 11 July, 1.30pm"],
        ["Bring a water bottle & sun hat"],
        ["Slide three"],
        ["Slide four"],
        ["Slide five"],
        ["Slide six"],
        ["Slide seven"],
        ["Slide eight"],
        ["Slide nine"],
        ["Slide ten"],
      ],
      { notes: { 1: "Parents welcome from 1.15pm" } },
    );
    const { text } = readPptx(bytes);
    expect(text.split("\n\n").slice(0, 3)).toEqual([
      "Slide 1\nSports day\nFriday 11 July, 1.30pm\nNotes: Parents welcome from 1.15pm",
      "Slide 2\nBring a water bottle & sun hat",
      "Slide 3\nSlide three",
    ]);
    expect(text.split("\n\n").at(-1)).toBe("Slide 10\nSlide ten");
  });

  it("lists embedded images in name order", async () => {
    const bytes = await pptx([["Poster"]], {
      media: {
        "image2.png": new Uint8Array([2]),
        "image1.jpeg": new Uint8Array([1]),
        "audio.mp3": new Uint8Array([3]),
      },
    });
    expect(readPptx(bytes).images.map((i) => i.name)).toEqual(["image1.jpeg", "image2.png"]);
  });

  it("throws on something that isn't a zip", () => {
    expect(() => readPptx(new TextEncoder().encode("not a pptx"))).toThrow();
  });
});
