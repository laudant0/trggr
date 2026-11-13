import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

class Element {
  constructor() { this.children = []; this.listeners = {}; this.parent = null; }
  append(...children) {
    children.forEach((child) => { child.parent = this; this.children.push(child); });
  }
  replaceChildren(...children) {
    this.children.forEach((child) => { child.parent = null; });
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  before(...children) {
    const index = this.parent.children.indexOf(this);
    children.forEach((child) => { child.parent = this.parent; });
    this.parent.children.splice(index, 0, ...children);
  }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  click() { this.listeners.click(); }
}

const source = (await readFile(new URL("../expandable-list.js", import.meta.url), "utf8"))
  .replace("export function", "function");
const context = { document: { createElement: () => new Element() } };
runInNewContext(source, context);

test("long lists reveal items in batches and remove the button at the end", () => {
  const container = new Element();
  context.renderExpandableList(container, [1, 2, 3, 4, 5], (value) => Object.assign(new Element(), { value }), 2);
  assert.deepEqual(container.children.map((item) => item.value), [1, 2, undefined]);
  container.children[2].click();
  assert.deepEqual(container.children.map((item) => item.value), [1, 2, 3, 4, undefined]);
  container.children[4].click();
  assert.deepEqual(container.children.map((item) => item.value), [1, 2, 3, 4, 5]);
});

test("short lists do not show a see more button", () => {
  const container = new Element();
  context.renderExpandableList(container, [1], (value) => Object.assign(new Element(), { value }), 2);
  assert.deepEqual(container.children.map((item) => item.value), [1]);
});
