// Everything that reads ESPN and the alumni list. Shared by the local server (server.mjs) and the
// Netlify functions (netlify/functions/), so both serve exactly the same data.
//
// The site covers Division I men's (NCAAM) and women's (NCAAW) college basketball. The league travels
// through every function, ESPN URL and cache key: team ids are only unique within a league (Duke is
// 150 for both), so the two can never mix. Adding the NBA later means adding it to LEAGUES and giving
// it its own scoreboard request (the NBA doesn't take groups=50).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESPN_ROOT = "https://site.api.espn.com/apis/site/v2/sports/basketball";

// code is the league column in alumni.csv. periods is regulation length if a game doesn't say:
// 2 halves for men, 4 quarters for women.
export const LEAGUES = {
  ncaam: { key: "ncaam", label: "NCAAM", code: "M", slug: "mens-college-basketball", periods: 2 },
  ncaaw: { key: "ncaaw", label: "NCAAW", code: "W", slug: "womens-college-basketball", periods: 4 },
};
export const DEFAULT_LEAGUE = "ncaam";
// The league from a request: none means NCAAM, so links from before NCAAW was added keep working.
export function parseLeague(v) {
  if (v == null || v === "") return DEFAULT_LEAGUE;
  return Object.hasOwn(LEAGUES, v) ? v : null;
}
const base = (league) => `${ESPN_ROOT}/${LEAGUES[league].slug}`;
export const headshotUrl = (id, league = DEFAULT_LEAGUE) => `https://a.espncdn.com/i/headshots/${LEAGUES[league].slug}/players/full/${id}.png`;

// How long ESPN responses are reused, kept short so the site is never more than a minute or two
// behind ESPN. Finished games still re-check hourly to pick up ESPN's occasional stat corrections.
export const SCOREBOARD_TTL = 60_000;
export const LIVE_GAME_TTL = 30_000;
const FINAL_GAME_TTL = 3600_000;
const ROSTER_TTL = 5 * 60_000;
const NAMES_TTL = 6 * 3600_000; // ESPN's spelling of each alumnus's name, for lists without a box line

// ---------------------------------------------------------------- alumni.csv

function parseCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Where alumni.csv lives differs between running locally and inside a bundled Netlify function,
// so try each place it can be. ALUMNI_FILE overrides all of them.
function alumniFileCandidates() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    process.env.ALUMNI_FILE,
    path.join(here, "..", "alumni.csv"),
    path.join(process.cwd(), "alumni.csv"),
    process.env.LAMBDA_TASK_ROOT && path.join(process.env.LAMBDA_TASK_ROOT, "alumni.csv"),
  ].filter(Boolean);
}

// Every row of alumni.csv. Re-read on every request, so a local edit shows up without a restart.
export async function loadAlumni() {
  let text = null;
  for (const f of alumniFileCandidates()) {
    text = await readFile(f, "utf8").catch(() => null);
    if (text != null) break;
  }
  if (text == null) throw new Error("alumni.csv not found");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const head = parseCsvLine(lines[0] || "").map((h) => h.toLowerCase());
  const col = (name) => head.indexOf(name);
  if (col("name") < 0 || col("espn_id") < 0) throw new Error('alumni.csv needs "name" and "espn_id" columns');
  const get = (c, name) => (col(name) >= 0 ? c[col(name)] || "" : "");
  return lines.slice(1).map(parseCsvLine).map((c) => ({
    name: get(c, "name"), espnId: get(c, "espn_id"), teamId: get(c, "team_id"), team: get(c, "team"),
    // No league column (or a blank one) means men's, so older copies of the file still work.
    league: (get(c, "league") || "M").toUpperCase(),
    years: get(c, "roster_years"), status: (get(c, "status") || "tracked").toLowerCase(), note: get(c, "note"),
  })).filter((a) => a.name || a.espnId);
}

// The alumni whose box scores the site can show (status "tracked", with an ESPN id and a D-I team),
// matched by ESPN id only, never by name. Everyone else is listed under "Alumni not on a D-I roster".
// Each league only sees its own rows, since team ids are only unique within a league.
export async function alumniMatcher(league = DEFAULT_LEAGUE) {
  const all = (await loadAlumni()).filter((a) => a.league === LEAGUES[league].code);
  const alumni = all.filter((a) => a.status === "tracked" && a.espnId && a.teamId);
  const others = all.filter((a) => !alumni.includes(a)).map(({ name, team, status, note, years }) => ({ name, team, status, note, years }));
  const byId = new Map(alumni.map((a) => [a.espnId, a]));
  return { alumni, others, total: all.length, teamIds: new Set(alumni.map((a) => a.teamId)), find: (id) => byId.get(String(id)) || null };
}

// ---------------------------------------------------------------- ESPN

// ESPN sometimes answers 200 with an empty body, or a cached empty response for a date. An empty
// body counts as a failure and is retried 3 times with backoff. If it still fails, the last good
// copy is served when there is one, and the next request tries ESPN again.
const cache = new Map();
export async function fetchJson(url) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "team-takeover-boxscores" } });
      if (!r.ok) throw new Error(`ESPN ${r.status} for ${url}`);
      const text = await r.text();
      if (!text.trim()) throw new Error(`ESPN sent an empty response for ${url}`);
      return JSON.parse(text);
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((res) => setTimeout(res, 400 * 2 ** (i - 1)));
    }
  }
}
async function getJson(url, ttlMs) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  try {
    const data = await fetchJson(url);
    cache.set(url, { at: Date.now(), ttl: ttlMs, data });
    return data;
  } catch (e) {
    if (hit) { console.error(`${e.message}; serving the saved copy`); return hit.data; }
    throw e;
  }
}

// Without groups=50 (Division I) and a high limit, ESPN quietly returns only some of the day's
// games. Games stay in the date bucket ESPN lists them under, even when a late tip crosses midnight ET.
const scoreboard = (league, date) => getJson(`${base(league)}/scoreboard?dates=${date}&groups=50&limit=1000`, SCOREBOARD_TTL);
const summaryUrl = (league, id) => `${base(league)}/summary?event=${id}`;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const madeAtt = (v) => String(v || "0-0").split("-").map(num);
export const espnLinks = (id, league = DEFAULT_LEAGUE) => ({
  box: `https://www.espn.com/${LEAGUES[league].slug}/boxscore/_/gameId/${id}`,
  game: `https://www.espn.com/${LEAGUES[league].slug}/game/_/gameId/${id}`,
});

// ESPN labels each stat column, and the order has changed before, so stats are read by label.
// College box scores have no +/-, so it isn't read at all.
export function readLine(labels, stats) {
  const at = (l) => stats[labels.indexOf(l)];
  const [fgm, fga] = madeAtt(at("FG"));
  const [tpm, tpa] = madeAtt(at("3PT"));
  const [ftm, fta] = madeAtt(at("FT"));
  return {
    min: num(at("MIN")), pts: num(at("PTS")), reb: num(at("REB")), oreb: num(at("OREB")), dreb: num(at("DREB")),
    ast: num(at("AST")), stl: num(at("STL")), blk: num(at("BLK")), tov: num(at("TO")), pf: num(at("PF")),
    fgm, fga, tpm, tpa, ftm, fta,
  };
}

// College poll rank, or null. ESPN uses 99 for unranked, and the game summary just leaves rank out.
function rankOf(c) {
  const r = Number(c.curatedRank?.current ?? c.rank);
  return r >= 1 && r <= 25 ? r : null;
}

function teamFromCompetitor(c) {
  return {
    id: c.team.id,
    abbr: c.team.abbreviation,
    name: c.team.displayName,
    short: c.team.shortDisplayName || c.team.location || c.team.name || c.team.abbreviation,
    logo: c.team.logo || c.team.logos?.[0]?.href || "",
    home: c.homeAway === "home",
    score: num(c.score),
    winner: !!c.winner,
    record: (c.records || c.record || []).find((r) => r.type === "total")?.summary || "",
    linescores: (c.linescores || []).map((l) => num(l.value ?? l.displayValue)),
    rank: rankOf(c),
  };
}
const teamsOf = (comp) => comp.competitors.map(teamFromCompetitor).sort((a, b) => a.home - b.home); // away first

// ESPN often gives no reason for a college DNP.
const dnpReason = (a) => (a.reason && a.reason.trim()) || "Did Not Play";

// Every player line in one game, with alumni flagged.
function playersFromSummary(sum, teams, gameId, state, statusText, match, league) {
  const players = [];
  for (const side of sum.boxscore?.players || []) {
    const team = teams.find((t) => t.id === side.team.id) || teams.find((t) => t.abbr === side.team.abbreviation);
    const opp = teams.find((t) => t !== team);
    const block = side.statistics?.[0];
    if (!block || !team || !opp) continue;
    for (const a of block.athletes || []) {
      const p = {
        id: a.athlete.id,
        name: a.athlete.displayName,
        pos: a.athlete.position?.abbreviation || "",
        jersey: a.athlete.jersey || "",
        headshot: a.athlete.headshot?.href || headshotUrl(a.athlete.id, league),
        alum: !!match.find(a.athlete.id),
        teamId: team.id, team: team.abbr, school: team.short, opp: opp.abbr, oppName: opp.short, oppRank: opp.rank, home: team.home,
        result: state === "post" ? (team.winner ? "W" : "L") : "",
        score: `${team.score}-${opp.score}`,
        gameId, gameState: state, gameStatus: statusText,
        starter: !!a.starter,
      };
      if (a.didNotPlay || !a.stats?.length) players.push({ ...p, dnp: true, reason: dnpReason(a) });
      else players.push({ ...p, dnp: false, ...readLine(block.labels, a.stats) });
    }
  }
  return players;
}

// Each alumni team's alumni with ESPN's current name and photo, from the rosters of only those teams
// (ESPN's /teams list is incomplete for college without a limit, so it isn't used). An alumnus
// missing from their listed team's roster falls back to the CSV's name and is reported.
async function rosterAlumni(league, match, teamIds, ttl = ROSTER_TTL) {
  const rosters = new Map();
  await Promise.all([...teamIds].map(async (teamId) => {
    const r = await getJson(`${base(league)}/teams/${teamId}/roster`, ttl).catch(() => null);
    rosters.set(teamId, new Map((r?.athletes || []).map((a) => [a.id, a])));
  }));
  const byTeam = new Map();
  const unrostered = [];
  for (const c of match.alumni) {
    if (!teamIds.has(c.teamId)) continue;
    const a = rosters.get(c.teamId)?.get(c.espnId);
    if (!a) unrostered.push(c.name);
    if (!byTeam.has(c.teamId)) byTeam.set(c.teamId, []);
    byTeam.get(c.teamId).push({
      id: c.espnId, name: a?.displayName || c.name, pos: a?.position?.abbreviation || "",
      headshot: a?.headshot?.href || headshotUrl(c.espnId, league),
    });
  }
  for (const list of byTeam.values()) list.sort((x, y) => x.name.localeCompare(y.name));
  return { byTeam, unrostered };
}

// ESPN's name for every tracked alumnus (id -> name), so lists of alumni without a box line still use
// ESPN's spelling. Falls back to the CSV name if a roster can't be read.
export async function espnNames(match, league = DEFAULT_LEAGUE) {
  const { byTeam } = await rosterAlumni(league, match, match.teamIds, NAMES_TTL).catch(() => ({ byTeam: new Map() }));
  return new Map([...byTeam.values()].flat().map((p) => [p.id, p.name]));
}

// Only games with an alumni team are ever fetched.
const alumniEvents = (board, match) => (board.events || []).filter((ev) => ev.competitions[0].competitors.some((c) => match.teamIds.has(c.team.id)));

// ---------------------------------------------------------------- one date's box scores

export async function boxscores(date, league = DEFAULT_LEAGUE) {
  const match = await alumniMatcher(league);
  const [board, names] = await Promise.all([scoreboard(league, date), espnNames(match, league)]);
  const events = alumniEvents(board, match);
  const preTeams = new Set(events.filter((ev) => ev.competitions[0].status.type.state === "pre")
    .flatMap((ev) => ev.competitions[0].competitors.map((c) => c.team.id)).filter((id) => match.teamIds.has(id)));
  const pre = preTeams.size ? await rosterAlumni(league, match, preTeams) : null;

  const players = [];
  const teamState = new Map(); // alumni team id -> its game, to explain an alumnus who isn't in a box
  const games = await Promise.all(events.map(async (ev) => {
    const comp = ev.competitions[0];
    const state = comp.status.type.state; // pre | in | post
    const status = comp.status.type.shortDetail;
    const teams = teamsOf(comp);
    for (const t of teams) teamState.set(t.id, { id: ev.id, state, team: t, opp: teams.find((x) => x !== t) });
    const out = { id: ev.id, state, status, start: comp.date, teams, espn: espnLinks(ev.id, league), alumni: [] };
    if (state === "pre") {
      out.alumni = teams.flatMap((t) => (pre?.byTeam.get(t.id) || []).map((p) => ({ name: p.name, team: t.abbr, pts: null })));
      return out;
    }
    const sum = await getJson(summaryUrl(league, ev.id), state === "post" ? FINAL_GAME_TTL : LIVE_GAME_TTL);
    const got = playersFromSummary(sum, teams, ev.id, state, status, match, league).filter((p) => p.alum);
    players.push(...got);
    out.alumni = got.filter((p) => !p.dnp).map((p) => ({ name: p.name, team: p.team, pts: p.pts })).sort((a, b) => b.pts - a.pts);
    return out;
  }));
  games.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

  // An alumnus with no box line: their team didn't play, its game hasn't started, or it played and
  // they aren't listed. College injury lists are usually empty, so they aren't used for this.
  const inBox = new Set(players.map((p) => p.id));
  const missing = match.alumni.filter((c) => !inBox.has(c.espnId)).map((c) => {
    const g = teamState.get(c.teamId);
    const who = { id: c.espnId, name: names.get(c.espnId) || c.name, school: c.team };
    if (!g) return { ...who, kind: "nogame", reason: "No game" };
    if (g.state === "pre") return { ...who, kind: "pending", reason: "Game hasn't started", team: g.team.abbr, opp: g.opp.abbr, home: g.team.home };
    return { ...who, kind: "notinbox", reason: "Not in box score", team: g.team.abbr, opp: g.opp.abbr, home: g.team.home, gameId: g.id };
  });

  return {
    date, league,
    updatedAt: new Date().toISOString(),
    games,
    boardGames: (board.events || []).length,
    played: players.filter((p) => !p.dnp),
    dnp: players.filter((p) => p.dnp).map((p) => ({ id: p.id, name: p.name, team: p.team, school: p.school, opp: p.opp, home: p.home, gameId: p.gameId, reason: p.reason })),
    missing,
    others: match.others,
    alumniCount: match.alumni.length,
    totalAlumni: match.total,
  };
}

// ---------------------------------------------------------------- one game

// Laid out like a printed box score: both teams' starters, bench, DNPs, totals and team stats.
export async function game(id, league = DEFAULT_LEAGUE) {
  const match = await alumniMatcher(league);
  const url = summaryUrl(league, id);
  const sum = await getJson(url, LIVE_GAME_TTL);
  const comp = sum.header.competitions[0];
  const state = comp.status.type.state;
  if (state === "post" && cache.get(url)) cache.get(url).ttl = FINAL_GAME_TTL;
  const status = comp.status.type.shortDetail;
  const teams = teamsOf(comp);
  const players = playersFromSummary(sum, teams, id, state, status, match, league);

  const sides = teams.map((t) => {
    const side = (sum.boxscore?.players || []).find((s) => s.team.id === t.id);
    const block = side?.statistics?.[0];
    const mine = players.filter((p) => p.teamId === t.id);
    const totals = block?.totals?.length ? readLine(block.labels, block.totals) : null;
    const teamStats = (sum.boxscore?.teams || []).find((s) => s.team.id === t.id)?.statistics || [];
    return {
      ...t,
      starters: mine.filter((p) => p.starter && !p.dnp),
      bench: mine.filter((p) => !p.starter && !p.dnp),
      dnp: mine.filter((p) => p.dnp),
      totals,
      stats: Object.fromEntries(teamStats.map((s) => [s.name, s.displayValue])),
    };
  });

  return {
    id, state, status, league,
    start: comp.date,
    venue: sum.gameInfo?.venue?.fullName || "",
    city: [sum.gameInfo?.venue?.address?.city, sum.gameInfo?.venue?.address?.state].filter(Boolean).join(", "),
    attendance: sum.gameInfo?.attendance || 0,
    teams: sides,
    espn: espnLinks(id, league),
    // Periods in regulation come from the game: 2 halves for men, 4 quarters for women, then overtimes.
    regPeriods: sum.format?.regulation?.periods || LEAGUES[league].periods,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- schedule

// The TV listing the way a schedule prints it: national networks if there are any, else the rest.
function tvFor(comp) {
  const b = comp.broadcasts || [];
  const national = b.filter((x) => x.market === "national").flatMap((x) => x.names || []);
  return (national.length ? national : b.flatMap((x) => x.names || [])).filter((n, i, all) => all.indexOf(n) === i).join(", ");
}

export function shiftYmd(ymd, days) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + days));
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

// Every alumni-team game from `from` for `days` days, each team carrying the alumni on its roster.
export async function schedule(from, days, league = DEFAULT_LEAGUE) {
  const match = await alumniMatcher(league);
  const dates = Array.from({ length: days }, (_, i) => shiftYmd(from, i));
  const boards = await Promise.all(dates.map((d) => scoreboard(league, d)));
  const eventsByDate = boards.map((b) => alumniEvents(b, match));
  const playing = new Set(eventsByDate.flat().flatMap((ev) => ev.competitions[0].competitors.map((c) => c.team.id)).filter((id) => match.teamIds.has(id)));
  const { byTeam, unrostered } = await rosterAlumni(league, match, playing);
  const out = dates.map((date, i) => ({
    date,
    games: eventsByDate[i].map((ev) => {
      const comp = ev.competitions[0];
      const teams = teamsOf(comp).map((t) => ({ ...t, alumni: byTeam.get(t.id) || [] }));
      return { id: ev.id, start: comp.date, state: comp.status.type.state, status: comp.status.type.shortDetail, venue: comp.venue?.fullName || "", tv: tvFor(comp), teams, espn: espnLinks(ev.id, league) };
    }).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
  }));
  return { from, days, dates, league, schedule: out, unrostered, alumniCount: match.alumni.length, updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- shared request checks

export const validDate = (d) => /^\d{8}$/.test(d || "");
export const validId = (id) => /^\d+$/.test(String(id || ""));
export const etYmd = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replaceAll("-", "");

// How long Netlify's CDN may keep a response: an hour once the day is over and every game is final
// (only rare stat corrections change it then), 30 seconds otherwise.
export function cacheSecondsFor(games, date) {
  const over = date ? date < etYmd() : true;
  return over && games.every((g) => g.state === "post") ? 3600 : 30;
}
export function scheduleCacheSeconds(data) {
  if (data.schedule.some((d) => d.games.some((g) => g.state === "in"))) return 30;
  return data.dates.every((d) => d < etYmd()) ? 3600 : 60;
}
