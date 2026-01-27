import { describe, expect, it, vi } from "vitest";

describe("SessionStore pagination", () => {
  it("returns latest messages and paginates backwards", async () => {
    const { SessionStore } = await import("../src/agent/libs/session-store.ts");

    const store = new SessionStore(":memory:");
    const session = store.createSession({ title: "t" });

    let now = 1000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now++);

    for (let i = 1; i <= 5; i++) {
      store.recordMessage(session.id, { type: "user_prompt", prompt: `m${i}`, uuid: `m${i}` } as any);
    }

    const page1 = store.getSessionHistoryPage(session.id, 2);
    expect(page1?.messages.map((m: any) => m.prompt)).toEqual(["m4", "m5"]);
    expect(page1?.hasMore).toBe(true);
    expect(page1?.nextCursor).toBeDefined();

    const page2 = store.getSessionHistoryPage(session.id, 2, page1?.nextCursor);
    expect(page2?.messages.map((m: any) => m.prompt)).toEqual(["m2", "m3"]);
    expect(page2?.hasMore).toBe(true);

    const page3 = store.getSessionHistoryPage(session.id, 5, page2?.nextCursor);
    expect(page3?.messages.map((m: any) => m.prompt)).toEqual(["m1"]);
    expect(page3?.hasMore).toBe(false);

    nowSpy.mockRestore();
  });
});
