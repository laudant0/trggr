import { getBackend, isBackendConfigured } from "./backend.js";
import { avatarUrl, fillAvatar, loadAvatarPaths } from "./avatar.js";

async function setupConnection(profile) {
  const avatar = document.querySelector(".member-profile-hero .profile-avatar");
  const paths = await loadAvatarPaths(backendClient, [memberId]);
  if (avatar && paths.get(memberId)) fillAvatar(avatar, profile.display_name, avatarUrl(backendClient, paths.get(memberId)));

  const { data: me } = await backendClient.auth.getSession();
  const myId = me.session?.user.id || null;
  const { data: state } = await backendClient.rpc("get_connection_state", { p_member_id: memberId });
  if (!state) return;
  const hero = document.querySelector(".member-profile-hero");
  const box = document.createElement("div");
  box.className = "connect-box";
  const counts = document.createElement("p");
  counts.className = "connect-counts";
  const note = document.createElement("span");
  note.className = "avatar-status";
  note.setAttribute("role", "status");
  const paint = () => {
    if (state.followers === null || state.followers === undefined) {
      counts.textContent = state.follows_me ? "FOLLOWS YOU" : "";
      counts.hidden = !state.follows_me;
      return;
    }
    counts.textContent = `${Number(state.followers).toLocaleString()} FOLLOWERS · ${Number(state.following).toLocaleString()} FOLLOWING${state.follows_me ? " · FOLLOWS YOU" : ""}`;
  };
  paint();
  box.append(counts);
  if (myId !== memberId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-lime button-small";
    const label = () => { button.textContent = state.i_follow ? "Following ✓" : state.follows_me ? "Follow back" : "Follow"; };
    label();
    button.addEventListener("click", async () => {
      if (!myId) {
        window.location.href = `login.html?next=${encodeURIComponent(`member.html?id=${memberId}`)}`;
        return;
      }
      button.disabled = true;
      note.textContent = "";
      const { data, error } = await backendClient.rpc("toggle_follow", { p_member_id: memberId });
      button.disabled = false;
      if (error) {
        console.error("Could not update the connection.", error);
        note.textContent = `Couldn't update: ${error.message}`;
        return;
      }
      state.i_follow = data;
      state.followers = Number(state.followers) + (data ? 1 : -1);
      label();
      paint();
    });
    const { data: blocks } = myId ? await backendClient.rpc("get_my_blocks") : { data: [] };
    const iBlocked = (blocks || []).some((row) => row.id === memberId);
    const blockButton = document.createElement("button");
    blockButton.type = "button";
    blockButton.className = "auth-signout block-button";
    blockButton.textContent = iBlocked ? "Unblock" : "Block";
    blockButton.addEventListener("click", async () => {
      if (!myId) {
        window.location.href = `login.html?next=${encodeURIComponent(`member.html?id=${memberId}`)}`;
        return;
      }
      if (!iBlocked && !window.confirm("Block this member? They will no longer see your polls or follow you, and you will not see theirs. You can unblock them from your profile.")) return;
      blockButton.disabled = true;
      const { error } = await backendClient.rpc("toggle_block", { p_member_id: memberId });
      if (error) {
        console.error("Could not update the block.", error);
        note.textContent = `Couldn't update: ${error.message}`;
        blockButton.disabled = false;
        return;
      }
      window.location.reload();
    });
    if (iBlocked) button.hidden = true;
    box.append(button, note, blockButton);
  }
  hero.append(box);
}

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
  polls.id = "member-poll-list";
  addText(polls, "p", "profile-empty", "Loading polls…");
  panel.append(polls);
  content.replaceChildren(hero, stats, panel);
  content.hidden = false;
  status.hidden = true;
}

let backendClient = null;
let memberId = null;
let signedIn = false;

function renderMemberPoll(row) {
  const options = Array.isArray(row.options) ? row.options : [];
  const total = options.reduce((sum, option) => sum + Number(option.votes), 0);
  const myPosition = row.my_option_position === null ? null : Number(row.my_option_position);
  const hasVoted = myPosition !== null;
  const card = document.createElement("article");
  card.className = "poll-card member-poll-card";
  const top = document.createElement("div");
  top.className = "poll-card-top";
  addText(top, "span", "poll-label", row.tag || `${row.category.toUpperCase()} CHECK`);
  addText(top, "span", "category-label", row.category.toUpperCase());
  const group = document.createElement("div");
  group.className = "poll-options";
  options.forEach((option) => {
    const percent = total ? Math.round((Number(option.votes) / total) * 100) : 0;
    const selected = myPosition === Number(option.position);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `poll-option${selected ? " selected" : ""}${hasVoted ? " show-results" : ""}`;
    button.disabled = hasVoted;
    button.dataset.poll = row.id;
    button.dataset.option = option.id;
    const content = document.createElement("span");
    content.className = "option-content";
    if (option.image_path) {
      const image = document.createElement("img");
      image.className = "option-image";
      image.src = backendClient.storage.from("poll-option-images").getPublicUrl(option.image_path).data.publicUrl;
      image.alt = `${option.label} option`;
      image.loading = "lazy";
      content.append(image);
    }
    const line = document.createElement("span");
    line.className = "option-top";
    addText(line, "span", "option-name", option.label);
    addText(line, "span", "option-percent", `${percent}%`);
    content.append(line);
    const track = document.createElement("span");
    track.className = "option-track";
    const fill = document.createElement("span");
    fill.className = "option-fill";
    fill.style.width = hasVoted ? `${percent}%` : "0%";
    track.append(fill);
    button.append(content, track);
    group.append(button);
  });
  const footer = document.createElement("div");
  footer.className = "poll-card-footer";
  addText(footer, "span", "vote-count", `${total.toLocaleString()} VOTES`);
  addText(footer, "span", "vote-hint", hasVoted ? "YOUR VOTE IS IN ✓" : signedIn ? "PICK A SIDE ↗" : "SIGN IN TO VOTE ↗");
  const title = document.createElement("h3");
  title.className = "poll-question";
  title.textContent = row.question;
  card.append(top, title, group, footer);
  return card;
}

async function loadMemberPolls() {
  const list = document.querySelector("#member-poll-list");
  const { data, error } = await backendClient.rpc("get_member_polls", { p_profile_id: memberId });
  if (error) {
    console.error("Could not load the member's polls.", error);
    list.replaceChildren();
    addText(list, "p", "profile-empty", "Their polls couldn't load right now.");
    return;
  }
  list.replaceChildren();
  if (!data.length) {
    addText(list, "p", "profile-empty", "No public polls yet.");
    return;
  }
  data.forEach((row) => list.append(renderMemberPoll(row)));
}

content.addEventListener("click", async (event) => {
  const button = event.target.closest(".member-poll-card .poll-option");
  if (!button || button.disabled) return;
  if (!signedIn) {
    window.location.href = `login.html?next=${encodeURIComponent(`member.html?id=${memberId}`)}`;
    return;
  }
  button.disabled = true;
  try {
    const { error } = await backendClient.rpc("vote_on_poll", {
      p_poll_id: button.dataset.poll,
      p_option_id: button.dataset.option
    });
    if (error) throw error;
    await loadMemberPolls();
  } catch (error) {
    console.error("Could not submit the vote.", error);
    button.disabled = false;
  }
});

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
    memberId = id;
    backendClient = backend;
    const { data: sessionData } = await backend.auth.getSession();
    signedIn = Boolean(sessionData.session?.user);
    await loadMemberPolls();
    await setupConnection(data);
  } catch (error) {
    console.error("Could not load the public member profile.", error);
    status.textContent = error.message.includes("profile_not_found_or_private")
      ? "This member's profile is private or no longer available."
      : `This profile couldn't load: ${error.message}`;
  }
}

initialize();
