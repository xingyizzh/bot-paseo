import { describe, expect, it } from "vitest";
import { runSelfTest, scanWorkspace } from "../scripts/check.mjs";

describe("static architecture gates", () => {
  it("catches every violation fixture in tests/gates/", () => {
    expect(runSelfTest()).toEqual([]);
  });

  it("keeps the real workspace violation-free", () => {
    expect(scanWorkspace()).toEqual([]);
  });
});
