import assert from "node:assert/strict";
import { parseFeed, resolveYouTube, itemId, diffFeed, matchesKeywords, buildNotifications } from "./lib.mjs";

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>T</title>
<item><title><![CDATA[Import AI 455: Things & stuff]]></title><link>https://example.com/p/455</link><guid isPermaLink="false">g-455</guid><pubDate>Mon, 28 Sep 2026 12:00:00 GMT</pubDate></item>
<item><title>Second &amp; item</title><link>https://example.com/p/454</link><guid>g-454</guid><pubDate>Mon, 21 Sep 2026 12:00:00 GMT</pubDate></item>
<item><title>No link here</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
<title>Chan</title>
<entry><id>yt:video:abc</id><title>New video</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><published>2026-09-30T10:00:00+00:00</published></entry>
<entry><id>yt:video:def</id><title>Older video</title><link rel="alternate" href="https://www.youtube.com/watch?v=def"/><published>2026-09-20T10:00:00+00:00</published></entry>
</feed>`;

// RSS parsing
let items = parseFeed(RSS);
assert.equal(items.length, 2, "drops items without a link");
assert.equal(items[0].title, "Import AI 455: Things & stuff");
assert.equal(items[1].title, "Second & item");
assert.equal(items[0].date, "2026-09-28T12:00:00.000Z");

// Atom parsing
items = parseFeed(ATOM);
assert.equal(items.length, 2);
assert.equal(items[0].url, "https://www.youtube.com/watch?v=abc");
assert.equal(items[0].date, "2026-09-30T10:00:00.000Z");

// Garbage is rejected
assert.throws(() => parseFeed("<html><body>blocked</body></html>"));

// Ids are stable and differ per feed
const a = { guid: "g1", url: "https://x.test/1" };
assert.equal(itemId("f1", a), itemId("f1", a));
assert.notEqual(itemId("f1", a), itemId("f2", a));

// Seeding: first sight of a feed notifies nothing
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: "i" + i, title: "t" + i, url: "https://x.test/" + i }));
let d = diffFeed(undefined, mk(3));
assert.equal(d.fresh.length, 0);
assert.equal(d.seeded, true);
assert.equal(d.state.init, true);

// Next run: only the genuinely new item is fresh
const next = [{ id: "new", title: "tn", url: "https://x.test/n" }, ...mk(3)];
d = diffFeed(d.state, next);
assert.equal(d.seeded, false);
assert.deepEqual(d.fresh.map((i) => i.id), ["new"]);

// Same items again: nothing fresh
d = diffFeed(d.state, next);
assert.equal(d.fresh.length, 0);

// Keywords use whole words
assert.equal(matchesKeywords("Why AI will matter", ["AI"]), true);
assert.equal(matchesKeywords("He said again", ["AI"]), false);
assert.equal(matchesKeywords("anything", []), true);

// Notifications: cap with a summary
const fresh = Array.from({ length: 9 }, (_, i) => ({ src: "S", cat: "Newsletter", title: "Item " + i, url: "https://x.test/" + i, date: "2026-09-0" + (i + 1) + "T00:00:00.000Z" }));
let notes = buildNotifications(fresh, "https://site.test/", 6);
assert.equal(notes.length, 7);
assert.equal(notes[0].message, "Item 8", "newest first");
assert.match(notes[6].message, /^3 more new items/);
assert.equal(notes[6].click, "https://site.test/");
notes = buildNotifications(fresh.slice(0, 2), "", 6);
assert.equal(notes.length, 2);

// YouTube channel id resolution
const id = await resolveYouTube("someone", async () => '..."externalId":"UCabcdefghijklmnopqrstuv"...');
assert.equal(id, "UCabcdefghijklmnopqrstuv");
await assert.rejects(() => resolveYouTube("x", async () => "<html></html>"));

console.log("All tests passed.");
