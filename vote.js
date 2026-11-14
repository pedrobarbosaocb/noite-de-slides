import { db, CRITERIA, configured, esc, store, voterId, poll, notConfiguredHTML, toast, fmt } from "./lib.js";

const app = document.getElementById("app");
const me = voterId();
let name = store.get("voter_name") || "";
let open = [];            // apresentações abertas
let loaded = false;
let lastSig = null;
const drafts = {};        // id -> { scores: {key: n}, comment }
const editing = new Set();
const sent = () => store.json("sent_votes", {});

function draftFor(id) {
  if (!drafts[id]) {
    const prev = sent()[id];
    drafts[id] = prev ? { scores: { ...prev.scores }, comment: prev.comment || "" } : { scores: {}, comment: "" };
  }
  return drafts[id];
}

function nameForm() {
  app.innerHTML = `
    <section class="card" style="margin-top:24px">
      <h1 style="font-size:2rem">Bem-vindo à Noite de Slides</h1>
      <p class="lede">Você vai dar nota de 1 a 5 para cada apresentação. Como quer aparecer nos comentários?</p>
      <form id="nameForm">
        <label class="field" for="nm">Seu nome</label>
        <input id="nm" type="text" maxlength="60" autocomplete="given-name" placeholder="Ex.: Ana" value="${esc(name)}" required>
        <button class="btn primary block" type="submit">Começar</button>
      </form>
    </section>`;
  const input = app.querySelector("#nm");
  input.focus();
  app.querySelector("#nameForm").addEventListener("submit", e => {
    e.preventDefault();
    name = input.value.trim();
    if (!name) return;
    store.set("voter_name", name);
    render();
  });
}

function scaleHTML(id, c, value) {
  const opts = [1, 2, 3, 4, 5].map(n => {
    const iid = `${id}-${c.key}-${n}`;
    return `<input type="radio" id="${iid}" name="${id}-${c.key}" value="${n}" data-p="${id}" data-k="${c.key}" ${value === n ? "checked" : ""}>
            <label for="${iid}">${n}</label>`;
  }).join("");
  return `<fieldset class="crit">
      <legend>${esc(c.label)}</legend>
      <p class="hint">${esc(c.hint)}</p>
      <div class="scale">${opts}</div>
      <div class="scale-ends"><span>fraco</span><span>incrível</span></div>
    </fieldset>`;
}

function cardHTML(p) {
  const prev = sent()[p.id];
  const head = `<span class="tag live">Votação aberta</span>
    <h2>${esc(p.title)}</h2><p class="by">por ${esc(p.presenter)}</p>`;
  if (prev && !editing.has(p.id)) {
    const avg = CRITERIA.reduce((s, c) => s + prev.scores[c.key], 0) / CRITERIA.length;
    return `<article class="card">${head}
      <div class="done"><span>✓ Voto enviado · sua média ${fmt(avg)}</span>
        <button class="btn small" data-edit="${p.id}">Editar voto</button></div></article>`;
  }
  const d = draftFor(p.id);
  const complete = CRITERIA.every(c => d.scores[c.key]);
  return `<article class="card">${head}
    <form data-form="${p.id}">
      ${CRITERIA.map(c => scaleHTML(p.id, c, d.scores[c.key])).join("")}
      <label class="field" for="cm-${p.id}">Comentário <span class="by" style="display:inline;font-weight:400">(opcional)</span></label>
      <textarea id="cm-${p.id}" data-c="${p.id}" maxlength="500" placeholder="O que mais marcou?">${esc(d.comment)}</textarea>
      <button class="btn primary block" type="submit" ${complete ? "" : "disabled"}>${prev ? "Atualizar voto" : "Enviar voto"}</button>
      ${prev ? `<button class="btn ghost block" type="button" data-cancel="${p.id}" style="margin-top:6px">Cancelar</button>` : ""}
    </form></article>`;
}

function render() {
  if (!configured) { app.innerHTML = notConfiguredHTML(); return; }
  if (!name) { nameForm(); return; }
  const header = `<div class="hello"><h1>Oi, ${esc(name)}!</h1>
    <button class="linkish" id="rename">não é você?</button></div>`;
  let body;
  if (!loaded) body = `<section class="empty"><p class="dots">Carregando</p></section>`;
  else if (!open.length) body = `<section class="empty"><h2>Pausa pro café</h2>
      <p class="dots">Nenhuma votação aberta agora. Esta tela atualiza sozinha quando a próxima apresentação começar</p></section>`;
  else body = (open.length > 1 ? `<p class="lede">${open.length} apresentações abertas para votação.</p>` : "") + open.map(cardHTML).join("");
  app.innerHTML = header + body;
}

app.addEventListener("change", e => {
  const t = e.target;
  if (t.matches("input[type=radio][data-p]")) {
    draftFor(t.dataset.p).scores[t.dataset.k] = Number(t.value);
    const form = t.closest("form");
    const d = draftFor(t.dataset.p);
    form.querySelector("button[type=submit]").disabled = !CRITERIA.every(c => d.scores[c.key]);
  }
});
app.addEventListener("input", e => {
  if (e.target.matches("textarea[data-c]")) draftFor(e.target.dataset.c).comment = e.target.value;
});
app.addEventListener("click", e => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.id === "rename") { name = ""; store.del("voter_name"); render(); }
  if (t.dataset.edit) { editing.add(t.dataset.edit); delete drafts[t.dataset.edit]; render(); }
  if (t.dataset.cancel) { editing.delete(t.dataset.cancel); delete drafts[t.dataset.cancel]; render(); }
});
app.addEventListener("submit", async e => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const id = form.dataset.form;
  const d = draftFor(id);
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Enviando…";
  try {
    await db.rpc("submit_rating", {
      p_presentation_id: id, p_voter_id: me, p_voter_name: name,
      p_content: d.scores.content, p_clarity: d.scores.clarity, p_design: d.scores.design,
      p_delivery: d.scores.delivery, p_fun: d.scores.fun, p_comment: d.comment,
    });
    const all = sent();
    all[id] = { scores: { ...d.scores }, comment: d.comment };
    store.set("sent_votes", JSON.stringify(all));
    editing.delete(id);
    delete drafts[id];
    toast("Voto registrado. Valeu!");
    render();
  } catch (err) {
    toast(err.message, "bad");
    btn.disabled = false;
    btn.textContent = "Tentar de novo";
  }
});

render();
if (configured) {
  poll(async () => {
    const list = await db.presentations();
    open = list.filter(p => p.is_open);
    loaded = true;
    const sig = open.map(p => `${p.id}:${p.title}:${p.presenter}`).join("|");
    if (sig !== lastSig) { lastSig = sig; if (name) render(); }
  }, 4000);
}
