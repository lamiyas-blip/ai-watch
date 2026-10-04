import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
});

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (v) => {
  if (v == null) return "";
  if (typeof v === "object") return String(v["#text"] ?? "");
  return String(v);
};
const clean = (s) => text(s).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

export function isHttp(u) {
  return /^https?:\/\//i.test(u || "");
}

function toIso(d) {
  const s = text(d).trim();
  if (!s) return "";
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? "" : t.toISOString();
}

function linkOf(l) {
  const links = arr(l);
  for (const x of links) {
    if (typeof x === "string" && isHttp(x.trim())) return x.trim();
  }
  const alt = links.find(
    (x) => typeof x === "object" && x["@_href"] && (!x["@_rel"] || x["@_rel"] === "alternate")
  );
  if (alt) return String(alt["@_href"]).trim();
  const any = links.find((x) => typeof x === "object" && x["@_href"]);
  if (any) return String(any["@_href"]).trim();
  for (const x of links) {
    if (typeof x === "object" && isHttp(text(x).trim())) return text(x).trim();
  }
  return "";
}

/** Parse RSS 2.0, Atom or RDF text into [{guid, title, url, date}]. */
export function parseFeed(xml) {
  const doc = parser.parse(xml);
  let items = [];
  if (doc.rss) {
    const ch = arr(doc.rss.channel)[0] || {};
    items = arr(ch.item).map((it) => {
      let url = linkOf(it.link);
      const guid = text(it.guid);
      if (!url && isHttp(guid)) url = guid;
      return { guid, title: clean(it.title), url, date: toIso(it.pubDate || it["dc:date"] || it.published) };
    });
  } else if (doc.feed) {
    items = arr(doc.feed.entry).map((e) => ({
      guid: text(e.id),
      title: clean(e.title),
      url: linkOf(e.link),
      date: toIso(e.published || e.updated),
    }));
  } else if (doc["rdf:RDF"]) {
    items = arr(doc["rdf:RDF"].item).map((it) => ({
      guid: text(it["@_rdf:about"]),
      title: clean(it.title),
      url: linkOf(it.link),
      date: toIso(it["dc:date"]),
    }));
  } else {
    throw new Error("Not an RSS or Atom feed");
  }
  return items.filter((i) => i.title && isHttp(i.url));
}

/** Find a YouTube channel id from an @handle page. */
export async function resolveYouTube(handle, fetchText) {
  const html = await fetchText(`https://www.youtube.com/@${handle}`);
  const m =
    html.match(/"externalId":"(UC[\w-]{22})"/) ||
    html.match(/"channelId":"(UC[\w-]{22})"/) ||
    html.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error("Could not find channel id for @" + handle);
  return m[1];
}

export function itemId(feedId, item) {
  return createHash("sha1").update(feedId + "|" + (item.guid || item.url)).digest("hex").slice(0, 16);
}

export function matchesKeywords(title, keywords) {
  if (!keywords || !keywords.length) return true;
  return keywords.some((k) => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b" + esc + "\\b", "i").test(title);
  });
}

/**
 * Compare a feed's current items with what was seen before.
 * The first time a feed is seen it is "seeded": nothing counts as fresh,
 * so adding a feed never floods you with its backlog.
 */
export function diffFeed(prev, items) {
  const known = new Set((prev && prev.ids) || []);
  const initialised = !!(prev && prev.init);
  const fresh = items.filter((i) => !known.has(i.id));
  const ids = [...new Set([...items.map((i) => i.id), ...((prev && prev.ids) || [])])].slice(0, 600);
  return { fresh: initialised ? fresh : [], seeded: !initialised, state: { init: true, ids } };
}

/** Turn fresh items into notifications: one each up to `cap`, then one summary. */
export function buildNotifications(freshItems, siteUrl = "", cap = 6) {
  const sorted = [...freshItems].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const notes = sorted.slice(0, cap).map((i) => ({
    title: i.src,
    message: i.title,
    click: i.url,
    tags: [i.cat === "YouTube" ? "movie_camera" : "newspaper"],
  }));
  if (sorted.length > cap) {
    const n = {
      title: "AI Watch",
      message: `${sorted.length - cap} more new item${sorted.length - cap === 1 ? "" : "s"}. Open the app to see them.`,
      tags: ["inbox_tray"],
    };
    if (siteUrl) n.click = siteUrl;
    notes.push(n);
  }
  return notes;
}

export async function sendNtfy(topic, n) {
  const body = { topic, title: n.title, message: n.message, tags: n.tags || ["newspaper"], priority: n.priority || 3 };
  if (n.click) body.click = n.click;
  const r = await fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("ntfy HTTP " + r.status);
}
