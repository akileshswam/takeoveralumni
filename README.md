# Team Takeover Box Scores

How Team Takeover alumni are doing in Division I men's (NCAAM) and women's (NCAAW) college basketball, so the social team can see each night who had a game worth posting about, and how every alumnus is doing this season.

It's a cut-down copy of KLUTCH Box Scores: same layout, type and data pipeline, recolored from the Team Takeover logo and limited to alumni.

## Run it

Needs Node 20 or newer.

```
node server.mjs
```

Then open http://localhost:4317. The only dependency is `@netlify/blobs`, which the Netlify functions use (`npm install` if `node_modules/` is missing). The local server doesn't need it.

## Leagues

The NCAAM / NCAAW switch in the top bar adds `league=ncaaw` to the URL. No `league` means NCAAM, so links from before NCAAW was added still work. Every page and API endpoint takes the same param, and the switch keeps the date. Each league has its own alumni rows, its own Leaderboard season log and its own "not on a D-I roster" list. Marks are stored by date and ESPN athlete id, which ESPN keeps unique across leagues.

Men's games are 2 halves and women's are 4 quarters, both read from each game.

## Pages

- **Players** (`/`): every alumnus's box score line for a date. It opens on last night (US Eastern), with previous/next arrows, a date box and Last night / Tonight buttons. Sort by any stat column; click again to flip it. Each row has the headshot, school, opponent and result, and links to our game page and ESPN's box score. Phones get cards instead of the table.
  - **Mark to post**: a shared bookmark, kept by date and player. Everyone sees the same marks within about 20 seconds. "Marked to post" filters to them.
  - **Alumni with no line** are split into: listed as did-not-play (with ESPN's reason, or "Did Not Play"), "Not in box score" (their team played but they aren't listed), "Game hasn't started" and "No game".
  - **Games**: every game that date with an alumnus's team, with tip time, TV and the alumni on each roster, so the page works for tonight too.
  - **Alumni not on a D-I roster**: everyone in `alumni.csv` who can't have box scores, with where they are. The page always accounts for the full list.
- **Games** (`/games`): every game that date with an alumni team, and which alumni played.
- **Game** (`/game?id=`): the full box score for both teams (starters, bench, did not play, totals), the line score by half and team stats, with alumni highlighted. Every game and player links to ESPN so numbers can be checked.
- **Leaderboard** (`/leaderboard`): season stats for every tracked alumnus, per game or totals, with search, a school filter and a minimum-games filter. Alumni who haven't played stay on the list with 0 GP and dashes. Click a player to open their team's last 5 games as rows of the same table, each stat under its season column. Games they missed show DNP with ESPN's reason.

## The alumni list: `alumni.csv`

```
name,league,espn_id,team_id,team,roster_years,status,note
Patrick Ngongba II,M,4873209,150,Duke,2022 2023,tracked,"""Patrick Ngongba"" on the 2023 roster"
Daniel Russell,M,,,The Potomac School,2025,not-d1,Still in high school
```

- **Matching is by `espn_id` only, never by name.** Many alumni have common names, and a wrong id puts a stranger's stats on the site. The id is the number in the player's ESPN URL (`espn.com/mens-college-basketball/player/_/id/4873209/...`, or `womens-college-basketball` for women).
- `league` is `M` (NCAAM) or `W` (NCAAW). A blank league means `M`.
- `team_id` is ESPN's team id for that league (in the team URL, `espn.com/womens-college-basketball/team/_/id/150/duke-blue-devils`). It decides which games are pulled, so **it must be the player's current team**. Team ids are only unique within a league (Duke is 150 for both men and women), so always take a women's player's team id from the women's site.
- `team` is the school name the site shows. `name` is for people reading the file: the site shows ESPN's spelling (Donovan Freeman shows as Donnie Freeman).
- `status`:
  - `tracked`: on a D-I roster. Needs `espn_id` and `team_id`, and shows everywhere.
  - `not-d1`: D-II, D-III, NAIA, JUCO, overseas or still in high school.
  - `not-found`: we couldn't find where they are.
  - `done`: no longer playing basketball.
  
  Everyone except `tracked` is listed under "Alumni not on a D-I roster" with `team` and `note`.
- Lines starting with `#` are comments.

To add someone or record a transfer, edit the row, push, and Netlify redeploys in about a minute. Locally, changes show up on the next page load.

**Mid-season transfers:** only the current `team_id`'s games are pulled. Games a player played for a previous team that season aren't counted, so a mid-season transfer's season totals restart at their new team.

**Changing the list resets the Leaderboard's season log.** The log only stores alumni lines, so a new or changed tracked row means earlier games were never saved for them. The log starts over by itself and refills within a few refreshes (seconds early in the season, a few 15-minute runs late in it).

## Data: ESPN's public feed

Everything comes from ESPN's site API (`site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball`, and `womens-college-basketball` for NCAAW). It's free and needs no key, but it isn't an official API and can change without notice, so every ESPN call is in `lib/` (`lib/core.mjs` for pages, `lib/season.mjs` for the Leaderboard). If a page breaks, check there first.

ESPN quirks that are handled:

- **Scoreboards need `&groups=50&limit=1000`.** Without them ESPN quietly returns only some of the day's D-I games.
- **Only alumni-team games are pulled.** The day's scoreboard is read once, and `/summary?event=` is called only for games with an alumni team. Rosters are fetched only for alumni teams. ESPN's `/teams` list isn't used: it's incomplete for college without a limit.
- **Team ids are only unique within a league.** Each league reads only its own alumni rows, the league slug is in every ESPN URL, the in-memory cache is keyed by URL, and each league's season log has its own key, so men's and women's teams can't mix.
- **Line scores**: men's games are 2 halves and women's are 4 quarters, then overtimes. The number of regulation periods comes from each game.
- **Dates**: each game stays in ESPN's date bucket, even when a late tip crosses midnight Eastern.
- **Ranks** show only for 1-25. ESPN uses 99 for unranked.
- **Retries**: ESPN sometimes answers 200 with an empty body, or caches a bad empty response for a date. An empty body counts as a failure and is retried 3 times with backoff. If it still fails, the last good copy is served. The Leaderboard skips that date and tries again on the next run, and keeps serving the saved board instead of an error.
- **DNP reasons**: college injury lists are usually empty, so they aren't used. ESPN often gives no reason for a college DNP, which shows as "Did Not Play".
- **Headshots**: `https://a.espncdn.com/i/headshots/{mens|womens}-college-basketball/players/full/{id}.png`, with a silhouette if ESPN has none.
- **Minutes**: box scores round each game's minutes, so MIN per game can differ from ESPN's season average by a few tenths (ESPN averages exact seconds). Every other stat matches ESPN's season totals exactly.

### Leaderboard season log

- Stores only alumni lines from their teams' games, as compact arrays: `[gameId, date, teamId, teamAbbr, started, min, pts, reb, oreb, dreb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta]`.
- Each league has its own log. On Netlify it lives in Blobs as `ledger-{league}-{season}` (the log) and `board-{league}-{season}` (the season totals the page reads). Locally, and on Render, it's `data/ledger-{league}-{season}.json`.
- Dates are walked directly from Oct 25 to Apr 15, because ESPN's college calendar stops at the end of the regular season.
- Regular season (type 2) and postseason (type 3) games count. Canceled or postponed games, and games that never get a box score, are closed out once the day has passed and never fetched again.
- `netlify/functions/update-leaderboard.mjs` runs every 15 minutes and adds newly finished games for both leagues within a time budget. On a first deploy, or after `alumni.csv` changes, `/api/leaderboard` starts the build itself, and the page says how many games are still loading.

## How fresh the numbers are

- The day's scoreboard is re-pulled at most once a minute.
- Box scores of live games are re-pulled every 30 seconds, and open pages refresh every 30 seconds while a game is live.
- Finished games are re-checked hourly to pick up ESPN's stat corrections.
- The Leaderboard is at most about 15 minutes behind the final buzzer.
- Netlify's CDN keeps responses 30 seconds while a day's games are on, a minute for the Leaderboard, and an hour once a day is over.

## API

All endpoints take `&league=ncaaw` (no league means NCAAM).

| Endpoint | What |
|---|---|
| `/api/boxscores?date=YYYYMMDD` | Alumni lines, DNPs and missing alumni for a date, plus that date's alumni-team games |
| `/api/game?id=` | Full box score for one game |
| `/api/schedule?from=YYYYMMDD&days=N` | Alumni-team games over 1-14 days, with each team's alumni |
| `/api/leaderboard` | Season totals and last 5 games for every tracked alumnus |
| `/api/marks?date=YYYYMMDD` (GET), `/api/marks` (POST `{date, id, marked}`) | Shared mark-to-post bookmarks |

## Putting it online (Render)

Render runs `server.mjs` as a plain Node web service. It has to be a **Web Service**, not a Static Site, because every page loads its data from `/api/...`.

- New → Web Service → pick the repo, branch `main`, runtime Node.
- Build command: `npm install`. Start command: `node server.mjs`. Render sets `PORT`.
- Marks and the season logs are files in `data/`. On the free plan that folder is wiped on every deploy, restart and sleep: the season logs rebuild themselves from ESPN on the next Leaderboard visit, but marks to post are lost. To keep them, use a paid instance, add a disk mounted at `/var/data`, and set the environment variable `DATA_DIR=/var/data`.
- With no scheduler on Render, each Leaderboard is brought up to date when someone opens it (at most every two minutes).

## Putting it online (Netlify)

`netlify.toml` has everything Netlify needs: it publishes `public/`, bundles `netlify/functions/` with esbuild, and ships `alumni.csv` with the functions (`included_files`) so they read it at request time.

1. Put this folder in a GitHub repo.
2. In Netlify: Add new site > Import an existing project, and pick the repo. Leave the build command empty.
3. Share the `netlify.app` URL or add a custom domain.

Marks and the season log go in Netlify Blobs, with nothing to set up. The free plan covers it. There's no login; anyone with the link can see the site and mark lines.

## Files

```
alumni.csv                 the alumni list
server.mjs                 local server (same pages and API as Netlify)
lib/core.mjs               ESPN reads, alumni.csv, box scores, games, schedule
lib/season.mjs             Leaderboard season log and totals
lib/ledger-blobs.mjs       Netlify Blobs storage for the season log
lib/respond.mjs            JSON responses and CDN cache headers
netlify/functions/         boxscores, game, schedule, leaderboard, marks, update-leaderboard (every 15 min)
public/                    the pages (plain HTML, CSS, JS; no build step)
assets/                    the original logo and 2022-2025 roster graphic
```
