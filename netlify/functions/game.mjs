// GET /api/game?id=ESPN_GAME_ID[&league=ncaaw] : the full box score for one game.
import { game, parseLeague, validId, cacheSecondsFor, etYmd } from "../../lib/core.mjs";
import { json } from "../../lib/respond.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const id = q.get("id");
  const league = parseLeague(q.get("league"));
  if (!validId(id) || !league) return json({ error: "id must be an ESPN game id and league ncaam or ncaaw" }, 400);
  try {
    const data = await game(id, league);
    return json(data, 200, cacheSecondsFor([data], etYmd(new Date(data.start))));
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/game" };
