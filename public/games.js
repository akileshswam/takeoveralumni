// Games page: one card per game with an alumnus's team on a date, linking to the full box score.
const { $, esc } = K;
const state = { date: "", data: null, error: "" };

async function load() {
  const date = state.date;
  state.error = "";
  render();
  try {
    const d = await K.getJson(`api/boxscores?date=${K.compact(date)}${K.lg()}`);
    if (date !== state.date) return;
    state.data = d;
  } catch (e) {
    if (date !== state.date) return;
    if (!state.data) state.error = `Couldn't load games: ${e.message}`;
  }
  render();
}

function statusLabel(g) {
  if (g.state === "pre") return `<span>${esc(K.etTime(g.start))}</span>`;
  if (g.state === "in") return `<span class="live">LIVE · ${esc(g.status)}</span>`;
  return `<span>${esc(g.status)}</span>`;
}

function teamRow(t, g) {
  const won = g.state === "post" && t.winner;
  const lost = g.state === "post" && !t.winner;
  return `<div class="gc-team${won ? " won" : ""}${lost ? " lost" : ""}">
    <img src="${esc(t.logo)}" alt="" width="24" height="24" loading="lazy">
    <span class="gc-name">${K.teamName(t)}</span>
    <span class="gc-rec">${esc(t.record)}</span>
    <span class="gc-score">${g.state === "pre" ? "" : t.score}</span>
  </div>`;
}

function card(g) {
  // Before tip-off this is who's on each roster; after, who played and their points.
  const alumni = g.alumni.length
    ? `<div class="gc-alumni">${K.badge(true)}<span>${g.alumni.map((c) => c.pts == null ? esc(c.name) : `${esc(c.name)} <b>${c.pts}</b>`).join(" · ")}</span></div>`
    : `<div class="gc-alumni muted">${g.state === "pre" ? "" : "No alumni played"}</div>`;
  return `<article class="gamecard">
    <a class="gc-main" href="${K.gameHref(g.id, state.date)}" aria-label="${esc(g.teams[0].name)} at ${esc(g.teams[1].name)}, box score">
      <div class="gc-status">${statusLabel(g)}</div>
      ${g.teams.map((t) => teamRow(t, g)).join("")}
    </a>
    ${alumni}
    <div class="gc-foot">
      <a href="${K.gameHref(g.id, state.date)}">Box score</a>
      ${K.espnLink(g.espn.box, "ESPN box score")}
    </div>
  </article>`;
}

function render() {
  const d = state.data;
  $("date").value = state.date;
  $("season").textContent = K.seasonLabel(state.date);
  $("lede").textContent = `${K.longDate(state.date)}. Every game with a Team Takeover alumnus's team. Open one for the full box score.`;
  $("players-link").href = `./?date=${state.date}${K.lg()}`;

  const all = d ? d.games : [];
  let status = "";
  if (state.error) status = `<div class="error">${esc(state.error)}</div>`;
  else if (!d) status = K.loading("Loading games…");
  else if (!all.length) status = K.emptyMark("No alumni teams play on this date.");
  $("status").innerHTML = status;
  $("games").innerHTML = all.map(card).join("");

  if (d) {
    const final = all.filter((g) => g.state === "post").length;
    $("finalnote").textContent = `${all.length} alumni team game${all.length === 1 ? "" : "s"} · ${final} final · ${d.boardGames} D-I games on the day's board`;
    $("foot").textContent = `Updated ${new Date(d.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
  } else $("finalnote").textContent = "";
}

function setDate(iso) {
  state.date = iso;
  state.data = null;
  K.setUrlParam("date", iso);
  load();
}

K.dateNav(() => state.date, setDate);
$("tonight").addEventListener("click", () => setDate(K.etToday()));

const fromUrl = new URL(location.href).searchParams.get("date");
setDate(K.validIso(fromUrl) ? fromUrl : K.lastNight());
setInterval(() => {
  if (!document.hidden && state.data?.games.some((g) => g.state === "in")) load();
}, 30_000);
