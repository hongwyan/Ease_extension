/**
 * With public lookups disabled, the semantic path must make no external network request — from
 * the service worker, the offscreen document or the inference worker.
 *
 * Three independent observers:
 *  1. A raw DevTools connection (--remote-debugging-port) auto-attached to every target,
 *     including the offscreen document, its dedicated worker and ONNX Runtime's thread workers,
 *     logging Network events per context.
 *  2. Chromium's NetLog: every request the network stack saw, with its initiator origin.
 *  3. A local recording proxy (--proxy-server): everything that tries to leave the machine.
 * Chromium's own browser-process services (component updater, account checks) also use the
 * network; the NetLog shows they have no page or extension initiator, so they are told apart
 * by attribution, not by an allowlist of hosts. Positive controls prove all three observers see
 * requests made from the extension's contexts.
 */
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Harness, button, panel, scrollToPost, semanticOutcome, settle, tall } from "./harness";

const SPACER = 1500;
const POSTS = [
  tall({ id: "1874000000000000001", author: "mei", text: "上海房租又涨了，房东说每个月要再加800块，一居室快租不起了。", lang: "zh" }),
  tall({ id: "1874000000000000002", author: "sam", text: "Rent in Shanghai went up again. My landlord wants 800 more a month.", lang: "en" }),
  tall({ id: "1874000000000000003", author: "yan", text: "我家猫把我的咖啡从桌上推下去，看了我一眼就走了。", lang: "zh" }),
];

interface Seen {
  targetType: string;
  targetUrl: string;
  url: string;
}

class CdpObserver {
  private ws!: WebSocket;
  private id = 0;
  private waiters = new Map<number, (v: any) => void>();
  readonly targets = new Map<string, { type: string; url: string; targetId: string }>();
  readonly requests: Seen[] = [];

  static async connect(profile: string): Promise<CdpObserver> {
    const [port, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split("\n");
    const o = new CdpObserver();
    o.ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((resolve, reject) => {
      o.ws.onopen = () => resolve();
      o.ws.onerror = () => reject(new Error("CDP connection failed"));
    });
    o.ws.onmessage = (ev) => o.onMessage(JSON.parse(String(ev.data)));
    await o.send("Target.setDiscoverTargets", { discover: true });
    await o.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    // Targets that already exist (the service worker) are attached explicitly.
    const { targetInfos } = await o.send("Target.getTargets");
    for (const t of targetInfos) if (t.url.startsWith("chrome-extension://")) await o.attach(t.targetId);
    return o;
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve) => this.waiters.set(id, resolve));
  }

  private async attach(targetId: string): Promise<void> {
    await this.send("Target.attachToTarget", { targetId, flatten: true }).catch(() => undefined);
  }

  private onMessage(m: any): void {
    if (m.id && this.waiters.has(m.id)) {
      this.waiters.get(m.id)!(m.result ?? m.error);
      this.waiters.delete(m.id);
      return;
    }
    if (m.method === "Target.targetCreated" && m.params.targetInfo.url.startsWith("chrome-extension://")) {
      void this.attach(m.params.targetInfo.targetId);
    }
    if (m.method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = m.params;
      this.targets.set(sessionId, { type: targetInfo.type, url: targetInfo.url, targetId: targetInfo.targetId });
      // Network for this target, and recursive auto-attach for its own workers.
      void this.send("Network.enable", {}, sessionId);
      void this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
      void this.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    }
    if (m.method === "Target.targetInfoChanged") {
      // Targets attach before they navigate (e.g. the offscreen document starts as type "other", url "").
      const info = m.params.targetInfo;
      for (const t of this.targets.values()) if (t.targetId === info.targetId) Object.assign(t, { type: info.type, url: info.url });
    }
    if (m.method === "Network.requestWillBeSent" && m.sessionId) {
      const t = this.targets.get(m.sessionId) ?? { type: "?", url: "?" };
      this.requests.push({ targetType: t.type, targetUrl: t.url, url: m.params.request.url });
    }
  }

  sessionFor(pred: (t: { type: string; url: string }) => boolean): string | undefined {
    return [...this.targets].find(([, t]) => pred(t))?.[0];
  }

  close(): void {
    this.ws.close();
  }
}

let proxy: Server;
const proxied: string[] = [];
test.beforeAll(async () => {
  proxy = createServer((req, res) => {
    proxied.push(`HTTP ${req.url}`);
    res.writeHead(403).end();
  });
  proxy.on("connect", (req, socket) => {
    proxied.push(`CONNECT ${req.url}`);
    socket.on("error", () => undefined); // Chromium may reset refused tunnels
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  proxy.on("clientError", (_err, socket) => socket.destroy());
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
});
test.afterAll(() => proxy.close());

test("semantic analysis makes no external request from the service worker, offscreen document or worker", async () => {
  test.setTimeout(180_000);
  const port = (proxy.address() as AddressInfo).port;
  const netlog = join(mkdtempSync(join(tmpdir(), "xfl-netlog-")), "net.json");
  const h = await Harness.launch({
    args: [`--proxy-server=http://127.0.0.1:${port}`, "--proxy-bypass-list=<-loopback>", "--remote-debugging-port=0", `--log-net-log=${netlog}`],
  });
  const extOrigin = `chrome-extension://${h.extId}`;
  const cdp = await CdpObserver.connect(h.profile);
  try {
    await h.enableRecording(); // public lookups stay off (the default)
    const page = await h.openHome({ forYou: POSTS, topSpacer: SPACER });
    for (const p of POSTS) {
      await scrollToPost(page, p.id);
      await settle(page);
    }
    await expect.poll(() => h.statusIds()).toHaveLength(3);
    proxied.length = 0;
    cdp.requests.length = 0;
    // Cold path: the click creates the offscreen document, the worker loads the model and encodes.
    await scrollToPost(page, POSTS[0]!.id);
    await button(page, POSTS[0]!.id).click();
    expect(await semanticOutcome(page)).toBe("fl-sem-metrics");
    await expect(panel(page).getByTestId("fl-related-all-detail")).toHaveText("1 of 2");
    await page.waitForTimeout(1000);

    const offscreen = cdp.sessionFor((t) => t.url.endsWith("/offscreen.html"));
    const worker = cdp.sessionFor((t) => t.type === "worker" && t.url.endsWith("/semantic-worker.js"));
    const sw = cdp.sessionFor((t) => t.type === "service_worker");
    expect(offscreen, "offscreen document observed").toBeTruthy();
    expect(worker, "inference worker observed").toBeTruthy();
    expect(sw, "service worker observed").toBeTruthy();
    // The worker really loaded the model and runtime files — locally.
    const workerUrls = cdp.requests.filter((r) => r.targetUrl.endsWith("/semantic-worker.js")).map((r) => r.url);
    expect(workerUrls.some((u) => u.endsWith("/model_quantized.onnx"))).toBe(true);
    expect(workerUrls.some((u) => u.endsWith("/ort-wasm-simd-threaded.wasm"))).toBe(true);
    const extensionContexts = cdp.requests.filter((r) => r.targetUrl.startsWith("chrome-extension://"));
    const external = extensionContexts.filter((r) => !/^(chrome-extension|blob|data):/.test(r.url));
    expect(external).toEqual([]);
    const proxiedDuringAnalysis = [...proxied];

    // CSP is a guard of its own: any other host is refused before reaching the network.
    const blocked = await cdp.send(
      "Runtime.evaluate",
      { expression: `fetch("https://example.com/").then(() => "fetched", (e) => "blocked: " + e.message)`, awaitPromise: true },
      worker,
    );
    expect(blocked.result.value).toMatch(/^blocked/);
    // Positive controls: a request from each extension context to the one allowed external origin
    // (the opt-in Wikimedia lookup) IS seen by the observers. Paths mark the canaries.
    for (const [name, session] of [["sw", sw], ["offscreen", offscreen], ["worker", worker]] as const) {
      const before = cdp.requests.length;
      await cdp.send("Runtime.evaluate", { expression: `fetch("https://wikimedia.org/canary-${name}").catch(() => 0)`, awaitPromise: true }, session);
      await expect.poll(() => cdp.requests.slice(before).some((r) => r.url.includes("/canary-"))).toBe(true);
    }
    // The service worker's request is answered by the test's Wikimedia route; the others reach the proxy.
    await expect.poll(() => proxied.filter((p) => p.includes("wikimedia.org")).length).toBeGreaterThanOrEqual(1);

    // NetLog is complete once the browser has exited.
    cdp.close();
    await h.close();
    const requests = readNetLog(netlog);
    const fromExtension = requests.filter((r) => r.initiator === extOrigin || r.url.startsWith(extOrigin));
    expect(fromExtension.filter((r) => r.url.includes("/canary-")).length).toBeGreaterThanOrEqual(2); // attribution works
    expect(fromExtension.filter((r) => !r.url.startsWith("chrome-extension://") && !r.url.includes("/canary-"))).toEqual([]);
    // Anything the proxy saw during the analysis came from Chromium itself (no initiator), never the extension.
    for (const p of proxiedDuringAnalysis) {
      const host = p.replace(/^(CONNECT|HTTP) (https?:\/\/)?/, "").split(/[:/]/)[0]!;
      const seen = requests.filter((r) => new URL(r.url).hostname === host);
      expect(seen.length, host).toBeGreaterThan(0);
      expect(seen.every((r) => !r.initiator || r.initiator === "not an origin"), host).toBe(true);
    }
    console.log(`privacy: ${cdp.requests.length} extension-context requests (all local); proxy during analysis: ${JSON.stringify(proxiedDuringAnalysis)}`);
  } finally {
    cdp.close();
    await h.close().catch(() => undefined);
  }
});

function readNetLog(path: string): { url: string; initiator: string | null }[] {
  let s = readFileSync(path, "utf8").trimEnd();
  if (!s.endsWith("}")) s = `${s.replace(/,$/, "")}]}`;
  const d = JSON.parse(s) as { events: { params?: { url?: string; initiator?: string } }[] };
  const out: { url: string; initiator: string | null }[] = [];
  for (const e of d.events) {
    const u = e.params?.url;
    if (typeof u === "string" && /^[a-z-]+:/.test(u)) out.push({ url: u, initiator: e.params?.initiator ?? null });
  }
  return out;
}
