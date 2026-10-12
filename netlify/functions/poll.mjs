const SUPABASE_URL = "https://sxlweaxmqcfxzxrybyvb.supabase.co";
const SUPABASE_KEY = "sb_publishable_-IVBeZscVKBByyy7ArrCVg__VtIyzXK";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function findPoll(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_polls`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: "{}"
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows.find((row) => row.id === id) || null;
}

export const handler = async (event) => {
  const id = event.queryStringParameters?.id || "";
  const host = event.headers["x-forwarded-host"] || event.headers.host;
  const origin = `https://${host}`;
  const target = `${origin}/index.html?poll=${encodeURIComponent(id)}#polls`;

  let title = "TRGGA - Pick a side";
  let description = "Polls, debates and the daily pulse. Pick a side and see where the room lands.";
  let image = `${origin}/og-image.png`;

  try {
    const poll = await findPoll(id);
    if (poll) {
      const options = Array.isArray(poll.options) ? poll.options : [];
      const total = options.reduce((sum, option) => sum + Number(option.votes || 0), 0);
      title = poll.question;
      description = `${options.map((option) => option.label).join(" vs ")} - ${total} vote${total === 1 ? "" : "s"} so far. Cast yours on TRGGA.`;
      const withImage = options.find((option) => option.image_path);
      if (withImage) image = `${SUPABASE_URL}/storage/v1/object/public/poll-option-images/${withImage.image_path}`;
    }
  } catch (error) {
    console.error("Could not build the poll card.", error);
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>${escapeHtml(title)} - TRGGA</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TRGGA">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(`${origin}/p/${id}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
</head><body><p><a href="${escapeHtml(target)}">Open this poll on TRGGA</a></p>
<script>location.replace(${JSON.stringify(target)});</script></body></html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
    body: html
  };
};
