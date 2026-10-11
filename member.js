import { getBackend, isBackendConfigured } from "./backend.js";

const status = document.querySelector("#member-status");
const content = document.querySelector("#member-content");

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "%";
}

function addText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function render(profile) {
  const hero = document.createElement("section");
  hero.className = "profile-hero member-profile-hero";
  const identity = document.createElement("div");
  identity.className = "profile-identity";
  const avatar = document.createElement("div");
  avatar.className = "profile-avatar";
  avatar.setAttribute("aria-hidden", "true");
  if (profile.avatar_url) {
    const image = document.createElement("img");
    image.src = profile.avatar_url;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => { avatar.textContent = initials(profile.display_name); }, { once: true });
    avatar.append(image);
  } else {
    avatar.textContent = initials(profile.display_name);
  }
  const heading = document.createElement("div");
  addText(heading, "span", "eyebrow", "A MEMBER OF THE ROOM");
  addText(heading, "h1", "", profile.display_name);
  addText(heading, "p", "profile-member-since", `IN THE ROOM SINCE ${new Date(profile.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" }).toUpperCase()}`);
  if (profile.bio) addText(heading, "p", "profile-bio-display", profile.bio);
  identity.append(avatar, heading);
  hero.append(identity);

  const stats = document.createElement("section");
  stats.className = "profile-stats member-public-stats";
  stats.setAttribute("aria-label", "Public member activity");
  [
    ["POLLS STARTED", profile.stats.polls_created],
    ["VOTES RECEIVED", profile.stats.votes_received]
  ].forEach(([label, value]) => {
    const stat = document.createElement("article");
    stat.className = "profile-stat";
    addText(stat, "span", "", label);
    addText(stat, "strong", "", Number(value).toLocaleString());
    stats.append(stat);
  });

  const panel = document.createElement("section");
  panel.className = "profile-panel member-polls-panel";
  const panelHeading = document.createElement("div");
  panelHeading.className = "profile-panel-heading";
  const panelTitle = document.createElement("div");
  addText(panelTitle, "span", "eyebrow", "THE QUESTIONS THEY STARTED");
  addText(panelTitle, "h2", "", "Public polls");
  panelHeading.append(panelTitle);
  panel.append(panelHeading);
  const polls = document.createElement("div");
  polls.className = "member-poll-list";
  if (!profile.recent_polls.length) {
    addText(polls, "p", "profile-empty", "No public polls yet.");
  } else {
    profile.recent_polls.forEach((poll) => {
      const pollCard = document.createElement("article");
      pollCard.className = "member-poll";
      addText(pollCard, "span", "topic-poll-tag", `${poll.category.toUpperCase()} · ${Number(poll.total_votes).toLocaleString()} VOTES`);
      addText(pollCard, "h3", "", poll.question);
      polls.append(pollCard);
    });
  }
  panel.append(polls);
  content.replaceChildren(hero, stats, panel);
  content.hidden = false;
  status.hidden = true;
}

async function initialize() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    status.textContent = "That public profile link isn't valid.";
    return;
  }
  if (!isBackendConfigured()) {
    status.textContent = "Public profiles need the shared TRGGA service to be connected.";
    return;
  }
  try {
    const backend = await getBackend();
    const { data, error } = await backend.rpc("get_public_profile", { p_profile_id: id });
    if (error) throw error;
    if (!data) throw new Error("This member has not opted into public discovery.");
    document.title = `${data.display_name} — TRGGA`;
    render(data);
  } catch (error) {
    console.error("Could not load the public member profile.", error);
    status.textContent = error.message.includes("profile_not_found_or_private")
      ? "This member's profile is private or no longer available."
      : `This profile couldn't load: ${error.message}`;
  }
}

initialize();
