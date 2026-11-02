import { getBackend, isBackendConfigured } from "./backend.js";

const grid = document.querySelector("#rooms-grid");

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function whenLabel(room) {
  const date = new Date(room.starts_at);
  if (room.status === "live") return "LIVE NOW";
  return `STARTS ${date.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()}`;
}

function roomCard(room, onEnd) {
  const card = node("article", `room-card${room.status === "live" ? " is-live" : ""}`);
  const top = node("div", "room-top");
  const badge = node("span", "room-badge", whenLabel(room));
  top.append(badge, node("span", "room-host", `Hosted by ${room.host_name}`));
  const title = node("h3", "room-title", room.title);
  const poll = node("p", "room-poll", `On: ${room.poll_question}`);
  const actions = node("div", "room-actions");
  const join = node("a", "button button-lime button-small", room.status === "live" ? "Join the room" : "View room");
  join.href = `room.html?id=${encodeURIComponent(room.id)}`;
  actions.append(join);
  if (room.is_host) {
    const end = node("button", "button button-dark button-small", "End room");
    end.type = "button";
    end.addEventListener("click", () => onEnd(room, end));
    actions.append(end);
  }
  card.append(top, title, poll, actions);
  return card;
}

export async function startRoomFlow(backend, pollId, pollQuestion) {
  const suggested = `Let's talk: ${pollQuestion}`.slice(0, 80);
  const title = window.prompt("Name your room", suggested);
  if (title === null) return null;
  const when = window.prompt("Start now? Leave blank to go live now, or enter minutes from now (e.g. 30).", "");
  if (when === null) return null;
  const minutes = Number(when);
  const startsAt = when.trim() && Number.isFinite(minutes) && minutes > 0 ? new Date(Date.now() + minutes * 60000).toISOString() : null;
  const { data, error } = await backend.rpc("create_room", { p_poll_id: pollId, p_title: title, p_starts_at: startsAt });
  if (error) {
    window.alert(error.message || "Could not create the room.");
    return null;
  }
  return data;
}

async function loadGrid() {
  if (!grid) return;
  if (!isBackendConfigured()) {
    grid.replaceChildren(node("p", "profile-empty", "Rooms appear here when the shared project is connected."));
    return;
  }
  const backend = await getBackend();
  const { data: session } = await backend.auth.getSession();
  if (!session?.session) {
    grid.replaceChildren(node("p", "profile-empty", "Sign in to see and join live rooms."));
    return;
  }
  const { data, error } = await backend.rpc("get_rooms");
  if (error) {
    grid.replaceChildren(node("p", "profile-empty", "Rooms are warming up. Check back soon."));
    return;
  }
  if (!data.length) {
    grid.replaceChildren(node("p", "profile-empty", "No rooms open right now. Open any poll and tap Start a room to get one going."));
    return;
  }
  const onEnd = async (room, button) => {
    button.disabled = true;
    await backend.rpc("end_room", { p_id: room.id });
    loadGrid();
  };
  grid.replaceChildren(...data.map((room) => roomCard(room, onEnd)));
}

loadGrid().catch((error) => console.error("Could not load rooms.", error));
