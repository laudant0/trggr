import { getBackend, isBackendConfigured } from "./backend.js";

const form = document.querySelector("#create-poll-form");
const questionInput = document.querySelector("#question");
const questionCount = document.querySelector("#question-count");
const note = document.querySelector("#form-note");
const modeNote = document.querySelector("#create-mode-note");
const categorySelect = form.elements.namedItem("category");
const choiceInputs = document.querySelector("#choice-inputs");
const addChoiceButton = document.querySelector("#add-choice");
const imageFiles = new WeakMap();
const maxImageSize = 512 * 1024;
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

async function createThumbnail(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 10 MB. It will be resized to a thumbnail.");
  }

  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 20_000_000) {
    bitmap.close();
    throw new Error("That image has too many pixels to safely resize. Try a smaller original.");
  }
  const scale = Math.min(1, 640 / bitmap.width, 420 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Your browser couldn't prepare this image.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.82, 0.68, 0.52, 0.38]) {
    const thumbnail = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (!thumbnail || thumbnail.type !== "image/webp") {
      throw new Error("Your browser couldn't convert this image. Try another image.");
    }
    if (thumbnail.size <= maxImageSize) return thumbnail;
  }
  throw new Error("This image couldn't be compressed small enough. Try a simpler image.");
}

function showImagePreview(input, blob) {
  const field = input.closest(".choice-field");
  const preview = field.querySelector(".choice-image-preview");
  const previousUrl = preview.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  if (!blob) {
    preview.removeAttribute("src");
    preview.hidden = true;
    delete preview.dataset.objectUrl;
    field.querySelector(".choice-image-trigger").hidden = false;
    field.querySelector(".choice-image-remove").hidden = true;
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  preview.src = objectUrl;
  preview.dataset.objectUrl = objectUrl;
  preview.alt = `Thumbnail for ${field.querySelector('input[name="options"]').value || "this choice"}`;
  preview.hidden = false;
  field.querySelector(".choice-image-trigger").hidden = true;
  field.querySelector(".choice-image-remove").hidden = false;
}

async function saveDraft() {
  try {
    const fields = [...choiceInputs.querySelectorAll(".choice-field")];
    const optionImages = await Promise.all(fields.map((field) => {
      const blob = imageFiles.get(field.querySelector(".choice-image-file"));
      return blob ? blobToDataUrl(blob) : null;
    }));
    localStorage.setItem("trggr-poll-draft-v1", JSON.stringify({
      question: questionInput.value,
      options: fields.map((field) => field.querySelector('input[name="options"]').value),
      optionImages,
      category: categorySelect.value
    }));
    return true;
  } catch (error) {
    console.warn("Could not save the poll draft before sign-in.", error);
    note.textContent = "Your draft couldn't be saved in this browser. Check storage settings and try again.";
    return false;
  }
}

async function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem("trggr-poll-draft-v1") || "null");
    if (!draft) return;
    questionInput.value = draft.question || "";
    const requestedOptions = Math.max(2, Math.min(4, draft.options?.length || 2));
    while (choiceInputs.querySelectorAll(".choice-field").length < requestedOptions) addChoice();
    while (choiceInputs.querySelectorAll(".choice-field").length > requestedOptions) {
      choiceInputs.lastElementChild.remove();
    }
    updateChoiceControls();
    const fields = [...choiceInputs.querySelectorAll(".choice-field")];
    for (const [index, field] of fields.entries()) {
      const optionInput = field.querySelector('input[name="options"]');
      optionInput.value = draft.options?.[index] || "";
      const imageData = draft.optionImages?.[index];
      if (imageData) {
        const image = await fetch(imageData).then((response) => response.blob());
        if (image.type === "image/webp" && image.size <= maxImageSize) {
          const fileInput = field.querySelector(".choice-image-file");
          imageFiles.set(fileInput, image);
          showImagePreview(fileInput, image);
        }
      }
    }
    if (draft.category) {
      categorySelect.value = draft.category;
      if (!categorySelect.value) categorySelect.selectedIndex = 0;
    }
    questionCount.textContent = `${questionInput.value.length} / 110`;
  } catch (error) {
    console.warn("Could not restore the saved poll draft.", error);
  }
}

function addChoice(value = "") {
  const fields = choiceInputs.querySelectorAll(".choice-field");
  if (fields.length >= 4) return;
  const number = fields.length + 1;
  const field = document.createElement("div");
  field.className = "choice-field";
  const label = document.createElement("label");
  label.htmlFor = `option-${number}`;
  label.textContent = `Option ${number}`;
  const input = document.createElement("input");
  input.id = `option-${number}`;
  input.name = "options";
  input.maxLength = 40;
  input.required = true;
  input.placeholder = "Add a clear choice";
  input.value = value;
  const imageInput = document.createElement("input");
  imageInput.id = `option-image-${number}`;
  imageInput.className = "choice-image-file";
  imageInput.type = "file";
  imageInput.accept = "image/jpeg,image/png,image/webp";
  imageInput.hidden = true;
  const imageActions = document.createElement("div");
  imageActions.className = "choice-image-actions";
  const imageTrigger = document.createElement("button");
  imageTrigger.className = "choice-image-trigger";
  imageTrigger.type = "button";
  imageTrigger.setAttribute("aria-label", `Add an image for option ${number}`);
  imageTrigger.textContent = "＋ Add image";
  const imageRemove = document.createElement("button");
  imageRemove.className = "choice-image-remove";
  imageRemove.type = "button";
  imageRemove.setAttribute("aria-label", `Remove image from option ${number}`);
  imageRemove.textContent = "Remove image";
  imageRemove.hidden = true;
  imageActions.append(imageTrigger, imageRemove);
  const preview = document.createElement("img");
  preview.className = "choice-image-preview";
  preview.alt = "";
  preview.hidden = true;
  const remove = document.createElement("button");
  remove.className = "choice-remove";
  remove.type = "button";
  remove.textContent = "Remove option";
  remove.hidden = true;
  field.append(label, input, imageInput, imageActions, preview, remove);
  choiceInputs.append(field);
  updateChoiceControls();
}

function updateChoiceControls() {
  const fields = [...choiceInputs.querySelectorAll(".choice-field")];
  addChoiceButton.disabled = fields.length >= 4;
  fields.forEach((field, index) => {
    const number = index + 1;
    const optionInput = field.querySelector('input[name="options"]');
    const label = field.querySelector("label");
    const imageInput = field.querySelector(".choice-image-file");
    label.htmlFor = `option-${number}`;
    label.textContent = `Option ${number}`;
    optionInput.id = label.htmlFor;
    imageInput.id = `option-image-${number}`;
    field.querySelector(".choice-image-trigger").setAttribute("aria-label", `Add an image for option ${number}`);
    field.querySelector(".choice-image-remove").setAttribute("aria-label", `Remove image from option ${number}`);
    field.querySelector(".choice-remove").hidden = fields.length <= 2;
  });
}

choiceInputs.addEventListener("click", (event) => {
  const trigger = event.target.closest(".choice-image-trigger");
  if (trigger) {
    trigger.closest(".choice-field").querySelector(".choice-image-file").click();
    return;
  }
  const removeImage = event.target.closest(".choice-image-remove");
  if (removeImage) {
    const field = removeImage.closest(".choice-field");
    const imageInput = field.querySelector(".choice-image-file");
    imageFiles.delete(imageInput);
    imageInput.value = "";
    showImagePreview(imageInput, null);
    return;
  }
  const removeChoice = event.target.closest(".choice-remove");
  if (removeChoice && choiceInputs.querySelectorAll(".choice-field").length > 2) {
    const field = removeChoice.closest(".choice-field");
    const preview = field.querySelector(".choice-image-preview");
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    field.remove();
    updateChoiceControls();
  }
});

choiceInputs.addEventListener("change", async (event) => {
  const input = event.target.closest(".choice-image-file");
  if (!input || !input.files?.[0]) return;
  const field = input.closest(".choice-field");
  const trigger = field.querySelector(".choice-image-trigger");
  const removeImage = field.querySelector(".choice-image-remove");
  trigger.disabled = true;
  removeImage.disabled = true;
  note.textContent = "Preparing your thumbnail…";
  try {
    const thumbnail = await createThumbnail(input.files[0]);
    if (!field.isConnected) return;
    imageFiles.set(input, thumbnail);
    showImagePreview(input, thumbnail);
    note.textContent = "";
  } catch (error) {
    console.error("Could not prepare the poll option image.", error);
    imageFiles.delete(input);
    input.value = "";
    showImagePreview(input, null);
    note.textContent = error.message;
  } finally {
    trigger.disabled = false;
    removeImage.disabled = false;
  }
});

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
  const fields = [...choiceInputs.querySelectorAll(".choice-field")];
  const thumbnails = fields.map((field) => imageFiles.get(field.querySelector(".choice-image-file")) || null);

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
      if (!await saveDraft()) return;
      window.location.href = "login.html?next=create.html";
      return;
    }

    const submitButton = form.querySelector("button[type=submit]");
    const uploadedImagePaths = [];
    submitButton.disabled = true;
    note.textContent = "Publishing your poll…";
    try {
      const optionImages = [];
      for (const [index, thumbnail] of thumbnails.entries()) {
        if (!thumbnail) {
          optionImages.push(null);
          continue;
        }
        const path = `${userId}/${crypto.randomUUID()}.webp`;
        note.textContent = `Uploading option ${index + 1} thumbnail…`;
        const { error: uploadError } = await backend.storage
          .from("poll-option-images")
          .upload(path, thumbnail, { contentType: "image/webp", upsert: false });
        if (uploadError) throw uploadError;
        uploadedImagePaths.push(path);
        optionImages.push(path);
      }
      note.textContent = "Publishing your poll…";
      const { error } = await backend.rpc("create_poll_with_options", {
        p_question: question,
        p_category: category,
        p_options: options,
        p_option_images: optionImages.some(Boolean) ? optionImages : null
      });
      if (error) throw error;
      uploadedImagePaths.length = 0;
      try {
        localStorage.removeItem("trggr-poll-draft-v1");
      } catch (storageError) {
        console.warn("The published poll's local draft couldn't be removed.", storageError);
      }
      window.location.href = "index.html#polls";
    } catch (error) {
      console.error("Could not publish the poll.", error);
      if (uploadedImagePaths.length) {
        const { error: cleanupError } = await backend.storage.from("poll-option-images").remove(uploadedImagePaths);
        if (cleanupError) console.error("Could not remove unused poll thumbnails.", cleanupError);
      }
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
      images: await Promise.all(thumbnails.map((thumbnail) => thumbnail ? blobToDataUrl(thumbnail) : null)),
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
