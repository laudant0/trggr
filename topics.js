import { getBackend, isBackendConfigured } from "./backend.js";

const topicList = document.querySelector("#topic-list");

function renderPolls(polls, backend = null) {
  if (!polls.length) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = "No questions are in the room yet. Start the first conversation.";
    topicList.replaceChildren(empty);
    return;
  }

  topicList.replaceChildren(...polls.slice(0, 9).map((poll) => {
    const card = document.createElement("a");
    card.className = "glass-card topic-poll-card";
    card.href = `index.html?category=${encodeURIComponent(poll.category)}#polls`;
    const tag = document.createElement("span");
    tag.className = "topic-poll-tag";
    tag.textContent = `${poll.category.toUpperCase()} · ${poll.tag || "COMMUNITY QUESTION"}`;
    const question = document.createElement("strong");
    question.textContent = poll.question;
    const firstImage = poll.options?.find((option) => option.image_path)?.image_path;
    if (firstImage && backend) {
      const image = document.createElement("img");
      image.className = "topic-poll-image";
      image.src = backend.storage.from("poll-option-images").getPublicUrl(firstImage).data.publicUrl;
      image.alt = `Image for a choice in ${poll.question}`;
      image.loading = "lazy";
      image.decoding = "async";
      card.append(image);
    }
    const detail = document.createElement("span");
    detail.className = "topic-link";
    const votes = Number(poll.total_votes || 0);
    detail.textContent = `${votes.toLocaleString()} ${votes === 1 ? "VOTE" : "VOTES"} · JOIN THE CONVERSATION ↗`;
    card.append(tag, question, detail);
    return card;
  }));
}

async function initializeTopics() {
  if (!isBackendConfigured()) {
    renderPolls(window.TRGGR_SEED_POLLS.map((poll) => ({
      ...poll,
      total_votes: poll.votes.reduce((sum, votes) => sum + votes, 0)
    })));
    return;
  }

  try {
    const backend = await getBackend();
    const { data, error } = await backend.rpc("get_public_polls");
    if (error) throw error;
    renderPolls(data || [], backend);
  } catch (error) {
    console.error("Could not load recent TRGGA conversations.", error);
    const message = document.createElement("p");
    message.className = "category-load-error";
    message.setAttribute("role", "status");
    message.textContent = `The latest questions could not load: ${error.message}. Refresh to try again.`;
    topicList.replaceChildren(message);
  }
}

initializeTopics();
