import { db, configured, esc, poll, summarize, notConfiguredHTML, toast, fmt } from "./lib.js";

const app = document.getElementById("app");
let pin = null;
try { pin = sessionStorage.getItem("admin_pin"); } catch { /* sem storage */ }
let rows = [];
let editingId = null;
let busy = false;

const voteUrl = new URL("./", location.href).href;

function loginView(error = "") {
  app.innerHTML = `
    <section class="card" style="margin-top:24px;max-width:440px;margin-inline:auto">
      <h1 style="font-size:1.8rem">Área do anfitrião</h1>
      <p class="lede">Cadastre as apresentações e controle quando cada votação abre e fecha.</p>
      <form id="login">
        <label class="field" for="pw">Senha de admin</label>
        <input id="pw" type="password" autocomplete="current-password" required>
        <p class="err" role="alert">${esc(error)}</p>
        <button class="btn primary block" type="submit" style="margin-top:8px">Entrar</button>
      </form>
    </section>`;
  app.querySelector("#pw").focus();
  app.querySelector("#login").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Entrando…";
    const candidate = app.querySelector("#pw").value;
    try {
      await db.rpc("admin_login", { p_pin: candidate });
      pin = candidate;
      try { sessionStorage.setItem("admin_pin", pin); } catch { /* ok */ }
      start();
    } catch (err) { loginView(err.message); }
  });
}

function qrSVG(text) {
  if (typeof window.qrcode !== "function") return "";
  const q = window.qrcode(0, "M");
  q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

function itemHTML(p, i) {
  if (editingId === p.id) {
    return `<li class="card"><form data-save="${p.id}">
      <div class="row">
        <input class="grow" type="text" name="title" maxlength="120" value="${esc(p.title)}" aria-label="Título" required>
        <input class="grow" type="text" name="presenter" maxlength="80" value="${esc(p.presenter)}" aria-label="Apresentador" required>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary small" type="submit">Salvar</button>
        <button class="btn ghost small" type="button" data-act="cancel">Cancelar</button>
      </div></form></li>`;
  }
  return `<li class="card admin-item">
    <div>
      ${p.is_open ? `<span class="tag live">Votação aberta</span>` : `<span class="tag closed">Fechada</span>`}
      <h2 style="font-size:1.25rem">${esc(p.title)}</h2>
      <p class="meta">por ${esc(p.presenter)} · ${p.count} voto${p.count === 1 ? "" : "s"} · média ${fmt(p.overall)}</p>
    </div>
    <div class="actions">
      ${p.is_open
        ? `<button class="btn small" data-act="close" data-id="${p.id}">Fechar votação</button>`
        : `<button class="btn primary small" data-act="open" data-id="${p.id}" title="Abre esta e fecha as outras">Abrir votação</button>`}
      <button class="btn ghost small" data-act="up" data-id="${p.id}" ${i === 0 ? "disabled" : ""} aria-label="Mover para cima">↑</button>
      <button class="btn ghost small" data-act="down" data-id="${p.id}" ${i === rows.length - 1 ? "disabled" : ""} aria-label="Mover para baixo">↓</button>
      <button class="btn ghost small" data-act="edit" data-id="${p.id}">Editar</button>
      <button class="btn ghost small danger" data-act="clear" data-id="${p.id}" ${p.count ? "" : "disabled"}>Zerar votos</button>
      <button class="btn ghost small danger" data-act="delete" data-id="${p.id}">Excluir</button>
    </div></li>`;
}

function render() {
  const anyOpen = rows.some(p => p.is_open);
  app.innerHTML = `
    <section class="card share">
      <div class="qr" aria-label="QR code do link de votação">${qrSVG(voteUrl)}</div>
      <div>
        <span class="tag">Link para os convidados</span>
        <p class="url">${esc(voteUrl)}</p>
        <div class="row">
          <button class="btn small" data-act="copy">Copiar link</button>
          <a class="btn small" href="resultados.html" target="_blank" rel="noopener">Abrir resultados</a>
        </div>
      </div>
    </section>

    <h2 class="section-title">Nova apresentação</h2>
    <form class="card" id="add">
      <div class="row">
        <input class="grow" type="text" name="title" maxlength="120" placeholder="Título (ex.: A história do pão de queijo)" aria-label="Título" required>
        <input class="grow" type="text" name="presenter" maxlength="80" placeholder="Quem apresenta" aria-label="Quem apresenta" required>
        <button class="btn primary" type="submit">Adicionar</button>
      </div>
    </form>

    <h2 class="section-title"><span>Apresentações (${rows.length})</span>
      <span class="row">
        <button class="btn small" data-act="openAll" ${rows.length ? "" : "disabled"}>Abrir todas</button>
        <button class="btn small" data-act="closeAll" ${anyOpen ? "" : "disabled"}>Fechar todas</button>
      </span>
    </h2>
    ${rows.length ? `<ol class="rank" style="display:block">${rows.map(itemHTML).join("")}</ol>`
      : `<section class="empty"><p>Nenhuma apresentação cadastrada ainda. Adicione a primeira acima.</p></section>`}

    <h2 class="section-title">Conta</h2>
    <form class="card" id="pinForm">
      <div class="row">
        <input class="grow" type="password" name="newpin" minlength="6" autocomplete="new-password" placeholder="Nova senha de admin (mín. 6)" aria-label="Nova senha" required>
        <button class="btn" type="submit">Trocar senha</button>
        <button class="btn ghost" type="button" data-act="logout">Sair</button>
      </div>
    </form>`;
}

async function refresh(force = false) {
  const [ps, rs] = await Promise.all([db.presentations(), db.ratings()]);
  rows = summarize(ps, rs);
  // não re-renderiza enquanto o usuário digita
  const typing = app.contains(document.activeElement) && document.activeElement.matches("input, textarea");
  if (force || (!typing && !editingId && !busy)) render();
}

async function act(fn, okMsg) {
  busy = true;
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (err) {
    if (/senha/i.test(err.message)) { pin = null; try { sessionStorage.removeItem("admin_pin"); } catch {} loginView(err.message); busy = false; return; }
    toast(err.message, "bad");
  }
  busy = false;
  await refresh(true);
}

app.addEventListener("click", async e => {
  const b = e.target.closest("button[data-act]");
  if (!b || !pin) return;
  const id = b.dataset.id;
  const p = rows.find(r => r.id === id);
  switch (b.dataset.act) {
    case "copy":
      try { await navigator.clipboard.writeText(voteUrl); toast("Link copiado"); }
      catch { toast("Não deu para copiar: selecione o link manualmente", "bad"); }
      break;
    case "open":  return act(() => db.rpc("admin_set_open", { p_pin: pin, p_id: id, p_open: true, p_exclusive: true }), `Votação aberta: ${p.title}`);
    case "close": return act(() => db.rpc("admin_set_open", { p_pin: pin, p_id: id, p_open: false, p_exclusive: false }), "Votação fechada");
    case "openAll":  return act(() => db.rpc("admin_set_all_open", { p_pin: pin, p_open: true }), "Todas abertas");
    case "closeAll": return act(() => db.rpc("admin_set_all_open", { p_pin: pin, p_open: false }), "Todas fechadas");
    case "up":   return act(() => db.rpc("admin_move_presentation", { p_pin: pin, p_id: id, p_dir: -1 }));
    case "down": return act(() => db.rpc("admin_move_presentation", { p_pin: pin, p_id: id, p_dir: 1 }));
    case "edit": editingId = id; render(); app.querySelector(`form[data-save] input`)?.focus(); break;
    case "cancel": editingId = null; render(); break;
    case "clear":
      if (b.dataset.confirm) return act(() => db.rpc("admin_clear_ratings", { p_pin: pin, p_id: id }), "Votos zerados");
      b.dataset.confirm = "1"; b.textContent = `Confirmar (${p.count} votos)`; break;
    case "delete":
      if (b.dataset.confirm) return act(() => db.rpc("admin_delete_presentation", { p_pin: pin, p_id: id }), "Apresentação excluída");
      b.dataset.confirm = "1"; b.textContent = "Confirmar exclusão"; break;
    case "logout":
      pin = null; try { sessionStorage.removeItem("admin_pin"); } catch {} loginView(); break;
  }
});

app.addEventListener("submit", e => {
  e.preventDefault();
  if (!pin) return;
  const f = e.target;
  if (f.id === "add") {
    const title = f.elements.title.value.trim(), presenter = f.elements.presenter.value.trim();
    if (!title || !presenter) return;
    return act(() => db.rpc("admin_create_presentation", { p_pin: pin, p_title: title, p_presenter: presenter }), "Apresentação adicionada");
  }
  if (f.dataset.save) {
    const id = f.dataset.save;
    editingId = null;
    return act(() => db.rpc("admin_update_presentation", { p_pin: pin, p_id: id, p_title: f.elements.title.value.trim(), p_presenter: f.elements.presenter.value.trim() }), "Salvo");
  }
  if (f.id === "pinForm") {
    const np = f.elements.newpin.value;
    return act(async () => {
      await db.rpc("admin_change_pin", { p_pin: pin, p_new_pin: np });
      pin = np; try { sessionStorage.setItem("admin_pin", pin); } catch {}
    }, "Senha alterada");
  }
});

let polling = false;
function start() {
  render();
  if (!polling) { polling = true; poll(() => (pin ? refresh(false) : null), 5000); }
  else refresh(true);
}

if (!configured) app.innerHTML = notConfiguredHTML();
else if (!pin) loginView();
else {
  db.rpc("admin_login", { p_pin: pin })
    .then(start)
    .catch(() => { pin = null; loginView(); });
}
