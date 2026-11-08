// The Leaderboard's season log: every alumnus's game-by-game line, and the season totals built from
// it. Only alumni-team games are ever fetched, and only alumni lines are stored. The caller stores the
// ledger (Netlify Blobs on Netlify, a JSON file in data/ locally); the page only reads the small board.
import { DEFAULT_LEAGUE, LEAGUES, fetchJson, readLine, etYmd } from "./core.mjs";

const ESPN_ROOT = "https://site.api.espn.com/apis/site/v2/sports/basketball";
const LEDGER_VERSION = 1;
export const BOARD_VERSION = 1;
const COUNTED_TYPES = new Set([2, 3]); // regular season and postseason, as ESPN's college season stats include both
// Each alumni line: [gameId, date, teamId, teamAbbr, started, min, pts, reb, oreb, dreb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta]
const STATS = ["min", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "tpm", "tpa", "ftm", "fta"];
const FIRST_STAT = 5;
const statOf = (line, k) => line[FIRST_STAT + STATS.indexOf(k)];
const isoOf = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

// ESPN names a season by the year it ends; from August on, the coming season.
export function currentSeason(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  return m >= 8 ? y + 1 : y;
}

// A key of the alumni list. Only alumni lines are stored, so changing the list starts the log over
// (a new alumnus's earlier games were never saved). It refills on its own within a few refreshes.
export const alumniKey = (match) => match.alumni.map((c) => `${c.espnId}:${c.teamId}`).sort().join(",");

export function emptyLedger(season, match, league = DEFAULT_LEAGUE) {
  return { v: LEDGER_VERSION, league, season, alumniKey: alumniKey(match), updated: null, doneDates: [], games: {}, players: {} };
}
export function ensureLedger(ledger, season, match, league = DEFAULT_LEAGUE) {
  const ok = ledger?.v === LEDGER_VERSION && ledger.league === league && ledger.season === season && ledger.alumniKey === alumniKey(match);
  return ok ? ledger : emptyLedger(season, match, league);
}

// Every date from Oct 25 through Apr 15. ESPN's college calendar stops at the end of the regular
// season, so walking it would miss conference tournaments and March Madness.
function seasonDates(season, today) {
  const out = [];
  const end = `${season}0415`;
  for (const d = new Date(Date.UTC(season - 1, 9, 25)); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const ymd = d.toISOString().slice(0, 10).replaceAll("-", "");
    if (ymd > today || ymd > end) return out;
    out.push(ymd);
  }
}

// One game's alumni lines, and why any alumnus listed without stats didn't play. ESPN's date bucket
// is kept as the game's date, even when a late tip falls on the next calendar day.
function readGame(sum, match, ymd) {
  const lines = [];
  const dnp = {};
  for (const side of sum.boxscore?.players || []) {
    const block = side.statistics?.[0];
    for (const a of block?.athletes || []) {
      if (!match.find(a.athlete.id)) continue;
      if (a.didNotPlay || !a.stats?.length) { dnp[a.athlete.id] = (a.reason && a.reason.trim()) || "Did Not Play"; continue; }
      const x = readLine(block.labels, a.stats);
      lines.push({
        id: a.athlete.id, name: a.athlete.displayName, pos: a.athlete.position?.abbreviation || "",
        line: [sum.header.id, isoOf(ymd), side.team.id, side.team.abbreviation, a.starter ? 1 : 0, ...STATS.map((k) => x[k])],
      });
    }
  }
  return { lines, dnp };
}

// Adds finished alumni-team games the ledger doesn't have yet, until the time budget runs out.
// A date whose scoreboard still fails after retries is skipped and tried again next time.
export async function updateLedger(ledger, match, { budgetMs = 6000, concurrency = 6 } = {}) {
  const started = Date.now();
  const timeLeft = () => budgetMs - (Date.now() - started);
  const base = `${ESPN_ROOT}/${LEAGUES[ledger.league].slug}`;
  const today = etYmd();
  const yesterday = etYmd(new Date(Date.now() - 864e5));
  const done = new Set(ledger.doneDates);
  const doneBefore = done.size;
  const open = seasonDates(ledger.season, today).filter((d) => !done.has(d));
  const pending = [];

  for (let i = 0; i < open.length && timeLeft() > 1500; i += 10) {
    const boards = await Promise.all(open.slice(i, i + 10).map((d) => fetchJson(`${base}/scoreboard?dates=${d}&groups=50&limit=1000`)
      .then((b) => [d, b])
      .catch((e) => { console.error(`scoreboard ${d}: ${e.message}`); return null; })));
    for (const entry of boards) {
      if (!entry) continue;
      const [d, b] = entry;
      let allIn = true;
      for (const ev of b.events || []) {
        const comp = ev.competitions[0];
        if (!COUNTED_TYPES.has(ev.season?.type) || !comp.competitors.some((c) => match.teamIds.has(c.team.id))) continue;
        const status = comp.status.type;
        if (status.completed) {
          if (!ledger.games[ev.id]) { pending.push({ ev, d }); allIn = false; }
        } else if (status.state === "post" || (status.state === "pre" && d < yesterday)) {
          continue; // canceled or postponed: it will never finish under this date
        } else allIn = false;
      }
      // A past date with every game in is never checked again.
      if (allIn && d < today) done.add(d);
    }
  }
  ledger.doneDates = [...done];

  let added = 0;
  const queue = [...pending];
  async function worker() {
    while (queue.length && timeLeft() > 800) {
      const { ev, d } = queue.shift();
      try {
        const sum = await fetchJson(`${base}/summary?event=${ev.id}`);
        // Small-school games sometimes never get a box score. Stop asking once the day has passed.
        if (!sum.boxscore?.players?.length) {
          if (d < yesterday) { ledger.games[ev.id] = { d: isoOf(d), t: [], tid: [], s: [], skipped: "no box score" }; added++; }
          continue;
        }
        const { lines, dnp } = readGame(sum, match, d);
        for (const { id, name, pos, line } of lines) {
          const p = (ledger.players[id] ||= { n: name, p: pos, lines: [] });
          p.n = name; if (pos) p.p = pos;
          if (!p.lines.some((l) => l[0] === ev.id)) p.lines.push(line);
        }
        const teams = ev.competitions[0].competitors.slice().sort((a, b) => (a.homeAway === "home") - (b.homeAway === "home"));
        ledger.games[ev.id] = { d: isoOf(d), t: teams.map((c) => c.team.abbreviation), tid: teams.map((c) => c.team.id), s: teams.map((c) => Number(c.score) || 0), dnp };
        added++;
      } catch (e) {
        console.error(`game ${ev.id}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (added) ledger.updated = new Date().toISOString();
  return { added, waiting: pending.length - added, changed: added > 0 || done.size !== doneBefore };
}

// Season totals for every tracked alumnus, including anyone who hasn't played yet.
// names: ESPN's spelling for alumni who haven't played yet (from their team rosters), else the CSV's.
export function buildBoard(ledger, match, names = new Map()) {
  const schedule = {}; // alumni team id -> its games, oldest first
  for (const [id, g] of Object.entries(ledger.games)) {
    if (g.skipped) continue;
    g.tid.forEach((tid, i) => { if (match.teamIds.has(tid)) (schedule[tid] ||= []).push({ id, ...g, mine: i }); });
  }
  for (const list of Object.values(schedule)) list.sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id));

  const players = match.alumni.map((c) => {
    const p = ledger.players[c.espnId];
    const lines = [...(p?.lines || [])].sort((a, b) => a[1].localeCompare(b[1]));
    const tot = Object.fromEntries(STATS.map((k) => [k, 0]));
    for (const l of lines) for (const k of STATS) tot[k] += statOf(l, k);
    const games = schedule[c.teamId] || [];
    const team = lines.at(-1)?.[3] || games.at(-1)?.t[games.at(-1).mine] || "";
    const byGame = new Map(lines.map((l) => [l[0], l]));
    const last5 = games.slice(-5).reverse().map((g) => {
      const mine = g.s[g.mine], theirs = g.s[1 - g.mine];
      const row = { g: g.id, d: g.d, opp: g.t[1 - g.mine], home: g.mine === 1, r: mine > theirs ? "W" : "L", s: `${mine}-${theirs}` };
      const l = byGame.get(g.id);
      // ESPN lists some players as did-not-play, and leaves others off the box entirely.
      if (!l) return { ...row, dnp: g.dnp?.[c.espnId] || "Not in box score" };
      return { ...row, gs: l[4], ...Object.fromEntries(STATS.map((k) => [k, statOf(l, k)])) };
    });
    return {
      id: c.espnId, name: p?.n || names.get(c.espnId) || c.name, pos: p?.p || "", school: c.team, team, last5, teamGames: games.length,
      gp: lines.length, gs: lines.reduce((n, l) => n + l[4], 0), ...tot,
    };
  });
  return {
    boardVersion: BOARD_VERSION, league: ledger.league, season: ledger.season, alumniKey: ledger.alumniKey,
    label: `${ledger.season - 1}-${String(ledger.season).slice(2)}`,
    games: Object.values(ledger.games).filter((g) => !g.skipped).length,
    updated: ledger.updated,
    players,
    others: match.others,
    totalAlumni: match.total,
  };
}
