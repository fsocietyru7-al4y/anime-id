const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
const g = require("./gogoanime");
const browse = require("./browse");
const { translateVtt } = require("./subtitle");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = crypto.randomBytes(16).toString("hex");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Proxy bertanda tangan: server hanya meneruskan URL yang dibuatnya sendiri.
const sign = (d) => crypto.createHmac("sha256", SECRET).update(d).digest("base64url").slice(0, 22);
function px(kind, url, ref) {
  const d = Buffer.from(JSON.stringify({ u: url, r: ref || "" })).toString("base64url");
  return `/api/p/${kind}?d=${d}&s=${sign(d)}`;
}
const img = (t) => (t ? px("img", t) : "");

function rewrite(txt, base, ref) {
  const abs = (u) => px("hls", new URL(u, base).href, ref);
  return txt
    .split(/\r?\n/)
    .map((l) => {
      if (!l.trim()) return l;
      if (l.startsWith("#")) return l.replace(/URI="([^"]+)"/g, (_, u) => `URI="${abs(u)}"`);
      return abs(l.trim());
    })
    .join("\n");
}


const LANGS = [["id", "Indonesia (otomatis)"], ["en", "English"], ["ar", "Arab (otomatis)"], ["fr", "Perancis (otomatis)"], ["ja", "Jepang (otomatis)"]];
function mkSubs(d) {
  const ref = d.headers.Referer;
  const abs = (f) => new URL(f, "https://megaplay.buzz").href;
  const tr = (d.tracks || []).filter((t) => t.file && /caption|subtitle/i.test(t.kind || "captions"));
  const base = tr.find((t) => /english/i.test(t.label || "")) || tr[0];
  if (!base) return [];
  const o = px("sub", abs(base.file), ref);
  return LANGS.map(([code, label]) => ({
    code,
    label,
    url: code === "en" ? o : o.replace("/api/p/sub", "/api/sub") + "&lang=" + code,
  }));
}
const subCache = new Map();

const guard = (req, res, next) => {
  try {
    if (/gogoanime/i.test(new URL(req.query.url).hostname)) return next();
  } catch {}
  res.json({ status: false, message: "URL harus dari situs Gogoanime." });
};

app.get("/api/search", async (req, res) => {
  const r = await g.search(req.query.q);
  if (r.status) r.result = r.result.map((a) => ({ ...a, thumbnail: img(a.thumbnail) }));
  res.json(r);
});

app.get("/api/episodes", guard, async (req, res) => res.json(await g.getEpisodes(req.query.url)));

app.get("/api/watch", guard, async (req, res) => {
  const r = await g.scrape(req.query.url);
  if (!r.status) return res.json(r);
  const sources = r.result.downloads.map((d) =>
    d.headers && /HLS/i.test(d.quality)
      ? { kind: "hls", label: "Streaming langsung", url: px("hls", d.url, d.headers.Referer), intro: d.intro, subs: mkSubs(d) }
      : { kind: "link", label: d.quality, url: d.url },
  );
  res.json({ status: true, result: { title: r.result.title, thumbnail: img(r.result.thumbnail), sources } });
});

app.get("/api/p/:kind", async (req, res) => {
  const { d, s } = req.query;
  if (!d || s !== sign(d)) return res.status(403).end();
  const { u, r } = JSON.parse(Buffer.from(d, "base64url").toString());
  const headers = { "User-Agent": UA };
  if (r) headers.Referer = r;
  if (req.headers.range) headers.Range = req.headers.range;
  try {
    const up = await axios.get(u, {
      headers,
      responseType: "stream",
      timeout: 15000,
      validateStatus: (c) => c < 400,
    });
    const ct = String(up.headers["content-type"] || "");
    if (/mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(u)) {
      let body = "";
      for await (const c of up.data) body += c;
      return res.type("application/vnd.apple.mpegurl").send(rewrite(body, u, r));
    }
    res.status(up.status);
    if (ct) res.setHeader("Content-Type", ct);
    for (const h of ["content-length", "content-range", "accept-ranges", "cache-control"]) {
      if (up.headers[h]) res.setHeader(h, up.headers[h]);
    }
    up.data.pipe(res);
    req.on("close", () => up.data.destroy());
  } catch {
    if (!res.headersSent) res.status(502).end();
  }
});

app.get("/api/browse", async (req, res) => {
  const r = await browse(req.query.s, parseInt(req.query.page) || 1);
  r.result = r.result.map((a) => ({ ...a, thumbnail: img(a.thumbnail) }));
  res.json(r);
});

app.get("/api/sub", async (req, res) => {
  const { d, s } = req.query;
  if (!d || s !== sign(d)) return res.status(403).end();
  const lang = LANGS.some((l) => l[0] === req.query.lang) ? req.query.lang : "id";
  const key = d + lang;
  try {
    if (!subCache.has(key)) {
      const { u, r } = JSON.parse(Buffer.from(d, "base64url").toString());
      const f = await axios.get(u, { headers: { "User-Agent": UA, ...(r && { Referer: r }) }, responseType: "text", timeout: 15000 });
      subCache.set(key, translateVtt(String(f.data), lang));
    }
    res.type("text/vtt").send(await subCache.get(key));
  } catch {
    subCache.delete(key);
    res.status(502).end();
  }
});

app.get("/api/diag", async (_, res) => {
  const out = {};
  for (const h of ["https://ww25.gogoanimes.fi", "https://www14.gogoanime.me"]) {
    try {
      const r = await axios.get(h, { headers: { "User-Agent": UA }, timeout: 10000, validateStatus: () => true });
      out[h] = { status: r.status, panjang: String(r.data).length, server: r.headers.server || "-" };
    } catch (e) {
      out[h] = { error: e.code || e.message };
    }
  }
  res.json(out);
});

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));
app.listen(PORT, () => console.log(`Anime Id jalan di http://localhost:${PORT}`));
