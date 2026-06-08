import { describe, expect, test } from "vitest";
import { assertCwdAllowed, assertFileInsideCwd, normalizeWorkspacePath } from "../src/index.js";

describe("path policy", () => {
  test("normalizes Windows slashes", () => {
    expect(normalizeWorkspacePath("D:\\project\\file.txt")).toBe("D:/project/file.txt");
  });

  test("allows cwd inside configured root", () => {
    expect(assertCwdAllowed("D:/project/sub", ["D:/project"])).toBe("D:/project/sub");
  });

  test("rejects cwd outside configured roots", () => {
    expect(() => assertCwdAllowed("D:/other", ["D:/project"])).toThrow("outside allowed workspace roots");
  });

  test("rejects relative file traversal outside cwd", () => {
    expect(() => assertFileInsideCwd("D:/project", "../secret.txt")).toThrow("outside cwd");
  });
});
