const KEY = "trgga-streak";
const MILESTONES = [3, 7, 14, 30, 60, 100, 365];

export function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function daysAgo(count) {
  return new Date(Date.now() - count * 86400000);
}

export function readStreak() {
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (error) { state = {}; }
  const days = Array.isArray(state.days) ? state.days : [];
  if (state.last && !days.includes(state.last)) days.push(state.last);
  return { count: state.count || 0, last: state.last || null, best: Math.max(state.best || 0, state.count || 0), days };
}

function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, days: state.days.slice(-400) })); } catch (error) { /* private mode */ }
}

export function liveStreak() {
  const state = readStreak();
  const alive = state.last === dayKey(new Date()) || state.last === dayKey(daysAgo(1));
  return alive ? state.count : 0;
}

// Returns true when this vote grew the streak (first vote of the day).
export function recordVote() {
  const state = readStreak();
  const today = dayKey(new Date());
  if (state.last === today) return false;
  const continued = state.last === dayKey(daysAgo(1));
  const count = continued ? state.count + 1 : 1;
  save({ count, last: today, best: Math.max(state.best, count), days: [...state.days, today] });
  return true;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function streakStats() {
  const state = readStreak();
  const current = liveStreak();
  const next = MILESTONES.find((value) => value > current) || current + 100;
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = daysAgo(6 - index);
    return { label: date.toLocaleDateString([], { weekday: "narrow" }), done: state.days.includes(dayKey(date)), today: index === 6 };
  });
  return { current, best: state.best, total: new Set(state.days).size, next, week, doneToday: state.last === dayKey(new Date()) };
}

export function streakPanel() {
  const stats = streakStats();
  const wrap = node("div", "streak-panel");
  const grid = node("div", "streak-grid");
  [["CURRENT", `${stats.current}`], ["BEST", `${stats.best}`], ["DAYS VOTED", `${stats.total}`]].forEach(([label, value]) => {
    const cell = node("div", "streak-cell");
    cell.append(node("strong", "", value), node("span", "", label));
    grid.append(cell);
  });
  const week = node("div", "streak-week");
  stats.week.forEach((day) => {
    const dot = node("div", `streak-day${day.done ? " done" : ""}${day.today ? " today" : ""}`);
    dot.append(node("i", "", day.done ? "🗳️" : ""), node("span", "", day.label));
    week.append(dot);
  });
  const progress = node("div", "streak-progress");
  const bar = node("div", "streak-bar");
  const fill = node("div", "streak-fill");
  fill.style.width = `${Math.min(100, Math.round((stats.current / stats.next) * 100))}%`;
  bar.append(fill);
  progress.append(bar, node("p", "room-note", stats.current ? `${stats.next - stats.current} more day${stats.next - stats.current === 1 ? "" : "s"} to a ${stats.next}-day streak.` : "Vote on any poll today to start a streak."));
  wrap.append(grid, week, progress);
  if (stats.current && !stats.doneToday) wrap.append(node("p", "room-note", "Vote today to keep your streak alive."));
  return wrap;
}

export function openStreakModal() {
  const dialog = node("dialog", "room-dialog");
  const form = node("form", "room-dialog-form");
  form.method = "dialog";
  const close = node("button", "button button-dark button-small", "Close");
  close.type = "submit";
  form.append(node("span", "eyebrow", "YOUR VOTING STREAK"), node("h2", "room-dialog-title", `🗳️ ${liveStreak()}-day streak`), streakPanel(), close);
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.showModal();
}
