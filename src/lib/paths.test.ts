import { describe, expect, it } from "vitest";
import { fileStem, pathParts } from "./paths";

describe("pathParts", () => {
  it("splits on either separator", () => {
    expect(pathParts("Unit 2/Dialogues")).toEqual(["Unit 2", "Dialogues"]);
    expect(pathParts("Unit 2\\Dialogues")).toEqual(["Unit 2", "Dialogues"]);
    expect(pathParts("a/b\\c")).toEqual(["a", "b", "c"]);
  });

  it("has nothing for no folder", () => {
    expect(pathParts("")).toEqual([]);
    expect(pathParts("/")).toEqual([]);
  });
});

describe("fileStem", () => {
  it("is the name without folders or extension", () => {
    expect(fileStem("/Users/me/Audio/01 自己紹介.mp3")).toBe("01 自己紹介");
    expect(fileStem("C:\\Users\\me\\Audio\\01 自己紹介.mp3")).toBe("01 自己紹介");
    expect(fileStem("D:\\a.b\\c.d.m4a")).toBe("c.d");
  });

  it("copes with a bare name and a path with no extension", () => {
    expect(fileStem("song.flac")).toBe("song");
    expect(fileStem("/a/b/readme")).toBe("readme");
    expect(fileStem("")).toBe("");
  });
});
