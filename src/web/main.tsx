import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bot,
  Brain,
  Database,
  ListFilter,
  Lock,
  LogOut,
  MessageSquareText,
  PlugZap,
  RefreshCcw,
  Save,
  Search,
  Send,
  Settings,
  Trash2
} from "lucide-react";
import "./styles.css";

type Page = "dashboard" | "model" | "natural" | "data" | "aliases" | "debug" | "logs" | "security";

interface Dashboard {
  onebot: {
    connected: boolean;
    connections: number;
    connectedAt: string | null;
    lastEventAt: string | null;
    selfId: string | null;
  };
  totals: {
    universities: number;
    srgaoxiaoProfiles: number;
    messages: number;
    llmCalls: number;
  };
  sync?: {
    status: string;
    finishedAt?: string;
    commitSha?: string;
    totalUniversities?: number;
    error?: string;
  };
  onebotWsUrl: string;
}

interface University {
  id: number;
  name: string;
  slug: string;
  source_url: string;
  updated_at: string;
  raw_markdown?: string;
  srgaoxiaoProfile?: {
    source: string;
    sourceSchoolId: string | null;
    sourceUrl: string | null;
    profileText: string;
    updatedAt: string;
  } | null;
}

interface AliasRow {
  id: number;
  alias: string;
  universityId: number;
  universityName: string;
  priority: number;
}

interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
}

interface SyncSchedulerStatus {
  jobs: {
    colleges: {
      enabled: boolean;
      intervalHours: number;
      running: boolean;
      lastStartedAt: string | null;
      lastFinishedAt: string | null;
      lastError: string | null;
      nextRunAt: string | null;
    };
    srgaoxiao: {
      enabled: boolean;
      intervalHours: number;
      running: boolean;
      lastStartedAt: string | null;
      lastFinishedAt: string | null;
      lastError: string | null;
      nextRunAt: string | null;
    };
  };
}

const NAV = [
  { id: "dashboard", label: "仪表盘", icon: Activity },
  { id: "model", label: "模型", icon: Brain },
  { id: "natural", label: "自然语言", icon: MessageSquareText },
  { id: "data", label: "高校数据", icon: Database },
  { id: "aliases", label: "别名", icon: ListFilter },
  { id: "debug", label: "调试", icon: Send },
  { id: "logs", label: "日志", icon: Bot },
  { id: "security", label: "安全", icon: Lock }
] satisfies Array<{ id: Page; label: string; icon: typeof Activity }>;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      // keep the raw text fallback
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  useEffect(() => {
    void api<AuthStatus>("/api/auth/status")
      .then(setAuth)
      .catch(() => setAuth({ configured: false, authenticated: false }));
  }, []);

  if (!auth) {
    return <div className="loading-screen">正在检查登录状态...</div>;
  }

  if (!auth.configured || !auth.authenticated) {
    return <LoginPage auth={auth} onLoggedIn={() => setAuth({ configured: true, authenticated: true })} />;
  }

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    setAuth({ configured: true, authenticated: false });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Bot size={20} /></div>
          <div>
            <strong>高校资料 QQBot</strong>
            <span>NapCat 管理台</span>
          </div>
        </div>
        <nav>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button className="logout-button" onClick={logout}><LogOut size={18} /><span>退出登录</span></button>
      </aside>
      <main className="content">
        {page === "dashboard" && <DashboardPage />}
        {page === "model" && <ModelPage />}
        {page === "natural" && <NaturalLanguagePage />}
        {page === "data" && <DataPage />}
        {page === "aliases" && <AliasesPage />}
        {page === "debug" && <DebugPage />}
        {page === "logs" && <LogsPage />}
        {page === "security" && <SecurityPage />}
      </main>
    </div>
  );
}

function LoginPage({ auth, onLoggedIn }: { auth: AuthStatus; onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      onLoggedIn();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={login}>
        <div className="brand-mark"><Lock size={22} /></div>
        <h1>管理员登录</h1>
        <p>输入部署时生成或在 .env 中配置的 ADMIN_PASSWORD。</p>
        {!auth.configured ? (
          <p className="login-warning">服务端还没有配置 ADMIN_PASSWORD。请先在 .env 中设置管理员密码并重启服务。</p>
        ) : (
          <>
            <Input label="管理员密码" value={password} onChange={setPassword} type="password" />
            <button className="primary" type="submit" disabled={loading || !password}>{loading ? "登录中..." : "登录"}</button>
          </>
        )}
        {status && <p className="notice">{status}</p>}
      </form>
    </main>
  );
}

function DashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [status, setStatus] = useState("");

  const load = async () => setDashboard(await api<Dashboard>("/api/dashboard"));
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, []);

  const sync = async () => {
    setStatus("同步中...");
    try {
      await api("/api/data/sync", { method: "POST", body: "{}" });
      setStatus("同步完成");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section>
      <Header title="仪表盘" subtitle="查看 NapCat 连接、数据版本和机器人运行概况。" />
      <div className="metrics">
        <Metric label="NapCat" value={dashboard?.onebot.connected ? "已连接" : "未连接"} tone={dashboard?.onebot.connected ? "good" : "warn"} />
        <Metric label="高校数据" value={String(dashboard?.totals.universities ?? 0)} />
        <Metric label="神人画像" value={String(dashboard?.totals.srgaoxiaoProfiles ?? 0)} />
        <Metric label="消息日志" value={String(dashboard?.totals.messages ?? 0)} />
        <Metric label="LLM 调用" value={String(dashboard?.totals.llmCalls ?? 0)} />
      </div>
      <div className="section-grid">
        <Panel title="NapCat 连接" icon={<PlugZap size={18} />}>
          <KeyValue label="反向 WS" value={dashboard?.onebotWsUrl ?? "-"} />
          <KeyValue label="Bot QQ" value={dashboard?.onebot.selfId ?? "-"} />
          <KeyValue label="最近事件" value={formatTime(dashboard?.onebot.lastEventAt)} />
        </Panel>
        <Panel title="数据同步" icon={<Database size={18} />}>
          <KeyValue label="状态" value={dashboard?.sync?.status ?? "未同步"} />
          <KeyValue label="最近完成" value={formatTime(dashboard?.sync?.finishedAt)} />
          <KeyValue label="版本" value={dashboard?.sync?.commitSha?.slice(0, 12) ?? "-"} />
          <button className="primary" onClick={sync}><RefreshCcw size={16} />手动同步</button>
          {status && <p className="notice">{status}</p>}
        </Panel>
      </div>
    </section>
  );
}

function ModelPage() {
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState("");

  useEffect(() => void api<Record<string, string | boolean>>("/api/settings").then(setSettings), []);
  const update = (key: string, value: string) => setSettings((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setStatus("保存中...");
    await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
    setStatus("已保存");
  };
  const test = async () => {
    setStatus("测试中...");
    try {
      const result = await api<{ text: string }>("/api/settings/test-llm", { method: "POST", body: "{}" });
      setStatus(`连接成功：${result.text}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section>
      <Header title="模型配置" subtitle="兼容 OpenAI 类接口，可直接填写你的 sub2api 源站和模型名。" />
      <Panel title="OpenAI-compatible API" icon={<Brain size={18} />}>
        <FormGrid>
          <Input label="API 源站" value={String(settings["llm.baseUrl"] ?? "")} onChange={(v) => update("llm.baseUrl", v)} />
          <Input label="API Key" value={String(settings["llm.apiKey"] ?? "")} onChange={(v) => update("llm.apiKey", v)} type="password" />
          <Input label="模型名" value={String(settings["llm.model"] ?? "")} onChange={(v) => update("llm.model", v)} />
          <Input label="温度" value={String(settings["llm.temperature"] ?? "")} onChange={(v) => update("llm.temperature", v)} />
          <Input label="最大 token" value={String(settings["llm.maxTokens"] ?? "")} onChange={(v) => update("llm.maxTokens", v)} />
          <Input label="超时毫秒" value={String(settings["llm.timeoutMs"] ?? "")} onChange={(v) => update("llm.timeoutMs", v)} />
        </FormGrid>
        <div className="actions">
          <button className="primary" onClick={save}><Save size={16} />保存</button>
          <button onClick={test}><PlugZap size={16} />测试连接</button>
          {status && <span className="status-text">{status}</span>}
        </div>
      </Panel>
    </section>
  );
}

function NaturalLanguagePage() {
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState("");
  useEffect(() => void api<Record<string, string | boolean>>("/api/settings").then(setSettings), []);
  const update = (key: string, value: string | boolean) => setSettings((current) => ({ ...current, [key]: value }));
  const save = async () => {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
    setStatus("已保存");
  };
  return (
    <section>
      <Header title="自然语言设置" subtitle="控制群聊触发强度、上下文和冷却，减少误触发。" />
      <Panel title="触发策略" icon={<MessageSquareText size={18} />}>
        <div className="toggle-row">
          <Switch label="群聊自然触发" checked={settings["nl.groupNaturalEnabled"] !== "false"} onChange={(v) => update("nl.groupNaturalEnabled", String(v))} />
          <Switch label="群聊必须 @ 机器人" checked={settings["nl.requireMentionInGroup"] === "true"} onChange={(v) => update("nl.requireMentionInGroup", String(v))} />
          <Switch label="QQ 回复渲染为图片" checked={settings["onebot.replyAsImage"] !== "false"} onChange={(v) => update("onebot.replyAsImage", String(v))} />
        </div>
        <FormGrid>
          <Input label="置信度阈值" value={String(settings["nl.confidenceThreshold"] ?? "")} onChange={(v) => update("nl.confidenceThreshold", v)} />
          <Input label="上下文分钟" value={String(settings["nl.contextTtlMinutes"] ?? "")} onChange={(v) => update("nl.contextTtlMinutes", v)} />
          <Input label="单用户冷却秒" value={String(settings["nl.cooldownSeconds"] ?? "")} onChange={(v) => update("nl.cooldownSeconds", v)} />
        </FormGrid>
        <div className="actions">
          <button className="primary" onClick={save}><Save size={16} />保存</button>
          {status && <span className="status-text">{status}</span>}
        </div>
      </Panel>
    </section>
  );
}

function SecurityPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("");
    if (newPassword.length < 8) {
      setStatus("新密码至少需要 8 位。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus("两次输入的新密码不一致。");
      return;
    }

    setSaving(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus("密码已修改。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <Header title="安全设置" subtitle="修改 WebUI 管理员密码，保护模型密钥、日志和同步操作。" />
      <Panel title="管理员密码" icon={<Lock size={18} />}>
        <form className="password-form" onSubmit={save}>
          <FormGrid>
            <Input label="当前密码" value={currentPassword} onChange={setCurrentPassword} type="password" />
            <Input label="新密码" value={newPassword} onChange={setNewPassword} type="password" />
            <Input label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} type="password" />
          </FormGrid>
          <div className="actions">
            <button className="primary" type="submit" disabled={saving || !currentPassword || !newPassword || !confirmPassword}>
              <Save size={16} />{saving ? "保存中..." : "修改密码"}
            </button>
            {status && <span className="status-text">{status}</span>}
          </div>
        </form>
      </Panel>
    </section>
  );
}

function DataPage() {
  const [query, setQuery] = useState("");
  const [profileLimit, setProfileLimit] = useState("20");
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const [scheduler, setScheduler] = useState<SyncSchedulerStatus | null>(null);
  const [schools, setSchools] = useState<University[]>([]);
  const [selected, setSelected] = useState<University | null>(null);
  const [status, setStatus] = useState("");

  const search = async () => setSchools(await api<University[]>(`/api/universities?query=${encodeURIComponent(query)}&limit=80`));
  const loadAutoSync = async () => {
    setSettings(await api<Record<string, string | boolean>>("/api/settings"));
    setScheduler(await api<SyncSchedulerStatus>("/api/sync-scheduler"));
  };
  useEffect(() => {
    void search();
    void loadAutoSync();
    const timer = window.setInterval(() => void loadAutoSync(), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const open = async (id: number) => setSelected(await api<University>(`/api/universities/${id}`));
  const updateSetting = (key: string, value: string | boolean) => setSettings((current) => ({ ...current, [key]: value }));
  const sync = async () => {
    setStatus("同步中...");
    try {
      await api("/api/data/sync", { method: "POST", body: "{}" });
      setStatus("同步完成");
      await search();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const syncSrgaoxiao = async () => {
    setStatus("神人高校画像同步中...");
    try {
      const result = await api<{ saved: number; total: number; errors: unknown[]; mode: string }>("/api/data/sync-srgaoxiao", {
        method: "POST",
        body: JSON.stringify({
          query: query.trim(),
          limit: Number(profileLimit) || 20
        })
      });
      setStatus(`神人高校画像同步完成：${result.saved}/${result.total}${result.errors.length ? `，失败 ${result.errors.length} 个` : ""}`);
      await search();
      if (selected) await open(selected.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const syncSrgaoxiaoFull = async () => {
    setStatus("神人高校画像全量同步中，预计需要几十秒到数分钟...");
    try {
      const result = await api<{ saved: number; total: number; remoteTotal: number | null; skipped: number; reviewsRefreshed: number; reviewsSaved: number; errors: unknown[] }>("/api/data/sync-srgaoxiao", {
        method: "POST",
        body: JSON.stringify({
          full: true,
          pageSize: 100,
          refreshReviews: "changed",
          reviewMaxPages: Number(settings["sync.srgaoxiaoReviewMaxPages"] ?? "20") || 20
        })
      });
      setStatus(`神人高校画像全量同步完成：保存 ${result.saved}/${result.total}，刷新评论 ${result.reviewsRefreshed} 所/${result.reviewsSaved} 条，未匹配 ${result.skipped}${result.errors.length ? `，失败 ${result.errors.length} 个` : ""}`);
      await search();
      if (selected) await open(selected.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const saveAutoSync = async () => {
    setStatus("保存自动同步设置中...");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      await loadAutoSync();
      setStatus("自动同步设置已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section>
      <Header title="高校数据" subtitle="同步 CollegesChat 资料和神人高校画像，查看解析后的学校条目。" />
      <Panel title="自动同步" icon={<RefreshCcw size={18} />}>
        <div className="toggle-row">
          <Switch label="定期同步 CollegesChat" checked={settings["sync.collegesAutoEnabled"] === "true"} onChange={(v) => updateSetting("sync.collegesAutoEnabled", String(v))} />
          <Switch label="定期同步神人画像" checked={settings["sync.srgaoxiaoAutoEnabled"] === "true"} onChange={(v) => updateSetting("sync.srgaoxiaoAutoEnabled", String(v))} />
        </div>
        <FormGrid>
          <Input label="主数据间隔小时" value={String(settings["sync.collegesIntervalHours"] ?? "24")} onChange={(v) => updateSetting("sync.collegesIntervalHours", v)} />
          <Input label="画像间隔小时" value={String(settings["sync.srgaoxiaoIntervalHours"] ?? "24")} onChange={(v) => updateSetting("sync.srgaoxiaoIntervalHours", v)} />
          <Input label="评论每校最多页数" value={String(settings["sync.srgaoxiaoReviewMaxPages"] ?? "20")} onChange={(v) => updateSetting("sync.srgaoxiaoReviewMaxPages", v)} />
        </FormGrid>
        <div className="scheduler-grid">
          <KeyValue label="主数据状态" value={scheduler?.jobs.colleges.running ? "运行中" : scheduler?.jobs.colleges.enabled ? "已启用" : "未启用"} />
          <KeyValue label="主数据下次" value={formatScheduleTime(scheduler?.jobs.colleges.nextRunAt)} />
          <KeyValue label="画像状态" value={scheduler?.jobs.srgaoxiao.running ? "运行中" : scheduler?.jobs.srgaoxiao.enabled ? "已启用" : "未启用"} />
          <KeyValue label="画像下次" value={formatScheduleTime(scheduler?.jobs.srgaoxiao.nextRunAt)} />
          <KeyValue label="主数据最近" value={formatTime(scheduler?.jobs.colleges.lastFinishedAt)} />
          <KeyValue label="画像最近" value={formatTime(scheduler?.jobs.srgaoxiao.lastFinishedAt)} />
        </div>
        {(scheduler?.jobs.colleges.lastError || scheduler?.jobs.srgaoxiao.lastError) && (
          <p className="notice">{scheduler.jobs.colleges.lastError || scheduler.jobs.srgaoxiao.lastError}</p>
        )}
        <div className="actions">
          <button className="primary" onClick={saveAutoSync}><Save size={16} />保存自动同步</button>
        </div>
      </Panel>
      <div className="toolbar">
        <div className="searchbox"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} placeholder="搜索学校或 slug" /></div>
        <input className="small-input" value={profileLimit} onChange={(e) => setProfileLimit(e.target.value)} inputMode="numeric" aria-label="画像同步数量" />
        <button onClick={search}><Search size={16} />搜索</button>
        <button className="primary" onClick={sync}><RefreshCcw size={16} />同步</button>
        <button onClick={syncSrgaoxiao}><RefreshCcw size={16} />同步画像</button>
        <button onClick={syncSrgaoxiaoFull}><RefreshCcw size={16} />全量画像</button>
      </div>
      {status && <p className="notice">{status}</p>}
      <div className="split">
        <div className="table-wrap">
          <table>
            <thead><tr><th>学校</th><th>slug</th><th>更新时间</th></tr></thead>
            <tbody>
              {schools.map((school) => (
                <tr key={school.id} onClick={() => void open(school.id)} className={selected?.id === school.id ? "selected" : ""}>
                  <td>{school.name}</td>
                  <td>{school.slug}</td>
                  <td>{formatTime(school.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Panel title={selected?.name ?? "学校详情"} icon={<Database size={18} />}>
          {selected ? (
            <>
              <KeyValue label="来源" value={selected.source_url} />
              <KeyValue label="神人高校画像" value={selected.srgaoxiaoProfile ? formatTime(selected.srgaoxiaoProfile.updatedAt) : "未同步"} />
              {selected.srgaoxiaoProfile?.sourceUrl && <KeyValue label="画像来源" value={selected.srgaoxiaoProfile.sourceUrl} />}
              {selected.srgaoxiaoProfile?.profileText && <pre className="raw">{selected.srgaoxiaoProfile.profileText}</pre>}
              <pre className="raw">{selected.raw_markdown?.slice(0, 3000) ?? ""}</pre>
            </>
          ) : <p className="muted">选择左侧学校查看原始 Markdown 摘要。</p>}
        </Panel>
      </div>
    </section>
  );
}

function AliasesPage() {
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [schools, setSchools] = useState<University[]>([]);
  const [alias, setAlias] = useState("");
  const [universityId, setUniversityId] = useState("");

  const load = async () => {
    setAliases(await api<AliasRow[]>("/api/aliases"));
    setSchools(await api<University[]>("/api/universities?limit=500"));
  };
  useEffect(() => void load(), []);
  const add = async () => {
    if (!alias || !universityId) return;
    await api("/api/aliases", { method: "POST", body: JSON.stringify({ alias, universityId: Number(universityId), priority: 85 }) });
    setAlias("");
    await load();
  };
  const remove = async (id: number) => {
    await api(`/api/aliases/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <section>
      <Header title="学校别名" subtitle="维护自然语言简称，例如安大、西电、南航。" />
      <Panel title="新增别名" icon={<ListFilter size={18} />}>
        <div className="alias-form">
          <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="别名，例如安大" />
          <select value={universityId} onChange={(e) => setUniversityId(e.target.value)}>
            <option value="">选择学校</option>
            {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
          <button className="primary" onClick={add}><Save size={16} />添加</button>
        </div>
      </Panel>
      <div className="table-wrap">
        <table>
          <thead><tr><th>别名</th><th>学校</th><th>优先级</th><th></th></tr></thead>
          <tbody>
            {aliases.map((row) => (
              <tr key={row.id}>
                <td>{row.alias}</td>
                <td>{row.universityName}</td>
                <td>{row.priority}</td>
                <td><button className="icon" onClick={() => void remove(row.id)}><Trash2 size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DebugPage() {
  const [text, setText] = useState("安徽大学宿舍怎么样");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      setResult(await api("/api/debug/message", { method: "POST", body: JSON.stringify({ text, messageType: "private" }) }));
    } finally {
      setLoading(false);
    }
  };
  return (
    <section>
      <Header title="Prompt 调试台" subtitle="模拟一条 QQ 消息，查看识别、检索和最终回复。" />
      <Panel title="模拟消息" icon={<Send size={18} />}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
        <div className="actions"><button className="primary" onClick={run} disabled={loading}><Send size={16} />运行</button></div>
      </Panel>
      <pre className="json">{JSON.stringify(result, null, 2)}</pre>
    </section>
  );
}

function LogsPage() {
  const [messages, setMessages] = useState<unknown[]>([]);
  const [llm, setLlm] = useState<unknown[]>([]);
  const load = async () => {
    setMessages(await api<unknown[]>("/api/logs/messages"));
    setLlm(await api<unknown[]>("/api/logs/llm"));
  };
  useEffect(() => void load(), []);
  return (
    <section>
      <Header title="日志" subtitle="查看 QQ 消息处理和 LLM 调用结果。" />
      <button onClick={load}><RefreshCcw size={16} />刷新</button>
      <div className="logs-grid">
        <Panel title="消息日志" icon={<MessageSquareText size={18} />}>
          <pre className="json">{JSON.stringify(messages, null, 2)}</pre>
        </Panel>
        <Panel title="LLM 日志" icon={<Brain size={18} />}>
          <pre className="json">{JSON.stringify(llm, null, 2)}</pre>
        </Panel>
      </div>
    </section>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-title">{icon}<h2>{title}</h2></div>
      {children}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value?: string | null }) {
  return <div className="kv"><span>{label}</span><strong>{value || "-"}</strong></div>;
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="form-grid">{children}</div>;
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span />{label}</label>;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
}

function formatScheduleTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

createRoot(document.getElementById("root")!).render(<App />);
