import { getBackend, isBackendConfigured } from "./backend.js";

const categoryGrid = document.querySelector("#category-grid");
const categorySymbols = {
  Arts: "✳",
  Automotive: "↗",
  Books: "▤",
  Business: "◫",
  Creators: "◎",
  Culture: "✳",
  Education: "⌘",
  Entertainment: "✦",
  Environment: "◌",
  Fashion: "◇",
  Finance: "$",
  Food: "✳",
  Gaming: "▣",
  Health: "+",
  Lifestyle: "✳",
  Music: "♫",
  News: "◉",
  Other: "＋",
  Politics: "§",
  Relationships: "♡",
  Science: "⌬",
  Sports: "◉",
  Tech: "⌘",
  Travel: "↗",
  World: "◎"
};

function renderCategories(categories) {
  categoryGrid.replaceChildren();
  categories.forEach((category, index) => {
    const link = document.createElement("a");
    link.className = "glass-card category-card";
    link.href = `index.html?category=${encodeURIComponent(category)}#polls`;
    const number = document.createElement("span");
    number.className = "category-card-number";
    number.textContent = `CATEGORY ${String(index + 1).padStart(2, "0")}`;
    const name = document.createElement("strong");
    name.textContent = category;
    const symbol = document.createElement("span");
    symbol.className = "category-card-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = categorySymbols[category] || "✳";
    const explore = document.createElement("span");
    explore.className = "topic-link";
    explore.textContent = "Find your people ↗";
    link.append(number, symbol, name, explore);
    categoryGrid.append(link);
  });
}

async function initialize() {
  if (!isBackendConfigured()) {
    renderCategories(window.TRGGR_CATEGORIES);
    return;
  }
  try {
    const backend = await getBackend();
    const { data, error } = await backend.rpc("get_public_categories");
    if (error) throw error;
    renderCategories(data.map((row) => row.name));
  } catch (error) {
    console.error("Could not load the topic categories.", error);
    const message = document.createElement("p");
    message.className = "category-load-error";
    message.setAttribute("role", "status");
    message.textContent = `Categories could not load from the shared service: ${error.message}. Refresh to try again.`;
    categoryGrid.replaceChildren(message);
  }
}

initialize();
