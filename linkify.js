const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

export function setLinkedText(element, text) {
  const value = String(text ?? "");
  const parts = [];
  let last = 0;
  for (const match of value.matchAll(URL_PATTERN)) {
    let url = match[1];
    const trailing = url.match(/[.,;:!?)\]]+$/);
    if (trailing) url = url.slice(0, -trailing[0].length);
    if (match.index > last) parts.push(value.slice(last, match.index));
    const link = document.createElement("a");
    link.href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    link.textContent = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer nofollow ugc";
    link.className = "text-link";
    parts.push(link);
    last = match.index + url.length;
  }
  if (last < value.length) parts.push(value.slice(last));
  element.replaceChildren(...parts);
  return element;
}