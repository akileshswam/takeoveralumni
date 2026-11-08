// Netlify Blobs storage for the season log (ledger-{season}: every alumni line) and the board built
// from it (board-{season}: season totals, small). The page only ever reads the board.
import { getStore } from "@netlify/blobs";
import { alumniMatcher, espnNames } from "./core.mjs";
import { BOARD_VERSION, alumniKey, buildBoard, ensureLedger, updateLedger } from "./season.mjs";

const store = () => getStore({ name: "season", consistency: "strong" });

export async function readBoard(season) {
  const board = await store().get(`board-${season}`, { type: "json" });
  return board?.boardVersion === BOARD_VERSION ? board : null; // an older shape gets rebuilt
}

// Adds newly finished games within the time budget and rewrites the board if anything changed.
// If ESPN is having trouble, the saved board keeps being served instead of an error.
export async function refresh(season, budgetMs) {
  const s = store();
  const match = await alumniMatcher();
  const ledger = ensureLedger(await s.get(`ledger-${season}`, { type: "json" }), season, match);
  let result;
  try {
    result = await updateLedger(ledger, match, { budgetMs });
  } catch (e) {
    console.error(`leaderboard update failed: ${e.message}`);
    const saved = await readBoard(season);
    if (saved && saved.alumniKey === alumniKey(match)) return saved;
    result = { changed: false, waiting: 0 };
  }
  const board = { ...buildBoard(ledger, match, await espnNames(match)), waiting: result.waiting };
  // waiting matters too: the page says how many games are still loading.
  const saved = await readBoard(season);
  if (result.changed || !saved || saved.waiting !== board.waiting || saved.alumniKey !== board.alumniKey) {
    await s.setJSON(`ledger-${season}`, ledger);
    await s.setJSON(`board-${season}`, board);
  }
  return board;
}
