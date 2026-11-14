"use strict";
// Reads ONLY feed.json (real desk data). No demo numbers: missing data shows an empty state.
const FEED_URL = "feed.json";
const STALE_S = 300;
const $ = (id) => document.getElementById(id);
let FEED = null;

const nf2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (v) => (v == null ? "—" : "$" + nf2.format(v));
const sUsd = (v) => (v == null ? "—" : (v >= 0 ? "+" : "−") + "$" + nf2.format(Math.abs(v)));
const sPct = (v) => (v == null ? "" : (v >= 0 ? "+" : "−") + nf2.format(Math.abs(v)) + "%");
const cls = (v) => (v == null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tfmt = (iso, withDay) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const o = { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" };
  if (withDay) Object.assign(o, { day: "numeric", month: "short" });
  return d.toLocaleString("nl-NL", o);
};
const held = (s) => {
  if (s == null) return "";
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h < 48 ? h + "u " + (m % 60) + "m" : Math.floor(h / 24) + "d";
};
const price = (p) => (p == null ? "—" : "$" + (p < 0.01 ? Number(p).toPrecision(4) : nf2.format(p)));
const safeHref = (u) => (typeof u === "string" && /^https:\/\/(fomo\.family|solscan\.io)\//.test(u) ? u : null);

function render(f) {
  FEED = f;
  // 1. header badge
  const ageFeed = (Date.now() - new Date(f.generatedAt).getTime()) / 1000;
  const online = f.heartbeat && f.heartbeat.fresh && ageFeed < STALE_S;
  const b = $("badge");
  b.className = "badge" + (online ? " on" : " off") + (f.mode === "LIVE" && online ? " live" : "");
  b.textContent = online ? (f.paused ? f.mode + " · PAUZE" : f.mode) : "OFFLINE";

  // 2. balance
  const bl = f.balance || {};
  $("balLabel").textContent = bl.basis === "wallet" ? "Wallet-saldo (LIVE)" : "Papiergeld (PAPER, geen echt geld)";
  $("bal").textContent = usd(bl.usd);
  const c = $("chg");
  c.className = "chg " + cls(bl.changeUsd);
  c.textContent = bl.changeUsd == null ? "—" : sUsd(bl.changeUsd) + "  " + sPct(bl.changePct);
  $("mult").textContent = bl.multiplier == null ? "x—" : "x" + nf2.format(bl.multiplier);
  $("nightLine").textContent = "t.o.v. start nachtsessie " + tfmt(f.night.start, true) + " · loopt tot " + tfmt(f.night.end, true);

  renderChart(f.equity || []);
  renderTicker(f.ticker || []);
  renderTrades(f.trades || []);
  renderRugs(f.rugChecks || []);
  renderSession(f.session);
  renderWallet(f.wallet || {});
  $("updated").textContent = "Bijgewerkt " + tfmt(f.generatedAt, true) + " (Amsterdam)" + (online ? "" : " · desk lijkt offline");
  startToasts(f.toasts || []);
  const m = /^#trade-(\d+)$/.exec(location.hash);
  if (m && !render.opened) { const t = (f.trades || []).find((x) => String(x.id) === m[1]); if (t) { render.opened = true; openTrade(t); } }
}

function renderChart(pts) {
  const el = $("chart");
  if (pts.length < 2) {
    el.innerHTML = '<div class="empty">Nog geen gesloten trades, dus nog geen lijn. Zodra de desk een trade afsluit, verschijnt hier de winst of het verlies.</div>';
    $("eqNote").textContent = "";
    return;
  }
  const W = 340, H = 150, P = { l: 6, r: 40, t: 22, b: 18 };
  // evenly spaced per closed trade (a trade can close a minute after it opens), last point runs on to "nu"
  const n = pts.length;
  const xs = pts.map((_, i) => i).concat([n]);
  const x0 = 0, x1 = n;
  const vals = pts.map((p) => p.value);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 1) hi = lo + 1;
  const X = (t) => P.l + ((t - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  // step line: value holds until the next close, then runs flat to now
  let d = `M${X(xs[0])},${Y(vals[0])}`;
  for (let i = 1; i < pts.length; i++) d += ` L${X(xs[i])},${Y(vals[i])}`;
  d += ` L${X(x1)},${Y(vals[vals.length - 1])}`;
  const area = d + ` L${X(x1)},${Y(lo)} L${X(xs[0])},${Y(lo)} Z`;
  const last = vals[vals.length - 1];
  const col = last >= 0 ? "#12d863" : "#ff3b4a";
  let labels = "";
  pts.forEach((p, i) => {
    if (!p.ticker) return;
    const x = X(xs[i]), y = Y(p.value);
    labels += `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="${col}" stroke-width="2.5"/>` +
      `<text class="lbl" x="${Math.max(P.l, Math.min(x - 30, W - 110))}" y="${y - 10}">$${esc(p.ticker)} ${esc(sUsd(p.pnlUsd))}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="#e6e8ec" stroke-dasharray="3 4"/>
    <path d="${area}" fill="url(#gf)"/>
    <path class="line" d="${d}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${labels}
    <text class="ax" x="${W - P.r + 4}" y="${Y(last) + 3}">${esc(sUsd(last))}</text>
    <text class="ax" x="${P.l}" y="${H - 2}">${esc(tfmt(pts[0].t, true))}</text>
    <text class="ax" x="${W - P.r}" y="${H - 2}" text-anchor="end">nu</text>
  </svg>`;
  $("eqNote").textContent = "gerealiseerd, na fees";
}

function renderTicker(items) {
  const el = $("ticker");
  if (!items.length) { el.innerHTML = '<div class="chip">Nog niets gescand</div>'; el.style.animation = "none"; return; }
  const chip = (t) => `<div class="chip"><b>$${esc(t.ticker)}</b><span class="tag ${t.verdict === "PASS" ? "pass" : "skip"}">${t.verdict}</span>${t.reason ? `<span class="why">${esc(t.reason)}</span>` : ""}</div>`;
  const html = items.map(chip).join("");
  el.innerHTML = html + html; // doubled for a seamless loop
}

function renderTrades(trades) {
  const el = $("trades");
  const open = trades.filter((t) => !t.realized).length;
  $("tradeNote").textContent = trades.length ? `${open} open · ${trades.length - open} gesloten` : "";
  if (!trades.length) { el.innerHTML = '<div class="empty">Nog geen trades. De desk koopt alleen als een coin alle checks haalt.</div>'; return; }
  el.innerHTML = trades.slice(0, 25).map((t, i) => {
    const status = t.realized ? `<span class="bdg ${esc(t.badge || "")}">${esc(t.badge || "DICHT")}</span>` : `<span class="bdg">${esc(t.badge || "OPEN")}</span>`;
    return `<div class="trade" data-i="${i}">
      <div class="av">${esc((t.ticker || "?").slice(0, 3).toUpperCase())}</div>
      <div class="t-mid"><div class="t-name">$${esc(t.ticker)}</div>
        <div class="t-sub">${status}<span>${esc(held(t.heldS))}</span><span>· ${esc(tfmt(t.closedAt || t.openedAt, true))}</span></div></div>
      <div class="t-right"><div class="t-pnl ${cls(t.pnlUsd)}">${esc(sUsd(t.pnlUsd))}</div><div class="t-pct ${cls(t.pnlUsd)}">${esc(sPct(t.pnlPct))}</div></div>
    </div>`;
  }).join("");
  el.querySelectorAll(".trade").forEach((n) => n.addEventListener("click", () => openTrade(trades[+n.dataset.i])));
}

function openTrade(t) {
  const row = (k, v) => `<div class="kv"><span>${esc(k)}</span><span>${v}</span></div>`;
  const link = (u, txt) => (safeHref(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(txt)}</a>` : "—");
  $("sheetBody").innerHTML = `
    <div class="muted">${esc(t.name || "")} · ${esc(t.mode)} ${t.mode === "PAPER" ? "(geen echt geld)" : ""}</div>
    <div class="big">$${esc(t.ticker)}</div>
    <div class="chg ${cls(t.pnlUsd)}" style="margin:2px 0 12px">${esc(sUsd(t.pnlUsd))} ${esc(sPct(t.pnlPct))} ${t.realized ? "" : "(nog open)"}</div>
    ${row("Ingestapt", esc(tfmt(t.openedAt, true)) + " · " + esc(price(t.entryPrice)))}
    ${row(t.realized ? "Uitgestapt" : "Laatste prijs", t.realized ? esc(tfmt(t.closedAt, true)) + " · " + esc(price(t.exitPrice)) : esc(price(t.lastPrice)))}
    ${row("Inleg", esc(usd(t.sizeUsd)) + (t.sizeSol != null ? " · " + esc(t.sizeSol) + " SOL" : ""))}
    ${t.realized ? row("Waarde bij verkoop", esc(usd(t.exitValueUsd))) : ""}
    ${row("Fees", esc(usd(t.feesUsd)))}
    ${row("Resultaat", `<span class="${cls(t.pnlUsd)}">${esc(sUsd(t.pnlUsd))}</span>`)}
    ${row("Reden verkoop", esc(t.exitReason || (t.realized ? "—" : "nog open")))}
    ${row("Vastgehouden", esc(held(t.heldS)))}
    ${row("FOMO", link(t.fomo, "Open op FOMO"))}
    ${t.mode === "LIVE" ? row("Koop-tx", link(t.buyTx, "Solscan")) + row("Verkoop-tx", link(t.sellTx, "Solscan")) : ""}`;
  $("sheet").classList.remove("hidden");
}
document.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", () => $("sheet").classList.add("hidden")));

function renderRugs(cards) {
  const el = $("rugs");
  if (!cards.length) { el.innerHTML = '<div class="card glass rug"><div class="empty">De Auditor heeft nog geen coins gecontroleerd.</div></div>'; return; }
  el.innerHTML = cards.map((c) => `<div class="card glass rug">
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
  el.innerHTML = `<div class="card-h"><span>Sessie klaar ☕</span><span class="muted">nacht ${esc(s.night)} · ${esc(s.mode)}</span></div>
    <div class="grid">
      <div class="kpi"><div class="k">Trades</div><div class="v">${s.trades}</div></div>
      <div class="kpi"><div class="k">Groen</div><div class="v">${s.green}</div></div>
      <div class="kpi"><div class="k">Resultaat</div><div class="v ${cls(s.pnlUsd)}">${esc(sUsd(s.pnlUsd))}</div></div>
    </div>
    <div class="line">${esc(s.seen)} coins gezien, ${esc(s.killed)} overgeslagen${s.lowLiq ? ` (${esc(s.lowLiq)} door te weinig liquiditeit)` : ""}.</div>
    <div class="line">${best} · ${worst}</div>`;
}

function renderWallet(w) {
  $("addr").textContent = w.address || "—";
  const sol = safeHref(w.solscan);
  if (sol) $("solscan").href = sol;
  $("walletBal").textContent = w.sol == null ? "Saldo nu niet op te halen." : `Nu in de wallet: ${String(w.sol).replace(".", ",")} SOL${w.usd != null ? " (" + usd(w.usd) + ")" : ""}`;
}
$("copy").addEventListener("click", async () => {
  const a = FEED && FEED.wallet && FEED.wallet.address;
  if (!a) return;
  try { await navigator.clipboard.writeText(a); } catch (e) {
    const r = document.createRange(); r.selectNodeContents($("addr")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand("copy");
  }
  $("copy").textContent = "Gekopieerd ✓";
  setTimeout(() => ($("copy").textContent = "Kopieer adres"), 1800);
});

let toastTimer = null, toastIdx = 0, toastList = [];
function startToasts(list) {
  toastList = list;
  if (toastTimer || !list.length) return;
  const show = () => {
    if (!toastList.length) return;
    const box = $("toasts");
    const n = document.createElement("div");
    n.className = "toast";
    n.textContent = toastList[toastIdx++ % toastList.length];
    box.appendChild(n);
    setTimeout(() => n.classList.add("out"), 3600);
    setTimeout(() => n.remove(), 4100);
  };
  setTimeout(show, 900);
  toastTimer = setInterval(show, 5200);
}

async function load() {
  try {
    const r = await fetch(FEED_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    render(await r.json());
  } catch (e) {
    $("badge").className = "badge off";
    $("badge").textContent = "OFFLINE";
    $("updated").textContent = "Kon de gegevens niet laden. Ik probeer het zo opnieuw.";
  }
}
load();
setInterval(load, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
