import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFeed,
  resolveYouTube,
  itemId,
  diffFeed,
  matchesKeywords,
  buildNotifications,
  sendNtfy,
} from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...a) => path.join(ROOT, ...a);

const DRY = process.env.DRY_RUN === "1";
const FIX = process.env.AIWATCH_FIXTURES || ""; // dev aid: read feeds from local files
const TOPIC = process.env.NTFY_TOPIC || "";
const SITE = process.env.SITE_URL || "";
const MAX_ITEMS = 400;

const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};
const writeIfChanged = (f, obj) => {
  const s = JSON.stringify(obj, null, 1) + "\n";
  let old = "";
  try {
    old = fs.readFileSync(f, "utf8");
  } catch {}
  if (old === s) return false;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s);
  return true;
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url, tries = 2) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  throw err;
}

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) {
        const k = i++;
        out[k] = await fn(list[k]);
      }
    })
  );
  return out;
}

const cfg = readJson(P("feeds.json"), { feeds: [] });
const state = readJson(P("data", "seen.json"), { feeds: {}, yt: {} });
state.feeds ||= {};
state.yt ||= {};
const prevFeed = readJson(P("docs", "feed.json"), { items: [], health: {}, generated: "" });
const firstSeen = new Map(prevFeed.items.map((i) => [i.id, i.first]));
const now = new Date().toISOString();

async function processFeed(feed) {
  try {
    let xml;
    if (FIX) {
      xml = fs.readFileSync(path.join(FIX, feed.id + ".xml"), "utf8");
    } else {
      let url = feed.url;
      if (feed.youtube) {
        let ch = state.yt[feed.youtube];
        if (!ch) {
          ch = await resolveYouTube(feed.youtube, fetchText);
          state.yt[feed.youtube] = ch;
        }
        url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`;
      }
      xml = await fetchText(url);
    }
    let items = parseFeed(xml).map((i) => ({ ...i, id: itemId(feed.id, i) }));
    items = items.filter((i) => matchesKeywords(i.title, feed.keywords));
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    items = items.slice(0, feed.keep ?? 15);
    return { feed, ok: true, items };
  } catch (e) {
    return { feed, ok: false, error: String(e.message || e).slice(0, 120) };
  }
}

const results = await pool(cfg.feeds, 5, processFeed);

const allItems = [];
const health = {};
const toNotify = [];
let seededCount = 0;

for (const r of results) {
  const { feed } = r;
  if (r.ok) {
    const d = diffFeed(state.feeds[feed.id], r.items);
    state.feeds[feed.id] = d.state;
    if (d.seeded) seededCount++;
    health[feed.id] = { name: feed.name, ok: true };
    for (const i of r.items) {
      allItems.push({
        id: i.id,
        f: feed.id,
        src: feed.name,
        cat: feed.cat,
        t: i.title,
        u: i.url,
        d: i.date,
        first: firstSeen.get(i.id) || now,
      });
    }
    if (feed.notify) {
      for (const i of d.fresh) toNotify.push({ src: feed.name, cat: feed.cat, title: i.title, url: i.url, date: i.date });
    }
  } else {
    health[feed.id] = { name: feed.name, ok: false, error: r.error };
    // keep what we had so items do not vanish while a source is down
    for (const i of prevFeed.items) if (i.f === feed.id) allItems.push(i);
  }
}

allItems.sort((a, b) => (b.d || b.first).localeCompare(a.d || a.first));
const items = allItems.slice(0, MAX_ITEMS);

const failed = results.filter((r) => !r.ok);
console.log(`Checked ${results.length} feeds: ${results.length - failed.length} ok, ${failed.length} failed.`);
for (const r of failed) console.log(`  FAILED ${r.feed.id}: ${r.error}`);
if (seededCount) console.log(`Seeded ${seededCount} feed(s) with no notifications (first run for those).`);
console.log(`New items to notify about: ${toNotify.length}`);

// Only touch files when content changed, so the repo does not get a commit every run.
const body = { generated: prevFeed.generated || now, items, health };
const prevCompare = JSON.stringify({ items: prevFeed.items, health: prevFeed.health });
if (prevCompare !== JSON.stringify({ items, health })) body.generated = now;
writeIfChanged(P("docs", "feed.json"), body);
writeIfChanged(P("data", "seen.json"), state);

// Notifications
const notes = buildNotifications(toNotify, SITE);
if (process.env.TEST_NOTIFY === "1") {
  notes.unshift({ title: "AI Watch", message: "Test notification. The watcher is connected.", click: SITE || undefined, tags: ["white_check_mark"] });
}
if (notes.length && !TOPIC && !DRY) console.log("NTFY_TOPIC is not set, so notifications were skipped.");
for (const n of notes) {
  if (DRY) {
    console.log(`[dry run] notify: ${n.title} | ${n.message}${n.click ? " | " + n.click : ""}`);
  } else if (TOPIC) {
    try {
      await sendNtfy(TOPIC, n);
    } catch (e) {
      console.log("Notification failed: " + e.message);
    }
  }
}

if (failed.length === results.length && results.length > 0) {
  console.error("Every feed failed. Check the runner's network access.");
  process.exit(1);
}
