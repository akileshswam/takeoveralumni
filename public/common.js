// Helpers shared by every page: escaping, dates in US Eastern, icons, headshots, the league switch.
const K = (() => {
  const $ = (id) => document.getElementById(id);
  // The league comes from the URL and is set once per page load. No param means NCAAM, so links from
  // before NCAAW was added still work. Switching league is a plain link, which reloads the page.
  const LEAGUES = {
    ncaam: { key: "ncaam", label: "NCAAM", slug: "mens-college-basketball" },
    ncaaw: { key: "ncaaw", label: "NCAAW", slug: "womens-college-basketball" },
  };
  const LEAGUE = LEAGUES[new URL(location.href).searchParams.get("league")] || LEAGUES.ncaam;
  // Appended to our own links and API calls: "&league=ncaaw", or nothing for NCAAM.
  const lg = () => (LEAGUE.key === "ncaam" ? "" : `&league=${LEAGUE.key}`);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // en-CA formats as YYYY-MM-DD.
  const etToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  function shiftDate(iso, days) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  const lastNight = () => shiftDate(etToday(), -1);
  const compact = (iso) => iso.replaceAll("-", "");
  const validIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  function seasonLabel(iso) {
    const [y, m] = iso.split("-").map(Number);
    const start = m >= 8 ? y : y - 1;
    return `${LEAGUE.label} · ${start}-${String(start + 1).slice(2)} SEASON`;
  }
  const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const etTime = (isoDateTime) => new Date(isoDateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
  // The ET calendar date a game was played on, from its UTC start time.
  const etDateOf = (isoDateTime) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoDateTime));

  // Wires the prev / date / next / last night controls; calls onChange with the new YYYY-MM-DD.
  function dateNav(getDate, onChange) {
    $("prev").addEventListener("click", () => onChange(shiftDate(getDate(), -1)));
    $("next").addEventListener("click", () => onChange(shiftDate(getDate(), 1)));
    $("lastnight").addEventListener("click", () => onChange(lastNight()));
    $("date").addEventListener("change", (e) => e.target.value && onChange(e.target.value));
  }
  function setUrlParam(key, value) {
    const u = new URL(location.href);
    u.searchParams.set(key, value);
    history.replaceState(null, "", u);
    renderLeagueSwitch();
  }

  // NCAAM / NCAAW in the top bar. Each link keeps the date; from a game page it goes to that date's
  // Games page, since a game belongs to one league.
  function renderLeagueSwitch() {
    const box = document.getElementById("league-switch");
    if (!box) return;
    box.innerHTML = Object.values(LEAGUES).map((l) => {
      const u = new URL(location.href);
      if (u.pathname.replace(/\/$/, "").endsWith("/game")) u.pathname = "/games";
      u.searchParams.delete("id");
      if (l.key === "ncaam") u.searchParams.delete("league"); else u.searchParams.set("league", l.key);
      return `<a href="${esc(u.pathname + u.search)}"${l.key === LEAGUE.key ? ' aria-current="true"' : ""}>${l.label}</a>`;
    }).join("");
  }
  // Every link in the top bar keeps the league as you move around.
  function applyLeagueToNav() {
    if (LEAGUE.key === "ncaam") return;
    for (const a of document.querySelectorAll(".topbar a.brand, .mainnav a")) {
      const u = new URL(a.getAttribute("href"), location.href);
      u.searchParams.set("league", LEAGUE.key);
      a.href = u.pathname + u.search;
    }
  }
  // Pages set their nav links' dates after load; this keeps the league on them too.
  const withLeague = (href) => href + (href.includes("?") ? lg() : lg().replace("&", "?"));

  async function getJson(url) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  const SILHOUETTE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 41"><circle cx="28" cy="15" r="8.5" fill="#48484A"/><path d="M10 41c1.5-10 9-15.5 18-15.5S44.5 31 46 41z" fill="#48484A"/></svg>')}`;
  const BOOKMARK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>';
  const EXTERNAL = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>';

  const headshot = (id) => `https://a.espncdn.com/i/headshots/${LEAGUE.slug}/players/full/${id}.png`;
  const shot = (p, cls = "") => `<div class="shot${p.alum ? " alum" : ""} ${cls}"><img src="${esc(p.headshot || headshot(p.id))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${SILHOUETTE}'"></div>`;
  // The orange alumni badge; "TT" where space is tight.
  const badge = (short = false) => `<span class="badge" title="Team Takeover alumnus">${short ? "TT" : "TEAM TAKEOVER"}</span>`;
  const gameHref = (id, iso) => `game?id=${encodeURIComponent(id)}${iso ? `&date=${iso}` : ""}${lg()}`;
  const playerHref = (id) => `https://www.espn.com/${LEAGUE.slug}/player/_/id/${encodeURIComponent(id)}`;
  // A team's name, with its poll rank in front when it's in the top 25.
  const teamName = (t, key = "name") => `${t.rank ? `<span class="rk">${t.rank}</span> ` : ""}${esc(t[key])}`;
  const espnLink = (href, label = "ESPN") => `<a class="espn" href="${esc(href)}" target="_blank" rel="noopener">${label} ${EXTERNAL}</a>`;
  const titleCase = (s) => String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/'S\b/g, "'s");
  const pct = (m, a) => (a ? ((m / a) * 100).toFixed(1) : "–");
  // An orange spinner and a short message, so a slow load never looks like a broken page.
  const loading = (text) => `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${esc(text)}</div>`;
  // The big logo on an empty state.
  const emptyMark = (text) => `<div class="empty-mark"><img src="/img/team-takeover-logo.png" alt="" width="120" height="105"><p>${text}</p></div>`;

  const STATUS_LABEL = { "not-d1": "Not Division I", "not-found": "Not found", done: "Done playing", tracked: "Tracked" };
  // "Alumni not on a D-I roster", shown at the bottom of the Players page and the Leaderboard so the
  // list on the site always adds up to everyone in alumni.csv.
  function othersHtml(others) {
    if (!others?.length) return "";
    return `<div class="others">${others.map((o) => `<div class="other">
      <b>${esc(o.name)}</b>
      <span class="sub">${esc([o.team, STATUS_LABEL[o.status] || o.status].filter(Boolean).join(" · "))}</span>
      ${o.note ? `<span class="other-note">${esc(o.note)}</span>` : ""}
    </div>`).join("")}</div>`;
  }

  renderLeagueSwitch();
  applyLeagueToNav();

  return { LEAGUE, lg, withLeague, $, esc, etToday, shiftDate, lastNight, compact, validIso, seasonLabel, longDate, shortDate, etTime, etDateOf, dateNav, setUrlParam, getJson, SILHOUETTE, BOOKMARK, EXTERNAL, headshot, shot, badge, gameHref, playerHref, teamName, espnLink, titleCase, pct, loading, emptyMark, othersHtml };
})();
