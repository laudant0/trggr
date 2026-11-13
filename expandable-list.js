export function renderExpandableList(container, items, renderItem, pageSize = 5) {
  let shown = 0;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-dark button-small list-more";
  button.textContent = "See more";

  function showNext() {
    const next = items.slice(shown, shown + pageSize);
    shown += next.length;
    button.before(...next.map(renderItem));
    if (shown >= items.length) button.remove();
  }

  button.addEventListener("click", showNext);
  container.replaceChildren(button);
  showNext();
}
