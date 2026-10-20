import { getBackend, isBackendConfigured } from "./backend.js";
import { setLinkedText } from "./linkify.js";

const status = document.querySelector("#window-status");
const signedOut = document.querySelector("#window-signed-out");
const dashboard = document.querySelector("#window-dashboard");
let myBackend = null;

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function personality(percent) {
  if (percent >= 75) return "Pulse reader";
  if (percent >= 50) return "In step";
  if (percent >= 25) return "Free thinker";
  return "Contrarian";
}

async function init() {
  if (!isBackendConfigured()) {
    status.textContent = "Window needs the shared TRGGA database. Connect it to see your window.";
    return;
  }
  try {
    const backend = await getBackend();
    const { data: session } = await backend.auth.getSession();
    if (!session.session) {
      status.hidden = true;
      signedOut.hidden = false;
      return;
    }
    const { data, error } = await backend.rpc("get_my_window");
    if (error) throw error;
    status.hidden = true;
    dashboard.hidden = false;
    render(data);
    myBackend = backend;
    setupNotes();
    loadNotes();
    loadNotifications();
  } catch (error) {
    console.error("Could not open Window.", error);
    status.textContent = `Window couldn't load: ${error.message}`;
  }
}

function render(data) {
  const total = Number(data.total);
  const percent = total ? Math.round((Number(data.with_room) / total) * 100) : 0;
  document.querySelector("#win-total").textContent = total.toLocaleString();
  document.querySelector("#win-with").textContent = total ? `${percent}%` : "—";
  document.querySelector("#win-label").textContent = total ? personality(percent) : "Vote to find out";

  const cats = document.querySelector("#win-cats");
  if (!data.top_categories.length) {
    cats.replaceChildren(node("p", "profile-empty", "Cast a few votes and your topics will show up here."));
  } else {
    const max = Math.max(...data.top_categories.map((row) => Number(row.count)));
    cats.replaceChildren(...data.top_categories.map((row) => {
      const line = node("div", "window-cat");
      const bar = node("span", "window-bar");
      bar.style.width = `${Math.max(8, Math.round((Number(row.count) / max) * 100))}%`;
      line.append(node("strong", "", row.category), bar, node("em", "", `${row.count} votes`));
      return line;
    }));
  }

  const bold = document.querySelector("#win-bold");
  const stands = data.recent.filter((row) => !row.with_room && row.my_percent !== null && row.my_percent !== undefined);
  if (bold) {
    if (!stands.length) {
      bold.replaceChildren(node("p", "profile-empty", total ? "You've been with the room on your recent votes. Pick a side nobody else would." : "Vote against the grain and your boldest stand shows up here."));
    } else {
      const pick = stands.reduce((a, b) => (Number(b.my_percent) < Number(a.my_percent) ? b : a));
      const link = node("a", "profile-activity-item");
      link.href = `index.html?poll=${encodeURIComponent(pick.poll_id)}`;
      link.append(node("strong", "", pick.question), node("span", "", `YOU PICKED ${pick.my_label} · ONLY ${pick.my_percent}% AGREED`.toUpperCase()));
      bold.replaceChildren(link);
    }
  }

  const recent = document.querySelector("#win-recent");
  if (!data.recent.length) {
    recent.replaceChildren(node("p", "profile-empty", "No votes yet. Head to the Lobby and pick a side."));
    return;
  }
  recent.replaceChildren(...data.recent.map((row) => {
    const link = node("a", "profile-activity-item");
    link.href = `index.html?poll=${encodeURIComponent(row.poll_id)}`;
    const detail = `YOU: ${row.my_label} · ${row.my_percent ?? 0}% AGREED · ${row.with_room ? "WITH THE ROOM" : "AGAINST THE ROOM"}`;
    link.append(node("strong", "", row.question), node("span", "", detail.toUpperCase()));
    return link;
  }));
}

async function loadNotifications() {
  const list = document.querySelector("#notif-list");
  const { data, error } = await myBackend.rpc("get_my_notifications");
  if (error) {
    list.replaceChildren(node("p", "profile-empty", "Notifications could not load right now."));
    return;
  }
  if (!data.length) {
    list.replaceChildren(node("p", "profile-empty", "Nothing yet. New followers, polls from people you follow and vote milestones show up here."));
    return;
  }
  list.replaceChildren(...data.map((item) => {
    const isFollow = item.kind === "follow";
    const isPoll = item.kind === "poll";
    const link = node("a", `notif-item${item.is_read ? "" : " unread"}`);
    link.href = isFollow ? `member.html?id=${encodeURIComponent(item.actor_id)}` : `index.html?poll=${encodeURIComponent(item.poll_id)}`;
    const title = isFollow
      ? `${item.actor_name || "Someone"} started following you`
      : isPoll ? `${item.actor_name || "Someone you follow"} posted a new poll: ${item.poll_question || ""}`
      : `Your poll hit ${item.detail} votes: ${item.poll_question || ""}`;
    link.append(node("strong", "", title), node("span", "", new Date(item.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }).toUpperCase()));
    return link;
  }));
  if (data.some((item) => !item.is_read)) {
    myBackend.rpc("mark_notifications_read").then(() => document.querySelectorAll(".nav-badge").forEach((b) => b.remove()));
  }
}

async function loadNotes() {
  const list = document.querySelector("#note-list");
  const { data, error } = await myBackend.rpc("get_window_notes");
  if (error) {
    console.error("Could not load notes.", error);
    list.replaceChildren(node("p", "profile-empty", "Notes couldn't load right now."));
    return;
  }
  if (!data.length) {
    list.replaceChildren(node("p", "profile-empty", "No notes yet. Post one, or follow members to see theirs."));
    return;
  }
  list.replaceChildren(...data.map((note) => {
    const item = node("article", `window-note${note.mine ? " mine" : ""}`);
    const head = node("div", "window-note-head");
    head.append(node("strong", "", note.mine ? "You" : note.author_name), node("time", "", new Date(note.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })));
    const body = setLinkedText(node("p", "window-note-body"), note.body);
    item.append(head, body);
    if (note.mine) {
      const remove = node("button", "window-note-delete", "Delete");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        const { error: deleteError } = await myBackend.rpc("delete_window_note", { p_note_id: note.id });
        if (deleteError) {
          console.error("Could not delete the note.", deleteError);
          remove.disabled = false;
          return;
        }
        loadNotes();
      });
      item.append(remove);
    }
    return item;
  }));
}

function setupNotes() {
  const form = document.querySelector("#note-form");
  const message = document.querySelector("#note-status");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const field = document.querySelector("#note-body");
    const body = field.value.trim();
    if (!body) return;
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    message.textContent = "";
    const { error } = await myBackend.rpc("post_window_note", { p_body: body });
    submit.disabled = false;
    if (error) {
      console.error("Could not post the note.", error);
      message.textContent = `Couldn't post: ${error.message}`;
      return;
    }
    field.value = "";
    message.textContent = "Posted to your window.";
    loadNotes();
  });
}

init();
