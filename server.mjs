// Local server for running and testing on your own machine: `node server.mjs`.
// On Netlify the same API is served by netlify/functions/ instead; both use lib/core.mjs.
// Marks and the season log are kept as JSON files in data/ here (Netlify Blobs on Netlify).
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alumniMatcher, boxscores, espnNames, game, parseLeague, schedule, validDate, validId } from "./lib/core.mjs";
import { buildBoard, currentSeason, ensureLedger, updateLedger } from "./lib/season.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const MARKS_FILE = path.join(DATA_DIR, "marks.json");

// ---------------------------------------------------------------- marks

let marks = null;
async function loadMarks() {
  if (marks) return marks;
  try { marks = JSON.parse(await readFile(MARKS_FILE, "utf8")); } catch { marks = {}; }
  return marks;
}
// Writes go through one chain so two clicks at once can't interleave and corrupt the file.
let saving = Promise.resolve();
function saveMarks() {
  saving = saving.then(async () => {
    await mkdir(path.dirname(MARKS_FILE), { recursive: true });
    await writeFile(MARKS_FILE, JSON.stringify(marks, null, 2));
  });
  return saving;
}

// ---------------------------------------------------------------- leaderboard
// Each league's season log lives in data/ledger-<league>-<season>.json locally. It's brought up to
// date at most every two minutes, when someone opens that league's Leaderboard.
const jobs = new Map();
async function localBoard(season, league) {
  const file = path.join(DATA_DIR, `ledger-${league}-${season}.json`);
  const match = await alumniMatcher(league);
  const key = match.alumni.map((c) => `${c.espnId}:${c.teamId}`).join(",");
  const job = jobs.get(league) || { running: null, checkedAt: 0, key: "" };
  jobs.set(league, job);
  if (!job.running && (Date.now() - job.checkedAt > 120_000 || job.key !== key)) {
    job.key = key;
    job.running = (async () => {
      const ledger = ensureLedger(await readFile(file, "utf8").then(JSON.parse).catch(() => null), season, match, league);
      // If ESPN is having trouble, show what's already saved rather than an error.
      const r = await updateLedger(ledger, match, { budgetMs: 60_000 }).catch((e) => {
        console.error(`leaderboard update failed (${league}): ${e.message}`);
        return { changed: false, waiting: 0 };
      });
      if (r.changed) {
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(file, JSON.stringify(ledger));
      }
      job.checkedAt = Date.now();
      job.waiting = r.waiting;
      return ledger;
    })().finally(() => { job.running = null; });
  }
  const ledger = await (job.running || readFile(file, "utf8").then(JSON.parse).catch(() => null));
  return { ...buildBoard(ensureLedger(ledger, season, match, league), match, await espnNames(match, league)), waiting: job.waiting || 0 };
}

// ---------------------------------------------------------------- http

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon" };

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (d) => { s += d; if (s.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const q = url.searchParams;
    const league = parseLeague(q.get("league"));
    if (url.pathname.startsWith("/api/") && !league) return send(res, 400, { error: "league must be ncaam or ncaaw" });

    if (url.pathname === "/api/boxscores") {
      if (!validDate(q.get("date"))) return send(res, 400, { error: "date must be YYYYMMDD" });
      return send(res, 200, await boxscores(q.get("date"), league));
    }
    if (url.pathname === "/api/game") {
      if (!validId(q.get("id"))) return send(res, 400, { error: "id must be an ESPN game id" });
      return send(res, 200, await game(q.get("id"), league));
    }
    if (url.pathname === "/api/schedule") {
      const days = Number(q.get("days") || 7);
      if (!validDate(q.get("from")) || !Number.isInteger(days) || days < 1 || days > 14) return send(res, 400, { error: "from must be YYYYMMDD and days 1-14" });
      return send(res, 200, await schedule(q.get("from"), days, league));
    }
    if (url.pathname === "/api/leaderboard") return send(res, 200, await localBoard(currentSeason(), league));

    if (url.pathname === "/api/marks" && req.method === "GET") {
      return send(res, 200, (await loadMarks())[q.get("date") || ""] || {});
    }
    if (url.pathname === "/api/marks" && req.method === "POST") {
      const { date, id, marked } = await readBody(req);
      if (!validDate(date) || !validId(id)) return send(res, 400, { error: "bad mark" });
      const all = await loadMarks();
      all[date] = all[date] || {};
      if (marked) all[date][id] = { at: new Date().toISOString() };
      else delete all[date][id];
      if (!Object.keys(all[date]).length) delete all[date];
      await saveMarks();
      return send(res, 200, all[date] || {});
    }

    // Static files from public/. /games and /game work without the .html, as they do on Netlify.
    let rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!path.extname(rel)) rel += ".html";
    const file = path.join(ROOT, "public", path.normalize(rel));
    if (!file.startsWith(path.join(ROOT, "public"))) return send(res, 404, "Not found", "text/plain");
    const body = await readFile(file).catch(() => null);
    if (!body) return send(res, 404, "Not found", "text/plain");
    return send(res, 200, body, TYPES[path.extname(file)] || "application/octet-stream");
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`Team Takeover Box Scores on http://localhost:${PORT}`));
