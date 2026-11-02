import { getBackend, isBackendConfigured } from "./backend.js";

const stage = document.querySelector("#room-stage");
const roomId = new URLSearchParams(window.location.search).get("id");

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function message(text, href, label) {
  const wrap = node("div", "room-message");
  wrap.append(node("p", "profile-empty", text));
  if (href) {
    const link = node("a", "button button-lime button-small", label);
    link.href = href;
    wrap.append(link);
  }
  stage.replaceChildren(wrap);
}

function jitsiUrl(room, name) {
  const hash = [
    "config.startWithVideoMuted=true",
    "config.startAudioOnly=true",
    "config.prejoinConfig.enabled=false",
    `config.subject=${encodeURIComponent(JSON.stringify(room.title))}`,
    `userInfo.displayName=${encodeURIComponent(JSON.stringify(name))}`
  ].join("&");
  return `https://meet.jit.si/${encodeURIComponent(room.join_key)}#${hash}`;
}

async function init() {
  if (!roomId || !isBackendConfigured()) {
    message("This room link isn't valid.", "community.html#rooms", "See all rooms");
    return;
  }
  const backend = await getBackend();
  const { data: session } = await backend.auth.getSession();
  if (!session?.session) {
    message("Sign in to join this room.", `login.html?next=${encodeURIComponent("room.html?id=" + roomId)}`, "Sign in");
    return;
  }
  const { data, error } = await backend.rpc("get_rooms");
  if (error) {
    message("Rooms couldn't load right now.", "community.html#rooms", "Back to rooms");
    return;
  }
  const room = (data || []).find((item) => item.id === roomId);
  if (!room) {
    message("This room has ended or doesn't exist.", "community.html#rooms", "See open rooms");
    return;
  }
  const meta = session.session.user.user_metadata || {};
  const name = meta.full_name || meta.name || "Member";

  const header = node("div", "room-header");
  header.append(
    node("span", `room-badge${room.status === "live" ? " live" : ""}`, room.status === "live" ? "LIVE NOW" : `STARTS ${new Date(room.starts_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()}`),
    node("h1", "room-heading", room.title),
    node("p", "room-poll", `Hosted by ${room.host_name} · On: ${room.poll_question}`)
  );
  const pollLink = node("a", "text-link", "See the poll");
  pollLink.href = `index.html?poll=${encodeURIComponent(room.poll_id)}`;
  header.append(pollLink);

  const body = node("div", "room-body");
  if (room.status !== "live") {
    body.append(node("p", "profile-empty", "This room hasn't started yet. Come back at the start time."));
  } else {
    const join = node("button", "button button-lime", "Join the room 🎙");
    join.type = "button";
    const note = node("p", "room-note", "You join muted. Tap the mic to speak. Be respectful, keep it about the poll.");
    join.addEventListener("click", () => {
      const frame = document.createElement("iframe");
      frame.className = "room-frame";
      frame.allow = "microphone; camera; autoplay; display-capture";
      frame.src = jitsiUrl(room, name);
      frame.title = room.title;
      body.replaceChildren(frame, newTabLink(room, name));
    });
    body.append(join, note, newTabLink(room, name));
  }
  if (room.is_host) {
    const end = node("button", "button button-dark button-small", "End room");
    end.type = "button";
    end.addEventListener("click", async () => {
      end.disabled = true;
      await backend.rpc("end_room", { p_id: room.id });
      window.location.href = "community.html#rooms";
    });
    body.append(end);
  }
  stage.replaceChildren(header, body);
}

function newTabLink(room, name) {
  const link = node("a", "text-link room-newtab", "Open in a new tab");
  link.href = jitsiUrl(room, name);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

init().catch((error) => {
  console.error("Could not load the room.", error);
  message("Something went wrong loading this room.", "community.html#rooms", "Back to rooms");
});
