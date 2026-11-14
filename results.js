import { db, CRITERIA, configured, esc, poll, summarize, notConfiguredHTML, fmt } from "./lib.js";

const app = document.getElementById("app");
const openDetails = new Set();
const tvBtn = document.getElementById("tv");

tvBtn.addEventListener("click", async () => {
  document.body.classList.toggle("tv");
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else await document.exitFullscreen?.();
  } catch { /* fullscreen bloqueado: segue só com o layout */ }
});

app.addEventListener("toggle", e => {
  const d = e.target;
  if (!d.matches?.("details[data-id]")) return;
  d.open ? openDetails.add(d.dataset.id) : openDetails.delete(d.dataset.id);
}, true);

function render(rows) {
  if (!rows.length) {
    app.innerHTML = `<section class="empty"><h2>Nada por aqui ainda</h2><p>As apresentações aparecem aqui assim que forem cadastradas.</p></section>`;
    return;
  }
  const ranked = [...rows].sort((a, b) =>
    (b.overall ?? -1) - (a.overall ?? -1) || b.count - a.count || a.position - b.position);
  let place = 0;
  app.innerHTML = `<ol class="rank">${ranked.map(p => {
    const pos = p.count ? `${++place}º` : "–";
    const bars = CRITERIA.map(c => {
      const v = p.byCrit[c.key];
      return `<span class="t">${esc(c.label)}</span>
        <span class="track"><span class="fill" style="transform:scaleX(${v ? v / 5 : 0})"></span></span>
        <span class="v">${fmt(v)}</span>`;
    }).join("");
    const comments = p.comments.length ? `<details class="comments" data-id="${p.id}" ${openDetails.has(p.id) ? "open" : ""}>
        <summary>${p.comments.length} comentário${p.comments.length > 1 ? "s" : ""}</summary>
        <ul>${p.comments.map(r => `<li>${esc(r.comment)}<small>${esc(r.voter_name || "Anônimo")}</small></li>`).join("")}</ul>
      </details>` : "";
    return `<li class="card">
      <div class="pos" aria-label="Posição">${pos}</div>
      <div>
        ${p.is_open ? `<span class="tag live">Votando agora</span>` : ""}
        <h2>${esc(p.title)}</h2><p class="by">por ${esc(p.presenter)}</p>
        <div class="bars">${bars}</div>
        ${comments}
      </div>
      <div class="score"><b>${fmt(p.overall)}</b><span>${p.count} voto${p.count === 1 ? "" : "s"}</span></div>
    </li>`;
  }).join("")}</ol>`;
}

if (!configured) app.innerHTML = notConfiguredHTML();
else poll(async () => {
  const [ps, rs] = await Promise.all([db.presentations(), db.ratings()]);
  render(summarize(ps, rs));
}, 5000);
