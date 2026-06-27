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
  QrCode,
  RefreshCcw,
  Save,
  Search,
  Send,
  Settings,
  Trash2
} from "lucide-react";
import "./styles.css";

type Page = "dashboard" | "model" | "site" | "natural" | "data" | "official" | "admissions" | "aliases" | "debug" | "logs" | "security";

const ADMISSION_CURRENT_YEAR = new Date().getFullYear();
const ADMISSION_CURRENT_MONTH = new Date().getMonth() + 1;
const DEFAULT_ADMISSION_PLAN_YEARS = String(ADMISSION_CURRENT_YEAR);
const DEFAULT_ADMISSION_SCORE_YEARS = (ADMISSION_CURRENT_MONTH >= 7 && ADMISSION_CURRENT_MONTH <= 10
  ? [ADMISSION_CURRENT_YEAR, ADMISSION_CURRENT_YEAR - 1, ADMISSION_CURRENT_YEAR - 2, ADMISSION_CURRENT_YEAR - 3]
  : [ADMISSION_CURRENT_YEAR - 1, ADMISSION_CURRENT_YEAR - 2, ADMISSION_CURRENT_YEAR - 3]).join(",");
const DEFAULT_ADMISSION_QUERY_YEARS = [ADMISSION_CURRENT_YEAR, ADMISSION_CURRENT_YEAR - 1, ADMISSION_CURRENT_YEAR - 2, ADMISSION_CURRENT_YEAR - 3].join(",");
const DEFAULT_ADMISSION_PLAN_INTERVAL_HOURS = ADMISSION_CURRENT_MONTH >= 5 && ADMISSION_CURRENT_MONTH <= 8 ? "24" : "168";
const DEFAULT_ADMISSION_SCORE_INTERVAL_HOURS = ADMISSION_CURRENT_MONTH >= 7 && ADMISSION_CURRENT_MONTH <= 10 ? "24" : "720";

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
    admissionMappings: number;
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
  publicBaseUrl: string;
}

interface NapcatWebStatus {
  configured?: boolean;
  reachable?: boolean;
  baseUrl?: string;
  panelUrl?: string;
  isLogin?: boolean;
  isOffline?: boolean;
  qrcodeUrl?: string;
  loginError?: string;
  message?: string;
}

interface XuefengAgentCacheStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  dbPath: string;
  gzPath: string;
  dbExists: boolean;
  gzExists: boolean;
  downloaded: boolean;
  error: string | null;
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
      cursorOffset?: number | null;
      lastResult?: GaokaoSchedulerResult | null;
      cooldownUntil?: string | null;
      retryAt?: string | null;
    };
    srgaoxiao: {
      enabled: boolean;
      intervalHours: number;
      running: boolean;
      lastStartedAt: string | null;
      lastFinishedAt: string | null;
      lastError: string | null;
      nextRunAt: string | null;
      cursorOffset?: number | null;
      lastResult?: GaokaoSchedulerResult | null;
      cooldownUntil?: string | null;
      retryAt?: string | null;
    };
    gaokaoCnPlan: {
      enabled: boolean;
      intervalHours: number;
      running: boolean;
      lastStartedAt: string | null;
      lastFinishedAt: string | null;
      lastError: string | null;
      nextRunAt: string | null;
      cursorOffset?: number | null;
      lastResult?: GaokaoSchedulerResult | null;
      cooldownUntil?: string | null;
      retryAt?: string | null;
    };
    gaokaoCnScore: {
      enabled: boolean;
      intervalHours: number;
      running: boolean;
      lastStartedAt: string | null;
      lastFinishedAt: string | null;
      lastError: string | null;
      nextRunAt: string | null;
      cursorOffset?: number | null;
      lastResult?: GaokaoSchedulerResult | null;
      cooldownUntil?: string | null;
      retryAt?: string | null;
    };
  };
}

interface GaokaoSchedulerResult {
  ok: boolean;
  batchCount?: number;
  total: number;
  candidateTotal: number;
  offset: number;
  nextOffset: number;
  mapped: number;
  planRows: number;
  planSummaryRows?: number;
  majorPlanRows?: number;
  schoolScoreRows: number;
  majorScoreRows: number;
  sourceRows: number;
  sourceRequests?: number;
  sourceRequestBudget?: number | null;
  requestBudgetExhausted?: boolean;
  skippedRequests?: number;
  skipped: number;
  errorCount: number;
  errors?: Array<{ university?: string; message?: string }>;
  savedAt: string;
}

interface AdmissionMapping {
  universityId: number;
  universityName?: string;
  sourceSchoolId: string;
  sourceSchoolName: string;
  matchStatus: string;
  confidence: number;
  sourceUrl: string | null;
  updatedAt: string;
}

interface AdmissionPlan {
  id: number;
  universityName: string;
  sourceSchoolId: string;
  year: number;
  provinceName: string;
  subjectType: string | null;
  batch: string | null;
  planGroup: string | null;
  majorName: string | null;
  planCount: number | null;
  schoolPlanCount: number | null;
  majorCount: number | null;
  tuition: string | null;
  duration: string | null;
  campus: string | null;
  selectionRequirements: string | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  fetchedAt: string;
}

interface AdmissionScore {
  id: number;
  scoreType: "school" | "major";
  universityName: string;
  sourceSchoolId: string;
  year: number;
  provinceName: string;
  subjectType: string | null;
  batch: string | null;
  planGroup: string | null;
  majorName: string | null;
  minScore: number | null;
  minRank: number | null;
  avgScore: number | null;
  avgRank: number | null;
  maxScore: number | null;
  planCount: number | null;
  controlScore: number | null;
  diffScore: number | null;
  selectionRequirements: string | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  fetchedAt: string;
}

interface AdmissionCoverageYear {
  year: number;
  rowCount: number;
  universityCount: number;
  provinceCount: number;
}

interface AdmissionCoverage {
  totalUniversities: number;
  attemptedUniversities: number;
  mappedUniversities: number;
  unmappedUniversities: number;
  pendingUniversities: number;
  unmatchedUniversities: number;
  ambiguousUniversities: number;
  mappingIssueUniversities: number;
  planUniversities: number;
  majorPlanUniversities: number;
  scoreUniversities: number;
  planRows: number;
  majorPlanRows: number;
  scoreRows: number;
  schoolScoreRows: number;
  majorScoreRows: number;
  sourceRows: number;
  failedJobs: number;
  latestPlanFetchedAt: string | null;
  latestScoreFetchedAt: string | null;
  latestSourceFetchedAt: string | null;
  planYears: AdmissionCoverageYear[];
  scoreYears: AdmissionCoverageYear[];
}

interface AdmissionCoverageGap {
  kind: "plan" | "major_plan" | "school_score" | "major_score";
  year: number;
  provinceName: string;
  subjectType: string | null;
  totalMappedUniversities: number;
  coveredUniversities: number;
  missingUniversities: number;
  rowCount: number;
  coverageRatio: number;
}

interface AdmissionCoverageMissingUniversity {
  universityId: number;
  universityName: string;
  sourceSchoolId: string;
  sourceSchoolName: string;
  matchStatus: string;
  updatedAt: string;
}

interface AdmissionUnmappedUniversity {
  id: number;
  name: string;
  slug: string;
  updatedAt: string;
}

interface AdmissionMappingIssue {
  universityId: number;
  universityName: string;
  slug: string;
  matchStatus: "unmatched" | "ambiguous";
  sourceSchoolId: string;
  sourceSchoolName: string;
  updatedAt: string;
}

interface AdmissionSourceSnapshot {
  id: number;
  source: string;
  sourceKind: string;
  universityId: number | null;
  universityName: string | null;
  sourceSchoolId: string | null;
  sourceUrl: string;
  requestJson: string;
  responseJson: string | null;
  status: string;
  error: string | null;
  fetchedAt: string;
}

interface AdmissionSyncJob {
  id: number;
  source: string;
  jobType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  targetJson: string;
  resultJson: string | null;
  error: string | null;
}

interface AdmissionSyncResult {
  total?: number;
  candidateTotal?: number;
  offset?: number;
  nextOffset?: number;
  mapped?: number;
  planRows?: number;
  planSummaryRows?: number;
  majorPlanRows?: number;
  schoolScoreRows?: number;
  majorScoreRows?: number;
  sourceRows?: number;
  sourceRequests?: number;
  sourceRequestBudget?: number | null;
  requestBudgetExhausted?: boolean;
  skippedRequests?: number;
  skipped?: number;
  errors?: Array<{ university?: string; message?: string }>;
}

interface GaokaoSchoolCandidate {
  school_id: number | string;
  name: string;
  province_name?: string | null;
  city_name?: string | null;
  level_name?: string | null;
  type_name?: string | null;
  nature_name?: string | null;
  f211?: number | string | null;
  f985?: number | string | null;
  dual_class_name?: string | null;
}

const NAV = [
  { id: "dashboard", label: "仪表盘", icon: Activity },
  { id: "model", label: "模型", icon: Brain },
  { id: "site", label: "站点", icon: Settings },
  { id: "natural", label: "自然语言", icon: MessageSquareText },
  { id: "data", label: "高校数据", icon: Database },
  { id: "official", label: "官方数据", icon: RefreshCcw },
  { id: "admissions", label: "招生数据", icon: Database },
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
    let message = formatApiErrorText(text, response.status, response.statusText);
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

function formatApiErrorText(text: string, status: number, statusText: string): string {
  if (/^\s*</u.test(text)) {
    if (status === 504) return "请求超时：任务可能仍在后台执行，请稍后刷新同步任务或来源列表。";
    return `${status} ${statusText || "HTTP Error"}`.trim();
  }
  return text || statusText;
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
        {page === "site" && <SitePage />}
        {page === "natural" && <NaturalLanguagePage />}
        {page === "data" && <DataPage />}
        {page === "official" && <OfficialDataPage />}
        {page === "admissions" && <AdmissionsPage />}
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
  const [napcatWeb, setNapcatWeb] = useState<NapcatWebStatus | null>(null);
  const [napcatQrStamp, setNapcatQrStamp] = useState(0);
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState("");
  const [napcatStatus, setNapcatStatus] = useState("");
  const [savingNapcat, setSavingNapcat] = useState(false);
  const [restartingNapcat, setRestartingNapcat] = useState(false);

  const load = async () => setDashboard(await api<Dashboard>("/api/dashboard"));
  const loadSettings = async () => setSettings(await api<Record<string, string | boolean>>("/api/settings"));
  const applyNapcatWebStatus = (data: NapcatWebStatus) => {
    setNapcatWeb(data);
    if (data.qrcodeUrl && !data.isLogin) setNapcatQrStamp(Date.now());
  };
  const loadNapcatWebStatus = async () => applyNapcatWebStatus(await api<NapcatWebStatus>("/api/onebot/napcat/status"));
  useEffect(() => {
    void load();
    void loadSettings();
    void loadNapcatWebStatus();
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
  const updateNapcatSetting = (key: string, value: string) => setSettings((current) => ({ ...current, [key]: value }));
  const napcatSettingsPayload = () => ({
    "onebot.napcatRestartCommand": settings["onebot.napcatRestartCommand"] ?? "",
    "onebot.napcatWebUrl": settings["onebot.napcatWebUrl"] ?? "",
    "onebot.napcatWebKey": settings["onebot.napcatWebKey"] ?? ""
  });
  const saveNapcatSettings = async () => {
    setSavingNapcat(true);
    setNapcatStatus("保存中...");
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(napcatSettingsPayload())
      });
      setNapcatStatus("NapCat 运维配置已保存");
      await loadSettings();
      await loadNapcatWebStatus();
    } catch (error) {
      setNapcatStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingNapcat(false);
    }
  };
  const restartNapcat = async () => {
    setRestartingNapcat(true);
    setNapcatStatus("正在向 NapCat 启动器发送重启请求...");
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(napcatSettingsPayload())
      });
      const result = await api<{ mode?: string; message?: string; stdout?: string; stderr?: string }>("/api/onebot/napcat/restart", {
        method: "POST",
        body: "{}"
      });
      const output = [result.stdout?.trim() ? `输出：${result.stdout.trim()}` : "", result.stderr?.trim() ? `错误输出：${result.stderr.trim()}` : ""]
        .filter(Boolean)
        .join("；");
      setNapcatStatus(output ? `命令已执行。${output}` : result.message || "已向 NapCat 启动器发送重启请求；如掉登录请打开扫码页。");
      await load();
      await loadNapcatWebStatus();
    } catch (error) {
      setNapcatStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRestartingNapcat(false);
    }
  };
  const checkNapcatWebStatus = async () => {
    setNapcatStatus("正在检查 NapCat QQ 登录状态...");
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(napcatSettingsPayload())
      });
      await loadSettings();
      const data = await api<NapcatWebStatus>("/api/onebot/napcat/status");
      applyNapcatWebStatus(data);
      setNapcatStatus(formatNapcatWebStatus(data));
    } catch (error) {
      setNapcatStatus(error instanceof Error ? error.message : String(error));
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
          <KeyValue label="站点地址" value={dashboard?.publicBaseUrl ?? "-"} />
          <KeyValue label="反向 WS" value={dashboard?.onebotWsUrl ?? "-"} />
          <KeyValue label="Bot QQ" value={dashboard?.onebot.selfId ?? "-"} />
          <KeyValue label="最近事件" value={formatTime(dashboard?.onebot.lastEventAt)} />
        </Panel>
        <Panel title="NapCat 运维" icon={<PlugZap size={18} />}>
          <KeyValue label="QQ 状态" value={formatNapcatWebStatus(napcatWeb)} />
          <KeyValue label="启动器" value={napcatWeb?.reachable ? "可访问" : napcatWeb?.configured ? "不可访问" : "未配置"} />
          <KeyValue label="地址" value={napcatWeb?.baseUrl ?? String(settings["onebot.napcatWebUrl"] ?? "")} />
          <FormGrid>
            <Input
              label="启动器地址"
              value={String(settings["onebot.napcatWebUrl"] ?? "")}
              onChange={(v) => updateNapcatSetting("onebot.napcatWebUrl", v)}
              autoComplete="url"
              name="napcat-launcher-url"
              hint="默认 http://127.0.0.1:6099；可填完整 /webui 地址。"
            />
            <Input
              label="WebUI Key"
              value={String(settings["onebot.napcatWebKey"] ?? "")}
              onChange={(v) => updateNapcatSetting("onebot.napcatWebKey", v)}
              type="password"
              autoComplete="new-password"
              ignorePasswordManagers
              name="napcat-webui-key"
              hint="NapCat 启动器 WebUI 的 key，会打码保存。"
            />
            <Input
              label="兜底重启命令"
              value={String(settings["onebot.napcatRestartCommand"] ?? "")}
              onChange={(v) => updateNapcatSetting("onebot.napcatRestartCommand", v)}
              autoComplete="off"
              ignorePasswordManagers
              name="napcat-restart-command"
              hint="可选；只有没填 WebUI Key 时才使用。"
            />
          </FormGrid>
          <div className="actions">
            <button className="primary" onClick={restartNapcat} disabled={restartingNapcat}>
              <RefreshCcw size={16} />{restartingNapcat ? "重启中..." : "重启启动器"}
            </button>
            <button onClick={checkNapcatWebStatus}><PlugZap size={16} />检查状态</button>
            <button onClick={saveNapcatSettings} disabled={savingNapcat}>
              <Save size={16} />{savingNapcat ? "保存中..." : "保存配置"}
            </button>
            <button onClick={checkNapcatWebStatus} disabled={!String(settings["onebot.napcatWebKey"] ?? "").trim()}>
              <QrCode size={16} />刷新二维码
            </button>
          </div>
          {napcatWeb?.qrcodeUrl && !napcatWeb.isLogin && (
            <div className="napcat-qr-panel">
              <img
                className="napcat-qr-image"
                src={`/api/onebot/napcat/qrcode.png?t=${napcatQrStamp || Date.now()}`}
                alt="NapCat QQ 登录二维码"
              />
              <div>
                <strong>扫码登录 NapCat QQ</strong>
                <p className="notice">二维码由 MyQQBot 后端从 NapCat 启动器获取并本地渲染，不会跳转到 127.0.0.1。</p>
              </div>
            </div>
          )}
          {napcatStatus && <p className="notice ops-status">{napcatStatus}</p>}
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

function SitePage() {
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState("");

  useEffect(() => void api<Record<string, string | boolean>>("/api/settings").then(setSettings), []);
  const update = (key: string, value: string) => setSettings((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setStatus("保存中...");
    await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
    setStatus("已保存");
  };
  const baseUrl = String(settings["site.publicBaseUrl"] ?? "").replace(/\/+$/g, "");

  return (
    <section>
      <Header title="站点设置" subtitle="配置公开资料页域名和页面页脚备案信息。" />
      <Panel title="公开访问" icon={<Settings size={18} />}>
        <FormGrid>
          <Input label="站点地址" value={String(settings["site.publicBaseUrl"] ?? "")} onChange={(v) => update("site.publicBaseUrl", v)} />
          <Input label="备案号" value={String(settings["site.filingNumber"] ?? "")} onChange={(v) => update("site.filingNumber", v)} />
        </FormGrid>
        <div className="site-preview">
          <KeyValue label="资料页格式" value={baseUrl ? `${baseUrl}/sources/随机编号` : "请先填写站点地址"} />
        </div>
        <div className="actions">
          <button className="primary" onClick={save}><Save size={16} />保存</button>
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
      <Header title="自然语言设置" subtitle="控制群聊是否需要 @、上下文和冷却；消息入口由大模型判断。" />
      <Panel title="触发策略" icon={<MessageSquareText size={18} />}>
        <div className="toggle-row">
          <Switch label="群聊自然触发" checked={settings["nl.groupNaturalEnabled"] !== "false"} onChange={(v) => update("nl.groupNaturalEnabled", String(v))} />
          <Switch label="群聊必须 @ 机器人" checked={settings["nl.requireMentionInGroup"] === "true"} onChange={(v) => update("nl.requireMentionInGroup", String(v))} />
          <Switch label="QQ 回复渲染为图片" checked={settings["onebot.replyAsImage"] !== "false"} onChange={(v) => update("onebot.replyAsImage", String(v))} />
        </div>
        <p className="notice">服务边界：QQBot 只回答高校生活服务和校园体验资料。招生计划、分数线、位次、志愿填报、冲稳保和专业推荐统一告知边界，不调用招生数据。</p>
        <FormGrid>
          <Input label="上下文分钟" value={String(settings["nl.contextTtlMinutes"] ?? "")} onChange={(v) => update("nl.contextTtlMinutes", v)} />
          <Input label="单用户冷却秒" value={String(settings["nl.cooldownSeconds"] ?? "")} onChange={(v) => update("nl.cooldownSeconds", v)} />
          <Input label="回复图片标题" value={String(settings["onebot.replyImageTitle"] ?? "高校资料助手")} onChange={(v) => update("onebot.replyImageTitle", v)} />
          <Input label="回复图片角标" value={String(settings["onebot.replyImageBadge"] ?? "AI 生成回复")} onChange={(v) => update("onebot.replyImageBadge", v)} />
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

function OfficialDataPage() {
  const [provinceTab, setProvinceTab] = useState<"jiangsu">("jiangsu");
  const [scoreCoverage, setScoreCoverage] = useState<AdmissionCoverage | null>(null);
  const [planCoverage, setPlanCoverage] = useState<AdmissionCoverage | null>(null);
  const [scores, setScores] = useState<AdmissionScore[]>([]);
  const [plans, setPlans] = useState<AdmissionPlan[]>([]);
  const [sources, setSources] = useState<AdmissionSourceSnapshot[]>([]);
  const [status, setStatus] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [year, setYear] = useState("2025");
  const [limit, setLimit] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [excelUrl, setExcelUrl] = useState("");
  const [syncingScores, setSyncingScores] = useState(false);
  const [syncingPlans, setSyncingPlans] = useState(false);

  const sourceQuery = (source: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({
      source,
      province: "江苏",
      limit: "16",
      ...extra
    });
    if (schoolQuery.trim()) params.set("university", schoolQuery.trim());
    return params;
  };

  const load = async () => {
    const scoreYears = year.trim() ? year.trim() : DEFAULT_ADMISSION_SCORE_YEARS;
    const [scoreCoverageData, planCoverageData, scoreData, planData, sourceData] = await Promise.all([
      api<AdmissionCoverage>("/api/admissions/coverage?source=jiangsu_eea"),
      api<AdmissionCoverage>("/api/admissions/coverage?source=jiangsu_school_official"),
      api<{ scores: AdmissionScore[]; plans: AdmissionPlan[] }>(`/api/admissions/query?${sourceQuery("jiangsu_eea", {
        years: scoreYears,
        subject,
        limit: "16"
      }).toString()}`),
      api<{ scores: AdmissionScore[]; plans: AdmissionPlan[] }>(`/api/admissions/query?${sourceQuery("jiangsu_school_official", {
        years: DEFAULT_ADMISSION_PLAN_YEARS,
        limit: "16"
      }).toString()}`),
      api<AdmissionSourceSnapshot[]>(`/api/admissions/sources?${new URLSearchParams({
        source: "jiangsu_eea",
        province: "江苏",
        limit: "12"
      }).toString()}`)
    ]);
    setScoreCoverage(scoreCoverageData);
    setPlanCoverage(planCoverageData);
    setScores(scoreData.scores);
    setPlans(planData.plans);
    setSources(sourceData);
  };

  useEffect(() => {
    void load();
  }, []);

  const syncJiangsuScores = async (custom: boolean) => {
    const trimmedSubject = subject.trim();
    if (custom && !trimmedSubject) {
      setStatus("按自定义来源同步时，请先选择物理类或历史类。");
      return;
    }
    setSyncingScores(true);
    setStatus(custom ? "正在按自定义官方来源拉取江苏投档线..." : "正在拉取内置江苏考试院投档线和一分一段表...");
    try {
      const body: Record<string, unknown> = {
        query: schoolQuery.trim() || undefined,
        limit: Number(limit) || undefined
      };
      if (custom) {
        body.subjectType = trimmedSubject;
        body.year = Number(year) || 2025;
        if (pageUrl.trim()) body.pageUrl = pageUrl.trim();
        if (pdfUrl.trim()) body.pdfUrl = pdfUrl.trim();
        if (excelUrl.trim()) body.excelUrl = excelUrl.trim();
      }
      const result = await api<{ total: number; mapped: number; scoreRows: number; sourceRows: number; skipped: number; errors: unknown[] }>("/api/data/sync-jiangsu-official", {
        method: "POST",
        body: JSON.stringify(body)
      });
      await load();
      const errorText = result.errors.length ? `，失败 ${result.errors.length} 个：${formatGaokaoSyncErrorPreview(result.errors)}` : "";
      setStatus(`江苏官方分数同步完成：来源快照 ${result.sourceRows}，解析 ${result.total} 行，入库 ${result.scoreRows} 条，映射 ${result.mapped}，跳过 ${result.skipped}${errorText}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncingScores(false);
    }
  };

  const syncJiangsuPlans = async () => {
    setSyncingPlans(true);
    setStatus("正在拉取江苏高校官方招生计划...");
    try {
      const result = await api<{ total: number; mapped: number; planRows: number; sourceRows: number; skipped: number; errors: unknown[] }>("/api/data/sync-jiangsu-official-plans", {
        method: "POST",
        body: JSON.stringify({
          query: schoolQuery.trim() || undefined,
          limit: Number(limit) || undefined
        })
      });
      await load();
      const errorText = result.errors.length ? `，失败 ${result.errors.length} 个：${formatGaokaoSyncErrorPreview(result.errors)}` : "";
      setStatus(`江苏高校官方计划同步完成：来源快照 ${result.sourceRows}，解析 ${result.total} 行，入库计划 ${result.planRows} 条，映射 ${result.mapped}，跳过 ${result.skipped}${errorText}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncingPlans(false);
    }
  };

  return (
    <section>
      <Header title="官方数据" subtitle="历史/备用数据维护页；当前 QQBot 不使用招生数据回答用户。" />
      <div className="tabs">
        <button className={provinceTab === "jiangsu" ? "active" : ""} onClick={() => setProvinceTab("jiangsu")}>江苏</button>
        <button disabled>其他省份待接入</button>
      </div>
      {provinceTab === "jiangsu" && (
        <>
          <div className="metrics">
            <Metric label="考试院分数行" value={String(scoreCoverage?.scoreRows ?? 0)} />
            <Metric label="覆盖学校" value={String(scoreCoverage?.scoreUniversities ?? 0)} />
            <Metric label="一分一段/来源" value={String(scoreCoverage?.sourceRows ?? 0)} />
            <Metric label="高校计划行" value={String(planCoverage?.planRows ?? 0)} />
            <Metric label="组内专业明细" value={String(planCoverage?.majorPlanRows ?? 0)} />
            <Metric label="最近官方分数" value={formatTime(scoreCoverage?.latestScoreFetchedAt)} />
          </div>

          <Panel title="江苏官方拉取" icon={<RefreshCcw size={18} />}>
            <p className="notice">默认按钮会同步内置的江苏考试院投档线和一分一段表，保存到本地 `jiangsu_eea`；高校官方计划会保存专业组下的具体专业、计划数、学费和选科要求，不会调用掌上高考。</p>
            <FormGrid>
              <Input label="学校过滤" value={schoolQuery} onChange={setSchoolQuery} hint="留空拉取内置来源中的全部已适配学校；填学校名只保存匹配学校。" />
              <Input label="入库上限" value={limit} onChange={setLimit} hint="留空不限制；调试时可填 20。" />
              <label className="field">
                <span>自定义科类</span>
                <select value={subject} onChange={(event) => setSubject(event.target.value)}>
                  <option value="">物理类 + 历史类</option>
                  <option value="物理类">物理类</option>
                  <option value="历史类">历史类</option>
                </select>
              </label>
              <Input label="自定义年份" value={year} onChange={setYear} />
              <Input label="官方页面 URL" value={pageUrl} onChange={setPageUrl} hint="可选；从考试院页面解析 PDF/xls/xlsx 链接。" />
              <Input label="官方 PDF URL" value={pdfUrl} onChange={setPdfUrl} hint="可选；直接指定投档线 PDF。" />
              <Input label="官方 Excel URL" value={excelUrl} onChange={setExcelUrl} hint="可选；直接指定投档线 xls/xlsx。" />
            </FormGrid>
            <div className="actions">
              <button className="primary" onClick={() => void syncJiangsuScores(false)} disabled={syncingScores}>
                <RefreshCcw size={16} />{syncingScores ? "拉取中..." : "一键拉取江苏考试院分数"}
              </button>
              <button onClick={() => void syncJiangsuScores(true)} disabled={syncingScores}>
                <RefreshCcw size={16} />按自定义来源拉取
              </button>
              <button onClick={() => void syncJiangsuPlans()} disabled={syncingPlans}>
                <RefreshCcw size={16} />{syncingPlans ? "拉取中..." : "拉取高校官网组内专业"}
              </button>
              <button onClick={() => void load()}><Search size={16} />刷新</button>
            </div>
            {status && <p className="notice">{status}</p>}
          </Panel>

          <div className="logs-grid">
            <Panel title="江苏考试院分数样例" icon={<Database size={18} />}>
              <div className="table-wrap compact-table">
                <table>
                  <thead><tr><th>学校</th><th>年份</th><th>科类</th><th>批次/组</th><th>最低分</th><th>最低位次</th><th>选科</th><th>来源</th><th>时间</th></tr></thead>
                  <tbody>
                    {scores.map((row) => (
                      <tr key={row.id}>
                        <td>{row.universityName}</td>
                        <td>{row.year}</td>
                        <td>{row.subjectType ?? "-"}</td>
                        <td>{[row.batch, row.planGroup].filter(Boolean).join(" ") || "-"}</td>
                        <td>{row.minScore ?? "-"}</td>
                        <td>{row.minRank ?? "-"}</td>
                        <td>{row.selectionRequirements ?? "-"}</td>
                        <td>{row.sourceRecordId ? `#${row.sourceRecordId}` : "-"}</td>
                        <td>{formatTime(row.fetchedAt)}</td>
                      </tr>
                    ))}
                    {!scores.length && <tr><td colSpan={9}>暂无江苏考试院分数样例。</td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="江苏高校官方组内专业样例" icon={<Database size={18} />}>
              <div className="table-wrap compact-table">
                <table>
                  <thead><tr><th>学校</th><th>年份</th><th>科类</th><th>专业组</th><th>专业</th><th>计划</th><th>学费</th><th>选科</th><th>时间</th></tr></thead>
                  <tbody>
                    {plans.map((row) => (
                      <tr key={row.id}>
                        <td>{row.universityName}</td>
                        <td>{row.year}</td>
                        <td>{row.subjectType ?? "-"}</td>
                        <td>{row.planGroup ?? "-"}</td>
                        <td>{row.majorName ?? "院校汇总"}</td>
                        <td>{row.planCount ?? row.schoolPlanCount ?? "-"}</td>
                        <td>{row.tuition ?? "-"}</td>
                        <td>{row.selectionRequirements ?? "-"}</td>
                        <td>{formatTime(row.fetchedAt)}</td>
                      </tr>
                    ))}
                    {!plans.length && <tr><td colSpan={9}>暂无江苏高校官方计划样例。</td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <Panel title="最近官方来源" icon={<Database size={18} />}>
            <div className="table-wrap compact-table">
              <table>
                <thead><tr><th>ID</th><th>类型</th><th>状态</th><th>请求条件</th><th>抓取时间</th><th>错误</th></tr></thead>
                <tbody>
                  {sources.map((row) => (
                    <tr key={row.id}>
                      <td>#{row.id}</td>
                      <td>{formatAdmissionSourceKind(row.sourceKind)}</td>
                      <td>{row.status}</td>
                      <td>{formatAdmissionSourceRequest(row.requestJson)}</td>
                      <td>{formatTime(row.fetchedAt)}</td>
                      <td>{row.error ?? "-"}</td>
                    </tr>
                  ))}
                  {!sources.length && <tr><td colSpan={6}>暂无官方来源快照。</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </section>
  );
}

function AdmissionsPage() {
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const [scheduler, setScheduler] = useState<SyncSchedulerStatus | null>(null);
  const [universities, setUniversities] = useState<University[]>([]);
  const [coverage, setCoverage] = useState<AdmissionCoverage | null>(null);
  const [coverageGaps, setCoverageGaps] = useState<AdmissionCoverageGap[]>([]);
  const [coverageMissingGap, setCoverageMissingGap] = useState<AdmissionCoverageGap | null>(null);
  const [coverageMissingRows, setCoverageMissingRows] = useState<AdmissionCoverageMissingUniversity[]>([]);
  const [unmapped, setUnmapped] = useState<AdmissionUnmappedUniversity[]>([]);
  const [mappingIssues, setMappingIssues] = useState<AdmissionMappingIssue[]>([]);
  const [mappings, setMappings] = useState<AdmissionMapping[]>([]);
  const [jobs, setJobs] = useState<AdmissionSyncJob[]>([]);
  const [failedJobs, setFailedJobs] = useState<AdmissionSyncJob[]>([]);
  const [status, setStatus] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [jobType, setJobType] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [syncLimit, setSyncLimit] = useState("1");
  const [syncOffset, setSyncOffset] = useState("0");
  const [manualProvince, setManualProvince] = useState("");
  const [manualSubjectTypes, setManualSubjectTypes] = useState("");
  const [manualPlanYears, setManualPlanYears] = useState("");
  const [manualScoreYears, setManualScoreYears] = useState("");
  const [manualIncludePlans, setManualIncludePlans] = useState(true);
  const [manualIncludePlanDetails, setManualIncludePlanDetails] = useState(false);
  const [manualIncludeScores, setManualIncludeScores] = useState(true);
  const [manualIncludeSpecialScores, setManualIncludeSpecialScores] = useState(true);
  const [jiangsuOfficialSubject, setJiangsuOfficialSubject] = useState("");
  const [jiangsuOfficialYear, setJiangsuOfficialYear] = useState("2025");
  const [jiangsuOfficialLimit, setJiangsuOfficialLimit] = useState("");
  const [jiangsuOfficialPageUrl, setJiangsuOfficialPageUrl] = useState("");
  const [jiangsuOfficialPdfUrl, setJiangsuOfficialPdfUrl] = useState("");
  const [jiangsuOfficialExcelUrl, setJiangsuOfficialExcelUrl] = useState("");
  const [xuefengAgentUrl, setXuefengAgentUrl] = useState("");
  const [xuefengAgentDbPath, setXuefengAgentDbPath] = useState("");
  const [xuefengAgentLimit, setXuefengAgentLimit] = useState("");
  const [xuefengAgentOffset, setXuefengAgentOffset] = useState("");
  const [xuefengAgentCache, setXuefengAgentCache] = useState<XuefengAgentCacheStatus | null>(null);
  const [queryUniversityId, setQueryUniversityId] = useState("");
  const [querySchool, setQuerySchool] = useState("");
  const [queryProvince, setQueryProvince] = useState("江苏");
  const [querySubject, setQuerySubject] = useState("");
  const [queryYears, setQueryYears] = useState(DEFAULT_ADMISSION_QUERY_YEARS);
  const [queryBatch, setQueryBatch] = useState("");
  const [queryPlanGroup, setQueryPlanGroup] = useState("");
  const [queryScoreType, setQueryScoreType] = useState("");
  const [queryMajor, setQueryMajor] = useState("");
  const [plans, setPlans] = useState<AdmissionPlan[]>([]);
  const [scores, setScores] = useState<AdmissionScore[]>([]);
  const [sources, setSources] = useState<AdmissionSourceSnapshot[]>([]);
  const [sourceUniversityId, setSourceUniversityId] = useState("");
  const [sourceKind, setSourceKind] = useState("");
  const [sourceStatus, setSourceStatus] = useState("");
  const [sourceYear, setSourceYear] = useState("");
  const [sourceProvince, setSourceProvince] = useState("");
  const [sourceSubject, setSourceSubject] = useState("");
  const [sourceSnapshot, setSourceSnapshot] = useState<AdmissionSourceSnapshot | null>(null);
  const [manualUniversityId, setManualUniversityId] = useState("");
  const [manualSchoolId, setManualSchoolId] = useState("");
  const [manualSchoolName, setManualSchoolName] = useState("");
  const [sourceSchoolQuery, setSourceSchoolQuery] = useState("");
  const [sourceSchoolCandidates, setSourceSchoolCandidates] = useState<GaokaoSchoolCandidate[]>([]);

  const buildSourceQuery = (overrides: Partial<{ universityId: string; sourceKind: string; status: string; year: string; province: string; subject: string; limit: string }> = {}) => {
    const params = new URLSearchParams({ limit: overrides.limit ?? "20" });
    const universityId = overrides.universityId ?? sourceUniversityId;
    const kind = overrides.sourceKind ?? sourceKind;
    const statusValue = overrides.status ?? sourceStatus;
    const yearValue = overrides.year ?? sourceYear;
    const provinceValue = overrides.province ?? sourceProvince;
    const subjectValue = overrides.subject ?? sourceSubject;
    if (universityId) params.set("universityId", universityId);
    if (kind) params.set("sourceKind", kind);
    if (statusValue) params.set("status", statusValue);
    if (yearValue) params.set("year", yearValue);
    if (provinceValue) params.set("province", provinceValue);
    if (subjectValue) params.set("subject", subjectValue);
    return params;
  };

  const loadSourceRows = async (overrides: Partial<{ universityId: string; sourceKind: string; status: string; year: string; province: string; subject: string; limit: string }> = {}) => {
    const rows = await api<AdmissionSourceSnapshot[]>(`/api/admissions/sources?${buildSourceQuery(overrides).toString()}`);
    setSources(rows);
    return rows;
  };

  const buildJobsQuery = (overrides: Partial<{ status: string; jobType: string; limit: string }> = {}) => {
    const params = new URLSearchParams({ limit: overrides.limit ?? "30" });
    const statusValue = overrides.status ?? jobStatus;
    const jobTypeValue = overrides.jobType ?? jobType;
    if (statusValue) params.set("status", statusValue);
    if (jobTypeValue) params.set("jobType", jobTypeValue);
    return params;
  };

  const buildCoverageGapQuery = (settingsData: Record<string, string | boolean>) => {
    const params = new URLSearchParams({ limit: "24" });
    const planYears = String(settingsData["sync.gaokaoCnPlanYears"] ?? "");
    const scoreYears = String(settingsData["sync.gaokaoCnScoreYears"] ?? "");
    const provinces = String(settingsData["sync.gaokaoCnProvinces"] ?? "");
    const subjectTypes = String(settingsData["sync.gaokaoCnSubjectTypes"] ?? "");
    if (planYears) params.set("planYears", planYears);
    if (scoreYears) params.set("scoreYears", scoreYears);
    if (provinces) params.set("provinces", provinces);
    if (subjectTypes) params.set("subjectTypes", subjectTypes);
    return params;
  };

  const load = async () => {
    const [settingsData, schedulerData, coverageData, unmappedData, issueData, mappingData, jobData, failedJobData, sourceData, xuefengCacheData, universityData] = await Promise.all([
      api<Record<string, string | boolean>>("/api/settings"),
      api<SyncSchedulerStatus>("/api/sync-scheduler"),
      api<AdmissionCoverage>("/api/admissions/coverage"),
      api<AdmissionUnmappedUniversity[]>(`/api/admissions/unmapped?query=${encodeURIComponent(schoolQuery)}&limit=30`),
      api<AdmissionMappingIssue[]>(`/api/admissions/mapping-issues?query=${encodeURIComponent(schoolQuery)}&limit=30`),
      api<AdmissionMapping[]>(`/api/admissions/mappings?query=${encodeURIComponent(schoolQuery)}&limit=80`),
      api<AdmissionSyncJob[]>(`/api/admissions/jobs?${buildJobsQuery().toString()}`),
      api<AdmissionSyncJob[]>("/api/admissions/jobs/failed?limit=10"),
      api<AdmissionSourceSnapshot[]>(`/api/admissions/sources?${buildSourceQuery().toString()}`),
      api<XuefengAgentCacheStatus>("/api/data/xuefeng-agent-cache"),
      api<University[]>(`/api/universities?query=${encodeURIComponent(schoolQuery)}&limit=120`)
    ]);
    const coverageGapData = await api<AdmissionCoverageGap[]>(`/api/admissions/coverage-gaps?${buildCoverageGapQuery(settingsData).toString()}`);
    setSettings(settingsData);
    setScheduler(schedulerData);
    setCoverage(coverageData);
    setCoverageGaps(coverageGapData);
    setUnmapped(unmappedData);
    setMappingIssues(issueData);
    setMappings(mappingData);
    setJobs(jobData);
    setFailedJobs(failedJobData);
    setSources(sourceData);
    setXuefengAgentCache(xuefengCacheData);
    setUniversities(universityData);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const updateSetting = (key: string, value: string | boolean) => setSettings((current) => ({ ...current, [key]: value }));

  const saveSettings = async () => {
    setStatus("保存招生同步设置中...");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      await load();
      setStatus("招生同步设置已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const syncGaokao = async (singleUniversityId?: number) => {
    setStatus("掌上高考同步中，学校和省份较多时会需要一会儿...");
    try {
      const skipExisting = settings["sync.gaokaoCnSkipExisting"] !== "false";
      const requestDelayMs = parseOptionalNumberSetting(settings["sync.gaokaoCnRequestDelayMs"]);
      const maxSourceRequests = parseOptionalNumberSetting(settings["sync.gaokaoCnMaxRequestsPerRun"]);
      const result = await api<{ mapped: number; total: number; candidateTotal: number; offset: number; nextOffset: number; planRows: number; planSummaryRows?: number; majorPlanRows?: number; schoolScoreRows: number; majorScoreRows: number; sourceRequests?: number; sourceRequestBudget?: number | null; requestBudgetExhausted?: boolean; skippedRequests?: number; errors: unknown[] }>("/api/data/sync-gaokao-cn", {
        method: "POST",
        body: JSON.stringify({
          query: singleUniversityId ? undefined : schoolQuery,
          universityId: singleUniversityId,
          limit: Number(syncLimit) || Number(settings["sync.gaokaoCnLimit"] ?? "1") || 1,
          offset: singleUniversityId ? 0 : Number(syncOffset) || 0,
          provinces: manualProvince || String(settings["sync.gaokaoCnProvinces"] ?? ""),
          subjectTypes: manualSubjectTypes || String(settings["sync.gaokaoCnSubjectTypes"] ?? ""),
          scoreYears: manualScoreYears || String(settings["sync.gaokaoCnScoreYears"] ?? ""),
          planYears: manualPlanYears || String(settings["sync.gaokaoCnPlanYears"] ?? ""),
          includePlans: manualIncludePlans,
          includePlanDetails: manualIncludePlans && manualIncludePlanDetails,
          includeScores: manualIncludeScores,
          includeSpecialScores: manualIncludeScores && manualIncludeSpecialScores,
          eligibleOnly: settings["sync.gaokaoCnEligibleOnly"] !== "false",
          requestDelayMs,
          maxSourceRequests,
          skipExisting
        })
      });
      const budgetText = result.requestBudgetExhausted ? `，请求预算 ${result.sourceRequests ?? 0}/${result.sourceRequestBudget ?? "不限"} 已用完，offset 保持不变` : "";
      const skipHint = result.requestBudgetExhausted && !skipExisting ? "；当前未开启“跳过已有覆盖”，下轮可能重复抓同一批数据，建议开启后再继续" : "";
      const rateLimited = hasGaokaoRateLimitErrors(result.errors);
      const prefix = rateLimited ? "同步已触发掌上高考限流，当前批次已停止" : result.errors.length ? "同步结束但有失败" : "同步完成";
      const errorText = result.errors.length
        ? `，失败 ${result.errors.length} 个，${rateLimited ? "已进入共享冷却，冷却结束后再继续" : "已保留当前 offset 便于重试"}${formatGaokaoSyncErrorPreview(result.errors)}`
        : "";
      setStatus(`${prefix}：本批 ${result.total}/${result.candidateTotal || result.total} 所，offset ${result.offset} → ${result.nextOffset}，映射 ${result.mapped}，计划 ${formatPlanRowBreakdown(result)}，院校线 ${result.schoolScoreRows}，专业线 ${result.majorScoreRows}，跳过已有 ${result.skippedRequests ?? 0} 个请求${budgetText}${skipHint}${errorText}`);
      if (!singleUniversityId && !result.errors.length && !result.requestBudgetExhausted) setSyncOffset(String(result.nextOffset));
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const syncJiangsuOfficial = async () => {
    const subject = jiangsuOfficialSubject.trim();
    const year = jiangsuOfficialYear.trim() || "2025";
    const pageUrl = jiangsuOfficialPageUrl.trim();
    const pdfUrl = jiangsuOfficialPdfUrl.trim();
    const excelUrl = jiangsuOfficialExcelUrl.trim();
    if (!subject && (year !== "2025" || pageUrl || pdfUrl || excelUrl)) {
      setStatus("自定义江苏官方来源时，请先选择物理类或历史类。");
      return;
    }
    setStatus("江苏考试院官方文件同步中...");
    try {
      const body: Record<string, unknown> = {
        query: schoolQuery,
        limit: Number(jiangsuOfficialLimit) || undefined
      };
      if (subject) {
        body.subjectType = subject;
        body.year = Number(year) || 2025;
      }
      if (pageUrl) body.pageUrl = pageUrl;
      if (pdfUrl) body.pdfUrl = pdfUrl;
      if (excelUrl) body.excelUrl = excelUrl;
      const result = await api<{ total: number; mapped: number; scoreRows: number; sourceRows: number; skipped: number; errors: unknown[] }>("/api/data/sync-jiangsu-official", {
        method: "POST",
        body: JSON.stringify(body)
      });
      const nextSourceYear = subject ? year : "";
      setSourceKind("");
      setSourceYear(nextSourceYear);
      setSourceProvince("江苏");
      setSourceSubject(subject);
      await load();
      await loadSourceRows({
        sourceKind: "",
        year: nextSourceYear,
        province: "江苏",
        subject
      });
      const errorText = result.errors.length ? `，失败 ${result.errors.length} 个：${formatGaokaoSyncErrorPreview(result.errors)}` : "";
      setStatus(`江苏考试院官方同步完成：来源快照 ${result.sourceRows}，解析 ${result.total} 行，入库 ${result.scoreRows} 条，映射 ${result.mapped}，跳过 ${result.skipped}${errorText}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const syncJiangsuOfficialPlans = async () => {
    setStatus("江苏高校官网招生计划同步中...");
    try {
      const result = await api<{ total: number; mapped: number; planRows: number; sourceRows: number; skipped: number; errors: unknown[] }>("/api/data/sync-jiangsu-official-plans", {
        method: "POST",
        body: JSON.stringify({
          query: schoolQuery,
          limit: Number(jiangsuOfficialLimit) || undefined
        })
      });
      setSourceKind("");
      setSourceYear("2026");
      setSourceProvince("江苏");
      setSourceSubject("");
      await load();
      await loadSourceRows({
        year: "2026",
        province: "江苏"
      });
      const errorText = result.errors.length ? `，失败 ${result.errors.length} 个：${formatGaokaoSyncErrorPreview(result.errors)}` : "";
      setStatus(`江苏高校官网计划同步完成：来源快照 ${result.sourceRows}，解析 ${result.total} 行，入库计划 ${result.planRows} 条，映射 ${result.mapped}，跳过 ${result.skipped}${errorText}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const downloadXuefengAgent = async () => {
    setStatus("雪峰 Agent 数据库开始后台下载；这一步只缓存 SQLite，不会创建同步任务。");
    try {
      const body: Record<string, unknown> = { background: true };
      if (xuefengAgentUrl.trim()) body.url = xuefengAgentUrl.trim();
      const result = await api<{
        queued?: boolean;
        running?: boolean;
        message?: string;
        status?: XuefengAgentCacheStatus;
        dbPath?: string;
        gzPath?: string;
        dbExists?: boolean;
        gzExists?: boolean;
        downloaded?: boolean;
        error?: string | null;
      }>("/api/data/download-xuefeng-agent", {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (result.status) setXuefengAgentCache(result.status);
      setStatus(result.message || "雪峰 Agent 数据库下载已启动，请稍后刷新缓存状态。");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const syncXuefengAgent = async () => {
    setStatus("雪峰 Agent 历史投档线导入中；这一步会写入本地招生表，后台任务里可以查看进度。");
    try {
      const body: Record<string, unknown> = {
        query: schoolQuery || undefined,
        provinces: manualProvince || undefined,
        years: manualScoreYears || undefined,
        limit: Number(xuefengAgentLimit) || undefined,
        offset: Number(xuefengAgentOffset) || undefined,
        background: true
      };
      if (xuefengAgentUrl.trim()) body.url = xuefengAgentUrl.trim();
      if (xuefengAgentDbPath.trim()) body.dbPath = xuefengAgentDbPath.trim();
      const result = await api<{
        queued?: boolean;
        message?: string;
        total: number;
        candidateTotal: number;
        offset: number;
        nextOffset: number;
        mapped: number;
        scoreRows: number;
        schoolScoreRows: number;
        majorScoreRows: number;
        sourceRows: number;
        unmapped: number;
        skipped: number;
        downloaded: boolean;
        errors: unknown[];
      }>("/api/data/sync-xuefeng-agent", {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (result.queued) {
        await load();
        setJobStatus("running");
        setJobType("sync-score");
        setStatus(result.message || "雪峰 Agent 导入已在后台启动，请稍后刷新同步任务查看进度。");
        return;
      }
      setSourceKind("xuefeng-agent-sqlite");
      setSourceYear(firstListValue(manualScoreYears) || "");
      setSourceProvince(firstListValue(manualProvince) || "");
      setSourceSubject("");
      if (result.nextOffset) setXuefengAgentOffset(String(result.nextOffset));
      await load();
      await loadSourceRows({ sourceKind: "xuefeng-agent-sqlite" });
      const errorText = result.errors.length ? `，未匹配 ${result.unmapped} 所/行，示例 ${formatGaokaoSyncErrorPreview(result.errors)}` : "";
      const downloadText = result.downloaded ? "，已下载并缓存数据库" : "";
      setStatus(`雪峰 Agent 导入完成：处理 ${result.total}/${result.candidateTotal} 行，入库 ${result.scoreRows} 条（院校线 ${result.schoolScoreRows}，专业线 ${result.majorScoreRows}），映射 ${result.mapped}，跳过 ${result.skipped}，next offset ${result.nextOffset}${downloadText}${errorText}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const fillSyncFromCoverageGap = (gap: AdmissionCoverageGap) => {
    setManualProvince(gap.provinceName);
    setManualSubjectTypes(gap.subjectType ?? "");
    setSyncOffset("0");
    if (gap.kind === "plan" || gap.kind === "major_plan") {
      setManualIncludePlans(true);
      setManualIncludePlanDetails(gap.kind === "major_plan");
      setManualIncludeScores(false);
      setManualIncludeSpecialScores(false);
      setManualPlanYears(String(gap.year));
      setManualScoreYears("");
    } else {
      setManualIncludePlans(false);
      setManualIncludePlanDetails(false);
      setManualIncludeScores(true);
      setManualIncludeSpecialScores(gap.kind === "major_score");
      setManualPlanYears("");
      setManualScoreYears(String(gap.year));
    }
    setStatus(`已填入 ${gap.provinceName} ${gap.subjectType ?? "自动科类"} ${gap.year} ${formatCoverageGapKind(gap.kind)} 的同步条件，可在手动同步区直接执行。`);
  };

  const loadCoverageGapMissing = async (gap: AdmissionCoverageGap) => {
    fillSyncFromCoverageGap(gap);
    setCoverageMissingGap(gap);
    setStatus(`读取 ${gap.provinceName} ${gap.year} ${formatCoverageGapKind(gap.kind)} 缺口学校...`);
    try {
      const params = new URLSearchParams({
        kind: gap.kind,
        year: String(gap.year),
        province: gap.provinceName,
        limit: "80"
      });
      if (gap.subjectType) params.set("subjectType", gap.subjectType);
      const rows = await api<AdmissionCoverageMissingUniversity[]>(`/api/admissions/coverage-gaps/missing?${params.toString()}`);
      setCoverageMissingRows(rows);
      setStatus(`缺口学校已读取：${rows.length} 所；同步条件已填入手动同步区。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const resetGaokaoProgress = async (target: "plan" | "score") => {
    const label = target === "plan" ? "计划" : "分数";
    setStatus(`重置掌上高考${label}同步进度中...`);
    try {
      await api("/api/sync-scheduler/gaokao-cn/reset", {
        method: "POST",
        body: JSON.stringify({ target })
      });
      await load();
      setStatus(`掌上高考${label}同步进度已重置，下次定时同步将从 offset 0 开始。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const runQuery = async () => {
    setStatus("查询招生数据...");
    try {
      const params = new URLSearchParams();
      if (queryUniversityId) params.set("universityId", queryUniversityId);
      else if (querySchool) params.set("university", querySchool);
      if (queryProvince) params.set("province", queryProvince);
      if (querySubject) params.set("subject", querySubject);
      if (queryYears) params.set("years", queryYears);
      if (queryBatch) params.set("batch", queryBatch);
      if (queryPlanGroup) params.set("planGroup", queryPlanGroup);
      if (queryScoreType) params.set("scoreType", queryScoreType);
      if (queryMajor) params.set("major", queryMajor);
      params.set("limit", "120");
      const result = await api<{ plans: AdmissionPlan[]; scores: AdmissionScore[] }>(`/api/admissions/query?${params.toString()}`);
      setPlans(result.plans);
      setScores(result.scores);
      const sourceYearValue = firstListValue(queryYears);
      if (queryUniversityId) setSourceUniversityId(queryUniversityId);
      if (sourceYearValue) setSourceYear(sourceYearValue);
      if (queryProvince) setSourceProvince(queryProvince);
      if (querySubject) setSourceSubject(querySubject);
      await loadSourceRows({
        universityId: queryUniversityId || sourceUniversityId,
        year: sourceYearValue || sourceYear,
        province: queryProvince || sourceProvince,
        subject: querySubject || sourceSubject
      });
      setStatus(`查询完成：计划 ${result.plans.length} 条，分数 ${result.scores.length} 条`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshSources = async () => {
    setStatus("筛选来源快照中...");
    try {
      const rows = await loadSourceRows();
      setStatus(`来源快照已更新：${rows.length} 条`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshJobs = async () => {
    setStatus("筛选同步日志中...");
    try {
      const rows = await api<AdmissionSyncJob[]>(`/api/admissions/jobs?${buildJobsQuery().toString()}`);
      setJobs(rows);
      setStatus(`同步日志已更新：${rows.length} 条`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const saveManualMapping = async () => {
    if (!manualUniversityId || !manualSchoolId) return;
    setStatus("保存学校映射中...");
    try {
      const sourceSchool = sourceSchoolCandidates.find((row) => String(row.school_id) === manualSchoolId);
      await api(`/api/admissions/mappings/${manualUniversityId}`, {
        method: "PUT",
        body: JSON.stringify({ sourceSchoolId: manualSchoolId, sourceSchoolName: manualSchoolName, sourceSchool })
      });
      setManualSchoolId("");
      setManualSchoolName("");
      await load();
      setStatus("学校映射已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const searchSourceSchools = async () => {
    const query = sourceSchoolQuery.trim() || manualSchoolName.trim();
    if (!query) {
      setStatus("先输入要搜索的学校名");
      return;
    }
    setStatus("搜索掌上高考学校中...");
    try {
      const params = new URLSearchParams({ query, limit: "12" });
      if (manualUniversityId) params.set("universityId", manualUniversityId);
      const rows = await api<GaokaoSchoolCandidate[]>(`/api/admissions/source-schools?${params.toString()}`);
      setSourceSchoolCandidates(rows);
      setStatus(rows.length ? `找到 ${rows.length} 个掌上高考候选` : "没有找到掌上高考候选");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const useSourceSchoolCandidate = (row: GaokaoSchoolCandidate) => {
    setManualSchoolId(String(row.school_id));
    setManualSchoolName(row.name);
    setStatus(`已填入 ${row.name} (${row.school_id})`);
  };

  const openSourceSnapshot = async (id: string | null) => {
    if (!id) return;
    setStatus(`读取来源快照 #${id}...`);
    try {
      const snapshot = await api<AdmissionSourceSnapshot>(`/api/admissions/sources/${encodeURIComponent(id)}`);
      setSourceSnapshot(snapshot);
      setStatus(`已读取来源快照 #${id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section>
      <Header title="招生数据" subtitle="历史缓存管理页；当前 QQBot 会对招生、志愿和专业推荐问题统一说明服务边界。" />
      <Panel title="覆盖进度" icon={<Activity size={18} />}>
        <div className="metrics">
          <Metric label="源站状态" value={formatGaokaoSourceStatus(scheduler)} tone={gaokaoSourceCooldownUntil(scheduler) ? "warn" : "good"} />
          <Metric label="有效映射" value={coverageRatio(coverage?.mappedUniversities, coverage?.totalUniversities)} tone={coverage?.unmappedUniversities ? "warn" : "good"} />
          <Metric label="待尝试" value={String(coverage?.pendingUniversities ?? 0)} tone={coverage?.pendingUniversities ? "warn" : "good"} />
          <Metric label="匹配问题" value={`${coverage?.mappingIssueUniversities ?? 0} / 未匹配 ${coverage?.unmatchedUniversities ?? 0} / 歧义 ${coverage?.ambiguousUniversities ?? 0}`} tone={coverage?.mappingIssueUniversities ? "warn" : "good"} />
          <Metric label="计划覆盖" value={coverageRatio(coverage?.planUniversities, coverage?.totalUniversities)} />
          <Metric label="专业计划覆盖" value={coverageRatio(coverage?.majorPlanUniversities, coverage?.totalUniversities)} />
          <Metric label="分数覆盖" value={coverageRatio(coverage?.scoreUniversities, coverage?.totalUniversities)} />
          <Metric label="计划行" value={String(coverage?.planRows ?? 0)} />
          <Metric label="专业计划行" value={String(coverage?.majorPlanRows ?? 0)} />
          <Metric label="分数行" value={`${coverage?.scoreRows ?? 0} / 专业线 ${coverage?.majorScoreRows ?? 0}`} />
          <Metric label="来源快照" value={String(coverage?.sourceRows ?? 0)} />
          <Metric label="失败任务" value={String(coverage?.failedJobs ?? 0)} tone={coverage?.failedJobs ? "warn" : "good"} />
        </div>
        <div className="scheduler-grid">
          <KeyValue label="最近计划" value={formatTime(coverage?.latestPlanFetchedAt)} />
          <KeyValue label="最近分数" value={formatTime(coverage?.latestScoreFetchedAt)} />
          <KeyValue label="最近来源" value={formatTime(coverage?.latestSourceFetchedAt)} />
          <KeyValue label="计划年份覆盖" value={formatCoverageYears(coverage?.planYears)} />
          <KeyValue label="分数年份覆盖" value={formatCoverageYears(coverage?.scoreYears)} />
        </div>
        <div className="table-wrap compact-table">
          <table>
            <thead><tr><th>最大缺口</th><th>年份</th><th>省份</th><th>科类</th><th>覆盖学校</th><th>缺口</th><th>行数</th><th></th></tr></thead>
            <tbody>
              {coverageGaps.map((gap) => (
                <tr key={`${gap.kind}-${gap.year}-${gap.provinceName}-${gap.subjectType ?? "auto"}`}>
                  <td>{formatCoverageGapKind(gap.kind)}</td>
                  <td>{gap.year}</td>
                  <td>{gap.provinceName}</td>
                  <td>{gap.subjectType ?? "-"}</td>
                  <td>{coverageRatio(gap.coveredUniversities, gap.totalMappedUniversities)}</td>
                  <td>{gap.missingUniversities}</td>
                  <td>{gap.rowCount}</td>
                  <td className="row-actions">
                    <button onClick={() => fillSyncFromCoverageGap(gap)}><Save size={14} />填入同步</button>
                    <button onClick={() => void loadCoverageGapMissing(gap)}><Search size={14} />缺口学校</button>
                  </td>
                </tr>
              ))}
              {!coverageGaps.length && <tr><td colSpan={8}>暂无缺口统计。</td></tr>}
            </tbody>
          </table>
        </div>
        {coverageMissingGap && (
          <div className="table-wrap compact-table">
            <table>
              <thead><tr><th>缺口学校</th><th>掌上高考</th><th>ID</th><th>映射</th><th>更新时间</th><th></th></tr></thead>
              <tbody>
                {coverageMissingRows.map((row) => (
                  <tr key={row.universityId}>
                    <td>{row.universityName}</td>
                    <td>{row.sourceSchoolName}</td>
                    <td>{row.sourceSchoolId}</td>
                    <td>{row.matchStatus}</td>
                    <td>{formatTime(row.updatedAt)}</td>
                    <td><button onClick={() => void syncGaokao(row.universityId)}><RefreshCcw size={14} />同步此校</button></td>
                  </tr>
                ))}
                {!coverageMissingRows.length && <tr><td colSpan={6}>当前缺口没有可列出的已映射学校。</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="split">
          <div className="table-wrap compact-table">
            <table>
              <thead><tr><th>待尝试学校</th><th>slug</th><th>资料时间</th><th></th></tr></thead>
              <tbody>
                {unmapped.map((school) => (
                  <tr key={school.id}>
                    <td>{school.name}</td>
                    <td>{school.slug}</td>
                    <td>{formatTime(school.updatedAt)}</td>
                    <td><button onClick={() => { setManualUniversityId(String(school.id)); setManualSchoolName(school.name); setSourceSchoolQuery(school.name); }}><Save size={14} />修正</button></td>
                  </tr>
                ))}
                {!unmapped.length && <tr><td colSpan={4}>暂无待尝试学校。</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="table-wrap compact-table">
            <table>
              <thead><tr><th>匹配问题</th><th>状态</th><th>候选名</th><th>更新时间</th><th></th></tr></thead>
              <tbody>
                {mappingIssues.map((row) => (
                  <tr key={row.universityId}>
                    <td>{row.universityName}</td>
                    <td>{row.matchStatus === "ambiguous" ? "歧义" : "未匹配"}</td>
                    <td>{row.sourceSchoolName}</td>
                    <td>{formatTime(row.updatedAt)}</td>
                    <td><button onClick={() => { setManualUniversityId(String(row.universityId)); setManualSchoolName(row.universityName); setSourceSchoolQuery(row.universityName); }}><Save size={14} />修正</button></td>
                  </tr>
                ))}
                {!mappingIssues.length && <tr><td colSpan={5}>暂无匹配问题。</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        {failedJobs.length > 0 && <AdmissionJobsTable jobs={failedJobs} emptyText="暂无失败任务。" />}
      </Panel>
      <Panel title="定期同步" icon={<RefreshCcw size={18} />}>
        <div className="toggle-row">
          <Switch label="定期同步掌上高考" checked={settings["sync.gaokaoCnAutoEnabled"] === "true"} onChange={(v) => updateSetting("sync.gaokaoCnAutoEnabled", String(v))} />
          <Switch label="仅同步中文院校候选" checked={settings["sync.gaokaoCnEligibleOnly"] !== "false"} onChange={(v) => updateSetting("sync.gaokaoCnEligibleOnly", String(v))} />
          <Switch label="跳过已有覆盖" checked={settings["sync.gaokaoCnSkipExisting"] !== "false"} onChange={(v) => updateSetting("sync.gaokaoCnSkipExisting", String(v))} />
          <Switch label="定期同步专业计划" checked={settings["sync.gaokaoCnIncludePlanDetails"] === "true"} onChange={(v) => updateSetting("sync.gaokaoCnIncludePlanDetails", String(v))} />
        </div>
        {settings["sync.gaokaoCnSkipExisting"] === "false" && (
          <p className="notice">当前没有开启“跳过已有覆盖”。全量补数据时如果请求预算暂停，下一轮会从同一 offset 重新抓，容易重复请求源站。</p>
        )}
        <FormGrid>
          <Input label="计划间隔小时" value={String(settings["sync.gaokaoCnPlanIntervalHours"] ?? DEFAULT_ADMISSION_PLAN_INTERVAL_HOURS)} onChange={(v) => updateSetting("sync.gaokaoCnPlanIntervalHours", v)} />
          <Input label="分数间隔小时" value={String(settings["sync.gaokaoCnScoreIntervalHours"] ?? DEFAULT_ADMISSION_SCORE_INTERVAL_HOURS)} onChange={(v) => updateSetting("sync.gaokaoCnScoreIntervalHours", v)} />
          <Input label="每次学校数" value={String(settings["sync.gaokaoCnLimit"] ?? "1")} onChange={(v) => updateSetting("sync.gaokaoCnLimit", v)} hint="掌上高考容易限流，建议长期保持 1；需要更快时优先缩小省份和年份。" />
          <Input label="学校范围" value={String(settings["sync.gaokaoCnQuery"] ?? "")} onChange={(v) => updateSetting("sync.gaokaoCnQuery", v)} />
          <Input label="省份范围" value={String(settings["sync.gaokaoCnProvinces"] ?? "")} onChange={(v) => updateSetting("sync.gaokaoCnProvinces", v)} hint="留空同步全国省份；填省名可限制范围。" />
          <Input label="科类范围" value={String(settings["sync.gaokaoCnSubjectTypes"] ?? "")} onChange={(v) => updateSetting("sync.gaokaoCnSubjectTypes", v)} hint="留空按省份和年份自动选择：综合改革、物理/历史或理科/文科。" />
          <Input label="分数年份" value={String(settings["sync.gaokaoCnScoreYears"] ?? DEFAULT_ADMISSION_SCORE_YEARS)} onChange={(v) => updateSetting("sync.gaokaoCnScoreYears", v)} />
          <Input label="计划年份" value={String(settings["sync.gaokaoCnPlanYears"] ?? DEFAULT_ADMISSION_PLAN_YEARS)} onChange={(v) => updateSetting("sync.gaokaoCnPlanYears", v)} />
          <Input label="每轮批次数" value={String(settings["sync.gaokaoCnBatchesPerRun"] ?? "1")} onChange={(v) => updateSetting("sync.gaokaoCnBatchesPerRun", v)} hint="定时任务每次触发时连续跑几批；源站容易限流，默认只跑 1 批。" />
          <Input label="批次间隔毫秒" value={String(settings["sync.gaokaoCnBatchDelayMs"] ?? "1800000")} onChange={(v) => updateSetting("sync.gaokaoCnBatchDelayMs", v)} hint="每轮多批同步时，批与批之间等待多久；建议不少于 1800000。" />
          <Input label="请求间隔毫秒" value={String(settings["sync.gaokaoCnRequestDelayMs"] ?? "180000")} onChange={(v) => updateSetting("sync.gaokaoCnRequestDelayMs", v)} hint="默认 180000；低于 180000 会自动按 180000 保存，频繁 1069 时继续调高。" />
          <Input label="每批请求预算" value={String(settings["sync.gaokaoCnMaxRequestsPerRun"] ?? "1")} onChange={(v) => updateSetting("sync.gaokaoCnMaxRequestsPerRun", v)} hint="每批最多启动多少个掌上高考接口；低于 1 会自动按 1 保存。" />
          <Input label="限流冷却分钟" value={String(settings["sync.gaokaoCnRateLimitCooldownMinutes"] ?? "1440")} onChange={(v) => updateSetting("sync.gaokaoCnRateLimitCooldownMinutes", v)} hint="遇到 1069 后定时任务和手动同步都会暂停源站请求。" />
          <Input label="失败重试次数" value={String(settings["sync.gaokaoCnRetryLimit"] ?? "1")} onChange={(v) => updateSetting("sync.gaokaoCnRetryLimit", v)} hint="仅普通错误会延迟重试；1069 限流不会重试，只进入冷却。" />
        </FormGrid>
        <div className="scheduler-grid">
          <KeyValue label="计划状态" value={formatGaokaoSchedulerState(scheduler?.jobs.gaokaoCnPlan)} />
          <KeyValue label="计划下次" value={formatScheduleTime(scheduler?.jobs.gaokaoCnPlan.nextRunAt)} />
          <KeyValue label="计划冷却到" value={formatScheduleTime(scheduler?.jobs.gaokaoCnPlan.cooldownUntil)} />
          <KeyValue label="计划待重试到" value={formatScheduleTime(scheduler?.jobs.gaokaoCnPlan.retryAt)} />
          <KeyValue label="分数状态" value={formatGaokaoSchedulerState(scheduler?.jobs.gaokaoCnScore)} />
          <KeyValue label="分数下次" value={formatScheduleTime(scheduler?.jobs.gaokaoCnScore.nextRunAt)} />
          <KeyValue label="分数冷却到" value={formatScheduleTime(scheduler?.jobs.gaokaoCnScore.cooldownUntil)} />
          <KeyValue label="分数待重试到" value={formatScheduleTime(scheduler?.jobs.gaokaoCnScore.retryAt)} />
          <KeyValue label="计划最近" value={formatTime(scheduler?.jobs.gaokaoCnPlan.lastFinishedAt)} />
          <KeyValue label="分数最近" value={formatTime(scheduler?.jobs.gaokaoCnScore.lastFinishedAt)} />
          <KeyValue label="计划下一批 offset" value={String(scheduler?.jobs.gaokaoCnPlan.cursorOffset ?? 0)} />
          <KeyValue label="分数下一批 offset" value={String(scheduler?.jobs.gaokaoCnScore.cursorOffset ?? 0)} />
          <KeyValue label="计划错误" value={scheduler?.jobs.gaokaoCnPlan.lastError ?? "-"} />
          <KeyValue label="分数错误" value={scheduler?.jobs.gaokaoCnScore.lastError ?? "-"} />
          <KeyValue label="计划最近批次" value={formatGaokaoLastResult(scheduler?.jobs.gaokaoCnPlan.lastResult)} />
          <KeyValue label="分数最近批次" value={formatGaokaoLastResult(scheduler?.jobs.gaokaoCnScore.lastResult)} />
        </div>
        <div className="actions">
          <button className="primary" onClick={saveSettings}><Save size={16} />保存设置</button>
          <button onClick={() => void resetGaokaoProgress("plan")}><RefreshCcw size={16} />重置计划进度</button>
          <button onClick={() => void resetGaokaoProgress("score")}><RefreshCcw size={16} />重置分数进度</button>
        </div>
      </Panel>

      <Panel title="手动同步" icon={<RefreshCcw size={18} />}>
        <p className="notice">优先使用江苏考试院官方文件补院校投档线，并用当年逐分段表换算最低投档位次；掌上高考保留为历史缓存补充，遇到 1069 时不要连续重试。</p>
        <FormGrid>
          <Input label="官方源学校搜索" value={schoolQuery} onChange={setSchoolQuery} hint="留空同步已适配官方来源的全部学校；填学校名可只补该校。" />
          <Input label="官方源年份" value={jiangsuOfficialYear} onChange={setJiangsuOfficialYear} hint="留空科类时同步内置近三年物理+历史；选择科类后按年份同步单个来源。" />
          <label className="field">
            <span>官方源科类</span>
            <select value={jiangsuOfficialSubject} onChange={(event) => setJiangsuOfficialSubject(event.target.value)}>
              <option value="">物理类 + 历史类</option>
              <option value="物理类">物理类</option>
              <option value="历史类">历史类</option>
            </select>
          </label>
          <Input label="官方源入库上限" value={jiangsuOfficialLimit} onChange={setJiangsuOfficialLimit} hint="留空不限制；临时调试时可填较小数值。" />
          <Input label="官方页面 URL" value={jiangsuOfficialPageUrl} onChange={setJiangsuOfficialPageUrl} hint="可选；填写后会从页面解析 PDF/xls/xlsx 链接。" />
          <Input label="官方 PDF URL" value={jiangsuOfficialPdfUrl} onChange={setJiangsuOfficialPdfUrl} hint="可选；直接指定考试院 PDF。" />
          <Input label="官方 Excel URL" value={jiangsuOfficialExcelUrl} onChange={setJiangsuOfficialExcelUrl} hint="可选；直接指定考试院 xls/xlsx。" />
        </FormGrid>
        <div className="actions">
          <button className="primary" onClick={() => void syncJiangsuOfficial()}><RefreshCcw size={16} />同步江苏官方源</button>
          <button onClick={() => void syncJiangsuOfficialPlans()}><RefreshCcw size={16} />同步江苏高校官方计划</button>
        </div>
        <p className="notice">雪峰 Agent 历史库主要补 2024-2025 投档线/位次，用来判断专业组门槛；具体“专业组里有什么专业”仍要看招生计划明细，缺专业计划时不会用它硬推荐具体专业。</p>
        <FormGrid>
          <Input label="雪峰库下载 URL" value={xuefengAgentUrl} onChange={setXuefengAgentUrl} hint="可选；留空使用内置 GitHub 地址。国内服务器可填镜像后的 admission_clean.db.gz 地址。" />
          <Input label="本地 SQLite 路径" value={xuefengAgentDbPath} onChange={setXuefengAgentDbPath} hint="可选；已手动下载 admission_clean.db 时填写。" />
          <Input label="导入行数上限" value={xuefengAgentLimit} onChange={setXuefengAgentLimit} hint="留空全量导入；调试时可填 1000。" />
          <Input label="导入 offset" value={xuefengAgentOffset} onChange={setXuefengAgentOffset} hint="分批导入时使用；完成后会自动填入下一批 offset。" />
        </FormGrid>
        {xuefengAgentCache && (
          <p className="notice">
            雪峰库缓存：{xuefengAgentCache.running ? "下载/解压中" : xuefengAgentCache.dbExists ? "SQLite 已缓存" : xuefengAgentCache.gzExists ? "压缩包已缓存，待解压" : "未缓存"}
            {xuefengAgentCache.dbPath ? `；路径 ${xuefengAgentCache.dbPath}` : ""}
            {xuefengAgentCache.finishedAt ? `；最近完成 ${formatTime(xuefengAgentCache.finishedAt)}` : ""}
            {xuefengAgentCache.error ? `；错误 ${xuefengAgentCache.error}` : ""}
          </p>
        )}
        <div className="actions">
          <button className="primary" onClick={() => void downloadXuefengAgent()}><RefreshCcw size={16} />下载雪峰数据库</button>
          <button onClick={() => void syncXuefengAgent()}><RefreshCcw size={16} />导入雪峰历史库</button>
        </div>
        {gaokaoSourceCooldownUntil(scheduler) && (
          <p className="notice">
            掌上高考源站正在限流冷却中，预计 {formatScheduleTime(gaokaoSourceCooldownUntil(scheduler))} 后恢复；冷却期手动同步不会继续请求源站，会优先保留当前 offset。
          </p>
        )}
        <FormGrid>
          <Input label="学校搜索" value={schoolQuery} onChange={setSchoolQuery} />
          <Input label="只同步省份" value={manualProvince} onChange={setManualProvince} hint="留空使用定期设置；定期省份为空时同步全国。" />
          <Input label="只同步科类" value={manualSubjectTypes} onChange={setManualSubjectTypes} hint="留空按省份和年份自动选择。" />
          <Input label="只同步计划年份" value={manualPlanYears} onChange={setManualPlanYears} hint="留空使用定期设置。" />
          <Input label="只同步分数年份" value={manualScoreYears} onChange={setManualScoreYears} hint="留空使用定期设置。" />
          <Input label="同步学校数" value={syncLimit} onChange={setSyncLimit} />
          <Input label="起始 offset" value={syncOffset} onChange={setSyncOffset} />
        </FormGrid>
        <div className="toggle-row">
          <Switch label="同步招生计划" checked={manualIncludePlans} onChange={setManualIncludePlans} />
          <Switch label="同步专业计划" checked={manualIncludePlans && manualIncludePlanDetails} onChange={(v) => { setManualIncludePlanDetails(v); if (v) setManualIncludePlans(true); }} />
          <Switch label="同步院校线" checked={manualIncludeScores} onChange={setManualIncludeScores} />
          <Switch label="同步专业线" checked={manualIncludeScores && manualIncludeSpecialScores} onChange={setManualIncludeSpecialScores} />
        </div>
        <div className="actions">
          <button onClick={() => void load()}><Search size={16} />刷新列表</button>
          <button onClick={() => void syncGaokao()}><RefreshCcw size={16} />同步掌上高考缓存</button>
        </div>
        {status && <p className="notice">{status}</p>}
      </Panel>

      <div className="split">
        <Panel title="学校映射" icon={<Database size={18} />}>
          <div className="table-wrap compact-table">
            <table>
              <thead><tr><th>本地学校</th><th>掌上高考</th><th>ID</th><th>状态</th><th></th></tr></thead>
              <tbody>
                {mappings.map((row) => (
                  <tr key={row.universityId}>
                    <td>{row.universityName}</td>
                    <td>{row.sourceSchoolName}</td>
                    <td>{row.sourceSchoolId}</td>
                    <td>{row.matchStatus}</td>
                    <td><button onClick={() => void syncGaokao(row.universityId)}><RefreshCcw size={14} />同步</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="手动修正映射" icon={<Save size={18} />}>
          <label className="field">
            <span>本地学校</span>
            <select
              value={manualUniversityId}
              onChange={(event) => {
                const value = event.target.value;
                setManualUniversityId(value);
                const school = universities.find((item) => String(item.id) === value);
                if (school) {
                  setManualSchoolName(school.name);
                  setSourceSchoolQuery(school.name);
                }
              }}
            >
              <option value="">选择学校</option>
              {universities.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
          </label>
          <FormGrid>
            <Input label="掌上高考搜索" value={sourceSchoolQuery} onChange={setSourceSchoolQuery} />
            <Input label="掌上高考 school_id" value={manualSchoolId} onChange={setManualSchoolId} />
            <Input label="掌上高考学校名" value={manualSchoolName} onChange={setManualSchoolName} />
          </FormGrid>
          <div className="actions">
            <button onClick={searchSourceSchools}><Search size={16} />搜索掌上高考</button>
            <button className="primary" onClick={saveManualMapping}><Save size={16} />保存映射</button>
          </div>
          {sourceSchoolCandidates.length > 0 && (
            <div className="table-wrap compact-table">
              <table>
                <thead><tr><th>ID</th><th>学校</th><th>地区</th><th>层次/类型</th><th></th></tr></thead>
                <tbody>
                  {sourceSchoolCandidates.map((row) => (
                    <tr key={String(row.school_id)}>
                      <td>{row.school_id}</td>
                      <td>{row.name}</td>
                      <td>{[row.province_name, row.city_name].filter(Boolean).join(" ") || "-"}</td>
                      <td>{[row.level_name, row.type_name, row.nature_name, row.f985 ? "985" : null, row.f211 ? "211" : null, row.dual_class_name].filter(Boolean).join(" / ") || "-"}</td>
                      <td><button onClick={() => useSourceSchoolCandidate(row)}><Save size={14} />使用</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="招生数据查询" icon={<Search size={18} />}>
        <FormGrid>
          <label className="field">
            <span>学校</span>
            <select value={queryUniversityId} onChange={(event) => setQueryUniversityId(event.target.value)}>
              <option value="">按学校名搜索或全部</option>
              {universities.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
          </label>
          <Input label="学校名搜索" value={querySchool} onChange={setQuerySchool} hint="不选上方学校时生效，可输入简称或完整校名。" />
          <Input label="省份" value={queryProvince} onChange={setQueryProvince} />
          <Input label="科类" value={querySubject} onChange={setQuerySubject} />
          <Input label="年份" value={queryYears} onChange={setQueryYears} />
          <Input label="批次" value={queryBatch} onChange={setQueryBatch} />
          <Input label="专业组" value={queryPlanGroup} onChange={setQueryPlanGroup} />
          <label className="field">
            <span>分数类型</span>
            <select value={queryScoreType} onChange={(event) => setQueryScoreType(event.target.value)}>
              <option value="">全部类型</option>
              <option value="school">院校线</option>
              <option value="major">专业线</option>
            </select>
          </label>
          <Input label="专业" value={queryMajor} onChange={setQueryMajor} />
        </FormGrid>
        <div className="actions"><button className="primary" onClick={runQuery}><Search size={16} />查询</button></div>
      </Panel>

      <div className="logs-grid">
        <Panel title="招生计划" icon={<Database size={18} />}>
          <div className="table-wrap compact-table">
            <table>
              <thead><tr><th>学校</th><th>年份</th><th>省份</th><th>科类</th><th>批次/组</th><th>专业</th><th>计划</th><th>学费</th><th>学制</th><th>校区</th><th>选科</th><th>来源</th><th>抓取时间</th></tr></thead>
              <tbody>
                {plans.map((row) => (
                  <tr key={row.id}>
                    <td>{row.universityName}</td>
                    <td>{row.year}</td>
                    <td>{row.provinceName}</td>
                    <td>{row.subjectType ?? "-"}</td>
                    <td>{[row.batch, row.planGroup].filter(Boolean).join(" ") || "-"}</td>
                    <td>{row.majorName ?? "院校汇总"}</td>
                    <td>{row.planCount ?? row.schoolPlanCount ?? "-"}</td>
                    <td>{row.tuition ?? "-"}</td>
                    <td>{row.duration ?? "-"}</td>
                    <td>{row.campus ?? "-"}</td>
                    <td>{row.selectionRequirements ?? "-"}</td>
                    <td>{row.sourceRecordId ? <button onClick={() => void openSourceSnapshot(row.sourceRecordId)}>#{row.sourceRecordId}</button> : "-"}</td>
                    <td>{formatTime(row.fetchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="分数线与位次" icon={<Database size={18} />}>
          <div className="table-wrap compact-table">
            <table>
              <thead><tr><th>学校</th><th>年份</th><th>类型</th><th>科类</th><th>批次/组</th><th>专业</th><th>最低分</th><th>最低位次</th><th>平均分</th><th>平均位次</th><th>最高分</th><th>计划</th><th>省控线</th><th>线差</th><th>选科</th><th>来源</th><th>抓取时间</th></tr></thead>
              <tbody>
                {scores.map((row) => (
                  <tr key={row.id}>
                    <td>{row.universityName}</td>
                    <td>{row.year}</td>
                    <td>{row.scoreType === "major" ? "专业线" : "院校线"}</td>
                    <td>{row.subjectType ?? "-"}</td>
                    <td>{[row.batch, row.planGroup].filter(Boolean).join(" ") || "-"}</td>
                    <td>{row.majorName ?? "-"}</td>
                    <td>{row.minScore ?? "-"}</td>
                    <td>{row.minRank ?? "-"}</td>
                    <td>{row.avgScore ?? "-"}</td>
                    <td>{row.avgRank ?? "-"}</td>
                    <td>{row.maxScore ?? "-"}</td>
                    <td>{admissionScorePlanCount(row, plans) ?? "-"}</td>
                    <td>{row.controlScore ?? "-"}</td>
                    <td>{row.diffScore ?? "-"}</td>
                    <td>{row.selectionRequirements ?? "-"}</td>
                    <td>{row.sourceRecordId ? <button onClick={() => void openSourceSnapshot(row.sourceRecordId)}>#{row.sourceRecordId}</button> : "-"}</td>
                    <td>{formatTime(row.fetchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="来源快照" icon={<Database size={18} />}>
        <FormGrid>
          <label className="field">
            <span>来源学校</span>
            <select value={sourceUniversityId} onChange={(event) => setSourceUniversityId(event.target.value)}>
              <option value="">全部学校</option>
              {universities.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>来源类型</span>
            <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}>
              <option value="">全部类型</option>
              <option value="school-search">学校搜索</option>
              <option value="school-profile">学校画像</option>
              <option value="plan-school-summary">计划汇总</option>
              <option value="plan-major">计划专业</option>
              <option value="score-school">院校分数</option>
              <option value="score-major">专业分数</option>
              <option value="jiangsu-eea-score-pdf">江苏省考试院投档线 PDF</option>
              <option value="jiangsu-eea-score-excel">江苏省考试院投档线 Excel</option>
              <option value="jiangsu-eea-rank-image">江苏省考试院逐分段表</option>
              <option value="jiangsu-school-plan-html">江苏高校官网招生计划 HTML</option>
              <option value="jiangsu-school-plan-json">江苏高校官网招生计划 JSON</option>
              <option value="xuefeng-agent-sqlite">雪峰 Agent 历史 SQLite</option>
            </select>
          </label>
          <label className="field">
            <span>状态</span>
            <select value={sourceStatus} onChange={(event) => setSourceStatus(event.target.value)}>
              <option value="">全部状态</option>
              <option value="success">成功</option>
              <option value="error">失败</option>
            </select>
          </label>
          <Input label="请求年份" value={sourceYear} onChange={setSourceYear} />
          <Input label="请求省份" value={sourceProvince} onChange={setSourceProvince} />
          <Input label="请求科类" value={sourceSubject} onChange={setSourceSubject} />
        </FormGrid>
        <div className="actions">
          <button onClick={() => void refreshSources()}><Search size={16} />筛选来源</button>
        </div>
        <div className="table-wrap compact-table">
          <table>
            <thead><tr><th>ID</th><th>学校</th><th>类型</th><th>状态</th><th>来源学校 ID</th><th>请求条件</th><th>抓取时间</th><th>错误</th><th></th></tr></thead>
            <tbody>
              {sources.map((row) => (
                <tr key={row.id}>
                  <td>#{row.id}</td>
                  <td>{row.universityName ?? "-"}</td>
                  <td>{formatAdmissionSourceKind(row.sourceKind)}</td>
                  <td>{row.status}</td>
                  <td>{row.sourceSchoolId ?? "-"}</td>
                  <td>{formatAdmissionSourceRequest(row.requestJson)}</td>
                  <td>{formatTime(row.fetchedAt)}</td>
                  <td>{row.error ?? "-"}</td>
                  <td><button onClick={() => void openSourceSnapshot(String(row.id))}><Search size={14} />查看</button></td>
                </tr>
              ))}
              {!sources.length && <tr><td colSpan={9}>暂无来源快照。</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="同步日志" icon={<Bot size={18} />}>
        <FormGrid>
          <label className="field">
            <span>任务类型</span>
            <select value={jobType} onChange={(event) => setJobType(event.target.value)}>
              <option value="">全部类型</option>
              <option value="sync-plan">招生计划</option>
              <option value="sync-score">分数线</option>
              <option value="sync-mixed">计划+分数</option>
              <option value="sync-mapping">学校映射</option>
            </select>
          </label>
          <label className="field">
            <span>状态</span>
            <select value={jobStatus} onChange={(event) => setJobStatus(event.target.value)}>
              <option value="">全部状态</option>
              <option value="running">运行中</option>
              <option value="success">成功</option>
              <option value="error">失败</option>
            </select>
          </label>
        </FormGrid>
        <div className="actions">
          <button onClick={() => void refreshJobs()}><Search size={16} />筛选日志</button>
        </div>
        <AdmissionJobsTable jobs={jobs} emptyText="暂无同步任务。" />
      </Panel>
      {sourceSnapshot && (
        <Panel title={`来源快照 #${sourceSnapshot.id}`} icon={<Database size={18} />}>
          <div className="scheduler-grid">
            <KeyValue label="学校" value={sourceSnapshot.universityName ?? "-"} />
            <KeyValue label="来源类型" value={formatAdmissionSourceKind(sourceSnapshot.sourceKind)} />
            <KeyValue label="来源学校 ID" value={sourceSnapshot.sourceSchoolId ?? "-"} />
            <KeyValue label="状态" value={sourceSnapshot.status} />
            <KeyValue label="抓取时间" value={formatTime(sourceSnapshot.fetchedAt)} />
            <KeyValue label="错误" value={sourceSnapshot.error ?? "-"} />
          </div>
          <KeyValue label="请求条件" value={formatAdmissionSourceRequest(sourceSnapshot.requestJson)} />
          <KeyValue label="来源 URL" value={sourceSnapshot.sourceUrl} />
          <div className="logs-grid">
            <div>
              <h3>请求参数</h3>
              <pre className="json">{formatJsonText(sourceSnapshot.requestJson)}</pre>
            </div>
            <div>
              <h3>原始响应</h3>
              <pre className="json">{formatJsonText(sourceSnapshot.responseJson)}</pre>
            </div>
          </div>
        </Panel>
      )}
    </section>
  );
}

function AdmissionJobsTable({ jobs, emptyText }: { jobs: AdmissionSyncJob[]; emptyText: string }) {
  return (
    <div className="table-wrap compact-table">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>类型</th>
            <th>状态</th>
            <th>目标</th>
            <th>结果</th>
            <th>开始</th>
            <th>结束</th>
            <th>错误</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>#{job.id}</td>
              <td>{formatAdmissionJobType(job.jobType)}</td>
              <td>{formatAdmissionJobStatus(job.status)}</td>
              <td>{formatAdmissionJobTarget(job.targetJson)}</td>
              <td>{formatAdmissionJobResult(job.resultJson)}</td>
              <td>{formatTime(job.startedAt)}</td>
              <td>{formatTime(job.finishedAt)}</td>
              <td>{formatAdmissionJobError(job)}</td>
            </tr>
          ))}
          {!jobs.length && <tr><td colSpan={8}>{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
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

function Input({
  label,
  value,
  onChange,
  type = "text",
  hint,
  autoComplete,
  ignorePasswordManagers = false,
  name
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  autoComplete?: string;
  ignorePasswordManagers?: boolean;
  name?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        autoComplete={autoComplete}
        data-lpignore={ignorePasswordManagers ? "true" : undefined}
        data-1p-ignore={ignorePasswordManagers ? "true" : undefined}
        data-form-type={ignorePasswordManagers ? "other" : undefined}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span />{label}</label>;
}

function coverageRatio(value?: number, total?: number) {
  const safeValue = Number(value ?? 0);
  const safeTotal = Number(total ?? 0);
  if (!safeTotal) return `${safeValue}/0`;
  return `${safeValue}/${safeTotal} (${Math.round((safeValue / safeTotal) * 100)}%)`;
}

function formatCoverageYears(years?: AdmissionCoverageYear[]) {
  if (!years?.length) return "-";
  return years
    .slice(0, 4)
    .map((item) => `${item.year}: ${item.universityCount}校/${item.provinceCount}省/${item.rowCount}行`)
    .join("；");
}

function formatNapcatWebStatus(status?: NapcatWebStatus | null) {
  if (!status) return "未检查";
  if (status.isLogin) return "QQ 在线";
  if (status.isOffline) return "QQ 已登录但离线，建议重启后扫码";
  if (status.reachable && status.qrcodeUrl) return "等待扫码登录";
  if (status.reachable) return status.loginError || "启动器可访问，QQ 未在线";
  return status.message || "启动器不可访问";
}

function formatCoverageGapKind(kind: AdmissionCoverageGap["kind"]) {
  const labels: Record<AdmissionCoverageGap["kind"], string> = {
    plan: "招生计划",
    major_plan: "专业计划",
    school_score: "院校线",
    major_score: "专业线"
  };
  return labels[kind] ?? kind;
}

function formatAdmissionJobType(type: string) {
  const labels: Record<string, string> = {
    "sync-plan": "招生计划",
    "sync-score": "分数线",
    "sync-mixed": "计划+分数",
    "sync-mapping": "学校映射"
  };
  return labels[type] ?? type;
}

function formatAdmissionJobStatus(status: string) {
  const labels: Record<string, string> = {
    running: "运行中",
    success: "成功",
    error: "失败"
  };
  return labels[status] ?? status;
}

function formatAdmissionSourceKind(kind: string) {
  const labels: Record<string, string> = {
    "school-search": "学校搜索",
    "school-profile": "学校画像",
    "plan-school-summary": "计划汇总",
    "plan-major": "专业计划",
    "score-school": "院校线",
    "score-major": "专业线",
    "jiangsu-eea-score-pdf": "江苏省考试院投档线 PDF",
    "jiangsu-eea-score-excel": "江苏省考试院投档线 Excel",
    "jiangsu-eea-score-text": "江苏省考试院投档线文本",
    "jiangsu-eea-rank-image": "江苏省考试院逐分段表",
    "jiangsu-school-plan-html": "江苏高校官网招生计划 HTML",
    "jiangsu-school-plan-json": "江苏高校官网招生计划 JSON",
    "xuefeng-agent-sqlite": "雪峰 Agent 历史 SQLite"
  };
  return labels[kind] ?? kind;
}

function formatAdmissionSourceRequest(value: string) {
  const parsed = parseJsonObject(value);
  if (!parsed) return formatShortText(value, 120);
  const endpoint = typeof parsed.uri === "string" ? parsed.uri.replace(/^apidata\/api\//u, "") : null;
  const parts = [
    endpoint ? `接口 ${endpoint}` : null,
    parsed.keyword ? `关键词 ${parsed.keyword}` : null,
    parsed.school_id ? `school_id ${parsed.school_id}` : null,
    parsed.local_province_id ? `省ID ${parsed.local_province_id}` : null,
    parsed.local_type_id ? `科类ID ${parsed.local_type_id}` : null,
    parsed.province ? `省份 ${parsed.province}` : null,
    parsed.subjectType ? `科类 ${parsed.subjectType}` : null,
    parsed.batch ? `批次 ${parsed.batch}` : null,
    parsed.year ? `年份 ${parsed.year}` : null,
    parsed.page ? `页 ${parsed.page}` : null,
    parsed.size ? `size ${parsed.size}` : null,
    parsed.zslx !== undefined ? `zslx ${parsed.zslx}` : null,
    parsed.source ? `来源 ${parsed.source}` : null,
    parsed.title ? `标题 ${formatShortText(String(parsed.title), 60)}` : null
  ].filter(Boolean);
  return parts.length ? parts.join("，") : formatShortText(JSON.stringify(parsed), 120);
}

function formatAdmissionJobTarget(value: string) {
  const parsed = parseJsonObject(value);
  if (!parsed) return formatShortText(value, 100);
  const parts = [
    parsed.universityId ? `学校ID ${parsed.universityId}` : null,
    parsed.query ? `范围 ${parsed.query}` : null,
    `limit ${parsed.limit ?? 10}`,
    `offset ${parsed.offset ?? 0}`,
    `省份 ${formatListValue(parsed.provinces)}`,
    `科类 ${formatListValue(parsed.subjectTypes, "自动")}`,
    parsed.planYears ? `计划 ${formatListValue(parsed.planYears)}` : null,
    parsed.scoreYears ? `分数 ${formatListValue(parsed.scoreYears)}` : null,
    parsed.includePlans === false ? "不抓计划" : null,
    parsed.includeScores === false ? "不抓分数" : null,
    parsed.includeSpecialScores === false ? "不抓专业线" : null
  ].filter(Boolean);
  return parts.join("，");
}

function formatAdmissionJobResult(value: string | null) {
  const parsed = parseJsonObject<AdmissionSyncResult>(value);
  if (!parsed) return "-";
  const rows = Number(parsed.planRows ?? 0) + Number(parsed.schoolScoreRows ?? 0) + Number(parsed.majorScoreRows ?? 0);
  const total = parsed.candidateTotal || parsed.total || 0;
  const budgetText = parsed.requestBudgetExhausted
    ? `预算暂停 ${parsed.sourceRequests ?? 0}/${parsed.sourceRequestBudget ?? "不限"}`
    : parsed.sourceRequests !== undefined
      ? `请求 ${parsed.sourceRequests}`
      : null;
  return [
    `${parsed.mapped ?? 0}/${total} 所`,
    `offset ${parsed.offset ?? 0}→${parsed.nextOffset ?? 0}`,
    `计划 ${formatPlanRowBreakdown(parsed)}`,
    `院校线 ${parsed.schoolScoreRows ?? 0}`,
    `专业线 ${parsed.majorScoreRows ?? 0}`,
    `来源 ${parsed.sourceRows ?? 0}`,
    `总行 ${rows}`,
    budgetText,
    `跳过 ${parsed.skippedRequests ?? 0}`,
    parsed.errors?.length ? `错误 ${parsed.errors.length}` : null
  ].filter(Boolean).join("，");
}

function formatPlanRowBreakdown(result: Pick<AdmissionSyncResult, "planRows" | "planSummaryRows" | "majorPlanRows">) {
  const total = result.planRows ?? 0;
  const summary = result.planSummaryRows ?? 0;
  const major = result.majorPlanRows ?? 0;
  if (!summary && !major) return String(total);
  return `${total}（汇总 ${summary}，专业计划 ${major}）`;
}

function hasGaokaoRateLimitErrors(errors: unknown[]) {
  return errors.some((error) => /1069|访问太过频繁|请稍后再试|限流|429|too many requests|rate limit/i.test(formatGaokaoSyncError(error)));
}

function formatGaokaoSyncErrorPreview(errors: unknown[]) {
  const preview = errors.map(formatGaokaoSyncError).find(Boolean);
  return preview ? `；首条错误：${formatShortText(preview, 120)}` : "";
}

function formatGaokaoSyncError(error: unknown) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const item = error as { university?: unknown; school?: unknown; message?: unknown; error?: unknown };
    return [item.university ?? item.school, item.message ?? item.error].filter(Boolean).map(String).join(": ");
  }
  return String(error);
}

function formatAdmissionJobError(job: AdmissionSyncJob) {
  if (job.error) return formatShortText(job.error, 180);
  const parsed = parseJsonObject<AdmissionSyncResult>(job.resultJson);
  const errors = parsed?.errors ?? [];
  if (!errors.length) return "-";
  return errors
    .slice(0, 2)
    .map((item) => [item.university, item.message].filter(Boolean).join(": "))
    .join("；");
}

function admissionScorePlanCount(score: AdmissionScore, plans: AdmissionPlan[]) {
  if (typeof score.planCount === "number") return score.planCount;
  const sameBucket = plans.filter((plan) =>
    plan.sourceSchoolId === score.sourceSchoolId &&
    plan.year === score.year &&
    plan.provinceName === score.provinceName &&
    admissionFieldCompatible(score.subjectType, plan.subjectType) &&
    admissionFieldCompatible(score.batch, plan.batch) &&
    admissionFieldCompatible(score.planGroup, plan.planGroup)
  );
  const majorName = normalizeComparableAdmissionText(score.majorName);
  if (majorName) {
    const exactMajor = sameBucket.find((plan) =>
      normalizeComparableAdmissionText(plan.majorName) === majorName &&
      typeof plan.planCount === "number"
    );
    if (typeof exactMajor?.planCount === "number") return exactMajor.planCount;
    return null;
  }
  const summary = sameBucket.find((plan) => !plan.majorName && typeof plan.schoolPlanCount === "number");
  if (typeof summary?.schoolPlanCount === "number") return summary.schoolPlanCount;
  return null;
}

function admissionFieldCompatible(left: string | null, right: string | null) {
  return !left || !right || left === right;
}

function normalizeComparableAdmissionText(value: string | null) {
  return value ? value.replace(/[（）()\s]/gu, "").toLowerCase() : null;
}

function parseOptionalNumberSetting(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(value?: string | null): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function formatListValue(value: unknown, fallback = "全部") {
  if (Array.isArray(value)) return value.length ? value.join(",") : fallback;
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function firstListValue(value: string) {
  return value.split(/[,，\s]+/u).map((item) => item.trim()).filter(Boolean)[0] ?? "";
}

function formatShortText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function formatJsonText(value?: string | null) {
  if (!value) return "-";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatGaokaoLastResult(result?: GaokaoSchedulerResult | null) {
  if (!result) return "-";
  const rows = result.planRows + result.schoolScoreRows + result.majorScoreRows;
  const batchText = result.batchCount && result.batchCount > 1 ? `，批次 ${result.batchCount}` : "";
  const firstError = result.errors?.[0];
  const errorText = firstError ? `，首个错误 ${firstError.university ?? "-"}：${formatShortText(firstError.message ?? "", 80)}` : "";
  const budgetText = result.requestBudgetExhausted ? `，预算暂停 ${result.sourceRequests ?? 0}/${result.sourceRequestBudget ?? "不限"}` : result.sourceRequests !== undefined ? `，请求 ${result.sourceRequests}` : "";
  return `${result.ok ? "成功" : "失败"}${batchText}：${result.total}/${result.candidateTotal || result.total} 所，offset ${result.offset}→${result.nextOffset}，映射 ${result.mapped}，计划 ${formatPlanRowBreakdown(result)}，行 ${rows}，来源 ${result.sourceRows}${budgetText}，跳过 ${result.skippedRequests ?? 0}，错误 ${result.errorCount}${errorText}，${formatTime(result.savedAt)}`;
}

function formatGaokaoSchedulerState(job?: SyncSchedulerStatus["jobs"]["gaokaoCnPlan"] | null) {
  if (!job) return "-";
  if (job.running) return "运行中";
  if (job.cooldownUntil) return "冷却中";
  if (job.retryAt) return "待重试";
  return job.enabled ? "已启用" : "未启用";
}

function gaokaoSourceCooldownUntil(scheduler?: SyncSchedulerStatus | null) {
  const values = [
    scheduler?.jobs.gaokaoCnPlan.cooldownUntil,
    scheduler?.jobs.gaokaoCnScore.cooldownUntil
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()) && date.getTime() > Date.now());
  if (!values.length) return null;
  return new Date(Math.max(...values.map((date) => date.getTime()))).toISOString();
}

function formatGaokaoSourceStatus(scheduler?: SyncSchedulerStatus | null) {
  const cooldownUntil = gaokaoSourceCooldownUntil(scheduler);
  if (cooldownUntil) return `冷却到 ${formatScheduleTime(cooldownUntil)}`;
  const running = scheduler?.jobs.gaokaoCnPlan.running || scheduler?.jobs.gaokaoCnScore.running;
  if (running) return "同步中";
  return "可请求";
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
