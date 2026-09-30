import express, { type Express } from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultProductionOrigin = (process.env.SITE_URL ?? "https://sait-madmuaziel-niks-final.pages.dev").replace(/\/$/, "");

function isAllowedOrigin(origin: string | undefined) {
  if (!origin) return true;
  if (configuredOrigins.length > 0) return configuredOrigins.includes(origin);
  if (process.env.NODE_ENV !== "production") return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return origin === defaultProductionOrigin;
}

app.disable("x-powered-by");
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      callback(isAllowedOrigin(origin) ? null : new Error("Origin is not allowed"), isAllowedOrigin(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  next();
});

app.use("/api", router);

// In production the API process can also serve the Vite build. This keeps the
// public site and its API on one origin, which is simpler to deploy on a VPS.
const frontendDist = path.resolve(
  process.env.STATIC_DIR ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../nyx-dnd-site/dist/public"),
);
const frontendIndex = path.join(frontendDist, "index.html");

if (process.env.SERVE_FRONTEND !== "false" && existsSync(frontendIndex)) {
  app.use(
    express.static(frontendDist, {
      redirect: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  // Wouter handles client-side routes after the server returns index.html.
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    if (req.method !== "GET" || !req.accepts("html")) {
      next();
      return;
    }
    res.sendFile(frontendIndex);
  });
}

export default app;
