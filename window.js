import { getBackend, isBackendConfigured } from "./backend.js";

const status = document.querySelector("#window-status");
const signedOut = document.querySelector("#window-signed-out");
const dashboard = document.querySelector("#window-dashboard");

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
    status.textContent = "iWindow needs the shared TRGGA database. Connect it to see your window.";
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
  } catch (error) {
    console.error("Could not open iWindow.", error);
    status.textContent = `iWindow couldn't load: ${error.message}`;
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

init();
