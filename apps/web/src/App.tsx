import {
  Activity,
  Bookmark,
  Clock3,
  Database,
  Gauge,
  Heart,
  History,
  LogOut,
  Search,
  Shield,
  UserRound
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { MagnetMetadataDto, SafeUserDto } from "../../../packages/shared/src";
import { ApiError, api } from "./api";

const sampleMagnet =
  "magnet:?xt=urn:btih:7c1da06ef6898eaf9cabf879e44450417f5ae63f&dn=ROYD-327-C";

type View = "search" | "library" | "admin";

export default function App() {
  const [user, setUser] = useState<SafeUserDto | null>(null);
  const [view, setView] = useState<View>("search");
  const [magnet, setMagnet] = useState("");
  const deferredMagnet = useDeferredValue(magnet);
  const [result, setResult] = useState<MagnetMetadataDto | null>(null);
  const [source, setSource] = useState<"cache" | "upstream" | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.session().then((session) => setUser(session.user)).catch(() => {
      setUser(null);
    });
  }, []);

  async function resolveMagnet() {
    setBusy(true);
    setStatus("");
    try {
      const response = await api.resolveMagnet(deferredMagnet || sampleMagnet);
      startTransition(() => {
        setResult(response.data);
        setSource(response.source);
        setStatus(
          response.data.status === "unknown"
            ? "未查询到可展示的元数据"
            : "查询完成"
        );
      });
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setView("search");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("search")}>
          <span className="brand-mark">M</span>
          <span>磁力元数据查询平台</span>
        </button>
        <nav className="nav">
          <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}>
            <Search size={16} />
            查询
          </button>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            <Bookmark size={16} />
            历史收藏
          </button>
          {user?.role === "admin" ? (
            <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>
              <Shield size={16} />
              管理后台
            </button>
          ) : null}
        </nav>
        <div className="account">
          {user ? (
            <>
              <span className="account-chip">
                <UserRound size={15} />
                {user.email}
              </span>
              <button className="icon-button" onClick={logout} title="退出登录">
                <LogOut size={17} />
              </button>
            </>
          ) : (
            <AuthBox onSignedIn={setUser} />
          )}
        </div>
      </header>

      <main className="workspace">
        {view === "search" ? (
          <SearchView
            magnet={magnet}
            setMagnet={setMagnet}
            busy={busy}
            status={status}
            source={source}
            result={result}
            user={user}
            onResolve={resolveMagnet}
            onResultChange={setResult}
          />
        ) : null}
        {view === "library" ? <LibraryView user={user} /> : null}
        {view === "admin" ? <AdminView user={user} /> : null}
      </main>
    </div>
  );
}

function SearchView(props: {
  magnet: string;
  setMagnet: (value: string) => void;
  busy: boolean;
  status: string;
  source: "cache" | "upstream" | null;
  result: MagnetMetadataDto | null;
  user: SafeUserDto | null;
  onResolve: () => void;
  onResultChange: (value: MagnetMetadataDto | null) => void;
}) {
  return (
    <section className="search-grid">
      <div className="query-panel">
        <div className="section-title">
          <h1>提交磁力链接，查看文件元数据</h1>
          <p>游客可直接查询；登录后会自动保存历史并支持收藏。</p>
        </div>
        <textarea
          value={props.magnet}
          onChange={(event) => props.setMagnet(event.target.value)}
          placeholder="magnet:?xt=urn:btih:7c1da06ef6898eaf9cabf879e44450417f5ae63f&dn=ROYD-327-C"
        />
        <div className="actions-row">
          <button className="primary-button" disabled={props.busy} onClick={props.onResolve}>
            <Search size={18} />
            {props.busy ? "查询中" : "查询磁力"}
          </button>
          <button className="secondary-button" onClick={() => props.setMagnet(sampleMagnet)}>
            填入示例
          </button>
          <span className="inline-status">{props.status}</span>
        </div>
        {props.result ? (
          <ResultPanel
            result={props.result}
            source={props.source}
            user={props.user}
            onResultChange={props.onResultChange}
          />
        ) : (
          <EmptyResult />
        )}
      </div>

      <aside className="summary-rail">
        <Metric icon={<Gauge size={18} />} label="游客额度" value="30 / 小时" />
        <Metric icon={<Clock3 size={18} />} label="成功缓存" value="7 天" />
        <Metric icon={<Database size={18} />} label="存储策略" value="仅保存 Hash" />
        <div className="rail-note">
          <strong>隐私默认值</strong>
          <span>系统不会保存完整磁力链接，只记录规范化后的 BTIH 与查询结果。</span>
        </div>
      </aside>
    </section>
  );
}

function ResultPanel(props: {
  result: MagnetMetadataDto;
  source: "cache" | "upstream" | null;
  user: SafeUserDto | null;
  onResultChange: (value: MagnetMetadataDto | null) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const result = props.result;

  async function toggleFavorite() {
    if (!props.user) return;
    setSaving(true);
    try {
      if (result.isFavorite) {
        await api.removeFavorite(result.infoHash);
      } else {
        await api.addFavorite(result.infoHash);
      }
      props.onResultChange({ ...result, isFavorite: !result.isFavorite });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="result-panel">
      <div className="result-head">
        <div>
          <span className={`status-dot ${result.status}`}>{result.status}</span>
          <h2>{result.name || "未命名磁力资源"}</h2>
          <p>{result.infoHash}</p>
        </div>
        <button
          className="secondary-button"
          disabled={!props.user || saving}
          onClick={toggleFavorite}
          title={props.user ? "收藏或取消收藏" : "登录后可收藏"}
        >
          <Heart size={17} fill={result.isFavorite ? "currentColor" : "none"} />
          {result.isFavorite ? "已收藏" : "收藏"}
        </button>
      </div>
      <div className="metadata-strip">
        <Metric label="大小" value={formatBytes(result.size)} />
        <Metric label="文件数" value={String(result.count)} />
        <Metric label="类型" value={result.fileType || result.type || "-"} />
        <Metric label="来源" value={props.source === "cache" ? "缓存" : "上游"} />
      </div>
      {result.screenshots.length > 0 ? (
        <div className="screenshots">
          <div className="screenshots-head">
            <span>截图预览</span>
            <button className="link-button" onClick={() => setRevealed((value) => !value)}>
              {revealed ? "隐藏" : "点击查看"}
            </button>
          </div>
          <div className="screenshot-grid">
            {result.screenshots.map((item) => (
              <button
                className={`screenshot-frame ${revealed ? "revealed" : ""}`}
                key={item.screenshot}
                onClick={() => setRevealed(true)}
              >
                <img src={item.screenshot} alt="磁力截图预览" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="no-preview">没有可展示的截图预览，或管理员已关闭预览。</div>
      )}
    </article>
  );
}

function AuthBox({ onSignedIn }: { onSignedIn: (user: SafeUserDto) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    try {
      const response =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password);
      onSignedIn(response.user);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="auth-box">
      <input
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="邮箱"
        type="email"
      />
      <input
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="密码"
        type="password"
      />
      <button className="primary-button small" onClick={submit}>
        {mode === "login" ? "登录" : "注册"}
      </button>
      <button
        className="link-button"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "注册" : "登录"}
      </button>
      {error ? <span className="auth-error">{error}</span> : null}
    </div>
  );
}

function LibraryView({ user }: { user: SafeUserDto | null }) {
  const [history, setHistory] = useState<Array<{ queriedAt: number; source: string; data: MagnetMetadataDto }>>([]);
  const [favorites, setFavorites] = useState<Array<{ favoritedAt: number; data: MagnetMetadataDto }>>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user) return;
    Promise.all([api.history(), api.favorites()])
      .then(([historyResponse, favoritesResponse]) => {
        setHistory(historyResponse.items);
        setFavorites(favoritesResponse.items);
      })
      .catch((error) => setMessage(errorMessage(error)));
  }, [user]);

  if (!user) {
    return <Gate title="登录后查看历史与收藏" />;
  }

  return (
    <section className="two-column">
      <ListPanel
        title="查询历史"
        icon={<History size={18} />}
        empty="还没有查询记录"
        items={history.map((item) => ({
          id: `${item.queriedAt}-${item.data.infoHash}`,
          title: item.data.name || item.data.infoHash,
          meta: `${formatDate(item.queriedAt)} · ${item.source}`,
          status: item.data.status
        }))}
      />
      <ListPanel
        title="收藏"
        icon={<Bookmark size={18} />}
        empty="还没有收藏"
        items={favorites.map((item) => ({
          id: `${item.favoritedAt}-${item.data.infoHash}`,
          title: item.data.name || item.data.infoHash,
          meta: `${formatDate(item.favoritedAt)} · ${formatBytes(item.data.size)}`,
          status: item.data.status
        }))}
      />
      {message ? <p className="inline-status">{message}</p> : null}
    </section>
  );
}

function AdminView({ user }: { user: SafeUserDto | null }) {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState({
    screenshotsEnabled: true,
    guestRateLimitPerHour: 30,
    userRateLimitPerHour: 120
  });
  const [users, setUsers] = useState<SafeUserDto[]>([]);
  const [queries, setQueries] = useState<Array<Record<string, unknown>>>([]);
  const [health, setHealth] = useState<{ ok: boolean; latencyMs: number; error?: string } | null>(null);

  useEffect(() => {
    if (user?.role !== "admin") return;
    Promise.all([
      api.adminStats(),
      api.adminUsers(),
      api.adminQueries(),
      api.adminHealth()
    ]).then(([statsResponse, usersResponse, queriesResponse, healthResponse]) => {
      setStats(statsResponse.stats);
      setSettings(statsResponse.settings);
      setUsers(usersResponse.items);
      setQueries(queriesResponse.items);
      setHealth(healthResponse.whatslink);
    }).catch(() => undefined);
  }, [user]);

  async function updateScreenshots(enabled: boolean) {
    const response = await api.updateSettings({ screenshotsEnabled: enabled });
    setSettings(response.settings);
  }

  if (user?.role !== "admin") {
    return <Gate title="管理员权限 required" />;
  }

  return (
    <section className="admin-grid">
      <div className="stats-row">
        <Metric icon={<UserRound size={18} />} label="用户" value={String(stats.users ?? 0)} />
        <Metric icon={<Activity size={18} />} label="查询" value={String(stats.queries ?? 0)} />
        <Metric icon={<Bookmark size={18} />} label="收藏" value={String(stats.favorites ?? 0)} />
        <Metric icon={<Gauge size={18} />} label="API" value={health?.ok ? `${health.latencyMs}ms` : "异常"} />
      </div>
      <div className="settings-panel">
        <div>
          <h2>系统配置</h2>
          <p>截图预览会影响前端展示，关闭后历史数据仍保留。</p>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.screenshotsEnabled}
            onChange={(event) => updateScreenshots(event.target.checked)}
          />
          默认展示截图预览
        </label>
      </div>
      <ListPanel
        title="用户"
        empty="暂无用户"
        items={users.map((item) => ({
          id: item.id,
          title: item.email,
          meta: `${item.role} · ${formatDate(item.createdAt)}`,
          status: item.role
        }))}
      />
      <ListPanel
        title="最近查询"
        empty="暂无查询"
        items={queries.slice(0, 20).map((item) => ({
          id: String(item.id),
          title: String(item.name || item.info_hash || item.infoHash || "-"),
          meta: `${String(item.email || item.actor_key || item.actorKey || "-")} · ${String(item.source || "-")}`,
          status: String(item.status || "-")
        }))}
      />
    </section>
  );
}

function ListPanel(props: {
  title: string;
  icon?: React.ReactNode;
  empty: string;
  items: Array<{ id: string; title: string; meta: string; status: string }>;
}) {
  return (
    <section className="list-panel">
      <h2>{props.icon}{props.title}</h2>
      {props.items.length === 0 ? (
        <p className="empty-text">{props.empty}</p>
      ) : (
        <div className="row-list">
          {props.items.map((item) => (
            <div className="data-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.meta}</span>
              </div>
              <span className={`status-dot ${item.status}`}>{item.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyResult() {
  return (
    <div className="empty-result">
      <Search size={30} />
      <span>等待查询</span>
      <p>提交磁力链接后会显示文件名、大小、文件数量和截图预览。</p>
    </div>
  );
}

function Gate({ title }: { title: string }) {
  return (
    <div className="gate">
      <Shield size={28} />
      <h1>{title}</h1>
    </div>
  );
}

function Metric(props: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {props.icon ? <span className="metric-icon">{props.icon}</span> : null}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function formatBytes(value: number): string {
  if (!value) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.message === "UNAUTHENTICATED") return "请先登录";
    if (error.message === "AUTH_INVALID") return "邮箱或密码不正确";
    if (error.message === "MAGNET_INVALID") return "磁力链接格式不正确";
    if (error.message === "RATE_LIMITED") return "查询过于频繁，请稍后再试";
    if (error.message === "WHATSLINK_UNAVAILABLE") return "上游查询暂时不可用";
    return error.message;
  }
  return "请求失败";
}
