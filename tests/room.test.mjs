import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = (await readFile(new URL("../room.js", import.meta.url), "utf8"))
  .replace(/^import .*;\r?\n/gm, "");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = { toggle() {} };
    this.textContent = "";
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  addEventListener(name, handler) { this.listeners[name] = handler; }
  querySelectorAll() { return []; }
  play() { return Promise.resolve(); }
  remove() {}
  find(text) {
    if (this.textContent === text) return this;
    return this.children.map((child) => child.find?.(text)).find(Boolean);
  }
  click() { return this.listeners.click?.(); }
}

async function setup({ live = false, guest = false, endError = false, getUserMedia, RTCPeerConnection, MediaStream, scheduleTimeout = () => {} } = {}) {
  const stage = new Element("main");
  const actions = [];
  const listeners = {};
  const me = guest ? "z" : "a";
  let state = {};
  const channel = {
    on(type, config, handler) { listeners[`${type}:${config.event}`] = handler; return this; },
    subscribe(handler) { this.subscribed = handler; return this; },
    track: async () => "ok",
    send: async (message) => { actions.push(message.event); return "ok"; },
    presenceState: () => state
  };
  const backend = {
    auth: { getSession: async () => ({ data: { session: { user: { id: me, user_metadata: { name: "Me" } } } } }) },
    rpc: async (name) => {
      actions.push(name);
      if (name === "get_rooms") return { data: [{ id: "room", host_id: "a", status: live ? "live" : "scheduled", starts_at: "2099-01-01", title: "Test", host_name: "Host", poll_question: "Test", poll_id: "poll" }] };
      return { error: endError ? new Error("failed") : null };
    },
    channel: () => channel,
    removeChannel: () => {}
  };
  const location = { search: "?id=room", href: "" };
  const alerts = [];
  const window = { location, alert: (message) => alerts.push(message), addEventListener() {} };
  const document = {
    querySelector: () => stage,
    createElement: (tag) => new Element(tag),
    body: new Element("body"),
    addEventListener() {},
    removeEventListener() {}
  };
  runInNewContext(source, {
    window, document, navigator: { mediaDevices: { getUserMedia } },
    getBackend: async () => backend, isBackendConfigured: () => true, initials: () => "M",
    URLSearchParams, Date, Set, Map, Uint8Array, RTCPeerConnection, MediaStream,
    console: { error() {}, warn() {} },
    setTimeout: scheduleTimeout, setInterval() { return 1; }, clearInterval() {}
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { stage, actions, alerts, location, channel, listeners, setState: (value) => { state = value; } };
}

test("host can end a scheduled room without joining it", async () => {
  const app = await setup();
  await app.stage.find("End room").click();
  assert.equal(app.location.href, "community.html#rooms");
  assert.ok(app.actions.includes("end_room"));
});

test("failed room end stays in the room and does not announce an end", async () => {
  const app = await setup({ live: true, endError: true });
  app.stage.find("Join the room 🎙").click();
  await app.channel.subscribed("SUBSCRIBED");
  const end = app.stage.find("End room");
  await end.click();
  assert.equal(end.disabled, false);
  assert.equal(app.location.href, "");
  assert.equal(app.actions.includes("ended"), false);
  assert.equal(app.alerts.length, 1);
});

test("enable audio explains when no speaker audio is available yet", async () => {
  const app = await setup({ live: true });
  app.stage.find("Join the room 🎙").click();
  await app.channel.subscribed("SUBSCRIBED");
  await app.stage.find("Enable audio").click();
  assert.ok(app.stage.find("Waiting for a speaker's audio. Tap Enable audio again if you can't hear them."));
});

for (const [arriving, expected] of [
  [true, "Audio packets are arriving. If you can't hear anyone, check your volume and audio output."],
  [false, "No incoming audio packets detected. Ask the speaker to unmute, then check again."]
]) {
  test(`audio check reports ${arriving ? "incoming" : "missing"} voice packets`, async () => {
    let packets = 10;
    class Peer {
      constructor() {
        this.connectionState = "connected";
        this.localDescription = { toJSON: () => ({}) };
      }
      addTransceiver() { return { sender: {} }; }
      async createOffer() { return {}; }
      async setLocalDescription() {}
      async getStats() {
        const current = packets;
        if (arriving) packets++;
        return new Map([["audio", { type: "inbound-rtp", kind: "audio", packetsReceived: current }]]);
      }
    }
    const app = await setup({ live: true, RTCPeerConnection: Peer, scheduleTimeout: (callback) => callback() });
    app.stage.find("Join the room 🎙").click();
    await app.channel.subscribed("SUBSCRIBED");
    app.setState({ a: [{ name: "Me" }], z: [{ name: "Guest" }] });
    app.listeners["presence:sync"]();
    await app.stage.find("Check audio").click();
    assert.ok(app.stage.find(expected));
  });
}

test("a microphone granted after demotion is stopped, not published", async () => {
  let grant;
  let stopped = false;
  const track = { stop() { stopped = true; } };
  const app = await setup({ live: true, guest: true, getUserMedia: () => new Promise((resolve) => { grant = resolve; }) });
  app.stage.find("Join the room 🎙").click();
  await app.channel.subscribed("SUBSCRIBED");
  const host = { name: "Host", speakers: ["z"] };
  app.setState({ a: [host], z: [{ name: "Me" }] });
  app.listeners["presence:sync"]();
  const request = app.stage.find("🎙 Unmute").click();
  host.speakers = [];
  app.listeners["presence:sync"]();
  grant({ getTracks: () => [track], getAudioTracks: () => [track] });
  await request;
  assert.equal(stopped, true);
});

test("the answering speaker attaches their microphone to the offered audio channel", async () => {
  const calls = [];
  const track = { stop() {} };
  class Peer {
    constructor() {
      this.localDescription = { toJSON: () => ({ type: "answer" }) };
      this.transceiver = { direction: "recvonly", receiver: { track: { kind: "audio" } }, sender: { replaceTrack: async (value) => calls.push(value === track ? "microphone attached" : "no microphone") } };
    }
    addTransceiver() { calls.push("unexpected extra transceiver"); }
    async setRemoteDescription() { calls.push("remote offer"); }
    getTransceivers() {
      return [this.transceiver];
    }
    async createAnswer() { calls.push(`answer ${this.transceiver.direction}`); return {}; }
    async setLocalDescription() {}
  }
  const app = await setup({
    live: true, guest: true, RTCPeerConnection: Peer,
    MediaStream: class { constructor() {} },
    getUserMedia: async () => ({ getAudioTracks: () => [track] })
  });
  app.stage.find("Join the room 🎙").click();
  await app.channel.subscribed("SUBSCRIBED");
  app.setState({ a: [{ name: "Host", speakers: ["z"] }], z: [{ name: "Me" }] });
  app.listeners["presence:sync"]();
  await app.stage.find("🎙 Unmute").click();
  await app.listeners["broadcast:sig"]({ payload: { from: "a", to: "z", kind: "offer", data: {} } });
  assert.deepEqual(calls, ["remote offer", "microphone attached", "answer sendrecv"]);
  assert.ok(app.actions.includes("sig"));
});

test("an incoming voice offer survives presence arriving out of order", async () => {
  let closed = false;
  class Peer {
    constructor() {
      this.localDescription = { toJSON: () => ({ type: "answer" }) };
      this.transceiver = { receiver: { track: { kind: "audio" } }, sender: { replaceTrack: async () => {} } };
    }
    async setRemoteDescription() {}
    getTransceivers() { return [this.transceiver]; }
    async createAnswer() { return {}; }
    async setLocalDescription() {}
    close() { closed = true; }
  }
  const app = await setup({ live: true, guest: true, RTCPeerConnection: Peer });
  app.stage.find("Join the room 🎙").click();
  await app.channel.subscribed("SUBSCRIBED");
  await app.listeners["broadcast:sig"]({ payload: { from: "a", to: "z", kind: "offer", data: {} } });
  app.setState({ z: [{ name: "Me" }] });
  app.listeners["presence:sync"]();
  assert.equal(closed, false);
  app.setState({ a: [{ name: "Host" }], z: [{ name: "Me" }] });
  app.listeners["presence:sync"]();
  app.setState({ z: [{ name: "Me" }] });
  app.listeners["presence:sync"]();
  assert.equal(closed, true);
});
