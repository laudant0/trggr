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

function askRoomDetails(suggested) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "room-dialog";
    const form = node("form", "room-dialog-form");
    form.method = "dialog";
    form.append(node("span", "eyebrow", "START A ROOM"), node("h2", "room-dialog-title", "Talk it out, live."));
    const titleLabel = node("label", "room-field");
    titleLabel.append(node("span", "", "Room name"));
    const title = node("input", "");
    title.maxLength = 80;
    title.value = suggested;
    title.required = true;
    titleLabel.append(title);
    const whenLabel = node("label", "room-field");
    whenLabel.append(node("span", "", "When"));
    const when = node("select", "");
    [["0", "Go live now"], ["15", "In 15 minutes"], ["60", "In 1 hour"], ["180", "In 3 hours"], ["1440", "Tomorrow"]].forEach(([value, label]) => {
      const option = node("option", "", label);
      option.value = value;
      when.append(option);
    });
    whenLabel.append(when);
    const actions = node("div", "room-actions");
    const cancel = node("button", "button button-dark button-small", "Cancel");
    cancel.type = "button";
    cancel.autofocus = true;
    const go = node("button", "button button-lime button-small", "Start room");
    go.type = "submit";
    actions.append(go, cancel);
    form.append(titleLabel, whenLabel, actions);
    dialog.append(form);
    document.body.append(dialog);
    let result = null;
    cancel.addEventListener("click", () => dialog.close());
    form.addEventListener("submit", () => { result = { title: title.value, minutes: Number(when.value) }; });
    dialog.addEventListener("close", () => { dialog.remove(); resolve(result); });
    dialog.showModal();
    if (window.matchMedia("(hover: hover)").matches) title.select();
  });
}

export async function startRoomFlow(backend, pollId, pollQuestion) {
  const details = await askRoomDetails(`Let's talk: ${pollQuestion}`.slice(0, 80));
  if (!details) return null;
  const startsAt = details.minutes > 0 ? new Date(Date.now() + details.minutes * 60000).toISOString() : null;
  try {
    const { data, error } = await backend.rpc("create_room", { p_poll_id: pollId, p_title: details.title, p_starts_at: startsAt });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Could not create the room.", error);
    window.alert(error.message || "Could not create the room. Please try again.");
    return null;
  }
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
    grid.replaceChildren(node("p", "profile-empty", "No rooms open right now. Authors can start one from their own poll."));
    return;
  }
  const onEnd = async (room, button) => {
    button.disabled = true;
    try {
      const { error } = await backend.rpc("end_room", { p_id: room.id });
      if (error) throw error;
      await loadGrid();
    } catch (error) {
      console.error("Could not end the room.", error);
      window.alert("The room couldn't be ended. Please try again.");
      button.disabled = false;
    }
  };
  grid.replaceChildren(...data.map((room) => roomCard(room, onEnd)));
}

loadGrid().catch((error) => console.error("Could not load rooms.", error));
