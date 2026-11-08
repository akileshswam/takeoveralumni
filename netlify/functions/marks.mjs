// GET  /api/marks?date=YYYYMMDD              : the lines marked to post that day.
// POST /api/marks {date, id, marked: bool}   : mark or unmark one alumnus's line.
// Kept in Netlify Blobs, one entry per mark ("20261107/4873145"), so two people marking at the same
// moment can't overwrite each other.
import { getStore } from "@netlify/blobs";
import { validDate, validId } from "../../lib/core.mjs";
import { json } from "../../lib/respond.mjs";

const store = () => getStore({ name: "marks", consistency: "strong" });

async function marksFor(date) {
  const s = store();
  const { blobs } = await s.list({ prefix: `${date}/` });
  const out = {};
  await Promise.all(blobs.map(async (b) => {
    out[b.key.slice(date.length + 1)] = (await s.get(b.key, { type: "json" })) || {};
  }));
  return out;
}

export default async (req) => {
  try {
    if (req.method === "GET") {
      const date = new URL(req.url).searchParams.get("date");
      if (!validDate(date)) return json({ error: "date must be YYYYMMDD" }, 400);
      return json(await marksFor(date));
    }
    if (req.method === "POST") {
      const { date, id, marked } = await req.json().catch(() => ({}));
      if (!validDate(date) || !validId(id)) return json({ error: "bad mark" }, 400);
      const key = `${date}/${id}`;
      if (marked) await store().setJSON(key, { at: new Date().toISOString() });
      else await store().delete(key);
      return json(await marksFor(date));
    }
    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/marks" };
