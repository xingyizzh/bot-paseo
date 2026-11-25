import { describe, expect, it } from "vitest";
import { createEmptyHubState, DomainError, ERROR_CODES } from "../../../shared/contracts";
import {
  archiveBot,
  bindBotAgent,
  deleteSection,
  seedDefaultBots,
  upsertBot,
  upsertSection,
} from "./logic";

describe("bot_registry pure logic", () => {
  it("seeds default butler and companion bots once", () => {
    const empty = createEmptyHubState("2026-11-25T00:00:00Z");
    const seeded = seedDefaultBots(empty, "/tmp/work", "2026-11-25T00:00:00Z");
    expect(seeded.bots.map((b) => b.id)).toEqual(["butler", "companion"]);
    expect(seeded.bots[1].permissionMode).toBe("readonly");
    expect(seedDefaultBots(seeded, "/tmp/other")).toBe(seeded);
  });

  it("blocks elevating companion permission beyond readonly", () => {
    const state = seedDefaultBots(createEmptyHubState(), "/tmp/work");
    expect(() =>
      upsertBot(state, {
        id: "companion",
        name: "陪伴主位",
        roleType: "companion",
        bio: "",
        personaPrompt: "",
        provider: "claude/sonnet",
        defaultCwd: "/tmp/work",
        permissionMode: "full",
        sectionId: null,
        pinned: true,
      }),
    ).toThrowError(DomainError);

    try {
      upsertBot(state, {
        name: "另一个陪伴",
        roleType: "companion",
        bio: "",
        personaPrompt: "",
        provider: "claude/sonnet",
        defaultCwd: "/tmp/work",
        permissionMode: "workspace",
        sectionId: null,
        pinned: false,
      });
    } catch (err) {
      expect((err as DomainError).code).toBe(ERROR_CODES.PERMISSION_DENIED);
    }
  });

  it("assigns distinct colors and keeps bots when deleting a section", () => {
    let state = seedDefaultBots(createEmptyHubState(), "/tmp/work");
    const secRes = upsertSection(state, {
      name: "研发组",
      collapsed: false,
      color: "#3B66F5",
    });
    state = secRes.nextState;

    const leadRes = upsertBot(state, {
      name: "项目主管A",
      roleType: "project_lead",
      bio: "负责主仓库",
      personaPrompt: "",
      provider: "claude/sonnet",
      defaultCwd: "/tmp/work/repo",
      permissionMode: "workspace",
      sectionId: secRes.section.id,
      pinned: false,
    });
    state = leadRes.nextState;

    expect(leadRes.bot.avatarColor).not.toBe("#3B66F5");
    expect(leadRes.bot.sectionId).toBe(secRes.section.id);

    const delRes = deleteSection(state, { sectionId: secRes.section.id });
    expect(delRes.deleted).toBe(true);
    const preserved = delRes.nextState.bots.find((b) => b.id === leadRes.bot.id);
    expect(preserved?.sectionId).toBeNull();
  });

  it("archives, unarchives, and binds agentId without cross-bot contamination", () => {
    let state = seedDefaultBots(createEmptyHubState(), "/tmp/work");
    state = bindBotAgent(state, "butler", "agent-butler-1").nextState;
    expect(state.bots.find((b) => b.id === "companion")?.agentId).toBeNull();

    state = archiveBot(state, { botId: "butler", archived: true }).nextState;
    expect(state.bots.find((b) => b.id === "butler")?.archivedAt).toBeTruthy();

    state = archiveBot(state, { botId: "butler", archived: false }).nextState;
    expect(state.bots.find((b) => b.id === "butler")?.archivedAt).toBeNull();
  });
});
