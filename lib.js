import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const CRITERIA = [
  { key: "content",  label: "Conteúdo",     hint: "O tema foi interessante e bem pesquisado?" },
  { key: "clarity",  label: "Clareza",      hint: "Deu pra entender a mensagem?" },
  { key: "design",   label: "Slides",       hint: "Visual, organização, memes bem colocados" },
  { key: "delivery", label: "Apresentação", hint: "Desenvoltura, ritmo, presença" },
  { key: "fun",      label: "Diversão",     hint: "Quanto você curtiu?" },
];

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);

async function req(path, opts = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
      ...opts,
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
  } catch {
    throw new Error("Sem conexão com o servidor. Confira a internet e tente de novo.");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* resposta vazia */ }
  if (!res.ok) throw new Error(data?.message || `Erro ${res.status}`);
  return data;
}

export const db = {
  presentations: () =>
    req("presentations?select=id,title,presenter,position,is_open,created_at&order=position.asc,created_at.asc"),
  ratings: () =>
    req("ratings?select=id,presentation_id,voter_name,content,clarity,design,delivery,fun,comment,created_at&order=created_at.asc"),
  rpc: (fn, args = {}) => req(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }),
};

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* modo privado */ } },
  json(k, fallback) { try { return JSON.parse(this.get(k)) ?? fallback; } catch { return fallback; } },
};

export function voterId() {
  let id = store.get("voter_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID()
      : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
          (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
    store.set("voter_id", id);
  }
  return id;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const fmt = n => (n == null || Number.isNaN(n) ? "–" : n.toFixed(1).replace(".", ","));

/** Roda fn agora e a cada `ms`, pausando quando a aba está escondida. */
export function poll(fn, ms) {
  let t;
  const tick = async () => {
    clearTimeout(t);
    if (document.visibilityState === "visible") { try { await fn(); } catch (e) { console.warn(e); } }
    t = setTimeout(tick, ms);
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  tick();
}

/** Agrega as notas por apresentação. */
export function summarize(presentations, ratings) {
  return presentations.map(p => {
    const rs = ratings.filter(r => r.presentation_id === p.id);
    const avg = key => (rs.length ? rs.reduce((s, r) => s + r[key], 0) / rs.length : null);
    const byCrit = Object.fromEntries(CRITERIA.map(c => [c.key, avg(c.key)]));
    const overall = rs.length
      ? rs.reduce((s, r) => s + CRITERIA.reduce((a, c) => a + r[c.key], 0) / CRITERIA.length, 0) / rs.length
      : null;
    return { ...p, count: rs.length, byCrit, overall, comments: rs.filter(r => r.comment) };
  });
}

export function notConfiguredHTML() {
  return `<section class="empty"><h2>Quase lá</h2>
    <p>O site ainda não está conectado ao banco de dados. Preencha <code>config.js</code> com a URL e a chave pública do Supabase.</p></section>`;
}

export function toast(msg, kind = "") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.className = "toast"), 3200);
}
