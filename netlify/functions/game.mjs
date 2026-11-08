// GET /api/game?id=ESPN_GAME_ID : the full box score for one game.
import { game, validId, cacheSecondsFor, etYmd } from "../../lib/core.mjs";
import { json } from "../../lib/respond.mjs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!validId(id)) return json({ error: "id must be an ESPN game id" }, 400);
  try {
    const data = await game(id);
    return json(data, 200, cacheSecondsFor([data], etYmd(new Date(data.start))));
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/game" };
