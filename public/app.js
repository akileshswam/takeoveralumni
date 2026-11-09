// Players page: every Team Takeover alumnus's line for one date, from /api/boxscores.
const { $, esc } = K;

const pctOf = (m, a) => (a ? m / a : -1); // no attempts sorts below 0%
const COLS = [
  { key: "min", label: "MIN", title: "Minutes" },
  { key: "pts", label: "PTS", title: "Points" },
  { key: "reb", label: "REB", title: "Rebounds" },
  { key: "oreb", label: "OREB", title: "Offensive rebounds" },
  { key: "dreb", label: "DREB", title: "Defensive rebounds" },
  { key: "ast", label: "AST", title: "Assists" },
  { key: "stl", label: "STL", title: "Steals" },
  { key: "blk", label: "BLK", title: "Blocks" },
  { key: "tov", label: "TOV", title: "Turnovers" },
  { key: "pf", label: "PF", title: "Personal fouls" },
  { key: "fgm", label: "FGM-A", title: "Field goals made-attempted", show: (r) => `${r.fgm}-${r.fga}` },
  { key: "fgp", label: "FG%", title: "Field goal percentage", v: (r) => pctOf(r.fgm, r.fga), show: (r) => K.pct(r.fgm, r.fga) },
  { key: "tpm", label: "3PM-A", title: "Threes made-attempted", show: (r) => `${r.tpm}-${r.tpa}` },
  { key: "tpp", label: "3P%", title: "Three-point percentage", v: (r) => pctOf(r.tpm, r.tpa), show: (r) => K.pct(r.tpm, r.tpa) },
  { key: "ftm", label: "FTM-A", title: "Free throws made-attempted", show: (r) => `${r.ftm}-${r.fta}` },
  { key: "ftp", label: "FT%", title: "Free throw percentage", v: (r) => pctOf(r.ftm, r.fta), show: (r) => K.pct(r.ftm, r.fta) },
];
const valueOf = (c, r) => (c.v ? c.v(r) : r[c.key]);

const state = {
  date: "",          // YYYY-MM-DD
  data: null,
  marks: {},
  view: "alumni",
  q: "",
  sortKey: "pts",
  dir: -1,
  loading: false,
  error: "",
  sched: null,       // the date's games with each team's alumni, from /api/schedule
};

// ------------------------------------------------------------ data

async function load() {
  const date = state.date;
  state.loading = true;
  state.error = "";
  render();
  try {
    const [box, marks, sched] = await Promise.all([
      K.getJson(`api/boxscores?date=${K.compact(date)}${K.lg()}`),
      K.getJson(`api/marks?date=${K.compact(date)}`),
      K.getJson(`api/schedule?from=${K.compact(date)}&days=1${K.lg()}`).catch(() => null),
    ]);
    if (date !== state.date) return; // the user moved on while this was loading
    state.data = box;
    state.marks = marks;
    state.sched = sched;
  } catch (e) {
    if (date !== state.date) return;
    if (!state.data) state.error = `Couldn't load box scores: ${e.message}`;
  }
  state.loading = false;
  render();
}

// Other people's marks show up without a reload.
async function refreshMarks() {
  if (!state.date || document.hidden) return;
  try {
    const m = await K.getJson(`api/marks?date=${K.compact(state.date)}`);
    if (JSON.stringify(m) !== JSON.stringify(state.marks)) { state.marks = m; render(); }
  } catch { /* try again next tick */ }
}

async function toggleMark(id) {
  const marked = !state.marks[id];
  const before = state.marks;
  state.marks = { ...state.marks };
  if (marked) state.marks[id] = { at: new Date().toISOString() }; else delete state.marks[id];
  render();
  try {
    const r = await fetch("api/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: K.compact(state.date), id, marked }),
    });
    if (!r.ok) throw new Error();
    state.marks = await r.json();
  } catch {
    state.marks = before;
    alert("That mark didn't save. Try again.");
  }
  render();
}

// ------------------------------------------------------------ games below the table

const shortTime = (iso) => K.etTime(iso).replace(" ET", "");

function chip(c) {
  return `<span class="chip"><img src="${esc(c.headshot)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${K.SILHOUETTE}'">${esc(c.name)}</span>`;
}

function gameStatus(g) {
  if (g.state === "in") return `<span class="live">LIVE</span><span>${esc(g.status)}</span>`;
  if (g.state === "post") return `<span>${esc(g.status)}</span>`;
  return `<b>${esc(shortTime(g.start))}</b>`;
}

function gameRow(g, iso) {
  const done = g.state === "post";
  const teams = g.teams.map((t) => `
    <div class="sr-team${done && t.winner ? " won" : ""}${done && !t.winner ? " lost" : ""}">
      <img src="${esc(t.logo)}" alt="" width="22" height="22" loading="lazy">
      <span class="sr-name">${K.teamName(t)}</span>
      <span class="sr-rec">${esc(t.record)}</span>
      <span class="sr-score">${g.state === "pre" ? "" : t.score}</span>
    </div>`).join("");
  const alumni = g.teams.filter((t) => t.alumni.length).map((t) => `
    <div class="sr-alumni"><span class="sr-abbr">${esc(t.abbr)}</span><div class="chips">${t.alumni.map(chip).join("")}</div></div>`).join("");
  const link = g.state === "pre"
    ? K.espnLink(g.espn.game, "ESPN preview")
    : `<a href="${K.gameHref(g.id, iso)}">Box score</a>${K.espnLink(g.espn.box, "ESPN")}`;
  return `<article class="sched-row">
    <div class="sr-when">${gameStatus(g)}<span class="sr-tv">${esc(g.tv)}</span><div class="sr-links">${link}</div></div>
    <div class="sr-teams">${teams}</div>
    <div class="sr-right">${alumni || `<span class="sr-none">No alumni</span>`}</div>
  </article>`;
}

function renderSchedule() {
  const day = state.sched?.schedule?.[0];
  $("sched-section").hidden = !day || !day.games.length;
  if (!day) return;
  const n = day.games.reduce((s, g) => s + g.teams.reduce((m, t) => m + t.alumni.length, 0), 0);
  $("sched-n").textContent = `${day.games.length} game${day.games.length === 1 ? "" : "s"} · ${n} alumni on a roster`;
  $("sched").innerHTML = day.games.map((g) => gameRow(g, state.date)).join("");
}

// ------------------------------------------------------------ the table

function who(r, short = false) {
  return `<div class="who">
    <a class="name" href="${K.playerHref(r.id)}" target="_blank" rel="noopener">${esc(r.name)}</a>
    <span class="meta">${K.badge(short)}<span class="sub">${esc(r.school)}${r.pos ? " · " + esc(r.pos) : ""}${r.starter ? "" : " · Bench"}</span></span>
  </div>`;
}
function result(r) {
  if (r.gameState === "in") return `<span class="live">LIVE</span> ${esc(r.score)} · ${esc(r.gameStatus)}`;
  return `<span class="${r.result}">${r.result}</span> ${esc(r.score)}`;
}
function matchup(r) {
  const g = state.data.games.find((x) => x.id === r.gameId);
  const rank = r.oppRank ? `<span class="rk">${r.oppRank}</span> ` : "";
  return `<a class="game-link" href="${K.gameHref(r.gameId, state.date)}">${r.home ? "vs" : "@"} ${rank}${esc(r.oppName || r.opp)}</a>`
    + `<span class="res">${result(r)}${g ? ` · ${K.espnLink(g.espn.box)}` : ""}</span>`;
}
function markBtn(r) {
  const on = !!state.marks[r.id];
  return `<button type="button" class="mark" data-mark="${esc(r.id)}" aria-pressed="${on}" title="${on ? "Marked to post" : "Mark to post"}" aria-label="${on ? "Unmark" : "Mark"} ${esc(r.name)} to post">${K.BOOKMARK}</button>`;
}

function visibleRows() {
  const d = state.data;
  if (!d) return [];
  const q = state.q.trim().toLowerCase();
  const rows = d.played.filter((r) => {
    if (state.view === "marked" && !state.marks[r.id]) return false;
    if (q && !`${r.name} ${r.school} ${r.team} ${r.oppName} ${r.opp}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const col = COLS.find((c) => c.key === state.sortKey);
  return rows.sort((a, b) => (valueOf(col, a) - valueOf(col, b)) * state.dir || b.pts - a.pts || a.name.localeCompare(b.name));
}

function renderHead() {
  const cols = COLS.map((c) => {
    const on = c.key === state.sortKey;
    const sort = on ? (state.dir < 0 ? "descending" : "ascending") : "none";
    return `<th scope="col" class="num${on ? " on" : ""}" aria-sort="${sort}"><button type="button" data-sort="${c.key}" title="Sort by ${c.title}">${c.label}<span class="arrow">${on ? (state.dir < 0 ? "↓" : "↑") : ""}</span></button></th>`;
  }).join("");
  $("headrow").innerHTML = `<th scope="col" class="sticky" style="min-width:270px">PLAYER</th><th scope="col" style="min-width:190px">MATCHUP</th>${cols}<th scope="col" class="c">POST</th>`;
  const active = COLS.find((c) => c.key === state.sortKey);
  $("sortlabel").textContent = `${active.label}, ${state.dir < 0 ? "high to low" : "low to high"}`;
}

function render() {
  const d = state.data;
  $("date").value = state.date;
  $("season").textContent = K.seasonLabel(state.date);
  $("games-link").href = `games?date=${state.date}${K.lg()}`;
  renderHead();

  for (const b of document.querySelectorAll("#viewseg button")) b.setAttribute("aria-pressed", String(b.dataset.view === state.view));

  const played = d ? d.played : [];
  const markedIds = played.filter((r) => state.marks[r.id]).map((r) => r.id);
  $("n-alumni").textContent = d ? played.length : "";
  $("n-marked").textContent = d ? markedIds.length : "";

  const gamesTotal = d ? d.games.length : 0;
  $("t-played").innerHTML = d ? `${played.length} <small>/ ${d.alumniCount}</small>` : "–";
  $("t-games").innerHTML = d ? `${gamesTotal}` : "–";
  $("t-marked").textContent = d ? markedIds.length : "–";
  $("t-updated").innerHTML = d
    ? new Date(d.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).replace(/ (AM|PM)/, " <small>$1 ET</small>")
    : "–";

  // Status line: loading, errors and the empty cases.
  let status = "";
  const rows = visibleRows();
  if (state.error) status = `<div class="error">${esc(state.error)}</div>`;
  else if (state.loading && !d) status = K.loading("Loading box scores…");
  else if (d && !d.games.length) status = K.emptyMark("No alumni teams play on this date.");
  else if (d && d.games.every((g) => g.state === "pre")) status = `<p class="empty">Games haven't started yet. Tip times and each team's alumni are below.</p>`;
  else if (d && !rows.length) {
    status = `<p class="empty">${
      state.q ? "No alumni match that search."
      : state.view === "marked" ? "Nothing marked yet. Use the bookmark on any row."
      : "No alumni have a line yet on this date."}</p>`;
  }
  $("status").innerHTML = status;

  $("rows").innerHTML = rows.map((r) => `<tr class="is-alum">
      <td class="sticky"><div class="player">${K.shot({ ...r, alum: true })}${who(r)}</div></td>
      <td><div class="matchup">${matchup(r)}</div></td>
      ${COLS.map((c) => {
        const cls = ["num"];
        if (c.key === "pts") cls.push("pts");
        if (c.key === state.sortKey) cls.push("on");
        return `<td class="${cls.join(" ")}">${esc(c.show ? c.show(r) : r[c.key])}</td>`;
      }).join("")}
      <td class="c">${markBtn(r)}</td>
    </tr>`).join("");

  $("cards").innerHTML = rows.map((r) => `<div class="card">
      <div class="card-top">${K.shot({ ...r, alum: true })}${who(r, true)}<div class="card-pts"><b>${r.pts}</b><span class="label">PTS</span></div></div>
      <div class="sub matchup-line">${matchup(r)}</div>
      <div class="card-bottom">
        <div class="line line-8">
          <div><b>${r.reb}</b><span>REB</span></div>
          <div><b>${r.ast}</b><span>AST</span></div>
          <div><b>${r.stl}</b><span>STL</span></div>
          <div><b>${r.blk}</b><span>BLK</span></div>
          <div><b>${r.fgm}-${r.fga}</b><span>FG</span></div>
          <div><b>${r.tpm}-${r.tpa}</b><span>3PT</span></div>
          <div><b>${r.ftm}-${r.fta}</b><span>FT</span></div>
          <div><b>${r.min}</b><span>MIN</span></div>
        </div>
        ${markBtn(r)}
      </div>
    </div>`).join("");

  // Alumni with no line: listed as did-not-play in the box (with ESPN's reason), not in the box at
  // all, game not started yet, or no game. The last two are one line each.
  const where = (p) => `${p.team} · ${p.home ? "vs" : "@"} ${p.opp}`;
  const out = d ? [
    ...d.dnp.map((p) => ({ name: p.name, line: `${where(p)} · ${K.titleCase(p.reason)}`, tag: "DNP" })),
    ...d.missing.filter((m) => m.kind === "notinbox").map((m) => ({ name: m.name, line: `${where(m)} · Not in box score`, tag: "" })),
  ] : [];
  const pending = d ? d.missing.filter((m) => m.kind === "pending") : [];
  const off = d ? d.missing.filter((m) => m.kind === "nogame") : [];
  $("dnp-n").textContent = d ? out.length + pending.length + off.length : "";
  $("dnp").hidden = !out.length;
  $("dnp").innerHTML = out.map((p) => `<div><b>${esc(p.name)}</b><span class="sub">${esc(p.line)}</span></div>`).join("");
  $("nogame").hidden = !off.length && !pending.length;
  $("nogame").innerHTML = [
    pending.length ? `<b>Game hasn't started (${pending.length}):</b> ${pending.map((m) => `${esc(m.name)} <span class="muted">(${esc(m.school)})</span>`).join(", ")}` : "",
    off.length ? `<b>No game (${off.length}):</b> ${off.map((m) => `${esc(m.name)} <span class="muted">(${esc(m.school)})</span>`).join(", ")}` : "",
  ].filter(Boolean).join("<br>");
  $("dnp-section").hidden = !out.length && !off.length && !pending.length;

  renderSchedule();

  const others = d?.others || [];
  $("others-section").hidden = !others.length;
  $("others-n").textContent = others.length ? `${others.length} of ${d.totalAlumni}` : "";
  $("others").innerHTML = K.othersHtml(others);

  if (d) {
    const final = d.games.filter((g) => g.state === "post").length;
    $("foot-games").textContent = `${final} of ${gamesTotal} alumni team games final${final < gamesTotal ? " · live games refresh every 30 seconds" : ""}`;
  } else $("foot-games").textContent = "";
}

// ------------------------------------------------------------ events

function setDate(iso) {
  state.date = iso;
  state.data = null;
  state.marks = {};
  state.sched = null;
  K.setUrlParam("date", iso);
  load();
}

K.dateNav(() => state.date, setDate);
$("tonight").addEventListener("click", () => setDate(K.etToday()));
$("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("viewseg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (b) { state.view = b.dataset.view; render(); }
});
$("headrow").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sort]");
  if (!b) return;
  if (b.dataset.sort === state.sortKey) state.dir = -state.dir;
  else { state.sortKey = b.dataset.sort; state.dir = -1; }
  render();
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mark]");
  if (b) toggleMark(b.dataset.mark);
});

const fromUrl = new URL(location.href).searchParams.get("date");
setDate(K.validIso(fromUrl) ? fromUrl : K.lastNight());

setInterval(refreshMarks, 20_000);
// Reload while any game on the page is still going.
setInterval(() => {
  if (!document.hidden && state.data?.games.some((g) => g.state === "in")) load();
}, 30_000);
