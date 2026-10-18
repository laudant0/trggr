import { getBackend, isBackendConfigured } from "./backend.js";

(() => {
  const storageKey = "trggr-polls-v1";
  const voteKey = "trggr-votes-v1";
  const grid = document.querySelector("#poll-grid");
  if (!grid) return;

  const status = document.querySelector("#backend-status");
  const getStored = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn(`Could not read ${key} from local storage.`, error);
      return fallback;
    }
  };
  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`Could not save ${key} to local storage.`, error);
    }
  };

  let polls = [];
  let voted = {};
  let userId = null;
  let pins = new Set();
  let takes = new Map();
  let loading = false;
  let category = new URLSearchParams(window.location.search).get("category") || "All";
  const sharedPollId = new URLSearchParams(window.location.search).get("poll");
  let query = "";
  let sortMode = "newest";
  let backend;
  const selectedFilter = document.querySelector(`[data-category="${CSS.escape(category)}"]`);
  if (selectedFilter) {
    document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === selectedFilter));
  }

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function setStatus(message, mode = "info") {
    status.hidden = false;
    status.dataset.mode = mode;
    status.querySelector(".backend-message").textContent = message;
    status.querySelector("a").hidden = Boolean(backend && userId);
  }

  function setCategories(categories) {
    const allButton = document.querySelector('[data-category="All"]');
    const buttons = categories.map((name) => {
      const button = el("button", `filter-chip${name.toLowerCase() === category.toLowerCase() ? " active" : ""}`, name);
      button.type = "button";
      button.dataset.category = name;
      return button;
    });
    allButton.classList.toggle("active", category === "All");
    document.querySelector("#filters").replaceChildren(allButton, ...buttons);
  }

  function displayDemoPolls() {
    setCategories(window.TRGGR_CATEGORIES);
    let stored = getStored(storageKey, null);
    if (!Array.isArray(stored)) {
      stored = JSON.parse(JSON.stringify(window.TRGGR_SEED_POLLS));
      save(storageKey, stored);
    } else {
      const existingIds = new Set(stored.filter((poll) => poll && typeof poll.id === "string").map((poll) => poll.id));
      const newPolls = window.TRGGR_SEED_POLLS.filter((poll) => !existingIds.has(poll.id));
      if (newPolls.length) {
        stored.push(...JSON.parse(JSON.stringify(newPolls)));
        save(storageKey, stored);
      }
    }
    polls = stored;
    voted = getStored(voteKey, {});
    setStatus("LOCAL MODE — polls and votes stay in this browser. Sign in to use the shared TRGGA feed.", "demo");
  }

  function mapPoll(row) {
    const options = Array.isArray(row.options) ? row.options : [];
    return {
      id: row.id,
      category: row.category,
      question: row.question,
      tag: row.tag,
      creator: row.creator,
      time: new Date(row.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
      optionIds: options.map((option) => option.id),
      choices: options.map((option) => option.label),
      images: options.map((option) => option.image_path
        ? backend.storage.from("poll-option-images").getPublicUrl(option.image_path).data.publicUrl
        : null),
      votes: options.map((option) => Number(option.votes)),
      votedPosition: row.my_option_position === null ? null : Number(row.my_option_position),
      closesAt: row.closes_at ? new Date(row.closes_at).getTime() : null,
      official: Boolean(row.official)
    };
  }

  let featuredTimer = null;

  function isFeatured(poll) {
    return poll.official && !(poll.closesAt && poll.closesAt <= Date.now());
  }

  function updateStats() {
    const stats = document.querySelector("#live-stats");
    if (!stats) return;
    const votes = polls.reduce((sum, poll) => sum + poll.votes.reduce((a, b) => a + b, 0), 0);
    stats.textContent = polls.length ? `${polls.length} polls live · ${votes.toLocaleString()} votes cast` : "";
  }

  function syncFeaturedDots() {
    const track = document.querySelector("#featured-track");
    const dots = document.querySelectorAll("#featured-dots .featured-dot");
    const active = track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : 0;
    dots.forEach((dot, index) => dot.classList.toggle("active", index === active));
  }

  function renderFeatured(featured) {
    const box = document.querySelector("#featured");
    const track = document.querySelector("#featured-track");
    const dots = document.querySelector("#featured-dots");
    box.hidden = !featured.length;
    const position = track.scrollLeft;
    track.replaceChildren(...featured.map((poll) => {
      const slide = el("div", "featured-slide");
      slide.append(renderPoll(poll));
      return slide;
    }));
    track.scrollLeft = position;
    dots.replaceChildren(...featured.map((poll, index) => {
      const dot = el("button", "featured-dot");
      dot.type = "button";
      dot.setAttribute("aria-label", `Show official poll ${index + 1}`);
      dot.addEventListener("click", () => track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" }));
      return dot;
    }));
    dots.hidden = featured.length < 2;
    syncFeaturedDots();
    if (!track.dataset.ready) {
      track.dataset.ready = "1";
      track.addEventListener("scroll", syncFeaturedDots, { passive: true });
      ["pointerenter", "focusin", "touchstart"].forEach((name) => box.addEventListener(name, () => { box.dataset.paused = "1"; }, { passive: true }));
      ["pointerleave", "focusout", "touchend"].forEach((name) => box.addEventListener(name, () => { delete box.dataset.paused; }, { passive: true }));
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        featuredTimer = window.setInterval(() => {
          const count = track.children.length;
          if (count < 2 || box.dataset.paused || document.hidden) return;
          const next = (Math.round(track.scrollLeft / track.clientWidth) + 1) % count;
          track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
        }, 6000);
      }
    }
  }
  async function refreshPolls() {
    if (!backend || loading) return;
    loading = true;
    try {
      const { data, error } = await backend.rpc("get_public_polls");
      if (error) throw error;
      const { data: links } = await backend.rpc("get_poll_creator_links");
      const creatorByPoll = new Map((links || []).map((link) => [link.poll_id, link.creator_id]));
      if (userId) {
        const { data: pinRows } = await backend.rpc("get_my_pins");
        pins = new Set((pinRows || []).map((row) => row.poll_id));
      } else {
        pins = new Set();
      }
      polls = (data || []).map(mapPoll);
      polls.forEach((poll) => { poll.creatorId = creatorByPoll.get(poll.id) || null; });
      voted = {};
      polls.forEach((poll) => {
        if (poll.votedPosition !== null) voted[poll.id] = poll.votedPosition;
      });
      await loadTakes(polls.filter((poll) => isTakesVisible(poll)).map((poll) => poll.id));
      updateStats();
      const typing = [...document.querySelectorAll("#poll-grid .take-input, #featured-track .take-input")].some((input) => input.value.trim() || input === document.activeElement);
      if (!typing) render();
      if (sharedPollId) {
        const targetPoll = polls.find((poll) => poll.id === sharedPollId);
        if (targetPoll) {
          category = targetPoll.category;
          document.querySelectorAll(".filter-chip").forEach((chip) => {
            chip.classList.toggle("active", chip.dataset.category.toLowerCase() === category.toLowerCase());
          });
          render();
          document.getElementById(`poll-${targetPoll.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      status.hidden = true;
    } catch (error) {
      console.error("Could not load the shared poll feed.", error);
      setStatus(`The shared feed could not load: ${error.message}. Refresh to try again.`, "error");
    } finally {
      loading = false;
    }
  }

  function isTakesVisible(poll) {
    const closed = Boolean(poll.closesAt) && poll.closesAt <= Date.now();
    return closed || (poll.votedPosition !== undefined && poll.votedPosition !== null);
  }

  async function loadTakes(ids) {
    if (!backend || !ids.length) return;
    const { data, error } = await backend.rpc("get_takes", { p_poll_ids: ids.slice(0, 60) });
    if (error) {
      console.error("Could not load takes.", error);
      return;
    }
    ids.forEach((id) => takes.delete(id));
    (data || []).forEach((row) => {
      if (!takes.has(row.poll_id)) takes.set(row.poll_id, []);
      takes.get(row.poll_id).push(row);
    });
  }

  function renderTakes(poll) {
    const wrap = el("div", "takes");
    wrap.dataset.poll = poll.id;
    const rows = takes.get(poll.id) || [];
    const closed = Boolean(poll.closesAt) && poll.closesAt <= Date.now();
    const hasVoted = poll.votedPosition !== undefined && poll.votedPosition !== null;
    if (rows.length) {
      wrap.append(el("span", "takes-label", "TOP TAKES · MOST AGREED FIRST"));
      rows.forEach((row) => {
        const item = el("div", `take${row.mine ? " mine" : ""}`);
        const body = el("p", "take-body", `“${row.body}”`);
        const meta = el("div", "take-meta");
        if (row.author_id && !row.mine) {
          const link = el("a", "take-author", row.author_name);
          link.href = `member.html?id=${encodeURIComponent(row.author_id)}`;
          meta.append(link);
        } else {
          meta.append(el("span", "take-author", row.mine ? "YOU" : row.author_name));
        }
        if (row.mine) {
          const remove = el("button", "take-delete", "DELETE");
          remove.type = "button";
          remove.dataset.poll = poll.id;
          meta.append(remove);
        } else if (userId) {
          const agree = el("button", `take-agree${row.i_agreed ? " agreed" : ""}`, `AGREE · ${row.agrees}`);
          agree.type = "button";
          agree.dataset.take = row.take_id;
          agree.dataset.poll = poll.id;
          agree.setAttribute("aria-pressed", String(row.i_agreed));
          meta.append(agree);
        } else {
          meta.append(el("span", "take-count", `${row.agrees} AGREE`));
        }
        if (row.mine) meta.append(el("span", "take-count", `${row.agrees} AGREE`));
        item.append(body, meta);
        wrap.append(item);
      });
    }
    if (hasVoted && !rows.some((row) => row.mine)) {
      const form = el("form", "take-form");
      form.dataset.poll = poll.id;
      const input = document.createElement("input");
      input.className = "take-input";
      input.maxLength = 100;
      input.placeholder = "Add your take in one line…";
      input.setAttribute("aria-label", "Your take");
      const submit = el("button", "button button-lime button-small", "Post");
      submit.type = "submit";
      form.append(input, submit, el("span", "take-message"));
      wrap.append(form);
    } else if (!rows.length && closed) {
      wrap.append(el("span", "takes-label", "NO TAKES YET"));
    }
    return wrap;
  }

  async function refreshTakesFor(pollId) {
    await loadTakes([pollId]);
    const poll = polls.find((item) => item.id === pollId);
    const current = document.querySelector(`#poll-grid .takes[data-poll="${CSS.escape(pollId)}"], #featured-track .takes[data-poll="${CSS.escape(pollId)}"]`);
    if (poll && current) current.replaceWith(renderTakes(poll));
  }

  function timeLeft(closesAt) {
    const ms = closesAt - Date.now();
    if (ms <= 0) return null;
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `${minutes}M LEFT`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}H LEFT`;
    return `${Math.floor(hours / 24)}D LEFT`;
  }

  function renderPoll(poll) {
    const card = el("article", "poll-card");
    card.id = `poll-${poll.id}`;
    const top = el("div", "poll-card-top");
    const closed = Boolean(poll.closesAt) && poll.closesAt <= Date.now();
    const remaining = poll.closesAt ? timeLeft(poll.closesAt) : null;
    const labelWrap = el("span", "poll-label-wrap");
    labelWrap.append(el("span", "poll-label", poll.tag || `${poll.category.toUpperCase()} CHECK`));
    if (poll.official) labelWrap.append(el("span", "official-badge", "OFFICIAL"));
    if (closed) labelWrap.append(el("span", "timer-badge closed", "CLOSED"));
    else if (remaining) labelWrap.append(el("span", "timer-badge", remaining));
    top.append(labelWrap, el("span", "category-label", poll.category.toUpperCase()));

    const title = el("h3", "poll-question", poll.question);
    const meta = el("p", "poll-meta");
    if (poll.creatorId) {
      const creatorLink = el("a", "poll-creator-link", poll.creator);
      creatorLink.href = `member.html?id=${encodeURIComponent(poll.creatorId)}`;
      meta.append(creatorLink, document.createTextNode(`  ·  ${poll.time || "JUST NOW"}`));
    } else {
      meta.textContent = `${poll.creator || "TRGGA community"}  ·  ${poll.time || "JUST NOW"}`;
    }
    const options = el("div", "poll-options");
    const total = poll.votes.reduce((sum, count) => sum + count, 0);
    const votedPosition = poll.votedPosition === undefined ? voted[poll.id] : poll.votedPosition;

    poll.choices.forEach((choice, index) => {
      const percent = total ? Math.round((poll.votes[index] / total) * 100) : 0;
      const selected = votedPosition === index;
      const hasVoted = votedPosition !== undefined && votedPosition !== null;
      const button = el("button", `poll-option${selected ? " selected" : ""}${hasVoted || closed ? " show-results" : ""}`);
      button.type = "button";
      button.dataset.poll = poll.id;
      button.dataset.option = String(index);
      button.disabled = hasVoted || closed;
      button.setAttribute("aria-pressed", String(selected));
      const optionTop = el("span", "option-top");
      optionTop.append(el("span", "option-name", choice), el("span", "option-percent", `${percent}%`));
      const content = el("span", "option-content");
      content.append(optionTop);
      const imageUrl = poll.images?.[index];
      if (imageUrl) {
        const image = el("img", "option-image");
        image.src = imageUrl;
        image.alt = `${choice} option`;
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        content.prepend(image);
      }
      const track = el("span", "option-track");
      const fill = el("span", "option-fill");
      fill.style.width = hasVoted || closed ? `${percent}%` : "0%";
      track.append(fill);
      button.append(content, track);
      options.append(button);
    });

    const footer = el("div", "poll-card-footer");
    footer.append(
      el("span", "vote-count", `${total.toLocaleString()} ${backend ? "VOTES" : "LOCAL VOTES"}`),
      el("span", "vote-hint", closed ? "VOTING CLOSED" : votedPosition !== undefined && votedPosition !== null ? "YOUR VOTE IS IN ✓" : backend && !userId ? "SIGN IN TO VOTE ↗" : "PICK A SIDE ↗")
    );
    if (backend) {
      const pinned = pins.has(poll.id);
      const pin = el("button", `poll-pin${pinned ? " pinned" : ""}`, pinned ? "PINNED ✓" : "PIN");
      pin.type = "button";
      pin.dataset.pin = poll.id;
      pin.setAttribute("aria-pressed", String(pinned));
      footer.append(pin);

    }
    card.append(top, title, meta, options);
    if (votedPosition !== undefined && votedPosition !== null) {
      const share = el("div", "poll-share");
      const resultSummary = poll.choices
        .map((choice, index) => `${choice}: ${total ? Math.round((poll.votes[index] / total) * 100) : 0}%`)
        .join(" · ");
      const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      const url = new URL(isLocal ? `index.html?poll=${encodeURIComponent(poll.id)}#polls` : `p/${encodeURIComponent(poll.id)}`, window.location.href).href;
      const shareText = `I voted "${poll.choices[votedPosition]}" on TRGGA: ${poll.question} — ${resultSummary}`;
      const shareButton = el("button", "poll-share-native", "Share my take ↗");
      shareButton.type = "button";
      shareButton.setAttribute("aria-label", "Share this vote using your device's sharing options, including Instagram when available");
      shareButton.dataset.shareTitle = poll.question;
      shareButton.dataset.shareText = shareText;
      shareButton.dataset.shareUrl = url;
      const xLink = el("a", "poll-share-link", "X");
      xLink.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;
      xLink.target = "_blank";
      xLink.rel = "noopener noreferrer";
      xLink.setAttribute("aria-label", "Share your vote on X");
      const whatsappLink = el("a", "poll-share-link", "WhatsApp");
      whatsappLink.href = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`;
      whatsappLink.target = "_blank";
      whatsappLink.rel = "noopener noreferrer";
      whatsappLink.setAttribute("aria-label", "Share your vote on WhatsApp");
      const instagramButton = el("button", "poll-share-link", "Instagram");
      instagramButton.type = "button";
      instagramButton.dataset.shareTitle = poll.question;
      instagramButton.dataset.shareText = shareText;
      instagramButton.dataset.shareUrl = url;
      instagramButton.dataset.instagram = "true";
      instagramButton.setAttribute("aria-label", "Copy your vote and open Instagram to share it");
      share.append(shareButton, xLink, whatsappLink, instagramButton);
      card.append(share);
    }
    if (backend && isTakesVisible(poll)) card.append(renderTakes(poll));
    card.append(footer);
    return card;
  }

  function render() {
    updateStats();
    const visible = polls.filter((poll) => {
      const matchesCategory = category === "All" || poll.category.toLowerCase() === category.toLowerCase();
      const matchesQuery = `${poll.question} ${poll.category} ${poll.creator || ""}`.toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
    const now = Date.now();
    if (sortMode === "trending") {
      visible.sort((a, b) => b.votes.reduce((s, c) => s + c, 0) - a.votes.reduce((s, c) => s + c, 0));
    } else if (sortMode === "closing") {
      const open = visible.filter((poll) => poll.closesAt && poll.closesAt > now).sort((a, b) => a.closesAt - b.closesAt);
      visible.length = 0;
      visible.push(...open);
    }
    const showFeatured = category === "All" && !query && sortMode !== "closing";
    const featured = showFeatured ? visible.filter(isFeatured).slice(0, 6) : [];
    const featuredIds = new Set(featured.map((poll) => poll.id));
    renderFeatured(featured);
    grid.replaceChildren(...visible.filter((poll) => !featuredIds.has(poll.id)).map(renderPoll));
    document.querySelector("#empty-state").hidden = visible.length > 0;
    document.querySelector("#poll-count").textContent = String(visible.length).padStart(2, "0");
  }

  document.querySelector("#filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    category = button.dataset.category;
    document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
    render();
  });

  document.querySelector("#poll-sort")?.addEventListener("change", (event) => {
    sortMode = event.target.value;
    render();
  });

  document.querySelector("#poll-search").addEventListener("input", (event) => {
    query = event.target.value.trim().toLowerCase();
    render();
  });

  [grid, document.querySelector("#featured-track")].forEach((root) => root.addEventListener("click", async (event) => {
    const instagramShare = event.target.closest("[data-instagram]");
    if (instagramShare) {
      const label = "Instagram";
      try {
        await navigator.clipboard.writeText(`${instagramShare.dataset.shareText} ${instagramShare.dataset.shareUrl}`);
        instagramShare.textContent = "Copied ✓ opening Instagram…";
      } catch (error) {
        instagramShare.textContent = "Opening Instagram…";
      }
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      window.setTimeout(() => {
        if (mobile) window.location.href = "instagram://app";
        else window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
        instagramShare.textContent = "Paste in your Story or DM";
        window.setTimeout(() => { instagramShare.textContent = label; }, 4000);
      }, 400);
      return;
    }
    const shareButton = event.target.closest(".poll-share-native, .poll-share-link[data-share-url]");
    if (shareButton) {
      const payload = {
        title: shareButton.dataset.shareTitle,
        text: shareButton.dataset.shareText,
        url: shareButton.dataset.shareUrl
      };
      try {
        if (navigator.share) {
          await navigator.share(payload);
        } else {
          await navigator.clipboard.writeText(`${payload.text} ${payload.url}`);
          shareButton.textContent = "Copied — paste into Instagram ✓";
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Could not share the poll result.", error);
          shareButton.textContent = "Sharing unavailable";
        }
      }
      return;
    }
    const agreeButton = event.target.closest(".take-agree");
    if (agreeButton) {
      agreeButton.disabled = true;
      const { error } = await backend.rpc("toggle_take_agree", { p_take_id: agreeButton.dataset.take });
      if (error) setStatus(error.message, "error");
      await refreshTakesFor(agreeButton.dataset.poll);
      return;
    }
    const deleteTake = event.target.closest(".take-delete");
    if (deleteTake) {
      deleteTake.disabled = true;
      const { error } = await backend.rpc("delete_my_take", { p_poll_id: deleteTake.dataset.poll });
      if (error) setStatus(error.message, "error");
      await refreshTakesFor(deleteTake.dataset.poll);
      return;
    }
    const pinButton = event.target.closest(".poll-pin");
    if (pinButton) {
      if (!userId) {
        window.location.href = "login.html?next=index.html%23polls";
        return;
      }
      pinButton.disabled = true;
      try {
        const { data, error } = await backend.rpc("toggle_pin", { p_poll_id: pinButton.dataset.pin });
        if (error) throw error;
        if (data) pins.add(pinButton.dataset.pin);
        else pins.delete(pinButton.dataset.pin);
        render();
      } catch (error) {
        console.error("Could not update the pin.", error);
        setStatus(`Couldn't update your pin: ${error.message}`, "error");
        pinButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest(".poll-option");
    if (!button || button.disabled) return;
    const poll = polls.find((item) => item.id === button.dataset.poll);
    const optionIndex = Number(button.dataset.option);
    if (!poll || !Number.isInteger(optionIndex) || !poll.choices[optionIndex]) return;

    if (!backend) {
      poll.votes[optionIndex] += 1;
      voted[poll.id] = optionIndex;
      save(storageKey, polls);
      save(voteKey, voted);
      render();
      return;
    }

    if (!userId) {
      window.location.href = "login.html?next=index.html%23polls";
      return;
    }

    button.disabled = true;
    try {
      const { data, error } = await backend.rpc("vote_on_poll", {
        p_poll_id: poll.id,
        p_option_id: poll.optionIds[optionIndex]
      });
      if (error) throw error;
      if (!data.recorded) {
        setStatus("You've already voted in this poll. One account, one vote.", "info");
      }
      await refreshPolls();
    } catch (error) {
      console.error("Could not submit the vote.", error);
      setStatus(`Your vote wasn't recorded: ${error.message}. Try again.`, "error");
      button.disabled = false;
    }
  }));

  [grid, document.querySelector("#featured-track")].forEach((root) => root.addEventListener("submit", async (event) => {
    const takeForm = event.target.closest(".take-form");
    if (takeForm) {
      event.preventDefault();
      const input = takeForm.querySelector(".take-input");
      const message = takeForm.querySelector(".take-message");
      const submit = takeForm.querySelector("button[type=submit]");
      if (!input.value.trim()) return;
      submit.disabled = true;
      const { error } = await backend.rpc("post_take", { p_poll_id: takeForm.dataset.poll, p_body: input.value });
      if (error) {
        message.textContent = error.message;
        submit.disabled = false;
        return;
      }
      input.value = "";
      await refreshTakesFor(takeForm.dataset.poll);
      return;
    }
  }));

  async function initialize() {
    if (!isBackendConfigured()) {
      displayDemoPolls();
      render();
      return;
    }

    setStatus("Connecting to the shared TRGGA database…", "info");
    try {
      backend = await getBackend();
      const { data: categories, error: categoryError } = await backend.rpc("get_public_categories");
      if (categoryError) throw categoryError;
      setCategories(categories.map((row) => row.name));
      const { data, error } = await backend.auth.getSession();
      if (error) throw error;
      userId = data.session?.user.id || null;
      await refreshPolls();
      backend.auth.onAuthStateChange((_event, session) => {
        userId = session?.user.id || null;
        refreshPolls();
      });
      window.addEventListener("focus", refreshPolls);
      window.setInterval(() => {
        if (document.visibilityState === "visible") refreshPolls();
      }, 20000);
    } catch (error) {
      console.error("Could not connect to the shared TRGGA backend.", error);
      setStatus(`The shared backend could not connect: ${error.message}. Check auth-config.js and your database migration.`, "error");
    }
  }

  initialize();
})();
