import { describe, expect, it } from "vitest";
import { resolveTrustedGit, scrubbedGitEnv } from "./git-env.js";
describe("git spawn environment", () => {
  it("drops inherited GIT_* overrides and pins a trusted PATH", () => {
    const env = scrubbedGitEnv({
      GIT_DIR: "/tmp/outside/.git",
      GIT_WORK_TREE: "/tmp/outside",
      GIT_COMMON_DIR: "/tmp/outside/.git",
      HOME: "/home/test",
      PATH: "/tmp/outside:/usr/bin",
    });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_COMMON_DIR).toBeUndefined();
    expect(env.GIT_CONFIG).toBe("/dev/null");
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(env.GIT_CONFIG_SYSTEM).toBe("/dev/null");
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
    expect(env.HOME).toBe("/home/test");
    expect(resolveTrustedGit().startsWith("/")).toBe(true);
  });
});
