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
  let loading = false;
  let category = new URLSearchParams(window.location.search).get("category") || "All";
  let query = "";
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
    setStatus("DEMO MODE — polls and votes are saved only in this browser. Set up Supabase to go live.", "demo");
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
      votes: options.map((option) => Number(option.votes)),
      votedPosition: row.my_option_position === null ? null : Number(row.my_option_position)
    };
  }

  function updateDailyPulse() {
    const dailyPoll = polls.find((poll) => poll.tag === "THE DAILY PULSE");
    if (!dailyPoll) return;
    const total = dailyPoll.votes.reduce((sum, count) => sum + count, 0);
    const firstPercent = total ? Math.round((dailyPoll.votes[0] / total) * 100) : 0;
    const question = document.querySelector("#daily-pulse-question");
    const label = document.querySelector("#daily-pulse-label");
    const result = document.querySelector("#daily-pulse-result");
    const majority = document.querySelector("#daily-pulse-majority");
    const fill = document.querySelector("#daily-pulse-fill");
    const firstOption = document.querySelector("#daily-pulse-option-one");
    const secondOption = document.querySelector("#daily-pulse-option-two");
    const words = dailyPoll.question.trim().split(/\s+/);
    const finalWord = el("span", "serif-italic", words.pop() || "");
    question.replaceChildren(document.createTextNode(`${words.join(" ")} `), finalWord);
    label.textContent = total ? "THE ROOM SAYS" : "WAITING ON FIRST VOTE";
    result.textContent = total ? `${firstPercent}%` : "—";
    majority.textContent = total ? dailyPoll.choices[firstPercent >= 50 ? 0 : 1] : "NO VOTES";
    fill.style.width = `${firstPercent}%`;
    firstOption.textContent = dailyPoll.choices[0];
    secondOption.textContent = dailyPoll.choices[1];
  }

  async function refreshPolls() {
    if (!backend || loading) return;
    loading = true;
    try {
      const { data, error } = await backend.rpc("get_public_polls");
      if (error) throw error;
      polls = (data || []).map(mapPoll);
      voted = {};
      polls.forEach((poll) => {
        if (poll.votedPosition !== null) voted[poll.id] = poll.votedPosition;
      });
      updateDailyPulse();
      render();
      setStatus("LIVE MODE — shared polls and verified votes are connected.", "live");
    } catch (error) {
      console.error("Could not load the shared poll feed.", error);
      setStatus(`The shared feed could not load: ${error.message}. Refresh to try again.`, "error");
    } finally {
      loading = false;
    }
  }

  function renderPoll(poll) {
    const card = el("article", "poll-card");
    const top = el("div", "poll-card-top");
    top.append(
      el("span", "poll-label", poll.tag || `${poll.category.toUpperCase()} CHECK`),
      el("span", "category-label", poll.category.toUpperCase())
    );

    const title = el("h3", "poll-question", poll.question);
    const meta = el("p", "poll-meta", `${poll.creator || "TRGGA community"}  ·  ${poll.time || "JUST NOW"}`);
    const options = el("div", "poll-options");
    const total = poll.votes.reduce((sum, count) => sum + count, 0);
    const votedPosition = poll.votedPosition === undefined ? voted[poll.id] : poll.votedPosition;

    poll.choices.forEach((choice, index) => {
      const percent = total ? Math.round((poll.votes[index] / total) * 100) : 0;
      const selected = votedPosition === index;
      const hasVoted = votedPosition !== undefined && votedPosition !== null;
      const button = el("button", `poll-option${selected ? " selected" : ""}${hasVoted ? " show-results" : ""}`);
      button.type = "button";
      button.dataset.poll = poll.id;
      button.dataset.option = String(index);
      button.disabled = hasVoted;
      button.setAttribute("aria-pressed", String(selected));
      const optionTop = el("span", "option-top");
      optionTop.append(el("span", "option-name", choice), el("span", "option-percent", `${percent}%`));
      const track = el("span", "option-track");
      const fill = el("span", "option-fill");
      fill.style.width = hasVoted ? `${percent}%` : "0%";
      track.append(fill);
      button.append(optionTop, track);
      options.append(button);
    });

    const footer = el("div", "poll-card-footer");
    footer.append(
      el("span", "vote-count", `${total.toLocaleString()} ${backend ? "VOTES" : "DEMO VOTES"}`),
      el("span", "vote-hint", votedPosition !== undefined && votedPosition !== null ? "YOUR VOTE IS IN ✓" : backend && !userId ? "SIGN IN TO VOTE ↗" : "PICK A SIDE ↗")
    );
    if (backend) {
      const report = el("details", "poll-report");
      const summary = el("summary", "", "REPORT");
      const form = document.createElement("form");
      form.className = "report-form";
      form.dataset.poll = poll.id;
      const reason = document.createElement("select");
      reason.name = "reason";
      reason.setAttribute("aria-label", "Report reason");
      [
        ["spam", "Spam"],
        ["harassment", "Harassment"],
        ["hate", "Hate or abuse"],
        ["misinformation", "Misinformation"],
        ["other", "Other"]
      ].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        reason.append(option);
      });
      const details = document.createElement("textarea");
      details.name = "details";
      details.maxLength = 500;
      details.placeholder = "Optional details";
      details.setAttribute("aria-label", "Report details");
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Send report";
      const message = el("span", "report-message");
      message.setAttribute("role", "status");
      form.append(reason, details, submit, message);
      report.append(summary, form);
      footer.append(report);
    }
    card.append(top, title, meta, options, footer);
    return card;
  }

  function render() {
    updateDailyPulse();
    const visible = polls.filter((poll) => {
      const matchesCategory = category === "All" || poll.category.toLowerCase() === category.toLowerCase();
      const matchesQuery = `${poll.question} ${poll.category} ${poll.creator || ""}`.toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
    grid.replaceChildren(...visible.map(renderPoll));
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

  document.querySelector("#poll-search").addEventListener("input", (event) => {
    query = event.target.value.trim().toLowerCase();
    render();
  });

  grid.addEventListener("click", async (event) => {
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
  });

  grid.addEventListener("submit", async (event) => {
    const form = event.target.closest(".report-form");
    if (!form) return;
    event.preventDefault();
    if (!backend) return;
    if (!userId) {
      window.location.href = "login.html?next=index.html%23polls";
      return;
    }

    const button = form.querySelector("button[type=submit]");
    const message = form.querySelector(".report-message");
    button.disabled = true;
    try {
      const { data, error } = await backend.rpc("report_poll", {
        p_poll_id: form.dataset.poll,
        p_reason: form.elements.reason.value,
        p_details: form.elements.details.value.trim() || null
      });
      if (error) throw error;
      message.textContent = data ? "Report received. Thanks for flagging it." : "You've already reported this poll.";
    } catch (error) {
      console.error("Could not submit the poll report.", error);
      message.textContent = `Report failed: ${error.message}`;
      button.disabled = false;
    }
  });

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
