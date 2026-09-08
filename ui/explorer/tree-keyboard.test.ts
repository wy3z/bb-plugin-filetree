import { describe, expect, it } from "vitest";
import { adjacentPath, treeKeyboardCommand } from "./tree-keyboard.js";
describe("tree keyboard model", () => {
  it("maps navigation, activation and context-menu keys", () => {
    expect(treeKeyboardCommand("ArrowDown", false)).toBe("next");
    expect(treeKeyboardCommand("ArrowLeft", false)).toBe("collapse-or-parent");
    expect(treeKeyboardCommand(" ", false)).toBe("activate");
    expect(treeKeyboardCommand("F10", true)).toBe("context-menu");
  });
  it("clamps roving focus at both ends", () => {
    const paths = ["a", "b", "c"];
    expect(adjacentPath(paths, "a", -1)).toBe("a");
    expect(adjacentPath(paths, "b", 1)).toBe("c");
    expect(adjacentPath(paths, "c", 1)).toBe("c");
  });
});
