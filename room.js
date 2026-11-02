import { getBackend, isBackendConfigured } from "./backend.js";
import { initials } from "./avatar.js";

const stage = document.querySelector("#room-stage");
const roomId = new URLSearchParams(window.location.search).get("id");
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

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

function hue(id) {
  let total = 0;
  for (const char of id) total = (total * 31 + char.charCodeAt(0)) % 360;
  return total;
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
  const me = session.session.user;
  const meta = me.user_metadata || {};
  const myName = meta.full_name || meta.name || "Member";
  const isHost = room.host_id === me.id;
  let channel = null;

  const header = node("div", "room-header");
  const badge = node("span", `room-badge${room.status === "live" ? " live" : ""}`, room.status === "live" ? "LIVE NOW" : `STARTS ${new Date(room.starts_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()}`);
  const pollLink = node("a", "text-link", "See the poll \u2197");
  pollLink.href = `index.html?poll=${encodeURIComponent(room.poll_id)}`;
  header.append(badge, node("h1", "room-heading", room.title), node("p", "room-poll", `Hosted by ${room.host_name} \u00b7 On: ${room.poll_question}`), pollLink);

  const body = node("div", "room-body");
  stage.replaceChildren(header, body);

  if (room.status !== "live") {
    body.append(node("p", "profile-empty", "This room hasn't started yet. It opens by itself at the start time."));
    const wait = new Date(room.starts_at).getTime() - Date.now();
    if (wait > 0 && wait < 2147483000) setTimeout(() => window.location.reload(), wait + 500);
    if (isHost) body.append(endButton());
    return;
  }

  const join = node("button", "button button-lime", "Join the room \ud83c\udf99");
  join.type = "button";
  body.append(join, node("p", "room-note", "Voice only. You join as a listener. Raise your hand and the host can bring you on stage."));
  if (isHost) body.append(endButton());
  join.addEventListener("click", () => startSession());

  function endButton() {
    const end = node("button", "button button-dark button-small", "End room");
    end.type = "button";
    end.addEventListener("click", async () => {
      end.disabled = true;
      if (channel) await channel.send({ type: "broadcast", event: "ended", payload: {} });
      await backend.rpc("end_room", { p_id: room.id });
      cleanup();
      window.location.href = "community.html#rooms";
    });
    return end;
  }

  let localTrack = null;
  let micOn = false;
  let hand = false;
  let speakers = new Set([room.host_id]);
  const peers = new Map();
  const pendingIce = new Map();
  const levels = new Map();
  const speaking = new Set();
  let audioCtx = null;
  let meter = null;
  let people = new Map();
  let ui = null;

  function canSpeak() {
    return speakers.has(me.id);
  }

  function send(to, kind, payload) {
    channel.send({ type: "broadcast", event: "sig", payload: { from: me.id, to, kind, data: payload } });
  }

  function watchLevel(id, stream) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      levels.set(id, analyser);
    } catch (error) {
      console.warn("Level meter unavailable.", error);
    }
  }

  function startMeter() {
    meter = setInterval(() => {
      let changed = false;
      levels.forEach((analyser, id) => {
        const buffer = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128));
        const talking = peak > 9 && (id !== me.id || micOn);
        if (talking !== speaking.has(id)) {
          if (talking) speaking.add(id); else speaking.delete(id);
          changed = true;
        }
      });
      if (changed) paintSpeaking();
    }, 160);
  }

  function paintSpeaking() {
    ui?.root.querySelectorAll("[data-uid]").forEach((tile) => tile.classList.toggle("speaking", speaking.has(tile.dataset.uid)));
  }

  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    peers.delete(id);
    levels.delete(id);
    speaking.delete(id);
  }

  function makePeer(id) {
    closePeer(id);
    const pc = new RTCPeerConnection(ICE);
    const transceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    document.body.append(audio);
    const peer = { pc, audio, sender: transceiver.sender };
    pc.onicecandidate = (event) => { if (event.candidate) send(id, "ice", event.candidate.toJSON()); };
    pc.ontrack = (event) => {
      const stream = new MediaStream([event.track]);
      audio.srcObject = stream;
      audio.play().catch(() => {});
      watchLevel(id, stream);
    };
    if (localTrack && micOn) peer.sender.replaceTrack(localTrack).catch(() => {});
    peers.set(id, peer);
    return peer;
  }

  async function flushIce(id, pc) {
    const queue = pendingIce.get(id) || [];
    pendingIce.delete(id);
    for (const candidate of queue) await pc.addIceCandidate(candidate).catch(() => {});
  }

  async function onSignal({ from, to, kind, data: payload }) {
    if (to !== me.id) return;
    try {
      if (kind === "offer") {
        const peer = makePeer(from);
        await peer.pc.setRemoteDescription(payload);
        await flushIce(from, peer.pc);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        send(from, "answer", peer.pc.localDescription.toJSON());
      } else if (kind === "answer") {
        const peer = peers.get(from);
        if (!peer) return;
        await peer.pc.setRemoteDescription(payload);
        await flushIce(from, peer.pc);
      } else if (kind === "ice") {
        const peer = peers.get(from);
        if (peer?.pc.remoteDescription) await peer.pc.addIceCandidate(payload).catch(() => {});
        else pendingIce.set(from, [...(pendingIce.get(from) || []), payload]);
      }
    } catch (error) {
      console.warn("Voice signal failed.", error);
    }
  }

  async function connectTo(id) {
    const peer = makePeer(id);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    send(id, "offer", peer.pc.localDescription.toJSON());
  }

  function syncPeople() {
    const state = channel.presenceState();
    people = new Map();
    Object.entries(state).forEach(([id, metas]) => { if (metas[0]) people.set(id, metas[0]); });
    people.forEach((_, id) => {
      if (id !== me.id && !peers.has(id) && me.id < id) connectTo(id).catch((error) => console.warn("Could not connect.", error));
    });
    [...peers.keys()].forEach((id) => { if (!people.has(id)) closePeer(id); });
    render();
  }

  function announce() {
    return channel.track({ name: myName, hand, mic: micOn });
  }

  function broadcastSpeakers() {
    channel.send({ type: "broadcast", event: "speakers", payload: { ids: [...speakers] } });
  }

  async function setMic(on) {
    if (on && !canSpeak()) return;
    if (on) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        localTrack = stream.getAudioTracks()[0];
        watchLevel(me.id, new MediaStream([localTrack]));
      } catch (error) {
        window.alert("TRGGA needs microphone access to let you speak. Check your browser permission.");
        return;
      }
    }
    micOn = on;
    peers.forEach((peer) => peer.sender.replaceTrack(on ? localTrack : null).catch(() => {}));
    if (!on && localTrack) {
      localTrack.stop();
      localTrack = null;
      levels.delete(me.id);
      speaking.delete(me.id);
    }
    await announce();
    render();
  }

  function setSpeakers(ids) {
    speakers = new Set([room.host_id, ...ids]);
    if (!canSpeak() && micOn) setMic(false);
    if (canSpeak()) { hand = false; announce(); }
    render();
  }

  function tile(id, info) {
    const person = node("div", "room-person");
    person.dataset.uid = id;
    const avatar = node("div", "room-avatar", initials(info.name));
    avatar.style.setProperty("--hue", hue(id));
    person.append(avatar);
    person.append(node("strong", "room-person-name", id === me.id ? `${info.name} (you)` : info.name));
    const tags = node("span", "room-person-tag");
    if (id === room.host_id) tags.textContent = "HOST";
    else if (info.hand) tags.textContent = "\u270b HAND UP";
    else if (speakers.has(id)) tags.textContent = "SPEAKER";
    if (speakers.has(id) && !info.mic) tags.textContent += tags.textContent ? " \u00b7 MUTED" : "MUTED";
    person.append(tags);
    if (isHost && id !== me.id) {
      const action = node("button", "room-person-action", speakers.has(id) ? "Move to audience" : "Bring on stage");
      action.type = "button";
      action.addEventListener("click", () => {
        if (speakers.has(id)) speakers.delete(id); else speakers.add(id);
        broadcastSpeakers();
        render();
      });
      if (speakers.has(id) || info.hand) person.append(action);
    }
    return person;
  }

  function render() {
    if (!ui) return;
    const onStage = [];
    const audience = [];
    people.forEach((info, id) => (speakers.has(id) ? onStage : audience).push([id, info]));
    onStage.sort((a) => (a[0] === room.host_id ? -1 : 1));
    audience.sort((a, b) => Number(Boolean(b[1].hand)) - Number(Boolean(a[1].hand)));
    ui.stageGrid.replaceChildren(...onStage.map(([id, info]) => tile(id, info)));
    ui.audienceGrid.replaceChildren(...audience.map(([id, info]) => tile(id, info)));
    ui.audienceTitle.textContent = `Audience \u00b7 ${audience.length}`;
    ui.mic.hidden = !canSpeak();
    ui.mic.textContent = micOn ? "\ud83c\udf99 Mute" : "\ud83c\udf99 Unmute";
    ui.mic.classList.toggle("is-on", micOn);
    ui.hand.hidden = canSpeak();
    ui.hand.textContent = hand ? "Lower hand" : "\u270b Raise hand";
    paintSpeaking();
  }

  function cleanup() {
    clearInterval(meter);
    [...peers.keys()].forEach(closePeer);
    if (localTrack) localTrack.stop();
    if (channel) backend.removeChannel(channel);
    channel = null;
  }

  function startSession() {
    const root = node("div", "room-live");
    const stageTitle = node("h2", "room-section-title", "On stage");
    const stageGrid = node("div", "room-people");
    const audienceTitle = node("h2", "room-section-title", "Audience");
    const audienceGrid = node("div", "room-people");
    const controls = node("div", "room-controls");
    const mic = node("button", "button button-lime", "\ud83c\udf99 Unmute");
    mic.type = "button";
    mic.hidden = true;
    mic.addEventListener("click", () => setMic(!micOn));
    const handButton = node("button", "button button-dark", "\u270b Raise hand");
    handButton.type = "button";
    handButton.addEventListener("click", async () => { hand = !hand; await announce(); render(); });
    const leave = node("button", "button button-dark", "Leave");
    leave.type = "button";
    leave.addEventListener("click", () => { cleanup(); window.location.href = "community.html#rooms"; });
    controls.append(mic, handButton, leave);
    if (isHost) controls.append(endButton());
    root.append(stageTitle, stageGrid, audienceTitle, audienceGrid, controls, node("p", "room-note", "Voice is peer to peer, so rooms work best with a small crowd. Be respectful and keep it about the poll."));
    ui = { root, stageGrid, audienceGrid, audienceTitle, mic, hand: handButton };
    body.replaceChildren(root);

    channel = backend.channel(`trgga-room-${room.id}`, { config: { broadcast: { self: false }, presence: { key: me.id } } });
    channel.on("broadcast", { event: "sig" }, ({ payload }) => onSignal(payload));
    channel.on("broadcast", { event: "speakers" }, ({ payload }) => setSpeakers(payload.ids || []));
    channel.on("broadcast", { event: "ended" }, () => {
      cleanup();
      message("The host ended this room. Thanks for being part of it.", "community.html#rooms", "Back to rooms");
    });
    channel.on("presence", { event: "sync" }, syncPeople);
    channel.on("presence", { event: "join" }, () => { if (isHost) broadcastSpeakers(); });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await announce();
        startMeter();
        if (isHost) broadcastSpeakers();
      }
    });
    window.addEventListener("pagehide", cleanup);
  }
}

init().catch((error) => {
  console.error("Could not load the room.", error);
  message("Something went wrong loading this room.", "community.html#rooms", "Back to rooms");
});
