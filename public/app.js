const $ = (s) => document.getElementById(s);
const app = document.getElementById("app");

const store = {
  get() {
    try { return JSON.parse(sessionStorage.getItem("roomcode") || "{}"); }
    catch { return {}; }
  },
  set(v) { sessionStorage.setItem("roomcode", JSON.stringify(v)); },
  clear() { sessionStorage.removeItem("roomcode"); },
};

let poll = null;

function render(html) {
  app.innerHTML = html;
}

function shell(inner) {
  return `
    <div class="brand">
      <h1><img src="/favicon.svg" alt="" class="mark" width="20" height="20" />roomcode.lol</h1>
      <span>one room. one dump. gone.</span>
    </div>
    ${inner}
  `;
}

function home() {
  render(shell(`
    <h2>Say it in the room.<br>Read it after dump.</h2>
    <p class="lede">Six-digit code. One line each. Host hits dump. Names stay off the wall. Close the room and the server forgets you.</p>
    <label>your name in the room</label>
    <input id="name" maxlength="24" placeholder="first name is enough" />
    <label>optional prompt</label>
    <input id="prompt" maxlength="120" placeholder="who here should we be honest about" />
    <div class="row">
      <button id="create">open a room</button>
      <button class="secondary" id="joinShow">I have a code</button>
    </div>
    <div id="joinBox" hidden>
      <label>room code</label>
      <input id="code" maxlength="6" inputmode="numeric" placeholder="000000" />
      <div class="row"><button id="join">walk in</button></div>
    </div>
    <p class="err" id="err"></p>
    <div class="rules">
      <strong>Rules.</strong> 18+. One line, 280 characters. Host dumps when they want. Lines shuffle. Nothing is stored after the host closes the room or two hours pass. This is a party toy, not a court transcript.
    </div>
  `));
  $("create").onclick = createRoom;
  $("joinShow").onclick = () => { $("joinBox").hidden = false; $("code").focus(); };
  $("join").onclick = joinRoom;
}

async function createRoom() {
  const name = $("name").value.trim() || "host";
  const prompt = $("prompt").value.trim();
  try {
    const res = await api("/api/rooms", { name, prompt });
    store.set({ code: res.code, memberId: res.memberId, hostToken: res.hostToken, name });
    roomView(res.state);
    startPoll();
  } catch (e) { $("err").textContent = e.message; }
}

async function joinRoom() {
  const name = $("name").value.trim() || "anon";
  const code = ($("code").value || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
  try {
    const res = await api(`/api/rooms/${code}?action=join`, { name });
    store.set({ code, memberId: res.memberId, name });
    roomView(res.state);
    startPoll();
  } catch (e) { $("err").textContent = e.message; }
}

function roomView(state) {
  const s = store.get();
  const isHost = Boolean(s.hostToken);
  const dumped = state.status === "dumped";
  const lines = dumped
    ? `<ol class="lines">${state.dump.map((l) => `<li>${esc(l)}</li>`).join("") || "<li>nobody wrote anything. cowards.</li>"}</ol>`
    : "";

  render(shell(`
    <p class="meta">${esc(state.prompt || "one line each")}</p>
    <div class="code">${state.code}</div>
    <div>
      <span class="pill">${state.members} in the room</span>
      <span class="pill">${state.submitted} submitted</span>
      <span class="pill">${state.status}</span>
    </div>
    ${dumped ? `<h2 style="margin-top:36px">the dump</h2>${lines}` : `
      <label style="margin-top:32px">your line</label>
      <textarea id="line" maxlength="280" placeholder="keep it to one breath">${esc(state.you?.line || "")}</textarea>
      <div class="row">
        <button id="submit">${state.you?.submitted ? "update line" : "lock it in"}</button>
        ${isHost ? `<button class="danger" id="dump">dump the room</button>` : ""}
      </div>
    `}
    ${isHost && dumped ? `<div class="row"><button class="secondary" id="close">burn the room</button></div>` : ""}
    <p class="err" id="err"></p>
    <div class="rules">Share the six digits out loud. Nobody sees a line until dump. Host can still burn the room after.</div>
  `));

  const line = $("line");
  if (line) $("submit").onclick = () => submitLine(line.value);
  const dumpBtn = $("dump");
  if (dumpBtn) dumpBtn.onclick = dumpRoom;
  const closeBtn = $("close");
  if (closeBtn) closeBtn.onclick = closeRoom;
}

async function submitLine(text) {
  const s = store.get();
  try {
    const res = await api(`/api/rooms/${s.code}?action=submit`, { memberId: s.memberId, line: text });
    roomView(res.state);
  } catch (e) { $("err").textContent = e.message; }
}

async function dumpRoom() {
  const s = store.get();
  try {
    const res = await api(`/api/rooms/${s.code}?action=dump`, { memberId: s.memberId, hostToken: s.hostToken });
    roomView(res.state);
  } catch (e) { $("err").textContent = e.message; }
}

async function closeRoom() {
  const s = store.get();
  try {
    await api(`/api/rooms/${s.code}?action=close`, { memberId: s.memberId, hostToken: s.hostToken });
    store.clear();
    stopPoll();
    home();
  } catch (e) { $("err").textContent = e.message; }
}

function startPoll() {
  stopPoll();
  poll = setInterval(refresh, 1500);
}

function stopPoll() {
  if (poll) clearInterval(poll);
  poll = null;
}

async function refresh() {
  const s = store.get();
  if (!s.code || !s.memberId) return;
  const line = $("line");
  if (line && document.activeElement === line) return;
  try {
    const state = await get(`/api/rooms/${s.code}?memberId=${encodeURIComponent(s.memberId)}`);
    roomView(state);
  } catch {
    store.clear();
    stopPoll();
    home();
  }
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "failed");
  return data;
}

async function get(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "failed");
  return data;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const existing = store.get();
if (existing.code && existing.memberId) {
  refresh().catch(home);
  startPoll();
} else {
  home();
}
