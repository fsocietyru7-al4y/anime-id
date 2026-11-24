const axios = require("axios");

// Terjemahan Inggris -> Indonesia lewat endpoint publik Google Translate.
async function gt(arr, tl = "id") {
  const q = arr.map((s) => s.replace(/\n+/g, " ")).join("\n\n");
  const r = await axios.post(
    "https://translate.googleapis.com/translate_a/single",
    new URLSearchParams({ client: "gtx", sl: "auto", tl, dt: "t", q }),
    { timeout: 15000 },
  );
  const txt = (r.data[0] || []).map((x) => x[0]).join("");
  const parts = txt.split(/\n\n+/);
  return parts.length === arr.length ? parts : null;
}

async function translateVtt(vtt, tl = "id", tr) {
  tr = tr || ((a) => gt(a, tl));
  const blocks = vtt.replace(/\r/g, "").split(/\n\n+/);
  const cues = [];
  blocks.forEach((b, bi) => {
    const L = b.split("\n");
    const ti = L.findIndex((l) => l.includes("-->"));
    if (ti >= 0 && L.length > ti + 1) {
      const text = L.slice(ti + 1).join(" ").replace(/<[^>]+>/g, "").trim();
      if (text) cues.push({ bi, ti, text });
    }
  });
  const chunks = [];
  for (let k = 0; k < cues.length; k += 40) chunks.push(cues.slice(k, k + 40));
  for (let g = 0; g < chunks.length; g += 5) {
    await Promise.all(
      chunks.slice(g, g + 5).map(async (ch) => {
        let out = null;
        try { out = await tr(ch.map((c) => c.text)); } catch (_) {}
        if (!out) out = await Promise.all(ch.map((c) => tr([c.text]).then((x) => x && x[0]).catch(() => null)));
        ch.forEach((c, j) => { if (out[j]) c.out = String(out[j]).trim(); });
      }),
    );
  }
  cues.forEach((c) => {
    if (c.out) blocks[c.bi] = [...blocks[c.bi].split("\n").slice(0, c.ti + 1), c.out].join("\n");
  });
  return blocks.join("\n\n");
}
module.exports = { translateVtt };
