// Game page: the full box score for one game, from /api/game, with alumni highlighted.
const { $, esc } = K;
const params = new URL(location.href).searchParams;
const gameId = params.get("id") || "";
let backDate = K.validIso(params.get("date")) ? params.get("date") : "";
let data = null;
let tab = "box";

const COLS = [
  { key: "min", label: "MIN" },
  { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" },
  { key: "oreb", label: "OREB" },
  { key: "dreb", label: "DREB" },
  { key: "ast", label: "AST" },
  { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" },
  { key: "tov", label: "TOV" },
  { key: "pf", label: "PF" },
  { key: "fg", label: "FGM-A", show: (r) => `${r.fgm}-${r.fga}` },
  { key: "fgp", label: "FG%", show: (r) => K.pct(r.fgm, r.fga) },
  { key: "3pt", label: "3PM-A", show: (r) => `${r.tpm}-${r.tpa}` },
  { key: "tpp", label: "3P%", show: (r) => K.pct(r.tpm, r.tpa) },
  { key: "ft", label: "FTM-A", show: (r) => `${r.ftm}-${r.fta}` },
  { key: "ftp", label: "FT%", show: (r) => K.pct(r.ftm, r.fta) },
];

// Team stats tab, in the order ESPN's own team stats read.
const TEAM_STATS = [
  ["fieldGoalsMade-fieldGoalsAttempted", "Field goals"],
  ["fieldGoalPct", "Field goal %"],
  ["threePointFieldGoalsMade-threePointFieldGoalsAttempted", "Threes"],
  ["threePointFieldGoalPct", "Three-point %"],
  ["freeThrowsMade-freeThrowsAttempted", "Free throws"],
  ["freeThrowPct", "Free throw %"],
  ["totalRebounds", "Rebounds"],
  ["offensiveRebounds", "Offensive rebounds"],
  ["defensiveRebounds", "Defensive rebounds"],
  ["assists", "Assists"],
  ["steals", "Steals"],
  ["blocks", "Blocks"],
  ["totalTurnovers", "Turnovers"],
  ["turnoverPoints", "Points off turnovers"],
  ["fastBreakPoints", "Fast break points"],
  ["pointsInPaint", "Points in the paint"],
  ["fouls", "Fouls"],
  ["largestLead", "Largest lead"],
];

// Period headers come from the game itself: 2 halves for men, 4 quarters for women, then overtimes.
function periodLabel(i, reg) {
  if (i < reg) return reg === 2 ? `H${i + 1}` : `Q${i + 1}`;
  return i === reg ? "OT" : `${i - reg + 1}OT`;
}

async function load() {
  try {
    data = await K.getJson(`api/game?id=${encodeURIComponent(gameId)}${K.lg()}`);
    if (!backDate) backDate = K.etDateOf(data.start);
    $("status").innerHTML = "";
  } catch (e) {
    if (!data) $("status").innerHTML = `<div class="error">Couldn't load this game: ${esc(e.message)}</div>`;
  }
  render();
}

function renderHead() {
  const [away, home] = data.teams;
  document.title = `${away.abbr} @ ${home.abbr} · Team Takeover Box Scores`;
  $("title").textContent = `${away.name} at ${home.name}, ${K.longDate(backDate)}`;
  $("eyebrow").textContent = `${K.seasonLabel(backDate)} · BOX SCORE`;
  $("back").href = `games?date=${backDate}${K.lg()}`;
  $("back-label").textContent = `Games · ${K.shortDate(backDate)}`;
  $("games-link").href = `games?date=${backDate}${K.lg()}`;
  $("players-link").href = `./?date=${backDate}${K.lg()}`;
  $("espn-links").innerHTML = K.espnLink(data.espn.box, "ESPN box score") + K.espnLink(data.espn.game, "ESPN gamecast");

  const where = [data.venue, data.city].filter(Boolean).join(", ");
  const status = data.state === "in" ? `<span class="live">LIVE · ${esc(data.status)}</span>`
    : data.state === "pre" ? esc(K.etTime(data.start)) : esc(data.status);
  $("meta").innerHTML = `${esc(K.longDate(backDate))}${where ? ` · ${esc(where)}` : ""} · ${status}`;

  const done = data.state === "post";
  $("scoreline").innerHTML = data.teams.map((t) => `
    <div class="sl-team${done && t.winner ? " won" : ""}${done && !t.winner ? " lost" : ""}">
      <img src="${esc(t.logo)}" alt="" width="40" height="40">
      <div class="sl-name"><span>${K.teamName(t)}</span><small>${esc(t.record)}${t.home ? " · Home" : " · Away"}</small></div>
      <span class="sl-score">${data.state === "pre" ? "–" : t.score}</span>
    </div>`).join("");

  const periods = Math.max(...data.teams.map((t) => t.linescores.length));
  $("linescore").innerHTML = periods ? `
    <thead><tr><th scope="col"></th>${Array.from({ length: periods }, (_, i) => `<th scope="col">${periodLabel(i, data.regPeriods)}</th>`).join("")}<th scope="col" class="t">T</th></tr></thead>
    <tbody>${data.teams.map((t) => `<tr><th scope="row">${esc(t.abbr)}</th>${Array.from({ length: periods }, (_, i) => `<td>${t.linescores[i] ?? ""}</td>`).join("")}<td class="t">${t.score}</td></tr>`).join("")}</tbody>` : "";

  const alumni = data.teams.flatMap((t) => [...t.starters, ...t.bench, ...t.dnp]).filter((p) => p.alum);
  $("game-alumni").hidden = !alumni.length;
  $("game-alumni").innerHTML = alumni.length ? `${K.badge()} ${alumni.map((p) => `${esc(p.name)} <span class="sub">${esc(p.team)}</span>`).join(" · ")}` : "";
}

function playerRow(p) {
  const name = `<div class="player">${K.shot(p, "sm")}<div class="who">
      <a class="name" href="${K.playerHref(p.id)}" target="_blank" rel="noopener">${esc(p.name)}</a>
      <span class="meta">${p.alum ? K.badge(true) : ""}<span class="sub">${esc(p.pos)}${p.jersey ? ` · #${esc(p.jersey)}` : ""}</span></span>
    </div></div>`;
  if (p.dnp) {
    return `<tr class="${p.alum ? "is-alum" : ""}"><td class="sticky">${name}</td><td class="dnp-reason" colspan="${COLS.length}">${esc(K.titleCase(p.reason))}</td></tr>`;
  }
  return `<tr class="${p.alum ? "is-alum" : ""}"><td class="sticky">${name}</td>${COLS.map((c) => {
    return `<td class="num${c.key === "pts" ? " pts" : ""}">${esc(c.show ? c.show(p) : p[c.key])}</td>`;
  }).join("")}</tr>`;
}

function teamBox(t) {
  const sub = (label) => `<tr class="subhead"><th scope="rowgroup" class="sticky">${label}</th><td colspan="${COLS.length}"></td></tr>`;
  const tot = t.totals;
  const totals = tot ? `<tr class="totals"><th scope="row" class="sticky">Team totals</th>${COLS.map((c) => {
    if (c.key === "min") return `<td class="num"></td>`;
    return `<td class="num${c.key === "pts" ? " pts" : ""}">${esc(c.show ? c.show(tot) : tot[c.key])}</td>`;
  }).join("")}</tr>` : "";

  return `<div class="teambox">
    <h2 class="teambox-head"><img src="${esc(t.logo)}" alt="" width="28" height="28">${K.teamName(t)} <small>${esc(t.record)}</small><span class="teambox-score">${t.score}</span></h2>
    <div class="tablewrap boxwrap">
      <table class="boxtable">
        <thead><tr><th scope="col" class="sticky" style="min-width:240px">${t.starters.length ? "STARTERS" : "PLAYER"}</th>${COLS.map((c) => `<th scope="col" class="num-h">${c.label}</th>`).join("")}</tr></thead>
        <tbody>
          ${t.starters.map(playerRow).join("")}
          ${t.bench.length ? sub("BENCH") + t.bench.map(playerRow).join("") : ""}
          ${t.dnp.length ? sub("DID NOT PLAY") + t.dnp.map(playerRow).join("") : ""}
          ${totals}
        </tbody>
      </table>
    </div>
  </div>`;
}

function teamStats() {
  const [away, home] = data.teams;
  const rows = TEAM_STATS.filter(([k]) => away.stats[k] != null || home.stats[k] != null);
  if (!rows.length) return `<p class="empty">Team stats show up once the game starts.</p>`;
  return `<div class="tablewrap statwrap"><table class="teamstats">
    <thead><tr><th scope="col">STAT</th><th scope="col" class="num-h"><img src="${esc(away.logo)}" alt="" width="20" height="20"> ${esc(away.abbr)}</th><th scope="col" class="num-h"><img src="${esc(home.logo)}" alt="" width="20" height="20"> ${esc(home.abbr)}</th></tr></thead>
    <tbody>${rows.map(([k, label]) => `<tr><th scope="row">${label}</th><td class="num">${esc(away.stats[k] ?? "–")}</td><td class="num">${esc(home.stats[k] ?? "–")}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function render() {
  if (!data) return;
  renderHead();
  $("tab-box").setAttribute("aria-selected", String(tab === "box"));
  $("tab-team").setAttribute("aria-selected", String(tab === "team"));
  $("panel-box").hidden = tab !== "box";
  $("panel-team").hidden = tab !== "team";
  $("panel-box").innerHTML = data.state === "pre"
    ? `<p class="empty">The box score shows up once the game tips off.</p>`
    : data.teams.map(teamBox).join("");
  $("panel-team").innerHTML = teamStats();
  $("foot").textContent = `Updated ${new Date(data.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" })} ET${data.state === "in" ? " · refreshing every 30 seconds" : ""}`;
}

$("tab-box").addEventListener("click", () => { tab = "box"; render(); });
$("tab-team").addEventListener("click", () => { tab = "team"; render(); });

if (!/^\d+$/.test(gameId)) $("status").innerHTML = `<div class="error">No game picked. Go back to Games and open one.</div>`;
else {
  $("status").innerHTML = K.loading("Loading box score…");
  load();
  setInterval(() => { if (!document.hidden && data && data.state !== "post") load(); }, 30_000);
}
