export function initials(name) {
  return (name || "").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "%";
}

export function avatarUrl(backend, path) {
  return path ? backend.storage.from("avatars").getPublicUrl(path).data.publicUrl : null;
}

export function fillAvatar(container, name, url) {
  container.replaceChildren();
  if (!url) {
    container.textContent = initials(name);
    return;
  }
  const image = document.createElement("img");
  image.src = url;
  image.alt = "";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => { container.textContent = initials(name); }, { once: true });
  container.append(image);
}

export async function loadAvatarPaths(backend, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await backend.rpc("get_avatar_paths", { p_ids: ids });
  if (error) {
    console.warn("Could not load profile photos.", error);
    return new Map();
  }
  return new Map((data || []).map((row) => [row.id, row.avatar_path]));
}

// Center-crops to a square and encodes a compact WebP under the 256 KB bucket limit.
export async function resizeAvatar(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose an image under 10 MB.");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 320;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 320, 320);
  bitmap.close?.();
  for (const quality of [0.86, 0.74, 0.62, 0.5]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.type === "image/webp" && blob.size <= 256 * 1024) return blob;
  }
  throw new Error("That image couldn't be compressed enough. Try a different one.");
}
