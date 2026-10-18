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

async function loadSupportReports() {
  const el = document.querySelector("#admin-reports");
  const { data, error } = await backend.rpc("admin_get_support_reports");
  if (error) throw error;
  el.replaceChildren();
  if (!data.length) {
    el.append(Object.assign(document.createElement("p"), { className: "profile-empty", textContent: "No open member reports." }));
    return;
  }
  data.forEach((row) => {
    const card = document.createElement("article");
    card.className = "admin-item";
    const q = document.createElement("strong");
    q.textContent = `${row.kind.toUpperCase()} · ${row.reason}`;
    const ref = document.createElement("span");
    ref.textContent = row.reference;
    const details = document.createElement("p");
    details.textContent = row.details;
    const meta = document.createElement("span");
    meta.textContent = `from ${row.reporter_name} · ${new Date(row.created_at).toLocaleString()}`;
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    actions.append(button("Mark resolved", () => call("admin_resolve_support_report", { p_report_id: row.report_id })));
    card.append(q, ref, details, meta, actions);
    el.append(card);
  });
}

async function loadTakesQueue() {
  const el = document.querySelector("#admin-takes");
  const { data, error } = await backend.rpc("admin_get_reported_takes");
  if (error) throw error;
  el.replaceChildren();
  if (!data.length) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = "No reported takes.";
    el.append(empty);
    return;
  }
  data.forEach((row) => {
    const card = document.createElement("article");
    card.className = "admin-item";
    const q = document.createElement("strong");
    q.textContent = `“${row.body}”`;
    const meta = document.createElement("span");
    meta.textContent = `${row.status.toUpperCase()} · ${row.report_count} report(s) · by ${row.author_name} · on: ${row.poll_question}`;
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    actions.append(
      button("Restore", () => call("admin_restore_take", { p_take_id: row.take_id })),
      button("Delete", () => call("admin_delete_take", { p_take_id: row.take_id }), "button button-danger button-small")
    );
    card.append(q, meta, actions);
    el.append(card);
  });
}

function textEl(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.textContent = text;
  return node;
}

function emptyNote(el, text) {
  el.replaceChildren(textEl("p", "profile-empty", text));
}

function pollStatsCard(row) {
  const card = document.createElement("article");
  card.className = "admin-item";
  const closed = row.closes_at && new Date(row.closes_at) <= new Date();
  const flags = [row.official ? "OFFICIAL" : null, row.status.toUpperCase(), closed ? "CLOSED" : null].filter(Boolean).join(" · ");
  card.append(textEl("strong", "", row.question));
  card.append(textEl("span", "", `${flags} · ${row.total_votes} votes (${row.votes_24h} today) · ${row.take_count} takes · ${row.report_count} reports`));
  const total = Number(row.total_votes);
  const bars = document.createElement("div");
  bars.className = "option-bars";
  (row.options || []).forEach((option) => {
    const pct = total ? Math.round((option.votes / total) * 100) : 0;
    const line = document.createElement("div");
    line.className = "option-bar";
    const fill = document.createElement("span");
    fill.style.width = `${pct}%`;
    const track = document.createElement("i");
    track.append(fill);
    line.append(textEl("small", "", option.label), track, textEl("b", "", `${pct}% · ${option.votes}`));
    bars.append(line);
  });
  card.append(bars);
  const actions = document.createElement("div");
  actions.className = "admin-actions";
  if (!closed) actions.append(button("Close now", () => call("admin_close_poll", { p_poll_id: row.poll_id })));
  actions.append(
    row.status === "hidden"
      ? button("Restore", () => call("admin_set_poll_status", { p_poll_id: row.poll_id, p_status: "published" }))
      : button("Hide", () => call("admin_set_poll_status", { p_poll_id: row.poll_id, p_status: "hidden" })),
    button("Delete", () => {
      if (!window.confirm("Delete this poll and its votes permanently?")) return Promise.resolve();
      return call("admin_delete_poll", { p_poll_id: row.poll_id });
    })
  );
  card.append(actions);
  return card;
}

async function loadDashboard() {
  const { data: overview, error } = await backend.rpc("admin_get_overview");
  if (error) throw error;
  const stats = [
    ["Members", overview.members, `+${overview.new_members_7d} this week`],
    ["Live polls", overview.polls, `${overview.official_polls} official`],
    ["Votes", overview.votes, `${overview.votes_24h} today · ${overview.votes_7d} this week`],
    ["Takes", overview.takes, ""],
    ["Open reports", Number(overview.open_member_reports) + Number(overview.reported_polls), `${overview.open_member_reports} member · ${overview.reported_polls} polls`]
  ];
  document.querySelector("#admin-stats").replaceChildren(...stats.map(([label, value, note]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.append(textEl("small", "", label), textEl("strong", "", Number(value).toLocaleString()), textEl("span", "", note));
    return card;
  }));
  const max = Math.max(1, ...overview.daily.map((d) => d.votes));
  document.querySelector("#admin-chart").replaceChildren(...overview.daily.map((d) => {
    const col = document.createElement("div");
    col.className = "daily-col";
    col.title = `${d.day}: ${d.votes} votes, ${d.members} new members`;
    const bar = document.createElement("span");
    bar.style.height = `${Math.max(3, (d.votes / max) * 100)}%`;
    col.append(bar, textEl("small", "", d.day.slice(8)));
    return col;
  }));

  const { data: official, error: officialError } = await backend.rpc("admin_get_poll_stats", { p_official_only: true });
  if (officialError) throw officialError;
  const officialEl = document.querySelector("#admin-official");
  if (official.length) officialEl.replaceChildren(...official.map(pollStatsCard));
  else emptyNote(officialEl, "No official polls yet. Publish one below.");

  const { data: all, error: allError } = await backend.rpc("admin_get_poll_stats", { p_official_only: false });
  if (allError) throw allError;
  const pollsEl = document.querySelector("#admin-polls");
  if (all.length) pollsEl.replaceChildren(...all.map(pollStatsCard));
  else emptyNote(pollsEl, "No polls yet.");

  const { data: members, error: membersError } = await backend.rpc("admin_get_new_members");
  if (membersError) throw membersError;
  const membersEl = document.querySelector("#admin-members");
  if (members.length) {
    membersEl.replaceChildren(...members.map((m) => {
      const card = document.createElement("article");
      card.className = "admin-item";
      card.append(textEl("strong", "", m.display_name || "Member"), textEl("span", "", `Joined ${new Date(m.created_at).toLocaleDateString()} · ${m.votes} votes`));
      return card;
    }));
  } else emptyNote(membersEl, "No members yet.");
}
async function loadQueue() {
  await loadDashboard();
  await loadSupportReports();
  await loadTakesQueue();
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

async function makeThumbnail(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Images must be under 10 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / bitmap.width, 420 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.68, 0.52, 0.38]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.type === "image/webp" && blob.size <= 200 * 1024) return blob;
  }
  throw new Error("That image is too detailed to compress. Try another.");
}

form.addEventListener("change", (event) => {
  const input = event.target.closest(".official-image");
  if (!input) return;
  const preview = input.closest(".official-row").querySelector(".official-preview");
  const file = input.files[0];
  if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
  if (!file) {
    preview.hidden = true;
    return;
  }
  preview.dataset.url = URL.createObjectURL(file);
  preview.src = preview.dataset.url;
  preview.hidden = false;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rows = [...form.querySelectorAll(".official-row")].filter((row) => row.querySelector(".official-option").value.trim());
  const options = rows.map((row) => row.querySelector(".official-option").value.trim());
  if (options.length < 2) {
    formStatus.textContent = "Add at least two options.";
    return;
  }
  const uploaded = [];
  const hours = Number(form.querySelector("#official-duration").value || 0);
  formStatus.textContent = "Publishing…";
  try {
    const { data: sessionData } = await backend.auth.getSession();
    const adminId = sessionData.session.user.id;
    const images = [];
    for (const row of rows) {
      const file = row.querySelector(".official-image").files[0];
      if (!file) {
        images.push(null);
        continue;
      }
      const blob = await makeThumbnail(file);
      const path = `${adminId}/${crypto.randomUUID()}.webp`;
      const { error: uploadError } = await backend.storage.from("poll-option-images").upload(path, blob, { contentType: "image/webp", upsert: false });
      if (uploadError) throw uploadError;
      uploaded.push(path);
      images.push(path);
    }
    await call("admin_create_poll", {
      p_option_images: images.some(Boolean) ? images : null,
      p_question: form.querySelector("#official-question").value.trim(),
      p_category: form.querySelector("#official-category").value,
      p_options: options,
      p_tag: form.querySelector("#official-tag").value,
      p_closes_at: hours ? new Date(Date.now() + hours * 3600000).toISOString() : null
    });
    form.reset();
    form.querySelectorAll(".official-preview").forEach((img) => { img.hidden = true; });
    formStatus.textContent = "Published to the room ✓";
  } catch (error) {
    if (uploaded.length) await backend.storage.from("poll-option-images").remove(uploaded).catch(() => {});
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
