import { getBackend, isBackendConfigured } from "./backend.js";
import { avatarUrl, fillAvatar, loadAvatarPaths, resizeAvatar } from "./avatar.js";
import { parseXHandle, xLink } from "./xhandle.js";

const status = document.querySelector("#profile-status");
const signedOut = document.querySelector("#profile-signed-out");
const dashboard = document.querySelector("#profile-dashboard");
const form = document.querySelector("#profile-form");
const formStatus = document.querySelector("#profile-form-status");
const saveButton = document.querySelector("#profile-save");
const signOutButton = document.querySelector("#profile-sign-out");
const activityList = document.querySelector("#profile-activity");
let backend;
let myId = null;
let myName = "";
let myAvatarPath = null;
let connectionKind = "following";

function setStatus(message, mode = "info") {
  status.textContent = message;
  status.dataset.mode = mode;
  status.hidden = false;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "T";
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "RECENTLY"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}

function renderActivity(profile) {
  const polls = (profile.recent_polls || []).map((item) => ({
    kind: "POLL STARTED",
    question: item.question,
    category: item.category,
    detail: `${Number(item.total_votes).toLocaleString()} ${Number(item.total_votes) === 1 ? "VOTE" : "VOTES"}`,
    date: item.created_at
  }));
  const votes = (profile.recent_votes || []).map((item) => ({
    kind: "YOU VOTED",
    question: item.question,
    category: item.category,
    detail: `YOUR PICK · ${item.option_label}`,
    date: item.voted_at
  }));
  const entries = [...polls, ...votes]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8);

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = "Your activity will show up here as you vote and start polls.";
    activityList.replaceChildren(empty);
    return;
  }

  activityList.replaceChildren(...entries.map((entry) => {
    const item = document.createElement("article");
    item.className = "profile-activity-item";
    const main = document.createElement("div");
    main.className = "profile-activity-main";
    const kind = document.createElement("span");
    kind.className = "profile-activity-kind";
    kind.textContent = entry.kind;
    const question = document.createElement("h3");
    question.textContent = entry.question;
    const meta = document.createElement("p");
    meta.textContent = `${entry.category.toUpperCase()} · ${entry.detail}`;
    const date = document.createElement("time");
    date.className = "profile-activity-date";
    date.dateTime = entry.date;
    date.textContent = formatDate(entry.date);
    main.append(kind, question, meta);
    item.append(main, date);
    return item;
  }));
}

function paintAvatar(fallbackUrl) {
  const url = myAvatarPath ? avatarUrl(backend, myAvatarPath) : fallbackUrl || null;
  fillAvatar(document.querySelector("#profile-avatar"), myName, url);
  document.querySelector("#avatar-remove").hidden = !myAvatarPath;
}

function paintXHandle(handle) {
  const display = document.querySelector("#profile-x-display");
  document.querySelector("#profile-x").value = handle ? `@${handle}` : "";
  display.replaceChildren(...(handle ? [xLink(handle)] : []));
  display.hidden = !handle;
}

function renderProfile(profile) {
  const name = profile.display_name || "TRGGA member";
  const bio = profile.bio || "";
  document.querySelector("#profile-name").textContent = name;
  document.querySelector("#profile-display-name").value = name;
  document.querySelector("#profile-bio").value = bio;
  document.querySelector("#profile-discoverable").checked = Boolean(profile.discoverable);
  document.querySelector("#profile-member-since").textContent = `IN THE ROOM SINCE ${formatDate(profile.created_at)}`;
  const bioDisplay = document.querySelector("#profile-bio-display");
  bioDisplay.textContent = bio;
  bioDisplay.hidden = !bio;
  paintXHandle(profile.x_handle);

  myName = name;
  paintAvatar(profile.avatar_url);

  document.querySelector("#stat-polls").textContent = Number(profile.stats.polls_created).toLocaleString();
  document.querySelector("#stat-votes").textContent = Number(profile.stats.votes_cast).toLocaleString();
  document.querySelector("#stat-received").textContent = Number(profile.stats.votes_received).toLocaleString();
  renderActivity(profile);
  dashboard.hidden = false;
  signedOut.hidden = true;
  status.hidden = true;
}

async function loadProfile() {
  setStatus("Loading your profile…");
  const [profileResult, discoveryResult, xResult] = await Promise.all([
    backend.rpc("get_my_profile"),
    backend.rpc("get_my_profile_discovery_setting"),
    backend.rpc("get_my_x_handle")
  ]);
  if (profileResult.error) throw profileResult.error;
  if (discoveryResult.error) throw discoveryResult.error;
  const data = profileResult.data;
  if (!data) throw new Error("Your profile could not be found. Try signing out and back in.");
  data.discoverable = discoveryResult.data;
  data.x_handle = xResult.error ? null : xResult.data;
  const { data: sessionData } = await backend.auth.getSession();
  myId = sessionData.session.user.id;
  myAvatarPath = (await loadAvatarPaths(backend, [myId])).get(myId) || null;
  renderProfile(data);
  loadCounts();
  loadConnections();
  loadPins();
  loadResults();
  loadBlocked();
}

async function initializeProfile() {
  if (!isBackendConfigured()) {
    dashboard.hidden = true;
    signedOut.hidden = false;
    setStatus("The shared profile needs the Supabase project configuration.");
    return;
  }

  try {
    backend = await getBackend();
    const { data, error } = await backend.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      dashboard.hidden = true;
      signedOut.hidden = false;
      setStatus("Sign in to open your personal TRGGA profile.");
      return;
    }
    await loadProfile();
    backend.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.replace("login.html");
    });
  } catch (error) {
    console.error("Could not load the TRGGA profile.", error);
    dashboard.hidden = true;
    signedOut.hidden = false;
    setStatus(`Your profile couldn't load: ${error.message}`, "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!backend) return;
  const displayName = form.elements.display_name.value.trim();
  const bio = form.elements.bio.value.trim();
  const discoverable = form.elements.discoverable.checked;
  if (!displayName) {
    formStatus.textContent = "Add a display name before saving.";
    return;
  }
  const xHandle = parseXHandle(form.elements.x_handle.value);
  if (xHandle === null) {
    formStatus.textContent = "That X handle doesn't look right. Use @name or your x.com link.";
    return;
  }

  saveButton.disabled = true;
  formStatus.textContent = "Saving your profile…";
  try {
    const { error } = await backend.rpc("update_my_profile", {
      p_display_name: displayName,
      p_bio: bio,
      p_discoverable: discoverable
    });
    if (error) throw error;
    const { data: savedHandle, error: handleError } = await backend.rpc("set_my_x_handle", { p_handle: xHandle });
    if (handleError) throw handleError;
    paintXHandle(savedHandle);
    document.querySelector("#profile-name").textContent = displayName;
    const bioDisplay = document.querySelector("#profile-bio-display");
    bioDisplay.textContent = bio;
    bioDisplay.hidden = !bio;
    myName = displayName;
    if (!document.querySelector("#profile-avatar img")) paintAvatar(null);
    formStatus.textContent = "Profile saved.";
  } catch (error) {
    console.error("Could not update the TRGGA profile.", error);
    formStatus.textContent = `Couldn't save your profile: ${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
});

async function loadCounts() {
  const { data } = await backend.rpc("get_connection_state", { p_member_id: myId });
  if (!data || data.followers === null) return;
  document.querySelector("#stat-followers").textContent = Number(data.followers).toLocaleString();
  document.querySelector("#stat-following").textContent = Number(data.following).toLocaleString();
}

async function loadPins() {
  const list = document.querySelector("#pin-list");
  const { data, error } = await backend.rpc("get_my_pins");
  if (error) {
    console.error("Could not load pins.", error);
    list.replaceChildren(Object.assign(document.createElement("p"), { className: "profile-empty", textContent: "Your pins couldn't load right now." }));
    return;
  }
  if (!data.length) {
    list.replaceChildren(Object.assign(document.createElement("p"), { className: "profile-empty", textContent: "Nothing pinned yet. Tap PIN on any poll to keep it here." }));
    return;
  }
  list.replaceChildren(...data.map((pin) => {
    const link = document.createElement("a");
    link.className = "profile-activity-item";
    link.href = `index.html?poll=${encodeURIComponent(pin.poll_id)}`;
    const title = document.createElement("strong");
    title.textContent = pin.question;
    const meta = document.createElement("span");
    meta.textContent = String(pin.category || "").toUpperCase();
    link.append(title, meta);
    return link;
  }));
}

function textNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

async function loadResults() {
  const list = document.querySelector("#results-list");
  const { data, error } = await backend.rpc("get_my_poll_results");
  if (error) {
    console.error("Could not load poll results.", error);
    list.replaceChildren(textNode("p", "profile-empty", "Your results couldn't load right now."));
    return;
  }
  if (!data.length) {
    list.replaceChildren(textNode("p", "profile-empty", "Start a poll and its results will show up here."));
    return;
  }
  list.replaceChildren(...data.map((poll) => {
    const card = document.createElement("article");
    card.className = "result-card";
    const closed = poll.closes_at && new Date(poll.closes_at) <= new Date();
    const state = poll.status === "hidden" ? "HIDDEN" : closed ? "CLOSED" : poll.closes_at ? "OPEN · CLOSES " + new Date(poll.closes_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase() : "OPEN";
    const head = document.createElement("a");
    head.className = "result-head";
    head.href = `index.html?poll=${encodeURIComponent(poll.poll_id)}`;
    head.append(textNode("strong", "", poll.question), textNode("span", "", `${state} · ${Number(poll.total_votes).toLocaleString()} VOTES`));
    card.append(head);
    const total = Number(poll.total_votes);
    poll.options.forEach((option) => {
      const percent = total ? Math.round((Number(option.votes) / total) * 100) : 0;
      const row = document.createElement("div");
      row.className = "result-row";
      const bar = document.createElement("span");
      bar.className = "result-bar";
      const fill = document.createElement("span");
      fill.style.width = `${percent}%`;
      bar.append(fill);
      row.append(textNode("span", "result-label", option.label), bar, textNode("em", "", `${percent}% · ${option.votes}`));
      card.append(row);
    });
    const days = poll.daily || [];
    const max = Math.max(1, ...days.map((day) => Number(day.votes)));
    const spark = document.createElement("div");
    spark.className = "result-spark";
    spark.setAttribute("aria-label", "Votes per day over the last 14 days");
    days.forEach((day) => {
      const bar = document.createElement("span");
      bar.style.height = `${Math.max(4, Math.round((Number(day.votes) / max) * 100))}%`;
      bar.title = `${day.day}: ${day.votes} vote${Number(day.votes) === 1 ? "" : "s"}`;
      spark.append(bar);
    });
    card.append(spark, textNode("small", "", "VOTES PER DAY · LAST 14 DAYS"));
    return card;
  }));
}

async function loadBlocked() {
  const list = document.querySelector("#blocked-list");
  const { data, error } = await backend.rpc("get_my_blocks");
  if (error) {
    console.error("Could not load blocked members.", error);
    list.replaceChildren(textNode("p", "profile-empty", "This couldn't load right now."));
    return;
  }
  if (!data.length) {
    list.replaceChildren(textNode("p", "profile-empty", "You haven't blocked anyone."));
    return;
  }
  list.replaceChildren(...data.map((member) => {
    const row = document.createElement("div");
    row.className = "blocked-row";
    const unblock = textNode("button", "auth-signout", "Unblock");
    unblock.type = "button";
    unblock.addEventListener("click", async () => {
      unblock.disabled = true;
      const { error: unblockError } = await backend.rpc("toggle_block", { p_member_id: member.id });
      if (unblockError) {
        console.error("Could not unblock.", unblockError);
        unblock.disabled = false;
        return;
      }
      loadBlocked();
    });
    row.append(textNode("strong", "", member.display_name), unblock);
    return row;
  }));
}

async function loadConnections() {
  const list = document.querySelector("#connection-list");
  const { data, error } = await backend.rpc("get_my_connections", { p_kind: connectionKind });
  if (error) {
    console.error("Could not load connections.", error);
    list.replaceChildren(Object.assign(document.createElement("p"), { className: "profile-empty", textContent: "Connections couldn't load right now." }));
    return;
  }
  if (!data.length) {
    list.replaceChildren(Object.assign(document.createElement("p"), {
      className: "profile-empty",
      textContent: connectionKind === "following"
        ? "You're not following anyone yet. Visit a member's profile and tap Follow."
        : "No followers yet. Share your polls and turn on discovery to be found."
    }));
    return;
  }
  list.replaceChildren(...data.map((member) => {
    const card = document.createElement("a");
    card.className = "member-card";
    card.href = `member.html?id=${encodeURIComponent(member.id)}`;
    const avatar = document.createElement("span");
    avatar.className = "member-avatar";
    fillAvatar(avatar, member.display_name, avatarUrl(backend, member.avatar_path));
    const identity = document.createElement("span");
    identity.className = "member-identity";
    const name = document.createElement("strong");
    name.textContent = member.display_name;
    const detail = document.createElement("span");
    detail.className = "member-bio";
    detail.textContent = member.mutual ? "CONNECTED BOTH WAYS" : member.bio || "In the room.";
    identity.append(name, detail);
    card.append(avatar, identity);
    return card;
  }));
}

document.querySelectorAll(".connection-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    connectionKind = tab.dataset.kind;
    document.querySelectorAll(".connection-tab").forEach((item) => {
      item.classList.toggle("active", item === tab);
      item.setAttribute("aria-selected", String(item === tab));
    });
    if (backend && myId) loadConnections();
  });
});

const avatarStatus = document.querySelector("#avatar-status");

async function removeAvatarFile(path) {
  if (path) await backend.storage.from("avatars").remove([path]);
}

document.querySelector("#avatar-input").addEventListener("change", async (event) => {
  const input = event.target;
  const file = input.files[0];
  input.value = "";
  if (!file || !backend || !myId) return;
  avatarStatus.textContent = "Uploading your photo...";
  let uploadedPath = null;
  try {
    const blob = await resizeAvatar(file);
    uploadedPath = `${myId}/${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await backend.storage.from("avatars").upload(uploadedPath, blob, { contentType: "image/webp", upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await backend.rpc("set_my_avatar", { p_path: uploadedPath });
    if (error) throw error;
    const previous = myAvatarPath;
    myAvatarPath = uploadedPath;
    paintAvatar(null);
    avatarStatus.textContent = "Photo updated.";
    removeAvatarFile(previous).catch(() => {});
  } catch (error) {
    console.error("Could not update the profile photo.", error);
    avatarStatus.textContent = `Couldn't update your photo: ${error.message}`;
    if (uploadedPath) removeAvatarFile(uploadedPath).catch(() => {});
  }
});

document.querySelector("#avatar-remove").addEventListener("click", async () => {
  if (!myAvatarPath) return;
  try {
    const { error } = await backend.rpc("set_my_avatar", { p_path: null });
    if (error) throw error;
    const previous = myAvatarPath;
    myAvatarPath = null;
    paintAvatar(null);
    avatarStatus.textContent = "Photo removed.";
    removeAvatarFile(previous).catch(() => {});
  } catch (error) {
    avatarStatus.textContent = `Couldn't remove your photo: ${error.message}`;
  }
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;
  try {
    const { error } = await backend.auth.signOut();
    if (error) throw error;
  } catch (error) {
    console.error("Could not sign out of TRGGA.", error);
    setStatus(`Sign-out failed: ${error.message}`, "error");
    signOutButton.disabled = false;
  }
});

document.querySelector("#delete-account")?.addEventListener("click", async (event) => {
  if (!window.confirm("Delete your TRGGA account permanently? This cannot be undone.")) return;
  if (window.prompt("Type DELETE to confirm.") !== "DELETE") return;
  event.currentTarget.disabled = true;
  try {
    const { error } = await backend.rpc("delete_my_account");
    if (error) throw error;
    await backend.auth.signOut().catch(() => {});
    window.location.assign("index.html");
  } catch (error) {
    setStatus(`Could not delete account: ${error.message}`, "error");
    event.currentTarget.disabled = false;
  }
});

initializeProfile();
