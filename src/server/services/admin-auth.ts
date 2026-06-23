import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

const COOKIE_NAME = "myqqbot_admin";

interface LoginBody {
  password?: string;
}

export async function registerAdminAuth(app: FastifyInstance, config: AppConfig): Promise<void> {
  const auth = new AdminAuth(config);

  app.get("/api/auth/status", async (request) => ({
    configured: auth.configured,
    authenticated: auth.isAuthenticated(request)
  }));

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as LoginBody;
    if (!auth.configured) {
      return reply.code(503).send({
        error: "admin_password_not_configured",
        message: "ADMIN_PASSWORD is not configured."
      });
    }
    if (!auth.verifyPassword(body.password ?? "")) {
      return reply.code(401).send({ error: "invalid_password" });
    }

    setCookie(reply, auth.createSession(), config);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearCookie(reply, config);
    return { ok: true };
  });

  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "/";
    if (!path.startsWith("/api/") || path === "/api/health" || path.startsWith("/api/auth/")) return;
    if (!auth.configured) {
      return reply.code(503).send({
        error: "admin_password_not_configured",
        message: "ADMIN_PASSWORD is not configured."
      });
    }
    if (!auth.isAuthenticated(request)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
}

class AdminAuth {
  readonly configured: boolean;
  private readonly passwordHash: Buffer;
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(private readonly config: AppConfig) {
    this.configured = Boolean(config.auth.adminPassword);
    this.passwordHash = hash(config.auth.adminPassword);
    this.secret = config.auth.sessionSecret || config.auth.adminPassword;
    this.ttlMs = Math.max(1, config.auth.sessionTtlHours) * 60 * 60 * 1000;
  }

  verifyPassword(password: string): boolean {
    if (!this.configured) return false;
    return timingSafeEqual(hash(password), this.passwordHash);
  }

  createSession(): string {
    const expiresAt = Date.now() + this.ttlMs;
    const payload = String(expiresAt);
    return `${payload}.${this.sign(payload)}`;
  }

  isAuthenticated(request: FastifyRequest): boolean {
    if (!this.configured) return false;
    const token = parseCookie(request.headers.cookie ?? "")[COOKIE_NAME];
    if (!token) return false;

    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;
    const expiresAt = Number(payload);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
    return safeEqual(signature, this.sign(payload));
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}

function setCookie(reply: FastifyReply, value: string, config: AppConfig): void {
  const maxAge = Math.max(1, config.auth.sessionTtlHours) * 60 * 60;
  reply.header(
    "set-cookie",
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.auth.secureCookie ? "; Secure" : ""}`
  );
}

function clearCookie(reply: FastifyReply, config: AppConfig): void {
  reply.header(
    "set-cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.auth.secureCookie ? "; Secure" : ""}`
  );
}

function parseCookie(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
