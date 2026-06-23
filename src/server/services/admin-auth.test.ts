import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { registerAdminAuth } from "./admin-auth.js";

describe("admin-auth", () => {
  it("protects management APIs with a signed admin session cookie", async () => {
    const app = Fastify();
    await registerAdminAuth(app, testConfig({ adminPassword: "secret", sessionSecret: "session-secret" }), memorySettings());
    app.get("/api/private", async () => ({ ok: true }));

    const blocked = await app.inject({ method: "GET", url: "/api/private" });
    expect(blocked.statusCode).toBe(401);

    const wrongLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "wrong" }
    });
    expect(wrongLogin.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "secret" }
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    expect(cookie).toBeTruthy();

    const allowed = await app.inject({
      method: "GET",
      url: "/api/private",
      headers: { cookie: Array.isArray(cookie) ? cookie[0] : String(cookie) }
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ ok: true });

    await app.close();
  });

  it("reports a missing admin password instead of leaving APIs open", async () => {
    const app = Fastify();
    await registerAdminAuth(app, testConfig({ adminPassword: "", sessionSecret: "" }), memorySettings());
    app.get("/api/private", async () => ({ ok: true }));

    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ configured: false, authenticated: false });

    const blocked = await app.inject({ method: "GET", url: "/api/private" });
    expect(blocked.statusCode).toBe(503);

    await app.close();
  });

  it("does not protect OneBot routes with the WebUI admin password", async () => {
    const app = Fastify();
    await registerAdminAuth(app, testConfig({ adminPassword: "secret", sessionSecret: "session-secret" }), memorySettings());
    app.get("/onebot/test", async () => ({ ok: true }));

    const response = await app.inject({ method: "GET", url: "/onebot/test" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await app.close();
  });

  it("changes the admin password and invalidates the previous session signature", async () => {
    const app = Fastify();
    await registerAdminAuth(app, testConfig({ adminPassword: "old-secret", sessionSecret: "session-secret" }), memorySettings());
    app.get("/api/private", async () => ({ ok: true }));

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "old-secret" }
    });
    const oldCookie = login.headers["set-cookie"];
    expect(login.statusCode).toBe(200);

    const weakChange = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      payload: { currentPassword: "old-secret", newPassword: "short" }
    });
    expect(weakChange.statusCode).toBe(400);

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: Array.isArray(oldCookie) ? oldCookie[0] : String(oldCookie) },
      payload: { currentPassword: "old-secret", newPassword: "new-secret" }
    });
    expect(changed.statusCode).toBe(200);

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/private",
      headers: { cookie: Array.isArray(oldCookie) ? oldCookie[0] : String(oldCookie) }
    });
    expect(oldSession.statusCode).toBe(401);

    const oldPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "old-secret" }
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "new-secret" }
    });
    expect(newPasswordLogin.statusCode).toBe(200);

    await app.close();
  });
});

function testConfig(auth: { adminPassword: string; sessionSecret: string }): AppConfig {
  return {
    cwd: process.cwd(),
    dataDir: "data",
    dbPath: "data/bot.sqlite",
    server: {
      host: "127.0.0.1",
      port: 8787,
      publicBaseUrl: "http://127.0.0.1:8787"
    },
    auth: {
      ...auth,
      sessionTtlHours: 1,
      secureCookie: false
    },
    dataSource: {
      repoUrl: "https://example.com/repo.git",
      branch: "generated",
      dataPath: "docs/universities"
    }
  };
}

function memorySettings() {
  const values = new Map<string, string>();
  return {
    getString: (key: string, fallback: string) => values.get(key) ?? fallback,
    setInternal: (key: string, value: string) => {
      values.set(key, value);
    }
  };
}
