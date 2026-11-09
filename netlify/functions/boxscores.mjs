// GET /api/boxscores?date=YYYYMMDD[&league=ncaaw] : every alumnus's line for one date, and the games with an alumni team.
import { boxscores, parseLeague, validDate, cacheSecondsFor } from "../../lib/core.mjs";
import { json } from "../../lib/respond.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const date = q.get("date");
  const league = parseLeague(q.get("league"));
  if (!validDate(date) || !league) return json({ error: "date must be YYYYMMDD and league ncaam or ncaaw" }, 400);
  try {
    const data = await boxscores(date, league);
    return json(data, 200, cacheSecondsFor(data.games, date));
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/boxscores" };
