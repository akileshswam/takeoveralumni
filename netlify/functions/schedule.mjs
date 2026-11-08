// GET /api/schedule?from=YYYYMMDD&days=7 : every alumni-team game in a stretch of days, with each team's alumni.
import { schedule, validDate, scheduleCacheSeconds } from "../../lib/core.mjs";
import { json } from "../../lib/respond.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  const days = Number(q.get("days") || 7);
  if (!validDate(from) || !Number.isInteger(days) || days < 1 || days > 14) return json({ error: "from must be YYYYMMDD and days 1-14" }, 400);
  try {
    const data = await schedule(from, days);
    return json(data, 200, scheduleCacheSeconds(data));
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/schedule" };
