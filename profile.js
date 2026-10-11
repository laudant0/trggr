import { getBackend, isBackendConfigured } from "./backend.js";

const status = document.querySelector("#profile-status");
const signedOut = document.querySelector("#profile-signed-out");
const dashboard = document.querySelector("#profile-dashboard");
const form = document.querySelector("#profile-form");
const formStatus = document.querySelector("#profile-form-status");
const saveButton = document.querySelector("#profile-save");
const signOutButton = document.querySelector("#profile-sign-out");
const activityList = document.querySelector("#profile-activity");
let backend;

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

function renderProfile(profile) {
  const name = profile.display_name || "TRGGA member";
  const bio = profile.bio || "";
  document.querySelector("#profile-name").textContent = name;
  document.querySelector("#profile-display-name").value = name;
  document.querySelector("#profile-bio").value = bio;
  document.querySelector("#profile-member-since").textContent = `IN THE ROOM SINCE ${formatDate(profile.created_at)}`;
  const bioDisplay = document.querySelector("#profile-bio-display");
  bioDisplay.textContent = bio;
  bioDisplay.hidden = !bio;

  const avatar = document.querySelector("#profile-avatar");
  avatar.replaceChildren();
  if (profile.avatar_url) {
    const image = document.createElement("img");
    image.src = profile.avatar_url;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      avatar.textContent = initials(name);
    }, { once: true });
    avatar.append(image);
  } else {
    avatar.textContent = initials(name);
  }

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
  const { data, error } = await backend.rpc("get_my_profile");
  if (error) throw error;
  if (!data) throw new Error("Your profile could not be found. Try signing out and back in.");
  renderProfile(data);
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
  if (!displayName) {
    formStatus.textContent = "Add a display name before saving.";
    return;
  }

  saveButton.disabled = true;
  formStatus.textContent = "Saving your profile…";
  try {
    const { error } = await backend.rpc("update_my_profile", {
      p_display_name: displayName,
      p_bio: bio
    });
    if (error) throw error;
    document.querySelector("#profile-name").textContent = displayName;
    const bioDisplay = document.querySelector("#profile-bio-display");
    bioDisplay.textContent = bio;
    bioDisplay.hidden = !bio;
    const avatar = document.querySelector("#profile-avatar");
    if (!avatar.querySelector("img")) avatar.textContent = initials(displayName);
    formStatus.textContent = "Profile saved.";
  } catch (error) {
    console.error("Could not update the TRGGA profile.", error);
    formStatus.textContent = `Couldn't save your profile: ${error.message}`;
  } finally {
    saveButton.disabled = false;
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

initializeProfile();
