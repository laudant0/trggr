import { getBackend, isBackendConfigured } from "./backend.js";
import { avatarUrl, loadAvatarPaths } from "./avatar.js";

const memberGrid = document.querySelector("#member-grid");
const searchInput = document.querySelector("#member-search");
const moreButton = document.querySelector("#member-more");
const memberStatus = document.querySelector("#member-status");
const PAGE_SIZE = 12;
let backend;
let requestNumber = 0;
let offset = 0;
let activeQuery = "";

function profileInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "%";
}

function renderMembers(profiles, append = false) {
  if (!profiles.length) {
    if (append) return;
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = searchInput.value.trim()
      ? "No public profiles matched. Try another name or search."
      : "No one has opted into discovery yet. Turn on profile discovery in your profile settings to be found here.";
    memberGrid.replaceChildren(empty);
    return;
  }

  const cards = profiles.map((profile) => {
    const card = document.createElement("a");
    card.className = "member-card";
    card.href = `member.html?id=${encodeURIComponent(profile.id)}`;
    const avatar = document.createElement("span");
    avatar.className = "member-avatar";
    if (profile.avatar_path || profile.avatar_url) {
      const image = document.createElement("img");
      image.src = profile.avatar_path ? avatarUrl(backend, profile.avatar_path) : profile.avatar_url;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => { avatar.textContent = profileInitials(profile.display_name); }, { once: true });
      avatar.append(image);
    } else {
      avatar.textContent = profileInitials(profile.display_name);
    }
    const identity = document.createElement("span");
    identity.className = "member-identity";
    const name = document.createElement("strong");
    name.textContent = profile.display_name;
    const bio = document.createElement("span");
    bio.className = "member-bio";
    bio.textContent = profile.bio || "In the room, shaping the conversation.";
    const stats = document.createElement("span");
    stats.className = "member-stats";
    stats.textContent = `${Number(profile.polls_created).toLocaleString()} POLLS · ${Number(profile.votes_received).toLocaleString()} VOTES RECEIVED`;
    identity.append(name, bio, stats);
    const arrow = document.createElement("span");
    arrow.className = "member-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    card.append(avatar, identity, arrow);
    return card;
  });
  if (append) memberGrid.append(...cards);
  else memberGrid.replaceChildren(...cards);
}

async function loadMembers(query = "", append = false) {
  const currentRequest = ++requestNumber;
  if (!append) {
    activeQuery = query.trim();
    offset = 0;
    moreButton.hidden = true;
    memberGrid.replaceChildren(Object.assign(document.createElement("p"), {
      className: "profile-empty",
      textContent: "Finding the people behind the polls…"
    }));
  }
  moreButton.disabled = true;
  memberStatus.hidden = true;
  try {
    const { data, error } = await backend.rpc("get_discoverable_profiles_page", {
      p_search: activeQuery || null,
      p_offset: offset
    });
    if (error) throw error;
    if (currentRequest === requestNumber) {
      const profiles = (data || []).slice(0, PAGE_SIZE);
      const paths = await loadAvatarPaths(backend, profiles.map((profile) => profile.id));
      profiles.forEach((profile) => { profile.avatar_path = paths.get(profile.id) || null; });
      if (currentRequest !== requestNumber) return;
      renderMembers(profiles, append);
      offset += profiles.length;
      moreButton.hidden = (data || []).length <= PAGE_SIZE;
    }
  } catch (error) {
    if (currentRequest !== requestNumber) return;
    console.error("Could not load the member directory.", error);
    memberStatus.textContent = `Public profiles couldn't load: ${error.message}. ${append ? "Try again." : "Refresh to try again."}`;
    memberStatus.hidden = false;
    if (!append) memberGrid.replaceChildren();
  } finally {
    if (currentRequest === requestNumber) moreButton.disabled = false;
  }
}

async function loadTrending() {
  const grid = document.querySelector("#trending-grid");
  if (!grid) return;
  try {
    const { data, error } = await backend.rpc("get_public_polls");
    if (error) throw error;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = (data || []).filter((row) => new Date(row.created_at).getTime() >= weekAgo);
    const ranked = (recent.length ? recent : data || []).map((row) => ({
      row,
      total: (Array.isArray(row.options) ? row.options : []).reduce((sum, option) => sum + Number(option.votes || 0), 0)
    })).sort((a, b) => b.total - a.total).slice(0, 4);
    if (!ranked.length) {
      grid.replaceChildren(Object.assign(document.createElement("p"), { className: "profile-empty", textContent: "No polls yet. Be the first to start one." }));
      return;
    }
    grid.replaceChildren(...ranked.map(({ row, total }, index) => {
      const card = document.createElement("a");
      card.className = "member-card";
      card.href = `index.html?poll=${encodeURIComponent(row.id)}`;
      const rank = document.createElement("span");
      rank.className = "member-avatar";
      rank.textContent = `#${index + 1}`;
      const identity = document.createElement("span");
      identity.className = "member-identity";
      const title = document.createElement("strong");
      title.textContent = row.question;
      const meta = document.createElement("span");
      meta.className = "member-stats";
      meta.textContent = `${total.toLocaleString()} VOTES · ${String(row.category || "").toUpperCase()}`;
      identity.append(title, meta);
      card.append(rank, identity);
      return card;
    }));
  } catch (error) {
    console.error("Could not load trending polls.", error);
    grid.replaceChildren(Object.assign(document.createElement("p"), { className: "profile-empty", textContent: "Popular polls are unavailable right now." }));
  }
}

document.querySelector("#share-trending")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const payload = { title: "Popular This Week on Trgga", text: "See what the room is voting on this week.", url: `${window.location.origin}${window.location.pathname}#trending` };
  try {
    if (navigator.share) await navigator.share(payload);
    else {
      await navigator.clipboard.writeText(`${payload.text} ${payload.url}`);
      button.textContent = "Link Copied ✓";
      window.setTimeout(() => { button.textContent = "Share This Week ↗"; }, 3000);
    }
  } catch (error) {
    if (error.name !== "AbortError") console.error("Could not share.", error);
  }
});

async function initializeDirectory() {
  if (!isBackendConfigured()) {
    memberGrid.replaceChildren(Object.assign(document.createElement("p"), {
      className: "profile-empty",
      textContent: "Public member discovery will appear here when the shared Supabase project is connected."
    }));
    return;
  }
  try {
    backend = await getBackend();
    await loadMembers();
    loadTrending();
  } catch (error) {
    console.error("Could not connect to public member discovery.", error);
    memberGrid.replaceChildren(Object.assign(document.createElement("p"), {
      className: "category-load-error",
      role: "status",
      textContent: `Public profiles couldn't load: ${error.message}.`
    }));
  }
}

let searchTimer;
searchInput.addEventListener("input", () => {
  requestNumber++;
  moreButton.hidden = true;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    if (backend) loadMembers(searchInput.value);
  }, 250);
});

moreButton.addEventListener("click", () => loadMembers(activeQuery, true));

initializeDirectory();
