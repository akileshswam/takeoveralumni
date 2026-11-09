// Leaderboard: season stats for every Team Takeover alumnus, from /api/leaderboard.
const { $, esc } = K;
const state = { open: new Set(), mode: "pg", q: "", team: "", minGp: 0, sortKey: "pts", dir: -1, data: null };

const pct = (m, a) => (a ? m / a : null);
const f1 = (v) => (v == null ? "–" : v.toFixed(1));
const fpct = (v) => (v == null ? "–" : (v * 100).toFixed(1));

// Per game or totals for counting stats; shooting shows made-attempted. An alumnus who hasn't played
// yet stays on the list with 0 GP and dashes.
const per = (p, v) => (!p.gp ? null : state.mode === "pg" ? v / p.gp : v);
const split = (p, m, a) => (!p.gp ? "–" : state.mode === "pg" ? `${f1(m / p.gp)}-${f1(a / p.gp)}` : `${m}-${a}`);
const tot = (v) => (state.mode === "pg" ? f1 : (x) => (x == null ? "–" : String(Math.round(x))))(v);
const COLS = [
  { k: "gp", l: "GP", t: "Games played", v: (p) => p.gp, f: (v) => String(v) },
  { k: "gs", l: "GS", t: "Games started", v: (p) => p.gs, f: (v) => String(v) },
  { k: "min", l: "MIN", t: "Minutes", v: (p) => per(p, p.min), f: tot },
  { k: "pts", l: "PTS", t: "Points", v: (p) => per(p, p.pts), f: tot, strong: true },
  { k: "reb", l: "REB", t: "Rebounds", v: (p) => per(p, p.reb), f: tot },
  { k: "oreb", l: "OREB", t: "Offensive rebounds", v: (p) => per(p, p.oreb), f: tot },
  { k: "dreb", l: "DREB", t: "Defensive rebounds", v: (p) => per(p, p.dreb), f: tot },
  { k: "ast", l: "AST", t: "Assists", v: (p) => per(p, p.ast), f: tot },
  { k: "stl", l: "STL", t: "Steals", v: (p) => per(p, p.stl), f: tot },
  { k: "blk", l: "BLK", t: "Blocks", v: (p) => per(p, p.blk), f: tot },
  { k: "tov", l: "TOV", t: "Turnovers", v: (p) => per(p, p.tov), f: tot },
  { k: "pf", l: "PF", t: "Personal fouls", v: (p) => per(p, p.pf), f: tot },
  { k: "fga", l: "FGM-A", t: "Field goals made-attempted", v: (p) => per(p, p.fga), show: (p) => split(p, p.fgm, p.fga) },
  { k: "fgp", l: "FG%", t: "Field goal percentage", v: (p) => pct(p.fgm, p.fga), f: fpct },
  { k: "tpa", l: "3PM-A", t: "Threes made-attempted", v: (p) => per(p, p.tpa), show: (p) => split(p, p.tpm, p.tpa) },
  { k: "tpp", l: "3P%", t: "Three-point percentage", v: (p) => pct(p.tpm, p.tpa), f: fpct },
  { k: "fta", l: "FTM-A", t: "Free throws made-attempted", v: (p) => per(p, p.fta), show: (p) => split(p, p.ftm, p.fta) },
  { k: "ftp", l: "FT%", t: "Free throw percentage", v: (p) => pct(p.ftm, p.fta), f: fpct },
  { k: "ts", l: "TS%", t: "True shooting: PTS / (2 × (FGA + 0.44 × FTA))", v: (p) => pct(p.pts, 2 * (p.fga + 0.44 * p.fta)), f: fpct },
];

async function load() {
  if (!state.data) $("status").innerHTML = K.loading("Loading season stats…");
  try {
    const data = await K.getJson(`api/leaderboard${K.lg().replace("&", "?")}`);
    state.data = data;
    const schools = [...new Set(data.players.map((p) => p.school))].sort();
    const keep = state.team;
    $("team").innerHTML = `<option value="">All schools</option>` + schools.map((t) => `<option${t === keep ? " selected" : ""}>${esc(t)}</option>`).join("");
    $("eyebrow").textContent = `${K.LEAGUE.label} · ${data.label} SEASON · ${data.games} ALUMNI TEAM GAMES`;
    const when = data.updated ? `Updated ${new Date(data.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET. ` : "";
    $("foot").textContent = `${when}Regular season and postseason games count. New games are added within about 15 minutes of the final buzzer.${data.waiting ? ` Still loading ${data.waiting} game${data.waiting === 1 ? "" : "s"}; refresh in a minute.` : ""}`;
    $("status").innerHTML = data.waiting && !data.games ? K.loading(`Building the season log: ${data.waiting} games still loading…`) : "";
  } catch (e) {
    if (!state.data) $("status").innerHTML = `<div class="error">Couldn't load the leaderboard: ${esc(e.message)}</div>`;
  }
  render();
}

function render() {
  const d = state.data;
  for (const b of document.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
  if (!d) return;

  const sortCol = COLS.find((c) => c.k === state.sortKey);
  const q = state.q.trim().toLowerCase();
  const rows = d.players
    .filter((p) => (!state.team || p.school === state.team) && p.gp >= state.minGp && (!q || `${p.name} ${p.school}`.toLowerCase().includes(q)))
    .map((p) => ({ p, v: sortCol.v(p) }))
    // Players with no value (0 GP) always sit at the bottom, whichever way the column is sorted.
    .sort((a, b) => (a.v == null) - (b.v == null) || (a.v - b.v) * state.dir || b.p.gp - a.p.gp || a.p.name.localeCompare(b.p.name))
    .map((r) => r.p);
  $("count").textContent = `${rows.length} of ${d.players.length} alumni on D-I rosters · ${d.players.filter((p) => p.gp).length} have played`;

  const head = (c) => {
    const on = c.k === state.sortKey;
    return `<th scope="col" class="num${on ? " on" : ""}" aria-sort="${on ? (state.dir < 0 ? "descending" : "ascending") : "none"}"><button type="button" data-sort="${c.k}" title="${esc(c.t)}">${esc(c.l)}<span class="arrow">${on ? (state.dir < 0 ? "↓" : "↑") : ""}</span></button></th>`;
  };
  $("headrow").innerHTML = `<th scope="col" class="rank-h">#</th><th scope="col" class="sticky" style="min-width:240px">PLAYER</th>` + COLS.map(head).join("");

  const span = 2 + COLS.length;
  $("rows").innerHTML = rows.map((p, i) => {
    const open = state.open.has(p.id);
    return `<tr class="is-alum${open ? " is-open" : ""}">
    <td class="rank">${i + 1}</td>
    <td class="sticky"><div class="player">${K.shot({ ...p, alum: true }, "sm")}<div class="who">
      <button type="button" class="name namebtn" data-open="${esc(p.id)}" aria-expanded="${open}">${esc(p.name)}<svg class="chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      <span class="meta">${K.badge(true)}<span class="sub">${esc(p.school)}${p.pos ? " · " + esc(p.pos) : ""}</span></span>
    </div></div></td>
    ${COLS.map((c) => {
      const v = c.v(p);
      const text = c.show ? c.show(p) : c.f(v);
      return `<td class="num${c.k === state.sortKey ? " on" : ""}${c.strong ? " pts" : ""}">${esc(text)}</td>`;
    }).join("")}
  </tr>${open ? gameRows(p, span) : ""}`;
  }).join("");
  if (!rows.length) $("status").innerHTML = `<p class="empty">No alumni match.</p>`;
  else if ($("status").querySelector(".empty")) $("status").innerHTML = "";

  const others = d.others || [];
  $("others-section").hidden = !others.length;
  $("others-n").textContent = others.length ? `${others.length} of ${d.totalAlumni}` : "";
  $("others").innerHTML = K.othersHtml(others);
}

// ------------------------------------------------------------ last 5 games, opened by clicking a player
// Each game is a row of the same table, filled column by column like the season row, so every
// number sits right under its season counterpart. A single game shows whole numbers.
const gameDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function gameCell(c, g) {
  switch (c.k) {
    case "gp": return "";
    case "gs": return g.gs ? "✓" : "";
    case "fga": return `${g.fgm}-${g.fga}`;
    case "tpa": return `${g.tpm}-${g.tpa}`;
    case "fta": return `${g.ftm}-${g.fta}`;
    case "fgp": case "tpp": case "ftp": case "ts": return fpct(c.v({ ...g, gp: 1 }));
    default: return String(g[c.k]);
  }
}

function gameRows(p, span) {
  if (!p.last5?.length) return `<tr class="gl-row gl-last"><td></td><td class="sticky gl-who" colspan="${span - 1}">${p.teamGames === 0 ? "Their team hasn't played yet." : "Recent games are still loading. Refresh in a few minutes."}</td></tr>`;
  const label = `<tr class="gl-label"><td></td><td class="sticky">Last ${p.last5.length} ${esc(p.school)} game${p.last5.length === 1 ? "" : "s"}</td><td colspan="${span - 2}"></td></tr>`;
  const rows = p.last5.map((g, i) => {
    const who = `<td class="rank"></td><td class="sticky gl-who">
      <span class="gl-date">${esc(gameDate(g.d))}</span>
      <a href="${K.gameHref(g.g, g.d)}">${g.home ? "vs" : "@"} ${esc(g.opp)}</a>
      <span class="gl-res"><span class="${g.r}">${g.r}</span> ${esc(g.s)}</span></td>`;
    const last = i === p.last5.length - 1 ? " gl-last" : "";
    if (g.dnp) return `<tr class="gl-row gl-dnp${last}">${who}<td class="num gpcell"><span class="dnp-tag">DNP</span></td><td colspan="${COLS.length - 1}" class="gl-reason">${esc(K.titleCase(g.dnp))}</td></tr>`;
    return `<tr class="gl-row${last}">${who}${COLS.map((c) => {
      const cls = ["num"];
      if (c.k === state.sortKey) cls.push("on");
      if (c.strong) cls.push("pts");
      return `<td class="${cls.join(" ")}">${esc(gameCell(c, g))}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return label + rows;
}

// ------------------------------------------------------------ events
document.addEventListener("click", (e) => {
  const openBtn = e.target.closest("[data-open]");
  if (openBtn) {
    const id = openBtn.dataset.open;
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    render();
    return;
  }
  const t = e.target.closest("[data-mode],[data-sort]");
  if (!t) return;
  if (t.dataset.mode) state.mode = t.dataset.mode;
  if (t.dataset.sort) {
    if (state.sortKey === t.dataset.sort) state.dir = -state.dir; else { state.sortKey = t.dataset.sort; state.dir = -1; }
  }
  render();
});
$("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("team").addEventListener("change", (e) => { state.team = e.target.value; render(); });
$("mingp").addEventListener("change", (e) => { state.minGp = Number(e.target.value); render(); });

load();
// While the season log is still filling, check back sooner.
setInterval(() => { if (!document.hidden) load(); }, 60_000);
