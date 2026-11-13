import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

class Element {
  constructor() { this.children = []; this.listeners = {}; this.value = ""; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute() {}
  click() { return this.listeners.click(); }
}

const source = (await readFile(new URL("../community.js", import.meta.url), "utf8"))
  .replace(/^import .*;\r?\n/gm, "");

test("member directory loads more pages and resets paging for a new search", async () => {
  const elements = Object.fromEntries(["#member-grid", "#member-search", "#member-more", "#member-status"].map((id) => [id, new Element()]));
  const calls = [];
  const profiles = Array.from({ length: 14 }, (_, index) => ({
    id: `${index}`, display_name: `Member ${index}`, polls_created: 0, votes_received: 0
  }));
  const backend = {
    rpc: async (name, args) => {
      if (name === "get_discoverable_profiles_page") {
        calls.push({ ...args });
        return { data: args.p_search ? profiles.slice(0, 1) : profiles.slice(args.p_offset, args.p_offset + 13) };
      }
      return { data: [] };
    }
  };
  const document = { querySelector: (id) => elements[id] || null, createElement: () => new Element() };
  const window = { setTimeout: (callback) => { callback(); }, clearTimeout() {} };
  runInNewContext(source, {
    document, window, navigator: {}, console,
    isBackendConfigured: () => true, getBackend: async () => backend,
    loadAvatarPaths: async () => new Map(), avatarUrl: () => ""
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  assert.equal(elements["#member-grid"].children.length, 12);
  assert.equal(elements["#member-more"].hidden, false);
  await elements["#member-more"].click();
  assert.equal(elements["#member-grid"].children.length, 14);
  assert.equal(elements["#member-more"].hidden, true);
  elements["#member-search"].value = "Member 0";
  elements["#member-search"].listeners.input();
  await settle();
  assert.equal(elements["#member-grid"].children.length, 1);
  assert.deepEqual(calls, [
    { p_search: null, p_offset: 0 },
    { p_search: null, p_offset: 12 },
    { p_search: "Member 0", p_offset: 0 }
  ]);
});
