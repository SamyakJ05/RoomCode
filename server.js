const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3847;
const MAX_LINE = 280;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_MEMBERS = 40;

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {string} hostToken
 * @property {string} prompt
 * @property {number} createdAt
 * @property {"open"|"dumped"|"closed"} status
 * @property {Map<string, {name:string, line:string, submitted:boolean}>} members
 * @property {string[]} dump
 */

function randomCode() {
  for (let i = 0; i < 20; i++) {
    const n = crypto.randomInt(0, 1_000_000);
    const code = String(n).padStart(6, "0");
    if (!rooms.has(code)) return code;
  }
  throw new Error("could not mint a code");
}

function token() {
  return crypto.randomBytes(16).toString("hex");
}

function now() {
  return Date.now();
}

function prune() {
  const t = now();
  for (const [code, room] of rooms) {
    if (t - room.createdAt > ROOM_TTL_MS || room.status === "closed") {
      rooms.delete(code);
    }
  }
}

setInterval(prune, 30_000);

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 16_384) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function publicState(room, memberId) {
  const member = room.members.get(memberId);
  const submitted = [...room.members.values()].filter((m) => m.submitted).length;
  return {
    code: room.code,
    prompt: room.prompt,
    status: room.status,
    members: room.members.size,
    submitted,
    you: member
      ? { name: member.name, line: member.line, submitted: member.submitted }
      : null,
    dump: room.status === "dumped" ? room.dump : null,
  };
}

async function handleApi(req, res, url) {
  prune();

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const prompt = String(body.prompt || "one line. no names. no takebacks after dump.")
      .slice(0, 120)
      .trim();
    const hostName = String(body.name || "host").slice(0, 24).trim() || "host";
    const code = randomCode();
    const hostToken = token();
    const memberId = token();
    /** @type {Room} */
    const room = {
      code,
      hostToken,
      prompt,
      createdAt: now(),
      status: "open",
      members: new Map(),
      dump: [],
    };
    room.members.set(memberId, { name: hostName, line: "", submitted: false });
    rooms.set(code, room);
    return json(res, 200, {
      code,
      hostToken,
      memberId,
      state: publicState(room, memberId),
    });
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/(\d{6})$/);
  if (!roomMatch) {
    return json(res, 404, { error: "not found" });
  }

  const code = roomMatch[1];
  const room = rooms.get(code);
  if (!room || room.status === "closed") {
    return json(res, 404, { error: "room is gone" });
  }

  if (req.method === "GET") {
    const memberId = url.searchParams.get("memberId") || "";
    return json(res, 200, publicState(room, memberId));
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: "method" });
  }

  const action = url.searchParams.get("action") || "";
  const body = await readBody(req);

  if (action === "join") {
    if (room.status !== "open") return json(res, 409, { error: "room already dumped" });
    if (room.members.size >= MAX_MEMBERS) return json(res, 409, { error: "room is full" });
    const name = String(body.name || "anon").slice(0, 24).trim() || "anon";
    const memberId = token();
    room.members.set(memberId, { name, line: "", submitted: false });
    return json(res, 200, { memberId, state: publicState(room, memberId) });
  }

  const memberId = String(body.memberId || "");
  if (!room.members.has(memberId)) {
    return json(res, 401, { error: "who are you" });
  }

  if (action === "submit") {
    if (room.status !== "open") return json(res, 409, { error: "too late" });
    const line = String(body.line || "").slice(0, MAX_LINE).trim();
    if (!line) return json(res, 400, { error: "write something" });
    const m = room.members.get(memberId);
    m.line = line;
    m.submitted = true;
    return json(res, 200, { state: publicState(room, memberId) });
  }

  if (action === "dump") {
    if (body.hostToken !== room.hostToken) return json(res, 403, { error: "not the host" });
    if (room.status !== "open") return json(res, 409, { error: "already dumped" });
    const lines = [...room.members.values()]
      .filter((m) => m.submitted && m.line)
      .map((m) => m.line);
    for (let i = lines.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [lines[i], lines[j]] = [lines[j], lines[i]];
    }
    room.dump = lines;
    room.status = "dumped";
    return json(res, 200, { state: publicState(room, memberId) });
  }

  if (action === "close") {
    if (body.hostToken !== room.hostToken) return json(res, 403, { error: "not the host" });
    rooms.delete(code);
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "unknown action" });
}

const PUBLIC = path.join(__dirname, "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }

    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    if (file.includes("..")) {
      res.writeHead(400);
      return res.end();
    }
    const full = path.join(PUBLIC, file);
    if (!full.startsWith(PUBLIC)) {
      res.writeHead(400);
      return res.end();
    }
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("gone");
        return;
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] || "text/plain" });
      res.end(data);
    });
  } catch (e) {
    json(res, 400, { error: e.message || "bad request" });
  }
});

server.listen(PORT, () => {
  console.log(`roomcode.lol on http://localhost:${PORT}`);
});
