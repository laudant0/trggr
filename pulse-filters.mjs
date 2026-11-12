export function hasVoted(poll, votes) {
  const position = poll.votedPosition === undefined ? votes[poll.id] : poll.votedPosition;
  return position !== null && position !== undefined;
}

export function matchesPulse(poll, filter, votes, pins, now) {
  if (filter === "closing") return Boolean(poll.closesAt && poll.closesAt > now && poll.closesAt <= now + 24 * 60 * 60 * 1000);
  if (filter === "voted") return hasVoted(poll, votes);
  if (filter === "pinned") return pins.has(poll.id);
  return true;
}

export function pulseCounts(rows, pins, now) {
  const polls = rows.map((row) => ({
    id: row.id,
    votedPosition: row.my_option_position ?? null,
    closesAt: row.closes_at ? new Date(row.closes_at).getTime() : null
  }));
  return Object.fromEntries(["all", "closing", "voted", "pinned"].map((filter) => [
    filter, polls.filter((poll) => matchesPulse(poll, filter, {}, pins, now)).length
  ]));
}
