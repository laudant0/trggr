import { getBackend } from "./backend.js";

const statusEl = document.querySelector("#admin-status");
const gate = document.querySelector("#admin-gate");
const panel = document.querySelector("#admin-panel");
const queueEl = document.querySelector("#admin-queue");
const form = document.querySelector("#official-form");
const formStatus = document.querySelector("#official-status");
let backend;

function setStatus(message) {
  statusEl.textContent = message;
  statusEl.hidden = !message;
}

function button(label, handler, cls = "button button-dark button-small") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await handler();
      await loadQueue();
    } catch (error) {
      setStatus(error.message);
      b.disabled = false;
    }
  });
  return b;
}

async function call(name, args) {
  const { error } = await backend.rpc(name, args);
  if (error) throw error;
}

async function loadQueue() {
  const { data, error } = await backend.rpc("admin_get_queue");
  if (error) throw error;
  queueEl.replaceChildren();
  if (!data.length) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = "Nothing reported. The room is behaving.";
    queueEl.append(empty);
    return;
  }
  data.forEach((row) => {
    const card = document.createElement("article");
    card.className = "admin-item";
    const q = document.createElement("strong");
    q.textContent = row.question;
    const meta = document.createElement("span");
    const reasons = Array.isArray(row.reasons) ? row.reasons.join(", ") : "";
    meta.textContent = `${row.status.toUpperCase()} · ${row.report_count} report(s) · by ${row.creator}${reasons ? ` · ${reasons}` : ""}`;
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    actions.append(
      row.status === "hidden"
        ? button("Restore", () => call("admin_set_poll_status", { p_poll_id: row.poll_id, p_status: "published" }))
        : button("Hide", () => call("admin_set_poll_status", { p_poll_id: row.poll_id, p_status: "hidden" })),
      button("Dismiss reports", () => call("admin_dismiss_reports", { p_poll_id: row.poll_id })),
      button("Delete", () => {
        if (!window.confirm("Delete this poll and its votes permanently?")) return Promise.resolve();
        return call("admin_delete_poll", { p_poll_id: row.poll_id });
      }, "button button-danger button-small")
    );
    card.append(q, meta, actions);
    queueEl.append(card);
  });
}

async function fillCategories() {
  const select = document.querySelector("#official-category");
  let names = window.TRGGR_CATEGORIES || [];
  const { data } = await backend.rpc("get_public_categories");
  if (data?.length) names = data.map((row) => row.name);
  select.replaceChildren(...names.map((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    return option;
  }));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const options = [...form.querySelectorAll(".official-option")].map((i) => i.value.trim()).filter(Boolean);
  if (options.length < 2) {
    formStatus.textContent = "Add at least two options.";
    return;
  }
  const hours = Number(form.querySelector("#official-duration").value || 0);
  formStatus.textContent = "Publishing…";
  try {
    await call("admin_create_poll", {
      p_question: form.querySelector("#official-question").value.trim(),
      p_category: form.querySelector("#official-category").value,
      p_options: options,
      p_tag: form.querySelector("#official-tag").value,
      p_closes_at: hours ? new Date(Date.now() + hours * 3600000).toISOString() : null
    });
    form.reset();
    formStatus.textContent = "Published to the room ✓";
  } catch (error) {
    formStatus.textContent = error.message;
  }
});

async function init() {
  try {
    backend = await getBackend();
    const { data: session } = await backend.auth.getSession();
    if (!session.session) {
      window.location.replace("login.html?next=admin.html");
      return;
    }
    const { data: admin } = await backend.rpc("is_admin");
    setStatus("");
    if (admin !== true) {
      gate.hidden = false;
      return;
    }
    panel.hidden = false;
    await fillCategories();
    await loadQueue();
  } catch (error) {
    setStatus(`Could not open admin: ${error.message}`);
  }
}

init();
