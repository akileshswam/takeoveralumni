// Runs every 15 minutes on Netlify: adds newly finished alumni-team games to the season log and
// rebuilds the leaderboard, so it's never more than about 15 minutes behind the final buzzer.
import { currentSeason } from "../../lib/season.mjs";
import { refresh } from "../../lib/ledger-blobs.mjs";

export default async () => {
  const board = await refresh(currentSeason(), 20000);
  console.log(`leaderboard: ${board.games} games, ${board.waiting} still waiting`);
};

export const config = { schedule: "*/15 * * * *" };
