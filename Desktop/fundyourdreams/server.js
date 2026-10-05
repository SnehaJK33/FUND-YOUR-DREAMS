const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
require("dotenv").config();

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const ALERTS_FILE = path.join(DATA_DIR, "alerts.json");
const SESSION_COOKIE = "fyd_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "fundyourdreams04@gmail.com").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH || (ADMIN_PASSWORD ? sha256(ADMIN_PASSWORD) : "2415JK@Rai");

const sessions = new Map();
const loginAttempts = new Map();

const defaultPosts = [
  {
    id: "p1",
    type: "internship",
    level: "undergraduate",
    country: "Switzerland",
    fundingType: "fully-funded",
    verified: true,
    status: "published",
    publishAt: "",
    views: 0,
    clicks: 0,
    createdAt: "2026-04-20T08:30:00.000Z",
    title: "CERN Openlab Summer Internship",
    org: "CERN | Switzerland",
    desc: "Hands-on computing and engineering internship with stipend, travel support, and accommodation assistance.",
    funding: "Stipend + travel + housing support",
    deadline: "18 May 2026",
    image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1400&q=80",
    overview:
      "The CERN Openlab Summer Internship offers students practical exposure to real-world scientific computing and engineering projects at CERN. Interns work with international teams and gain access to world-class research infrastructure.",
    eligibility:
      "Open to undergraduate and master's students in relevant fields such as Computer Science, Data Science, Physics, Electrical Engineering, and related disciplines. Applicants should have strong academic records and basic programming/research skills.",
    benefits:
      "Includes monthly stipend, travel support, and accommodation guidance. Selected interns receive mentorship from CERN experts and certification upon successful completion.",
    documents:
      "Updated CV, academic transcripts, statement of purpose, recommendation letter(s), passport details, and any relevant project portfolio.",
    steps:
      "Create account on official portal, complete application form, upload required documents, submit before deadline, and monitor email for shortlist/interview instructions.",
    notes: "Only complete applications with all documents are reviewed. Early submission is strongly recommended.",
    applyLink: "https://home.cern/summer-student-programme"
  },
  {
    id: "p2",
    type: "fellowship",
    level: "any",
    country: "Global",
    fundingType: "hybrid",
    verified: true,
    status: "published",
    publishAt: "",
    views: 0,
    clicks: 0,
    createdAt: "2026-04-22T09:00:00.000Z",
    title: "Echoing Green Global Fellowship",
    org: "Echoing Green | Global",
    desc: "Two-year social impact fellowship with seed funding, leadership coaching, and long-term network access.",
    funding: "Grant + mentorship + program costs",
    deadline: "02 June 2026",
    image: "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1400&q=80",
    overview:
      "Echoing Green Fellowship supports emerging social entrepreneurs solving critical global challenges. Fellows receive long-term capacity-building support and access to a global network.",
    eligibility:
      "Open to early-stage leaders with innovative social impact ideas. Applicants can be from any country but must demonstrate measurable impact potential.",
    benefits:
      "Includes seed grant funding, leadership development, strategic mentorship, and networking opportunities with global impact leaders.",
    documents:
      "Project proposal, founder bio, impact plan, organizational information, budget estimate, and optional recommendation material.",
    steps:
      "Register on official portal, submit organizational and founder details, provide impact model and budget, complete interview rounds if shortlisted.",
    notes: "Strong clarity on problem-solution fit and measurable outcomes improves selection chances.",
    applyLink: "https://echoinggreen.org/fellowship/"
  },
  {
    id: "p3",
    type: "scholarship",
    level: "masters",
    country: "USA",
    fundingType: "fully-funded",
    verified: true,
    status: "published",
    publishAt: "",
    views: 0,
    clicks: 0,
    createdAt: "2026-04-24T10:15:00.000Z",
    title: "Fulbright Foreign Student Program",
    org: "Fulbright Commission | USA",
    desc: "Graduate-level scholarship covering tuition, monthly stipend, health insurance, and round-trip travel.",
    funding: "Full tuition + living + travel",
    deadline: "12 July 2026",
    image: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1400&q=80",
    overview:
      "The Fulbright Foreign Student Program supports outstanding international students for master's or doctoral study and research in the United States.",
    eligibility:
      "Applicants must meet country-specific eligibility criteria, hold strong academic records, and demonstrate leadership potential.",
    benefits:
      "Covers tuition fees, living stipend, health insurance, travel allowance, and academic enrichment opportunities.",
    documents:
      "Academic transcripts, degree certificates, CV, statement of purpose, study/research objectives, recommendation letters, and language test scores as required.",
    steps:
      "Check your country Fulbright office requirements, prepare documents, submit online application, attend interviews, and complete nomination process.",
    notes: "Requirements vary by country. Always follow your national Fulbright commission instructions.",
    applyLink: "https://foreign.fulbrightonline.org/"
  }
];

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(POSTS_FILE)) writeJson(POSTS_FILE, defaultPosts);
  if (!fs.existsSync(ALERTS_FILE)) writeJson(ALERTS_FILE, []);
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index === -1) return acc;
      acc[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
      return acc;
    }, {});
}

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function requireAdmin(req, res) {
  if (getSession(req)) return true;
  sendError(res, 401, "Login required");
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (_) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function inferCountry(org) {
  const value = String(org || "");
  return value.includes("|") ? value.split("|").pop().trim() : "";
}

function normalizePost(raw) {
  const post = raw || {};
  const status = ["published", "draft", "scheduled"].includes(post.status) ? post.status : "published";
  return {
    id: String(post.id || `p-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`),
    type: String(post.type || "scholarship"),
    level: String(post.level || "any"),
    country: String(post.country || inferCountry(post.org) || ""),
    fundingType: String(post.fundingType || "fully-funded"),
    verified: post.verified !== false,
    status,
    publishAt: status === "scheduled" ? String(post.publishAt || "") : "",
    views: Number.isFinite(Number(post.views)) ? Math.max(0, Math.floor(Number(post.views))) : 0,
    clicks: Number.isFinite(Number(post.clicks)) ? Math.max(0, Math.floor(Number(post.clicks))) : 0,
    createdAt: String(post.createdAt || new Date().toISOString()),
    title: String(post.title || ""),
    org: String(post.org || ""),
    desc: String(post.desc || post.overview || ""),
    funding: String(post.funding || ""),
    deadline: String(post.deadline || ""),
    image: String(post.image || ""),
    overview: String(post.overview || post.desc || ""),
    eligibility: String(post.eligibility || ""),
    benefits: String(post.benefits || post.funding || ""),
    documents: String(post.documents || ""),
    steps: String(post.steps || ""),
    notes: String(post.notes || ""),
    applyLink: String(post.applyLink || post.link || "").trim()
  };
}

function loadPosts() {
  ensureDataFiles();
  return readJson(POSTS_FILE, defaultPosts).map(normalizePost);
}

function savePosts(posts) {
  writeJson(POSTS_FILE, posts.map(normalizePost));
}

function publishDueScheduledPosts(posts) {
  let changed = false;
  const now = Date.now();
  const updated = posts.map((post) => {
    if (post.status !== "scheduled") return post;
    const ts = Date.parse(post.publishAt);
    if (Number.isNaN(ts)) {
      changed = true;
      return { ...post, status: "draft", publishAt: "" };
    }
    if (ts <= now) {
      changed = true;
      return { ...post, status: "published", publishAt: "" };
    }
    return post;
  });
  if (changed) savePosts(updated);
  return updated;
}

function publicPosts() {
  return publishDueScheduledPosts(loadPosts()).filter((post) => post.status === "published");
}

function cleanPostInput(body, existing) {
  const base = existing || {};
  return normalizePost({
    ...base,
    ...body,
    id: base.id || body.id,
    createdAt: base.createdAt || body.createdAt || new Date().toISOString(),
    views: base.views || 0,
    clicks: base.clicks || 0
  });
}

function isValidPostForPublish(post) {
  return Boolean(post.title && post.org && post.funding && post.deadline && post.desc && post.overview && /^https?:\/\//i.test(post.applyLink));
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  }[ext] || "application/octet-stream";
}

function serveFile(res, filePath) {
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/session") {
    sendJson(res, 200, { authenticated: Boolean(getSession(req)) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const ip = req.socket.remoteAddress || "unknown";
    const entry = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    if (entry.lockedUntil > Date.now()) {
      sendError(res, 429, `Too many attempts. Try again in ${Math.ceil((entry.lockedUntil - Date.now()) / 1000)}s.`);
      return;
    }

    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const passwordHash = sha256(String(body.password || ""));
    const valid = username === ADMIN_USERNAME && passwordHash === ADMIN_PASSWORD_HASH;
    if (!valid) {
      entry.count += 1;
      if (entry.count >= 5) {
        entry.count = 0;
        entry.lockedUntil = Date.now() + 60 * 1000;
      }
      loginAttempts.set(ip, entry);
      sendError(res, 401, "Invalid credentials");
      return;
    }

    loginAttempts.delete(ip);
    const token = createSession();
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = getSession(req);
    if (token) sessions.delete(token);
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/posts") {
    sendJson(res, 200, { posts: publicPosts() });
    return;
  }

  const publicPostMatch = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (req.method === "GET" && publicPostMatch) {
    const post = publicPosts().find((item) => item.id === decodeURIComponent(publicPostMatch[1]));
    if (!post) {
      sendError(res, 404, "Post not found");
      return;
    }
    sendJson(res, 200, { post });
    return;
  }

  const metricMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/metrics$/);
  if (req.method === "POST" && metricMatch) {
    const body = await readBody(req);
    const metric = body.metric === "clicks" ? "clicks" : "views";
    const id = decodeURIComponent(metricMatch[1]);
    const posts = loadPosts();
    const index = posts.findIndex((post) => post.id === id);
    if (index !== -1) {
      posts[index][metric] = Number(posts[index][metric] || 0) + 1;
      savePosts(posts);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/alerts") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendError(res, 400, "Valid email required");
      return;
    }
    const alerts = readJson(ALERTS_FILE, []);
    if (!alerts.includes(email)) alerts.push(email);
    writeJson(ALERTS_FILE, alerts);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/admin/posts" && req.method === "GET") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { posts: publishDueScheduledPosts(loadPosts()) });
    return;
  }

  if (url.pathname === "/api/admin/posts" && req.method === "POST") {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const post = cleanPostInput(body);
    if (post.status !== "draft" && !isValidPostForPublish(post)) {
      sendError(res, 400, "Required publish fields are missing");
      return;
    }
    const posts = loadPosts();
    posts.unshift(post);
    savePosts(posts);
    sendJson(res, 201, { post });
    return;
  }

  const adminPostMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)$/);
  if (adminPostMatch && ["PUT", "DELETE"].includes(req.method)) {
    if (!requireAdmin(req, res)) return;
    const id = decodeURIComponent(adminPostMatch[1]);
    const posts = loadPosts();
    const index = posts.findIndex((post) => post.id === id);
    if (index === -1) {
      sendError(res, 404, "Post not found");
      return;
    }
    if (req.method === "DELETE") {
      posts.splice(index, 1);
      savePosts(posts);
      sendJson(res, 200, { ok: true });
      return;
    }
    const body = await readBody(req);
    const post = cleanPostInput(body, posts[index]);
    if (post.status !== "draft" && !isValidPostForPublish(post)) {
      sendError(res, 400, "Required publish fields are missing");
      return;
    }
    posts[index] = post;
    savePosts(posts);
    sendJson(res, 200, { post });
    return;
  }

  const publishMatch = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)\/publish$/);
  if (req.method === "POST" && publishMatch) {
    if (!requireAdmin(req, res)) return;
    const id = decodeURIComponent(publishMatch[1]);
    const posts = loadPosts();
    const index = posts.findIndex((post) => post.id === id);
    if (index === -1) {
      sendError(res, 404, "Post not found");
      return;
    }
    const post = { ...posts[index], status: "published", publishAt: "" };
    if (!isValidPostForPublish(post)) {
      sendError(res, 400, "Required publish fields are missing");
      return;
    }
    posts[index] = post;
    savePosts(posts);
    sendJson(res, 200, { post });
    return;
  }

  sendError(res, 404, "API route not found");
}

ensureDataFiles();

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        serveFile(res, path.join(ROOT, "scholarship-website.html"));
        return;
      }

      if (url.pathname === "/admin") {
        serveFile(res, path.join(ROOT, "scholarship-website.html"));
        return;
      }

      serveFile(res, path.join(ROOT, decodeURIComponent(url.pathname)));
    } catch (error) {
      sendError(res, 500, error.message || "Server error");
    }
  })
  .listen(PORT, () => {
    console.log(`Fund Your Dreams running at http://localhost:${PORT}`);
    console.log(`Admin entry: http://localhost:${PORT}/admin`);
  });
