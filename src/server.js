import express, { json } from "express";
import { createServer } from "http";
import osmsm from "./lib.js";
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket.remoteAddress;
};

// ALLOWED_REFERERS is a comma separated list of hostnames. `*.example.com`
// matches example.com and all of its subdomains, `none` allows requests that
// carry no Referer header (nginx `valid_referers` convention).
const parseAllowedReferers = (value) => {
  if (!value || !value.trim()) return null;
  const hosts = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => {
      if (s === "none") return s;
      const withScheme = s.includes("://") ? s : `http://${s}`;
      try {
        return new URL(withScheme).hostname;
      } catch {
        return s;
      }
    });
  return {
    allowNoReferer: hosts.includes("none"),
    hosts: hosts.filter((h) => h !== "none"),
  };
};

const refererHostMatches = (hostname, pattern) => {
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return hostname === base || hostname.endsWith(`.${base}`);
  }
  return hostname === pattern;
};

export const isRefererAllowed = (referer, allowed) => {
  if (!allowed) return true;
  if (!referer) return allowed.allowNoReferer;
  let hostname;
  try {
    hostname = new URL(referer).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.hosts.some((pattern) => refererHostMatches(hostname, pattern));
};

// Fixed window, in-memory, per client IP. Intended as a simple safety net for
// a single process; put a real reverse proxy in front for anything serious.
export const createRateLimiter = ({ max, windowMs }) => {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(ip);
    }
  }, windowMs);
  sweep.unref();
  return {
    hit(ip) {
      const now = Date.now();
      let entry = hits.get(ip);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(ip, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= max,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      };
    },
    stop() {
      clearInterval(sweep);
    },
  };
};

const parseRateLimit = (env) => {
  const max = Number(env.RATE_LIMIT_MAX);
  if (!Number.isInteger(max) || max <= 0) return null;
  const windowSeconds = Number(env.RATE_LIMIT_WINDOW) || 60;
  return createRateLimiter({ max, windowMs: windowSeconds * 1000 });
};

export const createApp = (env = process.env) => {
  const app = express();
  // app.set("port", env.PORT || 3000);
  app.set("views", __dirname + "/lib");
  app.set("view engine", "handlebars");
  app.set("view options", { layout: false });
  app.use(json({ limit: "50mb" }));

  const allowedReferers = parseAllowedReferers(env.ALLOWED_REFERERS);
  const rateLimiter = parseRateLimit(env);

  app.use((req, res, next) => {
    const ip = getClientIp(req);
    const date = new Date().toISOString();
    const ref = req.header("Referer");
    const ua = req.header("user-agent");
    const url = req.originalUrl;
    const logLine = `[${date} - ${ip}] (${ref}) {${ua}} ${url}`;
    if (env.HEADER_CHECK) {
      const header = env.HEADER_CHECK.split(":");
      if (req.headers[header[0]] !== header[1]) {
        res
          .status(403)
          .send(
            env.HEADER_CHECK_FAIL_MESSAGE ||
              "Forbidden, set correct header to access"
          );
        console.log(`${logLine} FORBIDDEN, HEADER_CHECK FAILED`);
        return;
      }
    }
    if (req.path === "/health") {
      console.log(logLine);
      return next();
    }
    if (rateLimiter) {
      const { allowed, retryAfterSeconds } = rateLimiter.hit(ip);
      if (!allowed) {
        res
          .status(429)
          .set("Retry-After", String(retryAfterSeconds))
          .send(
            env.RATE_LIMIT_FAIL_MESSAGE || "Too many requests, slow down"
          );
        console.log(`${logLine} TOO MANY REQUESTS, RATE_LIMIT EXCEEDED`);
        return;
      }
    }
    if (!isRefererAllowed(ref, allowedReferers)) {
      res
        .status(403)
        .send(
          env.ALLOWED_REFERERS_FAIL_MESSAGE ||
            "Forbidden, hotlinking from this site is not allowed"
        );
      console.log(`${logLine} FORBIDDEN, REFERER NOT ALLOWED`);
      return;
    }
    console.log(logLine);
    next();
  });

  app.get("/health", (req, res) => res.sendStatus(200));

  const handler = (res, params) => {
    const filename = params.f || params.geojsonfile
    if (
      filename &&
      !(filename.startsWith("http://") ||
      filename.startsWith("https://"))
    ) {
      throw new Error(
        `'geojsonfile' parameter on server only allowed if filename starts with http(s)`
      );
    }
    osmsm(params)
      .then((data) => {
        if (params.renderToHtml || params.D) {
          res.type("html");
        } else {
          res.type((params.type || params.F) === "jpeg" ? "jpeg" : "png");
        }
        res.end(data);
      })
      .catch((err) => res.status(500).end(err.toString()));
  };

  app.get("/", (req, res) => handler(res, req.query));
  app.post("/", (req, res) => handler(res, req.body));

  app.get("/dynamic", (req, res) => {
    handler(res, { ...req.query, renderToHtml: true })
  })

  app.post("/dynamic", (req, res) => {
    handler(res, { ...req.body, renderToHtml: true })
  })

  return app;
};

export default createServer(createApp());
