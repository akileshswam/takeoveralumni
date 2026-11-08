// GET /api/boxscores?date=YYYYMMDD : every alumnus's line for one date, and the games with an alumni team.
import { boxscores, validDate, cacheSecondsFor } from "../../lib/core.mjs";
import { json } from "../../lib/respond.mjs";

export default async (req) => {
  const date = new URL(req.url).searchParams.get("date");
  if (!validDate(date)) return json({ error: "date must be YYYYMMDD" }, 400);
  try {
    const data = await boxscores(date);
    return json(data, 200, cacheSecondsFor(data.games, date));
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/boxscores" };
