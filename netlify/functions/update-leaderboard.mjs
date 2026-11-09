// Runs every 15 minutes on Netlify: adds newly finished alumni-team games to each league's season log
// and rebuilds its leaderboard, so neither is more than about 15 minutes behind the final buzzer.
import { currentSeason } from "../../lib/season.mjs";
import { refresh } from "../../lib/ledger-blobs.mjs";
import { LEAGUES } from "../../lib/core.mjs";

export default async () => {
  for (const league of Object.keys(LEAGUES)) {
    const board = await refresh(currentSeason(), 10000, league);
    console.log(`leaderboard ${league}: ${board.games} games, ${board.waiting} still waiting`);
  }
};

export const config = { schedule: "*/15 * * * *" };
