// GET /api/schedule?from=YYYYMMDD&days=7[&league=ncaaw] : every alumni-team game in a stretch of days, with each team's alumni.
import { parseLeague, schedule, validDate, scheduleCacheSeconds } from "../../lib/core.mjs";
import { json } from "../../lib/respond.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  const days = Number(q.get("days") || 7);
  const league = parseLeague(q.get("league"));
  if (!validDate(from) || !Number.isInteger(days) || days < 1 || days > 14 || !league) return json({ error: "from must be YYYYMMDD, days 1-14 and league ncaam or ncaaw" }, 400);
  try {
    const data = await schedule(from, days, league);
    return json(data, 200, scheduleCacheSeconds(data));
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/schedule" };
