import {
  Activity,
  Bookmark,
  Clock3,
  Copy,
  Database,
  Gauge,
  Heart,
  History,
  LogOut,
  MessageSquarePlus,
  Search,
  Shield,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  UserRound
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type {
  LeaderboardItemDto,
  MagnetMetadataDto,
  SafeUserDto,
  SuggestionDto
} from "../../../packages/shared/src";
import { canonicalizeMagnetInput } from "../../../packages/shared/src";
import { ApiError, api } from "./api";
import { resolveMagnetFromBrowser } from "./whatslinkClient";

const sampleMagnet =
  "magnet:?xt=urn:btih:7c1da06ef6898eaf9cabf879e44450417f5ae63f&dn=ROYD-327-C";

const magnetPlaceholder =
  "可贴完整磁力链接，或直接填入 Hash，如 709314680ed7fdec766e5d11441295d2e01a9251（会自动补全 magnet:?xt=urn:btih:）";

type View = "search" | "library" | "admin";

export default function App() {
  const [user, setUser] = useState<SafeUserDto | null>(null);
  const [view, setView] = useState<View>("search");
  const [magnet, setMagnet] = useState("");
  const deferredMagnet = useDeferredValue(magnet);
  const [result, setResult] = useState<MagnetMetadataDto | null>(null);
  const [source, setSource] = useState<"cache" | "upstream" | "client" | null>(
    null
  );
  const [screenshotsEnabled, setScreenshotsEnabled] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaderboardTick, setLeaderboardTick] = useState(0);

  useEffect(() => {
    api.session().then((session) => setUser(session.user)).catch(() => {
      setUser(null);
    });
    api
      .health()
      .then((health) => setScreenshotsEnabled(health.settings.screenshotsEnabled))
      .catch(() => undefined);
  }, []);

  function normalizeMagnetField(value: string): string {
    try {
      return canonicalizeMagnetInput(value);
    } catch {
      return value.trim();
    }
  }

  async function resolveMagnet() {
    setBusy(true);
    setStatus("");
    const normalized = normalizeMagnetField(deferredMagnet || sampleMagnet);
    if (normalized !== deferredMagnet) {
      setMagnet(normalized);
    }
    const targetMagnet = normalized || sampleMagnet;

    async function applyClientFallback(): Promise<boolean> {
      try {
        const data = await resolveMagnetFromBrowser(targetMagnet);
        startTransition(() => {
          setResult(data);
          setSource("client");
          setStatus(
            data.status === "unknown"
              ? "未查询到可展示的元数据"
              : "查询完成（浏览器直连 WhatsLink）"
          );
        });
        return true;
      } catch {
        return false;
      }
    }

    try {
      const response = await api.resolveMagnet(targetMagnet);
      setScreenshotsEnabled(response.screenshotsEnabled);
      if (response.data.status === "error") {
        if (await applyClientFallback()) return;
      }
      startTransition(() => {
        setResult(response.data);
        setSource(response.source);
        setStatus(
          response.data.status === "unknown"
            ? "未查询到可展示的元数据"
            : response.data.status === "error"
              ? "上游查询暂时不可用"
              : "查询完成"
        );
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.message === "WHATSLINK_UNAVAILABLE"
      ) {
        if (await applyClientFallback()) return;
      }
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
          <span className="brand-mark">窝</span>
          <span>窝要验牌</span>
        </button>
        <nav className="nav">
          <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}>
            <Search size={16} />
            验牌
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
            onMagnetBlur={() => setMagnet((value) => normalizeMagnetField(value))}
            busy={busy}
            status={status}
            source={source}
            screenshotsEnabled={screenshotsEnabled}
            result={result}
            user={user}
            leaderboardTick={leaderboardTick}
            onResolve={resolveMagnet}
            onResultChange={setResult}
            onScoreChanged={() => setLeaderboardTick((value) => value + 1)}
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
  onMagnetBlur: () => void;
  busy: boolean;
  status: string;
  source: "cache" | "upstream" | "client" | null;
  screenshotsEnabled: boolean;
  result: MagnetMetadataDto | null;
  user: SafeUserDto | null;
  leaderboardTick: number;
  onResolve: () => void;
  onResultChange: (value: MagnetMetadataDto | null) => void;
  onScoreChanged: () => void;
}) {
  return (
    <section className="search-grid">
      <div className="query-panel">
        <div className="section-title">
          <h1>先偷看一眼，再决定要不要下</h1>
          <p>贴上磁力链接或 Hash 验一验牌面；游客可直接查询，登录后可保存历史与收藏。</p>
        </div>
        <textarea
          value={props.magnet}
          onChange={(event) => props.setMagnet(event.target.value)}
          onBlur={props.onMagnetBlur}
          placeholder={magnetPlaceholder}
        />
        <div className="actions-row">
          <button className="primary-button" disabled={props.busy} onClick={props.onResolve}>
            <Search size={18} />
            {props.busy ? "验牌中" : "开始验牌"}
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
            screenshotsEnabled={props.screenshotsEnabled}
            user={props.user}
            onResultChange={props.onResultChange}
            onScoreChanged={props.onScoreChanged}
          />
        ) : (
          <EmptyResult />
        )}
        <SuggestionBox />
      </div>

      <aside className="summary-rail">
        <LeaderboardPanel refreshKey={props.leaderboardTick} user={props.user} />
        <Metric icon={<Gauge size={18} />} label="游客额度" value="30 / 小时" />
        <Metric icon={<Clock3 size={18} />} label="成功缓存" value="7 天" />
        <Metric icon={<Database size={18} />} label="存储策略" value="仅保存 Hash" />
        <div className="rail-note">
          <strong>隐私默认值</strong>
          <span>系统只缓存 Hash 与元数据；完整磁力链接仅对登录用户在排行榜中展示。</span>
        </div>
      </aside>
    </section>
  );
}

function SuggestionBox() {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = content.trim();
    if (trimmed.length < 2) {
      setStatus("请至少写两个字");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await api.submitSuggestion(trimmed);
      setContent("");
      setStatus("感谢反馈，已提交给管理员");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="suggestion-box">
      <div className="suggestion-head">
        <MessageSquarePlus size={18} />
        <div>
          <strong>产品建议</strong>
          <span>有想法或吐槽都可以留在这里，管理后台可见。</span>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="例如：希望支持批量验牌、想看更多预览帧…"
        maxLength={2000}
      />
      <div className="actions-row">
        <button className="secondary-button" disabled={busy} onClick={submit}>
          提交建议
        </button>
        <span className="inline-status">{status}</span>
      </div>
    </div>
  );
}

function ResultPanel(props: {
  result: MagnetMetadataDto;
  source: "cache" | "upstream" | "client" | null;
  screenshotsEnabled: boolean;
  user: SafeUserDto | null;
  onResultChange: (value: MagnetMetadataDto | null) => void;
  onScoreChanged: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voting, setVoting] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState("");
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

  async function submitFeedback(vote: "up" | "down") {
    setVoting(true);
    setFeedbackStatus("");
    try {
      const response = await api.submitFeedback(result.infoHash, vote);
      props.onResultChange(response.data);
      props.onScoreChanged();
      if (response.data.myVote === 1) {
        setFeedbackStatus("已记正反馈：牌没有问题");
      } else if (response.data.myVote === -1) {
        setFeedbackStatus("已记负反馈：给我擦皮鞋");
      } else {
        setFeedbackStatus("已取消本次反馈");
      }
    } catch (error) {
      setFeedbackStatus(errorMessage(error));
    } finally {
      setVoting(false);
    }
  }

  const emptyPreviewText = props.screenshotsEnabled
    ? "没有可展示的截图预览"
    : "管理员已关闭预览";

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
        <Metric
          label="来源"
          value={
            props.source === "cache"
              ? "缓存"
              : props.source === "client"
                ? "浏览器直连"
                : "上游"
          }
        />
      </div>
      <div className="score-strip">
        <div className="score-badge">
          <Trophy size={16} />
          <span>当前得分</span>
          <strong
            className={
              (result.score ?? 0) > 0
                ? "positive"
                : (result.score ?? 0) < 0
                  ? "negative"
                  : ""
            }
          >
            {formatScore(result.score)}
          </strong>
        </div>
        <div className="feedback-actions">
          <button
            className={`feedback-button up ${result.myVote === 1 ? "active" : ""}`}
            disabled={voting}
            onClick={() => submitFeedback("up")}
          >
            <ThumbsUp size={16} />
            牌没有问题
          </button>
          <button
            className={`feedback-button down ${result.myVote === -1 ? "active" : ""}`}
            disabled={voting}
            onClick={() => submitFeedback("down")}
          >
            <ThumbsDown size={16} />
            给我擦皮鞋
          </button>
        </div>
        {feedbackStatus ? <span className="inline-status">{feedbackStatus}</span> : null}
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
        <div className="no-preview">{emptyPreviewText}</div>
      )}
    </article>
  );
}

function LeaderboardPanel(props: {
  refreshKey: number;
  user: SafeUserDto | null;
}) {
  const [items, setItems] = useState<LeaderboardItemDto[]>([]);
  const [linksVisible, setLinksVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .leaderboard(15)
      .then((response) => {
        if (!cancelled) {
          setItems(Array.isArray(response.items) ? response.items : []);
          setLinksVisible(Boolean(response.linksVisible));
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setItems([]);
          setLinksVisible(false);
          setError(errorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.refreshKey, props.user?.id]);

  const list = Array.isArray(items) ? items : [];
  const canSeeLinks = Boolean(props.user) && linksVisible;

  async function copyMagnet(item: LeaderboardItemDto) {
    if (!item.magnetLink) return;
    try {
      await navigator.clipboard.writeText(item.magnetLink);
      setCopiedHash(item.infoHash);
      window.setTimeout(() => {
        setCopiedHash((current) => (current === item.infoHash ? null : current));
      }, 1600);
    } catch {
      setError("复制失败，请手动选择链接");
    }
  }

  return (
    <div className="leaderboard-panel">
      <div className="leaderboard-head">
        <Trophy size={18} />
        <div>
          <strong>验牌排行榜</strong>
          <span>按社区反馈分数排序</span>
        </div>
      </div>
      <div className={`leaderboard-hint ${canSeeLinks ? "unlocked" : "locked"}`}>
        {canSeeLinks
          ? "已登录：可查看并复制完整磁力链接"
          : "游客仅看名称与分数；登录后可查看完整磁力链接"}
      </div>
      {loading ? <p className="empty-text">加载排行榜…</p> : null}
      {!loading && error ? <p className="inline-status">{error}</p> : null}
      {!loading && !error && list.length === 0 ? (
        <p className="empty-text">还没有评分，验完牌来第一票吧</p>
      ) : null}
      {!loading && list.length > 0 ? (
        <ol className="leaderboard-list">
          {list.map((item, index) => (
            <li key={`${item.infoHash}-${index}`}>
              <span className={`rank-badge rank-${Math.min(index + 1, 3)}`}>{index + 1}</span>
              <div className="leaderboard-item">
                <strong title={item.name || item.infoHash}>
                  {item.name || shortHash(item.infoHash)}
                </strong>
                <span>
                  {formatBytes(item.size)} · {item.voteCount} 票
                </span>
                {canSeeLinks && item.magnetLink ? (
                  <div className="leaderboard-link-row">
                    <code className="leaderboard-link" title={item.magnetLink}>
                      {item.magnetLink}
                    </code>
                    <button
                      className="link-button copy-link-button"
                      type="button"
                      onClick={() => copyMagnet(item)}
                      title="复制完整磁力链接"
                    >
                      <Copy size={14} />
                      {copiedHash === item.infoHash ? "已复制" : "复制"}
                    </button>
                  </div>
                ) : null}
              </div>
              <span
                className={`leaderboard-score ${
                  item.score > 0 ? "positive" : item.score < 0 ? "negative" : ""
                }`}
              >
                {formatScore(item.score)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
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
  const [history, setHistory] = useState<
    Array<{
      queriedAt: number;
      source: string;
      magnetLink: string;
      data: MagnetMetadataDto;
    }>
  >([]);
  const [favorites, setFavorites] = useState<
    Array<{ favoritedAt: number; data: MagnetMetadataDto }>
  >([]);
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
          meta: `${formatDate(item.queriedAt)} · ${item.source} · ${formatScore(item.data.score)} 分`,
          status: item.data.status,
          magnetLink: item.magnetLink
        }))}
      />
      <ListPanel
        title="收藏"
        icon={<Bookmark size={18} />}
        empty="还没有收藏"
        items={favorites.map((item) => ({
          id: `${item.favoritedAt}-${item.data.infoHash}`,
          title: item.data.name || item.data.infoHash,
          meta: `${formatDate(item.favoritedAt)} · ${formatBytes(item.data.size)} · ${formatScore(item.data.score)} 分`,
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
  const [queries, setQueries] = useState<
    Array<Record<string, unknown> & { magnetLink?: string }>
  >([]);
  const [suggestions, setSuggestions] = useState<SuggestionDto[]>([]);
  const [health, setHealth] = useState<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (user?.role !== "admin") return;
    Promise.all([
      api.adminStats(),
      api.adminUsers(),
      api.adminQueries(),
      api.adminSuggestions(),
      api.adminHealth()
    ])
      .then(
        ([
          statsResponse,
          usersResponse,
          queriesResponse,
          suggestionsResponse,
          healthResponse
        ]) => {
          setStats(statsResponse.stats);
          setSettings(statsResponse.settings);
          setUsers(usersResponse.items);
          setQueries(queriesResponse.items);
          setSuggestions(suggestionsResponse.items);
          setHealth(healthResponse.whatslink);
        }
      )
      .catch(() => undefined);
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
          status: String(item.status || "-"),
          magnetLink:
            typeof item.magnetLink === "string" ? item.magnetLink : undefined
        }))}
      />
      <ListPanel
        title="用户建议"
        icon={<MessageSquarePlus size={18} />}
        empty="暂无建议"
        items={suggestions.map((item) => ({
          id: item.id,
          title: item.content,
          meta: `${item.email || item.actorKey} · ${formatDate(item.createdAt)}`,
          status: "suggestion"
        }))}
      />
    </section>
  );
}

function ListPanel(props: {
  title: string;
  icon?: React.ReactNode;
  empty: string;
  items: Array<{
    id: string;
    title: string;
    meta: string;
    status: string;
    magnetLink?: string;
  }>;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyMagnet(id: string, magnetLink: string) {
    try {
      await navigator.clipboard.writeText(magnetLink);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1600);
    } catch {
      // ignore
    }
  }

  return (
    <section className="list-panel">
      <h2>
        {props.icon}
        {props.title}
      </h2>
      {props.items.length === 0 ? (
        <p className="empty-text">{props.empty}</p>
      ) : (
        <div className="row-list">
          {props.items.map((item) => (
            <div className="data-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.meta}</span>
                {item.magnetLink ? (
                  <div className="leaderboard-link-row">
                    <code className="leaderboard-link" title={item.magnetLink}>
                      {item.magnetLink}
                    </code>
                    <button
                      className="link-button copy-link-button"
                      type="button"
                      onClick={() => copyMagnet(item.id, item.magnetLink!)}
                      title="复制完整磁力链接"
                    >
                      <Copy size={14} />
                      {copiedId === item.id ? "已复制" : "复制"}
                    </button>
                  </div>
                ) : null}
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
      <span>等待验牌</span>
      <p>贴上磁力链接后，先偷看文件名、大小、文件数和截图，再决定要不要下。</p>
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

function formatScore(value: number | null | undefined): string {
  const score = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (score > 0) return `+${score}`;
  return String(score);
}

function shortHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.message === "UNAUTHENTICATED") return "请先登录";
    if (error.message === "AUTH_INVALID") return "邮箱或密码不正确";
    if (error.message === "MAGNET_INVALID") return "磁力链接格式不正确";
    if (error.message === "RATE_LIMITED") return "查询过于频繁，请稍后再试";
    if (error.message === "WHATSLINK_UNAVAILABLE") return "上游查询暂时不可用";
    if (error.message === "MAGNET_NOT_FOUND") return "还没有这条资源的记录";
    if (error.message === "API_UNAVAILABLE") return "后端接口未就绪，请重启服务";
    return error.message;
  }
  return "请求失败";
}
