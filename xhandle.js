const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

// Accepts "@name", "name", or an x.com / twitter.com profile link. Returns "" when empty, null when invalid.
export function parseXHandle(input) {
  let value = String(input || "").trim();
  if (!value) return "";
  const link = value.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([^/?#\s]+)/i);
  if (link) value = link[1];
  value = value.replace(/^@/, "");
  return HANDLE.test(value) ? value : null;
}

// Accepts "@name", "name", or an instagram.com profile link. Returns "" when empty, null when invalid.
export function parseInstagramHandle(input) {
  let value = String(input || "").trim();
  if (!value) return "";
  const link = value.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/@?([^/?#\s]+)/i);
  if (link) value = link[1];
  value = value.replace(/^@/, "");
  return /^[A-Za-z0-9_.]{1,30}$/.test(value) ? value : null;
}

export function instagramLink(handle) {
  const link = document.createElement("a");
  link.className = "x-link";
  link.href = `https://instagram.com/${encodeURIComponent(handle)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer me";
  link.textContent = `◎ @${handle}`;
  link.setAttribute("aria-label", `${handle} on Instagram`);
  return link;
}

export function xProfileUrl(handle) {
  return `https://x.com/${encodeURIComponent(handle)}`;
}

export function xLink(handle) {
  const link = document.createElement("a");
  link.className = "x-link";
  link.href = xProfileUrl(handle);
  link.target = "_blank";
  link.rel = "noopener noreferrer me";
  link.textContent = `𝕏 @${handle}`;
  link.setAttribute("aria-label", `${handle} on X`);
  return link;
}
