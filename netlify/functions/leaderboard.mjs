// GET /api/leaderboard : season totals for every tracked alumnus.
// Reads the board the scheduled update keeps current. If there's no board yet (first deploy, new
// season, alumni.csv changed), it starts building one within this request's time and says how many
// games are still loading.
import { alumniMatcher } from "../../lib/core.mjs";
import { alumniKey, currentSeason } from "../../lib/season.mjs";
import { readBoard, refresh } from "../../lib/ledger-blobs.mjs";
import { json } from "../../lib/respond.mjs";

export default async () => {
  const season = currentSeason();
  try {
    const match = await alumniMatcher();
    let board = await readBoard(season);
    // A board built from an older alumni list is rebuilt rather than served.
    if (!board || board.alumniKey !== alumniKey(match)) board = await refresh(season, 7000);
    // The "not on a D-I roster" list comes straight from alumni.csv, so note edits show up at once.
    return json({ ...board, others: match.others, totalAlumni: match.total }, 200, board.waiting ? 0 : 60);
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/leaderboard" };
