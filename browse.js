const axios = require("axios");
const cheerio = require("cheerio");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HOSTS = ["https://ww25.gogoanimes.fi", "https://www14.gogoanime.me"];
const PATHS = { popular: "/popular.html", season: "/new-season.html", movies: "/anime-movies.html" };

async function browse(section, page = 1) {
  const p = PATHS[section] || PATHS.popular;
  for (const host of HOSTS) {
    try {
      const res = await axios.get(`${host}${p}?page=${page}`, { headers: { "User-Agent": UA }, timeout: 10000 });
      const $ = cheerio.load(res.data);
      const out = [];
      $("div.last_episodes ul.items li").each((_, el) => {
        const a = $(el).find("p.name a");
        const title = a.attr("title") || a.text().trim();
        let href = a.attr("href") || "";
        if (href && !href.startsWith("http")) href = host + href;
        let thumb = $(el).find("div.img a img").attr("src") || "";
        if (thumb && !thumb.startsWith("http")) thumb = host + thumb;
        const rel = $(el).find("p.released").text().replace(/\s+/g, " ").replace(/released:?/i, "").trim();
        if (title && href) out.push({ title: /\d{4}/.test(rel) ? `${title} (${rel.match(/\d{4}/)[0]})` : title, url: href, thumbnail: thumb });
      });
      if (out.length) return { status: true, result: out };
    } catch (_) {}
  }
  return { status: true, result: [] };
}
module.exports = browse;
