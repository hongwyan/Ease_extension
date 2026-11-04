import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { FeedStore, type ExposureRecord } from "../../src/background/db";
import { DAY_MS } from "../../src/shared/metrics";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function rec(statusId: string, sessionId = S1, ts = NOW): Omit<ExposureRecord, "key"> {
  return { sessionId, statusId, author: "alice", ts, topics: ["chatgpt"], excerpt: "x", catalogVersion: "t" };
}

let factory: IDBFactory;
let store: FeedStore;

beforeEach(async () => {
  factory = new IDBFactory();
  store = new FeedStore(factory, "test");
  await store.setRecording(true, NOW - 20 * DAY_MS);
});

describe("FeedStore", () => {
  it("deduplicates by session and status ID", async () => {
    expect(await store.recordExposure(rec("1"), 0, NOW)).toBe("recorded");
    expect(await store.recordExposure(rec("1"), 0, NOW)).toBe("duplicate");
    expect(await store.recordExposure(rec("1", S2), 0, NOW)).toBe("recorded"); // new session may count again
    expect((await store.countExposures()).count).toBe(2);
  });

  it("overlapping writes of the same exposure store exactly one row", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => store.recordExposure(rec("7"), 0, NOW)));
    expect(results.filter((r) => r === "recorded")).toHaveLength(1);
    expect((await store.countExposures()).count).toBe(1);
  });

  it("history and dedupe survive a service-worker restart (new connection)", async () => {
    await store.recordExposure(rec("9"), 0, NOW);
    const restarted = new FeedStore(factory, "test");
    expect(await restarted.recordExposure(rec("9"), 0, NOW)).toBe("duplicate");
    expect((await restarted.exposuresSince(0, NOW)).map((r) => r.statusId)).toEqual(["9"]);
  });

  it("rejects writes while paused", async () => {
    await store.setRecording(false, NOW);
    expect(await store.recordExposure(rec("1"), 0, NOW)).toBe("paused");
    const meta = await store.getMeta();
    expect(meta.pauses).toHaveLength(1);
    await store.setRecording(true, NOW + 1000);
    expect((await store.getMeta()).pauses[0]!.to).toBe(NOW + 1000);
  });

  it("delete removes history and caches; a write queued with the old epoch cannot resurrect it", async () => {
    await store.recordExposure(rec("1"), 0, NOW);
    await store.putCache(
      { key: "k", article: "ChatGPT", start: "a", end: "b", trend: {} as never, fetchedAt: NOW },
      0,
    );
    const pending = store.recordExposure(rec("2"), 0, NOW); // started before delete
    const epoch = await store.clearAll(NOW);
    await pending;
    expect(epoch).toBe(1);
    // The pending write may land before the clear (then it is cleared) but never after it.
    expect((await store.countExposures()).count).toBe(0);
    expect(await store.recordExposure(rec("3"), 0, NOW)).toBe("stale-epoch");
    expect(await store.putCache({ key: "k2", article: "ChatGPT", start: "a", end: "b", trend: {} as never, fetchedAt: NOW }, 0)).toBe(false);
    expect(await store.getCache("k")).toBeUndefined();
    expect(await store.recordExposure(rec("3"), 1, NOW)).toBe("recorded");
    expect((await store.getMeta()).trackingSince).toBe(NOW);
  });

  it("keeps 30 days of history", async () => {
    await store.recordExposure(rec("old", S1, NOW - 31 * DAY_MS), 0, NOW - 31 * DAY_MS);
    await store.recordExposure(rec("recent", S1, NOW - 29 * DAY_MS), 0, NOW - 29 * DAY_MS);
    const rows = await store.exposuresSince(0, NOW);
    expect(rows.map((r) => r.statusId)).toEqual(["recent"]);
  });
});
