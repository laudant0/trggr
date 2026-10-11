import { getBackend, isBackendConfigured } from "./backend.js";

const form = document.querySelector("#create-poll-form");
const questionInput = document.querySelector("#question");
const questionCount = document.querySelector("#question-count");
const note = document.querySelector("#form-note");
const modeNote = document.querySelector("#create-mode-note");
const categorySelect = form.elements.namedItem("category");
const choiceInputs = document.querySelector("#choice-inputs");
const addChoiceButton = document.querySelector("#add-choice");
let backend;
let userId = null;

function fillCategories(categories) {
  const selected = categorySelect.value;
  categorySelect.replaceChildren(...categories.map((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    return option;
  }));
  if (categories.includes(selected)) categorySelect.value = selected;
}

questionInput.addEventListener("input", () => {
  questionCount.textContent = `${questionInput.value.length} / 110`;
});

function saveDraft() {
  try {
    localStorage.setItem("trggr-poll-draft-v1", JSON.stringify({
        question: questionInput.value,
        options: [...form.querySelectorAll('input[name="options"]')].map((input) => input.value),
        category: form.elements.namedItem("category").value
    }));
  } catch (error) {
    console.warn("Could not save the poll draft before sign-in.", error);
  }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem("trggr-poll-draft-v1") || "null");
    if (!draft) return;
    questionInput.value = draft.question || "";
    (draft.options || []).slice(2, 4).forEach(() => addChoice());
    [...form.querySelectorAll('input[name="options"]')].forEach((input, index) => {
      input.value = draft.options?.[index] || "";
    });
    categorySelect.value = draft.category || categorySelect.value;
    questionCount.textContent = `${questionInput.value.length} / 110`;
  } catch (error) {
    console.warn("Could not restore the saved poll draft.", error);
  }
}

function addChoice(value = "") {
  const currentInputs = [...choiceInputs.querySelectorAll('input[name="options"]')];
  if (currentInputs.length >= 4) return;
  const nextNumber = currentInputs.length + 1;
  const label = document.createElement("label");
  label.htmlFor = `option-${nextNumber}`;
  label.append(document.createTextNode(`Option ${nextNumber}`));
  const input = document.createElement("input");
  input.id = `option-${nextNumber}`;
  input.name = "options";
  input.maxLength = 40;
  input.required = true;
  input.placeholder = `Option ${nextNumber}`;
  input.value = value;
  label.append(input);
  choiceInputs.append(label);
  updateChoiceControls();
}

function updateChoiceControls() {
  const inputs = [...choiceInputs.querySelectorAll('input[name="options"]')];
  addChoiceButton.disabled = inputs.length >= 4;
  inputs.forEach((input, index) => {
    const label = input.closest("label");
    const removeButton = label.querySelector(".choice-remove");
    if (inputs.length > 2 && !removeButton) {
      const remove = document.createElement("button");
      remove.className = "choice-remove";
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        label.remove();
        [...choiceInputs.querySelectorAll('input[name="options"]')].forEach((optionInput, optionIndex) => {
          optionInput.id = `option-${optionIndex + 1}`;
          optionInput.closest("label").htmlFor = optionInput.id;
          optionInput.closest("label").firstChild.textContent = `Option ${optionIndex + 1}`;
        });
        updateChoiceControls();
      });
      label.append(remove);
    } else if (inputs.length <= 2 && removeButton) {
      removeButton.remove();
    }
    label.firstChild.textContent = `Option ${index + 1}`;
  });
}

addChoiceButton.addEventListener("click", () => addChoice());

async function initialize() {
  if (!isBackendConfigured()) {
    fillCategories(window.TRGGR_CATEGORIES);
    modeNote.textContent = "LOCAL MODE: this poll stays in this browser. Sign in to publish to the shared feed.";
    return;
  }

  modeNote.textContent = "Your published poll will appear in the shared TRGGA feed.";
  try {
    backend = await getBackend();
    const { data: categories, error: categoryError } = await backend.rpc("get_public_categories");
    if (categoryError) throw categoryError;
    fillCategories(categories.map((row) => row.name));
    const { data, error } = await backend.auth.getSession();
    if (error) throw error;
    userId = data.session?.user.id || null;
    if (!userId) {
      modeNote.replaceChildren(
        document.createTextNode("Sign in is required to publish to the shared feed. "),
        Object.assign(document.createElement("a"), { href: "login.html?next=create.html", textContent: "Sign in ↗" })
      );
    } else {
      restoreDraft();
    }
    backend.auth.onAuthStateChange((_event, session) => {
      userId = session?.user.id || null;
      if (userId) restoreDraft();
    });
  } catch (error) {
    console.error("Could not connect to the poll service.", error);
    if (!categorySelect.options.length) fillCategories(window.TRGGR_CATEGORIES);
    note.textContent = `The poll service could not connect: ${error.message}. Check the backend settings and try again.`;
    form.querySelector("button[type=submit]").disabled = true;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(form);
  const question = String(values.get("question") || "").trim();
  const options = values.getAll("options").map((option) => String(option).trim());
  const category = String(values.get("category") || "");

  if (!question || options.length < 2 || options.some((option) => !option)) {
    note.textContent = "Add a question and at least two complete options.";
    return;
  }
  if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
    note.textContent = "Make every option different so the room can choose clearly.";
    return;
  }

  if (isBackendConfigured()) {
    if (!backend) {
      note.textContent = "The shared poll service isn't connected yet. Reload the page to retry.";
      return;
    }
    if (!userId) {
      saveDraft();
      window.location.href = "login.html?next=create.html";
      return;
    }

    const submitButton = form.querySelector("button[type=submit]");
    submitButton.disabled = true;
    note.textContent = "Publishing your poll…";
    try {
      const { error } = await backend.rpc("create_poll_with_options", {
        p_question: question,
        p_category: category,
        p_options: options
      });
      if (error) throw error;
      localStorage.removeItem("trggr-poll-draft-v1");
      window.location.href = "index.html#polls";
    } catch (error) {
      console.error("Could not publish the poll.", error);
      note.textContent = `Your poll couldn't be published: ${error.message}`;
      submitButton.disabled = false;
    }
    return;
  }

  try {
    const key = "trggr-polls-v1";
    const savedPolls = localStorage.getItem(key);
    const polls = savedPolls ? JSON.parse(savedPolls) : JSON.parse(JSON.stringify(window.TRGGR_SEED_POLLS));
    polls.unshift({
      id: `community-${Date.now()}`,
      category,
      question,
      choices: options,
      votes: options.map(() => 0),
      tag: "COMMUNITY QUESTION",
      creator: "you",
      time: "JUST NOW"
    });
    localStorage.setItem(key, JSON.stringify(polls));
    window.location.href = "index.html#polls";
  } catch (error) {
    console.error("Could not save your local poll.", error);
    note.textContent = "Couldn't save this poll in this browser. Check your browser storage settings and try again.";
  }
});

initialize();
