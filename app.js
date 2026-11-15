"use strict";
// Grok Desk v2. Reads ONLY feed.json (real desk data). No demo numbers: missing data shows an empty state.
const FEED_URL = "feed.json";
const STALE_S = 300;
const $ = (id) => document.getElementById(id);
let FEED = null;
const TF = { desk: "24h", wallet: "24h" };
const TF_S = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, all: Infinity };
const TF_NL = { "24h": "24u", "7d": "7d", "30d": "30d", all: "sinds start" };

const nf2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const usd = (v) => (v == null ? "—" : (v < 0 ? "−" : "") + "$" + nf2.format(Math.abs(v)));
const sUsd = (v) => (v == null ? "—" : (v >= 0 ? "+" : "−") + "$" + nf2.format(Math.abs(v)));
const sPct = (v) => (v == null ? "" : (v >= 0 ? "+" : "−") + nf2.format(Math.abs(v)) + "%");
const cls = (v) => (v == null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tfmt = (iso, withDay) => {
  if (!iso) return "—";
  const o = { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" };
  if (withDay) Object.assign(o, { day: "numeric", month: "short" });
  return new Date(iso).toLocaleString("nl-NL", o);
};
const ago = (iso) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "net";
  if (s < 3600) return Math.floor(s / 60) + " min geleden";
  if (s < 86400) return Math.floor(s / 3600) + " u geleden";
  return Math.floor(s / 86400) + " d geleden";
};
const held = (s) => {
  if (s == null) return "—";
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m " + (s % 60) + "s";
  const h = Math.floor(m / 60);
  return h < 48 ? h + "u " + (m % 60) + "m" : Math.floor(h / 24) + "d " + (h % 24) + "u";
};
const price = (p) => (p == null ? "—" : "$" + (p < 0.01 ? Number(p).toPrecision(4) : nf2.format(p)));
const safeHref = (u) => (typeof u === "string" && /^https:\/\/(fomo\.family|solscan\.io)\//.test(u) ? u : null);
const hue = (s) => { let h = 0; for (const c of String(s || "?")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const tokAv = (tk, badge) => `<div class="tok" style="background:linear-gradient(135deg,hsl(${hue(tk)} 70% 52%),hsl(${(hue(tk) + 40) % 360} 65% 30%))">${esc(String(tk || "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "?")}${badge || ""}</div>`;

/* ---------- number count-up ---------- */
function setMoney(el, v) {
  if (v == null) { el.innerHTML = '<span class="int">$—</span><span class="dec"></span>'; el._v = null; return; }
  const from = el._v == null ? v * 0.96 : el._v;
  el._v = v;
  const t0 = performance.now(), dur = Math.abs(from - v) < 1e-9 ? 0 : 1100;
  const paint = (x) => {
    const s = nf2.format(Math.abs(x)); const i = s.lastIndexOf(",");
    el.innerHTML = `<span class="int">${x < 0 ? "−" : ""}$${s.slice(0, i)}</span><span class="dec">${s.slice(i)}</span>`;
  };
  cancelAnimationFrame(el._raf);
  if (!dur) return paint(v);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    paint(from + (v - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/* ---------- chart ---------- */
function windowed(series, tf) {
  if (!series || !series.length) return [];
  const now = series[series.length - 1][0];
  const w = TF_S[tf];
  if (!isFinite(w) || series[0][0] >= now - w) return series.slice();
  const t0 = now - w;
  let v0 = series[0][1];
  for (const [t, v] of series) { if (t <= t0) v0 = v; else break; }
  return [[t0, v0]].concat(series.filter(([t]) => t > t0));
}
function drawChart(el, series, tf, key) {
  const pts = windowed(series, tf);
  if (pts.length < 2) { el.innerHTML = '<div class="empty">Nog geen saldo-geschiedenis.</div>'; el._sig = null; return null; }
  if (pts[pts.length - 1][0] - pts[0][0] < 60) pts[0] = [pts[pts.length - 1][0] - 3600, pts[0][1]]; // no history yet: flat line
  const W = Math.max(300, el.clientWidth || 390), H = el.clientHeight || 170, P = { t: 30, b: 14, l: 0, r: 10 };
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const vals = pts.map((p) => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.01, 0.5);
  lo -= pad; hi += pad;
  const X = (t) => P.l + ((t - t0) / (t1 - t0 || 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  // step line: the balance only changes when a trade closes (no invented in-between values)
  let d = `M${X(pts[0][0]).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L${X(pts[i][0]).toFixed(1)},${Y(pts[i - 1][1]).toFixed(1)} L${X(pts[i][0]).toFixed(1)},${Y(pts[i][1]).toFixed(1)}`;
  }
  const first = vals[0], last = vals[vals.length - 1];
  const up = last >= first - 0.004;
  const col = up ? "#14F195" : "#ff4d5e";
  const ex = X(t1), ey = Y(last);
  const area = d + ` L${ex},${H} L${X(t0)},${H} Z`;
  // tag for the most recent close inside the window
  let tag = "";
  const tr = ((FEED && FEED.trades) || []).filter((t) => t.realized && t.closedAt).map((t) => ({ t, ts: new Date(t.closedAt).getTime() / 1000 }))
    .filter((x) => x.ts >= t0 && x.ts <= t1).sort((a, b) => b.ts - a.ts)[0];
  if (tr) {
    const tx = X(tr.ts), ty = Y(series.find((p) => Math.abs(p[0] - tr.ts) < 2)?.[1] ?? last);
    const label = (tr.t.badge === "STOP" ? "Gestopt " : "Verkocht ") + tr.t.ticker + " " + sUsd(tr.t.pnlUsd);
    const tw = label.length * 6.4 + 18, lx = Math.max(4, Math.min(tx - tw / 2, W - tw - 4));
    tag = `<line x1="${tx}" x2="${tx}" y1="20" y2="${ty}" stroke="rgba(255,255,255,.35)" stroke-dasharray="2 3"/>
      <circle cx="${tx}" cy="${ty}" r="7" fill="none" stroke="rgba(91,140,255,.9)" stroke-width="1.5"/>
      <rect x="${lx}" y="3" rx="9" width="${tw}" height="18" fill="#1b2340" stroke="rgba(91,140,255,.6)"/>
      <text class="tag" x="${lx + tw / 2}" y="16" text-anchor="middle" fill="#fff">${esc(label)}</text>`;
  }
  const sig = tf + "|" + JSON.stringify(pts.map((p) => p[1])) + "|" + W;
  if (el._sig === sig) { // same shape: only move the end dot
    return { up, first, last };
  }
  const redraw = el._sig == null || el._sig.split("|")[0] !== tf || el._sig.split("|")[1] !== sig.split("|")[1] || true;
  el._sig = sig;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="gf-${key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <path class="area" d="${area}" fill="url(#gf-${key})"/>
    <path class="ln ${up ? "" : "down"}" d="${d}" stroke="${col}"/>
    ${tag}
    <circle class="dot" cx="${ex}" cy="${ey}" r="4" fill="${col}"/>
  </svg>`;
  if (redraw) {
    const ln = el.querySelector(".ln"); const L = ln.getTotalLength ? ln.getTotalLength() : 1000;
    ln.style.strokeDasharray = L; ln.style.strokeDashoffset = L; ln.getBoundingClientRect(); ln.classList.add("draw");
  }
  return { up, first, last };
}

/* ---------- render ---------- */
function online(f) {
  const ageFeed = (Date.now() - new Date(f.generatedAt).getTime()) / 1000;
  return f.heartbeat && f.heartbeat.fresh && ageFeed < STALE_S;
}
function render(f) {
  FEED = f;
  const on = online(f);
  for (const id of ["badge", "badge2"]) {
    const b = $(id);
    b.className = "state " + (on ? "on" : "off");
    b.textContent = on ? (f.paused ? "PAUZE" : "LIVE") : "OFFLINE";
  }
  for (const id of ["modePill", "modePill2"]) { const m = $(id); m.textContent = f.mode; m.className = "mode" + (f.mode === "LIVE" ? " live" : ""); }
  const open = (f.stats && f.stats.open) || 0;
  $("openNote").textContent = "· " + open + " open";

  // desk hero
  const bl = f.balance || {};
  $("balLabel").textContent = bl.basis === "wallet" ? "Wallet-saldo (LIVE, echt geld)" : "Papiergeld (PAPER, geen echt geld)";
  setMoney($("bal"), bl.usd);
  const at = f.allTime || {};
  const m = $("mult");
  m.className = "mult " + (at.multiplier == null || Math.abs(at.multiplier - 1) < 0.0005 ? "flat" : at.multiplier > 1 ? "" : "down");
  m.textContent = at.multiplier == null ? "—" : nf2.format(at.multiplier) + "×";
  renderCharts();

  renderLive(f.scanNow, f.ticker || []);
  renderBots(f.modules || []);
  renderActivity($("act"), f.activity || [], 6);
  $("actNote").textContent = (f.activity || []).length ? (f.stats.trades + " trades") : "";
  renderRugs(f.rugChecks || []);
  renderSession(f.session);

  // wallet
  const st = f.stats || {};
  $("pfName").textContent = (f.profile && f.profile.name) || "Grok Desk";
  $("pfHandle").textContent = "@" + ((f.profile && f.profile.handle) || "");
  $("pfBio").textContent = "Solana memecoins · " + f.mode + (f.mode === "PAPER" ? " (geen echt geld)" : "");
  $("stHold").textContent = held(st.avgHoldS);
  $("stTrades").textContent = st.trades == null ? "—" : st.trades;
  $("stStart").textContent = st.startedAt ? "Gestart " + new Date(st.startedAt).toLocaleString("nl-NL", { month: "short", year: "numeric", timeZone: "Europe/Amsterdam" }).replace(".", "") : "—";
  setMoney($("bal2"), bl.usd);
  const c = f.cash || {};
  $("cashLabel").textContent = c.basis === "wallet" ? "Saldo (SOL-wallet)" : "Saldo · vrij papiergeld";
  $("cash").textContent = usd(c.usd) + (c.basis === "wallet" && f.wallet && f.wallet.sol != null ? " · " + String(f.wallet.sol).replace(".", ",") + " SOL" : "");
  renderPositions();
  renderActivity($("feed"), f.activity || [], 25);
  $("updated").textContent = "Bijgewerkt " + tfmt(f.generatedAt, true) + " (Amsterdam)" + (on ? "" : " · desk lijkt offline");
  startToasts(f.toasts || []);

  const mh = /^#trade-(\d+)$/.exec(location.hash);
  if (mh && !render.opened) { const t = (f.trades || []).find((x) => String(x.id) === mh[1]); if (t) { render.opened = true; openTrade(t); } }
}

function renderCharts() {
  const f = FEED; if (!f) return;
  const bl = f.balance || {};
  const r1 = drawChart($("chartDesk"), f.series, TF.desk, "d");
  const c = $("chg");
  if (r1 && bl.usd != null) {
    const ch = bl.usd - r1.first, pct = r1.first ? (100 * ch) / r1.first : null;
    c.className = "chg " + cls(ch);
    c.innerHTML = `<span class="arr">${ch >= 0 ? "▲" : "▼"}</span>${esc(usd(Math.abs(ch)))} (${esc(nf2.format(Math.abs(pct || 0)))}%) <span class="mut">${esc(TF_NL[TF.desk])}</span>`;
  } else { c.className = "chg flat"; c.textContent = "—"; }
  const r2 = drawChart($("chartWallet"), f.series, TF.wallet, "w");
  const c2 = $("chg2");
  if (r2 && bl.usd != null) { const ch = bl.usd - r2.first; c2.className = cls(ch); c2.textContent = sUsd(ch); }
  else { c2.className = "flat"; c2.textContent = "—"; }
  $("chg2tf").textContent = TF_NL[TF.wallet];
}
document.querySelectorAll(".tf").forEach((g) => g.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tf]"); if (!b) return;
  g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  TF[g.dataset.chart] = b.dataset.tf;
  renderCharts();
}));

function renderLive(s, items) {
  const el = $("live");
  if (!s) { el.innerHTML = '<div class="empty-st" style="border:0"><b>Nog niets gescand</b>Zodra de Scanner een nieuwe coin ziet, staat hij hier.</div>'; return; }
  const met = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const liq = s.liqUsd == null ? "—" : "$" + (s.liqUsd >= 1000 ? nf2.format(s.liqUsd / 1000).replace(/,?0+$/, "") + "K" : nf0.format(s.liqUsd));
  const rows = items.slice(0, 20).map((t) => `<div class="scanrow"><span class="t">${esc(tfmt(t.t))}</span><b>$${esc(t.ticker)}</b><span class="s ${t.verdict === "PASS" ? "p" : ""}">${t.verdict === "PASS" ? "PASS" : "SKIP"}</span><span class="why">${esc(t.reason || "door naar Auditor")}</span></div>`).join("");
  const fomo = safeHref(s.fomo);
  el.innerHTML = `<div class="live-top"><span class="rd">Live · Scanner</span><span class="ac">${s.verdict === "PASS" ? "Auditor · controleert" : "Scanner · zoekt"}</span></div>
    <div class="live-main">${tokAv(s.ticker)}<div><div class="tk">$${esc(s.ticker)}</div><div class="nm">${esc(s.name || "")} · ${esc(ago(s.t))}</div></div>
      <span class="verd ${s.verdict}">${s.verdict === "PASS" ? "DOOR" : "SKIP"}</span></div>
    <div class="metrics">${met("Liquiditeit", liq)}${met("1u", s.h1Pct == null ? "—" : `<span class="${cls(s.h1Pct)}">${esc((s.h1Pct >= 0 ? "+" : "−") + (Math.abs(s.h1Pct) >= 1000 ? nf2.format(Math.abs(s.h1Pct) / 1000).replace(/,?0+$/, "") + "K" : nf0.format(Math.abs(s.h1Pct))) + "%")}</span>`)}${met("Leeftijd", s.ageMin == null ? "—" : esc(s.ageMin) + " min")}${met("Top-10", s.top10Pct == null ? "—" : esc(nf2.format(s.top10Pct)) + "%")}</div>
    <div class="scanlist"><div class="track" style="${items.length < 5 ? "animation:none" : ""}">${rows}${items.length >= 5 ? rows : ""}</div></div>
    <div class="live-foot"><span>${s.reason ? "Overgeslagen: " + esc(s.reason) : "Door de eerste filter ✓"}</span>${fomo ? `<a class="v" href="${esc(fomo)}" target="_blank" rel="noopener" style="text-decoration:none">FOMO ↗</a>` : ""}</div>`;
  $("liveWho").textContent = s.seenTonight + " gezien vannacht";
}

const BOT = {
  scanner: { c: "#2dd4bf", d: "#22d3ee", i: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 12 L18 7" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="#fff"/>' },
  auditor: { c: "#ff4d5e", d: "#f43f5e", i: '<path d="M12 3 4 6v6c0 4.4 3.4 8 8 9 4.6-1 8-4.6 8-9V6z" fill="none" stroke="#fff" stroke-width="2"/><path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' },
  analyst: { c: "#f5c542", d: "#facc15", i: '<path d="M4 18 9 12l3 3 7-8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  executor: { c: "#b57bff", d: "#a78bfa", i: '<path d="M13 2 5 14h6l-1 8 8-12h-6z" fill="#fff"/>' },
  risk: { c: "#fb923c", d: "#f97316", i: '<rect x="6" y="10" width="12" height="10" rx="2" fill="#fff"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" fill="none" stroke="#fff" stroke-width="2"/>' },
};
function renderBots(mods) {
  const alive = mods.filter((m) => m.alive).length;
  $("botsNote").textContent = mods.length ? `${alive} van ${mods.length} actief` : "";
  $("botsNote").style.color = alive === mods.length ? "" : "var(--r)";
  $("bots").innerHTML = mods.map((m) => {
    const b = BOT[m.key] || BOT.scanner;
    const ring = `<svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="18.5" fill="none" stroke="${b.c}" stroke-opacity=".25" stroke-width="3"/>
      <circle cx="21" cy="21" r="18.5" fill="none" stroke="${b.c}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${m.alive ? "84 32" : "0 200"}" transform="rotate(-90 21 21)">
      ${m.alive ? '<animateTransform attributeName="transform" type="rotate" from="-90 21 21" to="270 21 21" dur="3s" repeatCount="indefinite"/>' : ""}</circle></svg>`;
    const right = m.rightPnl != null ? `<span class="${cls(m.rightPnl)}">${esc(m.right)}</span>`
      : m.right == null ? "" : m.key === "analyst" ? `<span class="up" style="font-size:14px">${esc(m.right)}</span>` : `${esc(m.right)}${m.rightUnit ? `<small>${esc(m.rightUnit)}</small>` : ""}`;
    return `<div class="bot ${m.alive ? "" : "dead"}"><div class="ring">${ring}<div class="ico" style="background:${b.c}33"><svg viewBox="0 0 24 24">${b.i}</svg></div></div>
      <div class="bot-mid"><div class="bot-n"><i style="background:${m.alive ? b.d : "#555"}"></i>${esc(m.name)}${m.alive ? "" : ' <small class="down" style="font-size:12px">offline</small>'}</div>
      <div class="bot-l">${esc(m.line || "")}</div></div><div class="bot-r">${right}</div></div>`;
  }).join("");
}

const KIND = { buy: ["#5b8cff", "↗"], sell: ["#14F195", "↙"], stop: ["#ff4d5e", "↙"], reject: ["#8a8a8f", "✕"] };
function renderActivity(el, list, n) {
  if (!list.length) { el.innerHTML = '<div class="empty-st"><div class="eic">◎</div><b>Nog geen activiteit</b>Hier komen aankopen, verkopen en afgekeurde coins.</div>'; return; }
  el.innerHTML = list.slice(0, n).map((a, i) => {
    const k = KIND[a.kind] || KIND.reject;
    const right = a.pnlUsd != null ? `<div class="a ${cls(a.pnlUsd)}">${esc(sUsd(a.pnlUsd))}</div><div class="b ${cls(a.pnlUsd)}">${esc(sPct(a.pnlPct))}</div>`
      : a.amountUsd != null ? `<div class="a">${esc(usd(a.amountUsd))}</div><div class="b mut">inleg</div>` : `<div class="b mut">Overgeslagen</div>`;
    return `<div class="row ${a.tradeId ? "tap" : ""}" data-tid="${a.tradeId || ""}">${tokAv(a.ticker, `<span class="sb" style="background:${k[0]}">${k[1]}</span>`)}
      <div class="row-mid"><div class="row-t">${esc(a.title)}</div><div class="row-s">${esc(a.sub)} · ${esc(tfmt(a.t, true))}</div></div><div class="row-r">${right}</div></div>`;
  }).join("");
  el.querySelectorAll(".row.tap").forEach((r) => r.addEventListener("click", () => {
    const t = (FEED.trades || []).find((x) => String(x.id) === r.dataset.tid); if (t) openTrade(t);
  }));
}

let POS = "open", POSF = "all";
function renderPositions() {
  const f = FEED; if (!f) return;
  const openP = f.positions || [];
  const closedT = (f.trades || []).filter((t) => t.realized);
  $("posTitle").textContent = `Posities (${openP.length})`;
  const el = $("positions");
  const list = POS === "open" ? openP : closedT;
  if (!list.length) {
    el.innerHTML = POS === "open"
      ? `<div class="empty-st"><div class="eic">◎</div><b>Geen open posities</b>De desk koopt pas als een coin alle 8 rug-checks en de Analyst haalt. Zodra hij koopt, staat de positie hier live.</div>`
      : `<div class="empty-st"><div class="eic">◎</div><b>Nog geen gesloten trades</b></div>`;
    return;
  }
  el.innerHTML = list.slice(0, 30).map((p) => {
    const value = POS === "open" ? p.valueUsd : p.exitValueUsd;
    const sub = POS === "open" ? `${esc(p.name || p.ticker)}${p.sharePct != null ? ` · <span class="share">${esc(nf2.format(p.sharePct))}% van portfolio</span>` : ""}`
      : `${esc(p.badge || "DICHT")} · ${esc(held(p.heldS))} · ${esc(tfmt(p.closedAt, true))}`;
    return `<div class="row tap" data-tid="${p.id}">${tokAv(p.ticker)}<div class="row-mid"><div class="row-t">${esc(p.name || p.ticker)}</div><div class="row-s">$${esc(p.ticker)} · ${sub}</div></div>
      <div class="row-r"><div class="a">${esc(usd(value))}</div><div class="b ${cls(p.pnlUsd)}">${p.pnlPct != null ? (p.pnlPct >= 0 ? "▲ " : "▼ ") + esc(nf2.format(Math.abs(p.pnlPct))) + "%" : ""}</div></div></div>`;
  }).join("");
  el.querySelectorAll(".row.tap").forEach((r) => r.addEventListener("click", () => {
    const t = (FEED.trades || []).find((x) => String(x.id) === r.dataset.tid); if (t) openTrade(t);
  }));
}
$("posSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  POS = b.dataset.v; $("posSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); renderPositions();
});
$("posPills").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  POSF = b.dataset.f; $("posPills").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); renderPositions();
});
$("feedToggle").addEventListener("click", () => {
  const h = $("feed").style.display !== "none";
  $("feed").style.display = h ? "none" : "";
  $("feedToggle").textContent = h ? "Toon" : "Verberg";
});
$("posToggle").addEventListener("click", () => {
  const h = $("positions").style.display !== "none";
  $("positions").style.display = $("posPills").style.display = h ? "none" : "";
  $("posToggle").textContent = h ? "Toon" : "Verberg";
});

function renderRugs(cards) {
  const el = $("rugs");
  if (!cards.length) { el.innerHTML = '<div class="card rug"><div class="mut">De Auditor heeft nog geen coins gecontroleerd.</div></div>'; return; }
  el.innerHTML = cards.map((c) => `<div class="card rug">
      <div class="stamp ${c.stamp}">${c.stamp}</div>
      <h4>$${esc(c.ticker)}</h4><div class="when">${esc(tfmt(c.t, true))}${c.holders ? " · " + esc(c.holders.toLocaleString("nl-NL")) + " holders" : ""}</div>
      ${c.checks.map((k) => `<div class="chk"><i class="${k.pass ? "y" : "n"}">${k.pass ? "✓" : "✕"}</i><div>${esc(k.label)}<div class="val">${esc(k.value || "")}</div></div></div>`).join("")}
      ${!c.passed && c.checksDone < 8 ? `<div class="notdone">Gestopt na ${c.checksDone} van 8 checks</div>` : ""}
    </div>`).join("");
}

function renderSession(s) {
  const el = $("session");
  if (!s) { el.innerHTML = ""; return; }
  const best = s.best ? `Beste trade: $${esc(s.best.ticker)} ${esc(sUsd(s.best.pnlUsd))}` : "Beste trade: geen";
  const worst = s.worstStop ? `Zwaarste stop: $${esc(s.worstStop.ticker)} ${esc(sUsd(s.worstStop.pnlUsd))}` : "Geen stop-loss geraakt";
  el.innerHTML = `<div class="card-h"><span>Sessie klaar ☕</span><span class="mut">nacht ${esc(s.night)} · ${esc(s.mode)}</span></div>
    <div class="grid">
      <div class="kpi"><div class="k">Trades</div><div class="v">${s.trades}</div></div>
      <div class="kpi"><div class="k">Groen</div><div class="v">${s.green}</div></div>
      <div class="kpi"><div class="k">Resultaat</div><div class="v ${cls(s.pnlUsd)}">${esc(sUsd(s.pnlUsd))}</div></div>
    </div>
    <div class="line">${esc(s.seen)} coins gezien, ${esc(s.killed)} overgeslagen${s.lowLiq ? ` (${esc(s.lowLiq)} door te weinig liquiditeit)` : ""}.</div>
    <div class="line">${best} · ${worst}</div>`;
}

/* ---------- sheets ---------- */
function openSheet(html) { $("sheetBody").innerHTML = html; $("sheet").classList.remove("hidden"); }
function closeSheet() { $("sheet").classList.add("hidden"); }
document.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", closeSheet));
function openTrade(t) {
  const row = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
  const link = (u, txt) => { const h = safeHref(u); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener">${txt}</a>` : "—"; };
  openSheet(`<div style="display:flex;gap:12px;align-items:center">${tokAv(t.ticker)}<div><div class="big">$${esc(t.ticker)}</div>
    <div class="mut">${esc(t.name || "")} · ${esc(t.mode)} ${t.mode === "PAPER" ? "(geen echt geld)" : ""}</div></div></div>
    <div class="chg ${cls(t.pnlUsd)}" style="margin:12px 0 8px;font-size:20px">${esc(sUsd(t.pnlUsd))} ${esc(sPct(t.pnlPct))} ${t.realized ? "" : "(nog open)"}</div>
    ${row("Ingestapt", esc(tfmt(t.openedAt, true)) + " · " + esc(price(t.entryPrice)))}
    ${row(t.realized ? "Uitgestapt" : "Laatste prijs", t.realized ? esc(tfmt(t.closedAt, true)) + " · " + esc(price(t.exitPrice)) : esc(price(t.lastPrice)))}
    ${row("Inleg", esc(usd(t.sizeUsd)) + (t.sizeSol != null ? " · " + esc(t.sizeSol) + " SOL" : ""))}
    ${t.realized ? row("Waarde bij verkoop", esc(usd(t.exitValueUsd))) : ""}
    ${row("Fees", esc(usd(t.feesUsd)))}
    ${row("Resultaat", `<span class="${cls(t.pnlUsd)}">${esc(sUsd(t.pnlUsd))}</span>`)}
    ${row("Reden verkoop", esc(t.exitReason || (t.realized ? "—" : "nog open")))}
    ${row("Vastgehouden", esc(held(t.heldS)))}
    ${row("FOMO", link(t.fomo, "Open op FOMO ↗"))}
    ${t.mode === "LIVE" ? row("Koop-tx", link(t.buyTx, "Solscan ↗")) + row("Verkoop-tx", link(t.sellTx, "Solscan ↗")) : ""}`);
}
function openDeposit() {
  const w = (FEED && FEED.wallet) || {};
  const sol = safeHref(w.solscan);
  openSheet(`<div class="card-h"><span style="font-size:22px;font-weight:700">Storten</span><span class="mut">Solana</span></div>
    <p class="txt">Stuur SOL vanuit Phantom of een exchange naar dit adres. Dit is de enige manier om de desk geld te geven.</p>
    <div class="addr" id="addr">${esc(w.address || "—")}</div>
    <div class="btns"><button id="copy" class="btn">Kopieer adres</button>${sol ? `<a class="btn ghost" href="${esc(sol)}" target="_blank" rel="noopener">Bekijk op Solscan</a>` : ""}</div>
    <div class="sub">${w.sol == null ? "Saldo nu niet op te halen." : `Nu in de wallet: ${String(w.sol).replace(".", ",")} SOL${w.usd != null ? " (" + usd(w.usd) + ")" : ""}`}</div>`);
  $("copy").addEventListener("click", () => copyAddr($("copy")));
}
async function copyAddr(btn) {
  const a = FEED && FEED.wallet && FEED.wallet.address; if (!a) return;
  try { await navigator.clipboard.writeText(a); } catch (e) {
    const ta = document.createElement("textarea"); ta.value = a; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  if (btn) { const o = btn.innerHTML; btn.textContent = "Gekopieerd ✓"; setTimeout(() => (btn.innerHTML = o), 1600); }
}
$("btnDeposit").addEventListener("click", openDeposit);
$("btnMore").addEventListener("click", () => {
  const w = (FEED && FEED.wallet) || {};
  const sol = safeHref(w.solscan);
  openSheet(`<div class="menu">
    <button id="mCopy"><span class="mi">⧉</span>Kopieer wallet-adres</button>
    ${sol ? `<button id="mSol"><span class="mi">↗</span>Open op Solscan</button>` : ""}
    <button id="mDep"><span class="mi">+</span>Storten</button></div>`);
  $("mCopy").addEventListener("click", () => copyAddr($("mCopy")));
  if (sol) $("mSol").addEventListener("click", () => { window.open(sol, "_blank", "noopener"); closeSheet(); });
  $("mDep").addEventListener("click", openDeposit);
});

/* ---------- tabs + swipe ---------- */
function goTab(i) {
  $("screens").classList.toggle("w", i === 1);
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("on", +b.dataset.tab === i));
  if (history.replaceState) history.replaceState(null, "", i === 1 ? "#wallet" : location.pathname + location.search);
  setTimeout(renderCharts, 450);
}
document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => goTab(+b.dataset.tab)));
(() => {
  let x0 = null, y0 = null;
  const v = $("viewport");
  v.addEventListener("touchstart", (e) => { if (e.target.closest(".rug-row,.tf")) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  v.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) goTab(dx < 0 ? 1 : 0);
  }, { passive: true });
})();
if (location.hash === "#wallet") goTab(1);

/* ---------- toasts (iOS-style banner) ---------- */
let toastTimer = null, toastIdx = 0, toastList = [];
function startToasts(list) {
  toastList = list;
  if (toastTimer || !list.length) return;
  const show = () => {
    if (!toastList.length || document.hidden) return;
    const box = $("toasts");
    const n = document.createElement("div");
    n.className = "toast";
    n.innerHTML = `<span class="tl"></span><div><div class="tt">grok desk · nu</div><div>${esc(toastList[toastIdx++ % toastList.length])}</div></div>`;
    box.appendChild(n);
    setTimeout(() => n.classList.add("out"), 3600);
    setTimeout(() => n.remove(), 4100);
  };
  setTimeout(show, 1400);
  toastTimer = setInterval(show, 9000);
}

/* ---------- load ---------- */
async function load() {
  try {
    const r = await fetch(FEED_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    render(await r.json());
  } catch (e) {
    for (const id of ["badge", "badge2"]) { $(id).className = "state off"; $(id).textContent = "OFFLINE"; }
    $("updated").textContent = "Kon de gegevens niet laden. Ik probeer het zo opnieuw.";
  }
}
load();
setInterval(load, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { $("chartDesk")._sig = $("chartWallet")._sig = null; renderCharts(); }, 200); });
