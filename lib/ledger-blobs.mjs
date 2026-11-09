// Netlify Blobs storage for each league's season log (ledger-{league}-{season}: every alumni line) and
// the board built from it (board-{league}-{season}: season totals, small). The page only reads the board.
import { getStore } from "@netlify/blobs";
import { DEFAULT_LEAGUE, alumniMatcher, espnNames } from "./core.mjs";
import { BOARD_VERSION, alumniKey, buildBoard, ensureLedger, updateLedger } from "./season.mjs";

const store = () => getStore({ name: "season", consistency: "strong" });

const ledgerKey = (league, season) => `ledger-${league}-${season}`;
const boardKey = (league, season) => `board-${league}-${season}`;

export async function readBoard(season, league = DEFAULT_LEAGUE) {
  const board = await store().get(boardKey(league, season), { type: "json" });
  return board?.boardVersion === BOARD_VERSION ? board : null; // an older shape gets rebuilt
}

// Adds newly finished games within the time budget and rewrites the board if anything changed.
// If ESPN is having trouble, the saved board keeps being served instead of an error.
export async function refresh(season, budgetMs, league = DEFAULT_LEAGUE) {
  const s = store();
  const match = await alumniMatcher(league);
  const ledger = ensureLedger(await s.get(ledgerKey(league, season), { type: "json" }), season, match, league);
  let result;
  try {
    result = await updateLedger(ledger, match, { budgetMs });
  } catch (e) {
    console.error(`leaderboard update failed (${league}): ${e.message}`);
    const saved = await readBoard(season, league);
    if (saved && saved.alumniKey === alumniKey(match)) return saved;
    result = { changed: false, waiting: 0 };
  }
  const board = { ...buildBoard(ledger, match, await espnNames(match, league)), waiting: result.waiting };
  // waiting matters too: the page says how many games are still loading.
  const saved = await readBoard(season, league);
  if (result.changed || !saved || saved.waiting !== board.waiting || saved.alumniKey !== board.alumniKey) {
    await s.setJSON(ledgerKey(league, season), ledger);
    await s.setJSON(boardKey(league, season), board);
  }
  return board;
}
