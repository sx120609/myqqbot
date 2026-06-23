import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { SettingsStore } from "../settings.js";

const COOKIE_NAME = "myqqbot_admin";
const PASSWORD_HASH_KEY = "auth.adminPasswordHash";
const SCRYPT_KEY_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;

interface LoginBody {
  password?: string;
}

interface ChangePasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

export async function registerAdminAuth(app: FastifyInstance, config: AppConfig, settings: AuthSettings): Promise<void> {
  const auth = new AdminAuth(config, settings);

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

  app.post("/api/auth/change-password", async (request, reply) => {
    const body = request.body as ChangePasswordBody;
    const result = auth.changePassword(body.currentPassword ?? "", body.newPassword ?? "");
    if (result === "not_configured") {
      return reply.code(503).send({
        error: "admin_password_not_configured",
        message: "ADMIN_PASSWORD is not configured."
      });
    }
    if (result === "invalid_current_password") {
      return reply.code(401).send({ error: "invalid_current_password", message: "当前密码不正确。" });
    }
    if (result === "weak_new_password") {
      return reply.code(400).send({
        error: "weak_new_password",
        message: `新密码至少需要 ${MIN_PASSWORD_LENGTH} 位。`
      });
    }

    setCookie(reply, auth.createSession(), config);
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

type ChangePasswordResult = "ok" | "not_configured" | "invalid_current_password" | "weak_new_password";

interface AuthSettings {
  getString(key: string, fallback: string): string;
  setInternal(key: string, value: string): void;
}

class AdminAuth {
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(
    private readonly config: AppConfig,
    private readonly settings: AuthSettings
  ) {
    this.secret = config.auth.sessionSecret || config.auth.adminPassword;
    this.ttlMs = Math.max(1, config.auth.sessionTtlHours) * 60 * 60 * 1000;
    this.seedInitialPassword();
  }

  get configured(): boolean {
    return Boolean(this.passwordHash);
  }

  private get passwordHash(): string {
    return this.settings.getString(PASSWORD_HASH_KEY, "");
  }

  verifyPassword(password: string): boolean {
    if (!this.configured) return false;
    return verifyPasswordHash(password, this.passwordHash);
  }

  changePassword(currentPassword: string, newPassword: string): ChangePasswordResult {
    if (!this.configured) return "not_configured";
    if (!this.verifyPassword(currentPassword)) return "invalid_current_password";
    if (newPassword.length < MIN_PASSWORD_LENGTH) return "weak_new_password";
    this.settings.setInternal(PASSWORD_HASH_KEY, hashPassword(newPassword));
    return "ok";
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
    return createHmac("sha256", `${this.secret}:${this.passwordHash}`).update(payload).digest("base64url");
  }

  private seedInitialPassword(): void {
    if (this.passwordHash || !this.config.auth.adminPassword) return;
    this.settings.setInternal(PASSWORD_HASH_KEY, hashPassword(this.config.auth.adminPassword));
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

function hashPassword(value: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(value, salt, SCRYPT_KEY_LENGTH).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

function verifyPasswordHash(password: string, encoded: string): boolean {
  const [algorithm, salt, expectedHash] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHash) return false;
  const actualHash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("base64url");
  return safeEqual(actualHash, expectedHash);
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
