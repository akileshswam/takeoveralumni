// GET /api/leaderboard[?league=ncaaw] : season totals for every tracked alumnus in one league.
// Reads the board the scheduled update keeps current. If there's no board yet (first deploy, new
// season, alumni.csv changed), it starts building one within this request's time and says how many
// games are still loading.
import { alumniMatcher, parseLeague } from "../../lib/core.mjs";
import { alumniKey, currentSeason } from "../../lib/season.mjs";
import { readBoard, refresh } from "../../lib/ledger-blobs.mjs";
import { json } from "../../lib/respond.mjs";

export default async (req) => {
  const season = currentSeason();
  const league = parseLeague(new URL(req.url).searchParams.get("league"));
  if (!league) return json({ error: "league must be ncaam or ncaaw" }, 400);
  try {
    const match = await alumniMatcher(league);
    let board = await readBoard(season, league);
    // A board built from an older alumni list is rebuilt rather than served.
    if (!board || board.alumniKey !== alumniKey(match)) board = await refresh(season, 7000, league);
    // The "not on a D-I roster" list comes straight from alumni.csv, so note edits show up at once.
    return json({ ...board, others: match.others, totalAlumni: match.total }, 200, board.waiting ? 0 : 60);
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/leaderboard" };
