/**
 * Threads Dashboard - Frontend JavaScript
 */

const API_BASE = '/api';
let currentInsights = null;
let allPosts = [];
let charts = {};

// ===== Auth =====
async function initAuth() {
  try {
    const res = await fetch('/auth/me');
    if (res.status === 401) {
      location.href = '/login';
      return false;
    }
    const data = await res.json();
    if (data.success && data.user) {
      const nameEl = document.getElementById('userBadgeName');
      if (nameEl) nameEl.textContent = '@' + (data.user.username || data.user.name || '—');
    }
    return true;
  } catch {
    location.href = '/login';
    return false;
  }
}

// ===== Navigation =====
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`[onclick="navigate('${page}')"]`);
  if (navEl) navEl.classList.add('active');

  const titles = {
    dashboard: 'ダッシュボード',
    insights: 'インサイト分析',
    followers: 'フォロワー推移',
    creator: '投稿作成',
    calendar: 'コンテンツカレンダー',
    schedule: '予約投稿',
    posts: '投稿一覧',
    timing: '時間帯分析',
    velocity: '速度追跡',
    reports: 'レポート生成',
    secretary: '秘書',
    trend: 'バズパターン分析',
    competitor: '競合比較',
    replies: '返信分析',
    news: 'ニュース自動投稿',
  };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  // スケジュールページ以外に移動したら自動更新タイマーを止める
  if (page !== 'schedule') clearInterval(scheduleAutoReloadTimer);

  if (page === 'insights') loadInsightsPage();
  if (page === 'followers') loadFollowersPage();
  if (page === 'schedule') loadSchedule();
  if (page === 'posts') loadPostsPage();
  if (page === 'calendar') loadCalendarPage();
  if (page === 'timing') loadTimingPage();
  if (page === 'velocity') loadVelocityPage();
  if (page === 'trend') loadTrendPage();
  if (page === 'competitor') loadCompetitorPage();
  if (page === 'replies') loadRepliesPage();
  if (page === 'news') loadNewsPage();
}

// ===== Dashboard Load =====
async function loadDashboard(force = false) {
  try {
    showToast('info', force ? 'データを再取得中（数分かかります）...' : 'データを読み込み中...');
    const url = force ? '/insights-cached?force=1' : '/insights-cached';
    const data = await fetchAPI(url);
    currentInsights = data.data || data;
    allPosts = currentInsights.posts || [];

    updateKPIs(currentInsights);
    renderTrendTopics(currentInsights.trendTopics || []);
    renderTopPosts(currentInsights.topPosts || []);
    renderRecommendations(currentInsights);
    renderEngagementChart(allPosts);

    document.getElementById('lastUpdated').textContent =
      '最終更新: ' + new Date().toLocaleTimeString('ja-JP');
    if (data.cached) showToast('success', 'キャッシュデータを表示しています');
    else showToast('success', 'データを更新しました');
  } catch (e) {
    showToast('error', `データ取得失敗: ${e.message}`);
    updateKPIs(getDemoData());
    renderTrendTopics(getDemoTrends());
    renderTopPosts(getDemoPosts());
    renderRecommendations({});
  }
}

// ===== KPI Update =====
function updateKPIs(data) {
  const m = data.engagementMetrics || data || {};
  const posts = data.posts || [];

  setEl('kpi-followers', num(m.followersCount));
  setEl('kpi-engagement', `${m.engagementRate || m.avgEngagementRate || 0}%`);
  setEl('kpi-views', shortNum(m.totalViews || m.totalReach));
  setEl('kpi-views-sub', `平均 ${num(m.avgViews || 0)} / 投稿`);
  setEl('kpi-posts', num(posts.length || m.postCount));
  setEl('kpi-likes', shortNum(m.totalLikes));
  setEl('kpi-replies', shortNum(m.totalReplies));
  setEl('kpi-reposts', shortNum(m.totalReposts));
  setEl('kpi-avg-views', shortNum(m.avgViews));

  const er = parseFloat(m.engagementRate || m.avgEngagementRate || 0);
  const badge = document.getElementById('kpi-engagement-badge');
  if (badge) {
    if (er >= 3.0)      { badge.textContent = '目標達成';  badge.className = 'badge badge-green'; }
    else if (er >= 2.0) { badge.textContent = 'あと少し';  badge.className = 'badge badge-amber'; }
    else                { badge.textContent = '要改善';    badge.className = 'badge badge-red'; }
  }

  const sub = document.getElementById('kpi-followers-sub');
  if (sub) sub.textContent = `総閲覧 ${shortNum(m.totalViews || m.totalReach)}`;
}

// ===== Trend Topics =====
function renderTrendTopics(topics) {
  const el = document.getElementById('trendTopics');
  if (!el) return;
  if (!topics.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px"><div>データなし</div></div>';
    return;
  }
  const max = topics[0]?.count || 1;
  el.innerHTML = topics.slice(0, 10).map(t => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <span style="font-size:12px;color:var(--text2);width:90px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.word}</span>
      <div class="progress-bar" style="flex:1;">
        <div class="progress-fill" style="width:${Math.max(8,(t.count/max*100)).toFixed(0)}%;"></div>
      </div>
      <span style="font-size:11px;color:var(--text3);width:20px;text-align:right;">${t.count}</span>
    </div>`).join('');
}

// ===== Top Posts =====
function renderTopPosts(posts) {
  const el = document.getElementById('topPosts');
  if (!el) return;
  if (!posts.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px"><div>データなし</div></div>';
    return;
  }
  el.innerHTML = posts.slice(0, 5).map((p, i) => {
    const score = p.engagementScore || ((p.like_count||0)*2+(p.reply_count||0)*3+(p.repost_count||0)*4);
    return `
    <div style="padding:12px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:11px;font-weight:800;color:var(--accent);min-width:20px;">#${i+1}</span>
        <span style="font-size:12px;line-height:1.4;color:var(--text);">${(p.text||'').substring(0,55)}${(p.text||'').length>55?'…':''}</span>
      </div>
      <div style="display:flex;gap:12px;font-size:11px;color:var(--text3);padding-left:28px;">
        <span>👁 ${shortNum(p.views||0)}</span>
        <span>❤️ ${shortNum(p.like_count||0)}</span>
        <span>💬 ${shortNum(p.reply_count||0)}</span>
        <span>🔁 ${shortNum(p.repost_count||0)}</span>
        <span style="margin-left:auto;color:var(--accent);font-weight:700;">スコア: ${score}</span>
      </div>
    </div>`;
  }).join('');
}

// ===== Recommendations =====
function renderRecommendations(data) {
  const el = document.getElementById('recommendations');
  if (!el) return;
  const m = data?.engagementMetrics || {};
  const rec = data?.bestTimeRecommendation;
  const vp = data?.viralPosts;
  const cl = data?.contentLengthAnalysis;
  const va = data?.viralityAnalysis;
  const recs = [];

  if (parseFloat(m.engagementRate || m.avgEngagementRate || 0) < 3.0) {
    recs.push({ icon:'🔴', title:'エンゲージメント率向上', desc:`現在${m.engagementRate||m.avgEngagementRate||0}%（目標3%）。質問投稿・議論促進コンテンツを増やし、コメントへ積極的に返信しましょう。` });
  } else {
    recs.push({ icon:'✅', title:'エンゲージメント目標達成中', desc:'現在の戦略を継続しつつ、さらなる改善を図りましょう。' });
  }

  // データ駆動の最適時間帯
  if (rec && !rec.dataInsufficient && rec.topHours?.length) {
    const times = rec.topHours.slice(0, 3).map(h => `${h.label}（平均${shortNum(h.avgViews)}views）`).join('・');
    const bestDay = rec.topDays?.[0]?.label ? `${rec.topDays[0].label}曜日が最も成果が高い傾向です。` : '';
    recs.push({ icon:'⏰', title:'あなたの最適投稿時間帯（実績データより）', desc:`${times}。${bestDay}` });
  } else {
    recs.push({ icon:'⏰', title:'最適投稿時間帯を活用', desc:'平日 7:00・12:00・18:00・21:00、週末 9:00・12:00・15:00・20:00 に集中投稿でリーチを最大化できます。' });
  }

  // テキスト長の推奨
  if (cl?.bestBucket) {
    recs.push({ icon:'📝', title:`「${cl.bestBucket.label}」が最も拡散（実績データより）`, desc:`平均 ${shortNum(cl.bestBucket.avgViews)} views。投稿時はこの文字数帯を意識してみましょう。` });
  } else {
    recs.push({ icon:'💡', title:'保存・シェアされやすいコンテンツ', desc:'ノウハウ・Tips系はリポストされやすく、フォロワー外へのリーチ拡大に効果的です。' });
  }

  // バイラル投稿の時間帯
  if (vp?.count > 0 && vp.topHour) {
    recs.push({ icon:'🔥', title:`10万views超え投稿は${String(vp.topHour.hour).padStart(2,'0')}時台が最多`, desc:`${vp.count}件のバイラル投稿を分析。この時間帯に投稿することでバイラルの確率が上がる可能性があります。` });
  } else {
    recs.push({ icon:'💬', title:'コメントへの返信を徹底', desc:'返信はアルゴリズムへのシグナルになります。投稿後1時間以内のエンゲージメントが特に重要です。' });
  }

  el.innerHTML = recs.map(r => `
    <div style="border-left:2px solid var(--gray-300);padding:10px 14px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:3px;">${r.icon} ${r.title}</div>
      <div style="font-size:12px;color:var(--ink2);">${r.desc}</div>
    </div>`).join('');
}

// ===== Chart defaults (light mode) =====
const CHART_OPTS = {
  grid:    '#e5e7eb',
  tick:    '#9ca3af',
  legend:  '#6b7280',
  bar1:    'rgba(17,24,39,0.75)',
  bar1b:   'rgba(17,24,39,1)',
  bar2:    'rgba(107,114,128,0.45)',
  bar2b:   'rgba(107,114,128,0.9)',
  line:    'rgba(17,24,39,1)',
  doughnut: ['rgba(17,24,39,0.85)', 'rgba(59,130,246,0.75)', 'rgba(22,163,74,0.75)', 'rgba(217,119,6,0.75)'],
};

// ===== Engagement Chart (Dashboard) =====
function renderEngagementChart(posts) {
  const ctx = document.getElementById('engagementChart');
  if (!ctx) return;
  if (charts.engagement) charts.engagement.destroy();

  const sorted = [...posts]
    .sort((a, b) => (b.views||0) - (a.views||0))
    .slice(0, 30);

  charts.engagement = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map((_, i) => `#${i+1}`),
      datasets: [{
        label: '閲覧数',
        data: sorted.map(p => p.views || 0),
        backgroundColor: CHART_OPTS.bar1,
        borderColor: CHART_OPTS.bar1b,
        borderWidth: 0,
        borderRadius: 3,
      }, {
        label: 'エンゲージメント',
        data: sorted.map(p => (p.like_count||0)+(p.reply_count||0)+(p.repost_count||0)+(p.quote_count||0)),
        backgroundColor: CHART_OPTS.bar2,
        borderColor: CHART_OPTS.bar2b,
        borderWidth: 0,
        borderRadius: 3,
        yAxisID: 'y2',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CHART_OPTS.legend, font: { size: 11 }, boxWidth: 10, padding: 16 } } },
      scales: {
        x:  { ticks: { color: CHART_OPTS.tick, font: { size: 10 } }, grid: { color: CHART_OPTS.grid } },
        y:  { ticks: { color: CHART_OPTS.tick, font: { size: 10 } }, grid: { color: CHART_OPTS.grid } },
        y2: { position: 'right', ticks: { color: CHART_OPTS.tick, font: { size: 10 } }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

// ===== Insights Page =====
async function loadInsightsPage() {
  if (!currentInsights && allPosts.length === 0) {
    await loadDashboard();
  }
  const m = currentInsights?.engagementMetrics || {};
  const posts = allPosts;

  // ① リーチ率（平均閲覧数 ÷ フォロワー数）
  const followers = m.followersCount || 0;
  const avgViews = m.avgViews || 0;
  const reachRate = followers > 0 ? ((avgViews / followers) * 100) : 0;
  setEl('ins-reach-rate', reachRate.toFixed(1) + '%');
  const reachBadge = document.getElementById('ins-reach-badge');
  if (reachBadge) {
    if (reachRate >= 30)      { reachBadge.textContent = '優秀'; reachBadge.className = 'badge badge-green'; }
    else if (reachRate >= 10) { reachBadge.textContent = '普通'; reachBadge.className = 'badge badge-amber'; }
    else if (reachRate > 0)   { reachBadge.textContent = '要改善'; reachBadge.className = 'badge badge-red'; }
    else                      { reachBadge.textContent = ''; }
  }

  // ④ リポスト率（総リポスト＋総引用 ÷ 総閲覧数）
  const totalViews = m.totalViews || m.totalReach || 0;
  const totalSpread = (m.totalReposts || 0) + (m.totalQuotes || 0);
  const repostRate = totalViews > 0 ? (totalSpread / totalViews * 100) : 0;
  setEl('ins-repost-rate', repostRate.toFixed(2) + '%');
  const repostBadge = document.getElementById('ins-repost-badge');
  if (repostBadge) {
    if (repostRate >= 1.0)      { repostBadge.textContent = '高拡散'; repostBadge.className = 'badge badge-green'; }
    else if (repostRate >= 0.3) { repostBadge.textContent = '普通'; repostBadge.className = 'badge badge-amber'; }
    else if (repostRate > 0)    { repostBadge.textContent = '低め'; repostBadge.className = 'badge badge-red'; }
    else                        { repostBadge.textContent = ''; }
  }

  // ⑤ 返信率（総返信 ÷ 総閲覧数）
  const replyRate = totalViews > 0 ? ((m.totalReplies || 0) / totalViews * 100) : 0;
  setEl('ins-reply-rate', replyRate.toFixed(2) + '%');
  const replyBadge = document.getElementById('ins-reply-badge');
  if (replyBadge) {
    if (replyRate >= 0.5)       { replyBadge.textContent = '高共感'; replyBadge.className = 'badge badge-green'; }
    else if (replyRate >= 0.15) { replyBadge.textContent = '普通'; replyBadge.className = 'badge badge-amber'; }
    else if (replyRate > 0)     { replyBadge.textContent = '低め'; replyBadge.className = 'badge badge-red'; }
    else                        { replyBadge.textContent = ''; }
  }

  // アカウント指標
  const metricsEl = document.getElementById('insightsMetrics');
  if (metricsEl) {
    metricsEl.innerHTML = [
      ['フォロワー数',       num(m.followersCount)],
      ['エンゲージメント率', `${m.engagementRate || m.avgEngagementRate || 0}%`],
      ['総閲覧数',           num(totalViews)],
      ['平均閲覧数 / 投稿',  num(m.avgViews)],
      ['リーチ率',           reachRate.toFixed(1) + '%'],
      ['リポスト率',         repostRate.toFixed(2) + '%'],
      ['返信率',             replyRate.toFixed(2) + '%'],
      ['総いいね',           num(m.totalLikes)],
      ['総返信',             num(m.totalReplies)],
      ['総リポスト',         num(m.totalReposts)],
      ['総引用',             num(m.totalQuotes)],
      ['分析投稿数',         num(m.postCount || posts.length)],
    ].map(([name, val]) => `
      <div class="metric-row">
        <span class="metric-name">${name}</span>
        <span class="metric-val">${val ?? '—'}</span>
      </div>`).join('');
  }

  // エンゲージメント内訳（割合付き）
  renderEngBreakdownChart(m);
  const totalEng = (m.totalLikes||0) + (m.totalReplies||0) + (m.totalReposts||0) + (m.totalQuotes||0);
  const statsEl = document.getElementById('engBreakdownStats');
  if (statsEl && totalEng > 0) {
    statsEl.innerHTML = [
      ['いいね',   m.totalLikes||0,   'var(--accent)'],
      ['返信',     m.totalReplies||0, 'var(--blue)'],
      ['リポスト', m.totalReposts||0, 'var(--green)'],
      ['引用',     m.totalQuotes||0,  'var(--amber)'],
    ].map(([label, val, color]) => {
      const pct = (val / totalEng * 100).toFixed(1);
      return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="width:46px;font-size:12px;color:var(--ink2);">${label}</span>
        <div style="flex:1;background:var(--border);border-radius:3px;height:5px;overflow:hidden;">
          <div style="background:${color};height:100%;width:${pct}%;border-radius:3px;"></div>
        </div>
        <span style="font-size:11px;color:var(--ink2);width:36px;text-align:right;">${pct}%</span>
      </div>`;
    }).join('');
  }

  // ③ カテゴリ別パフォーマンス（投稿タイプ別）
  renderCategoryPerformance(posts);

  // ER分布チャート
  renderERDistributionChart(posts);

  renderTopViewsChart(posts);
}

function renderCategoryPerformance(posts) {
  const el = document.getElementById('categoryPerformance');
  if (!el) return;

  const typeLabel = { TEXT_POST: 'テキスト', IMAGE: '画像', VIDEO: '動画', CAROUSEL_ALBUM: 'カルーセル' };
  const groups = {};
  posts.forEach(p => {
    const type = p.media_type || 'TEXT_POST';
    if (!groups[type]) groups[type] = [];
    groups[type].push(p);
  });

  if (!Object.keys(groups).length) {
    el.innerHTML = '<div class="empty"><div class="empty-text">データなし</div></div>';
    return;
  }

  const rows = Object.entries(groups).map(([type, ps]) => {
    const avgV  = ps.reduce((s, p) => s + (p.views||0), 0) / ps.length;
    const avgER = ps.reduce((s, p) => s + parseFloat(p.engagementRate||0), 0) / ps.length;
    const avgRP = ps.reduce((s, p) => s + (p.repost_count||0), 0) / ps.length;
    const avgRL = ps.reduce((s, p) => s + (p.reply_count||0), 0) / ps.length;
    return { type, label: typeLabel[type] || type, count: ps.length, avgV, avgER, avgRP, avgRL };
  }).sort((a, b) => b.avgV - a.avgV);

  const maxV = rows[0]?.avgV || 1;
  el.innerHTML = rows.map((r, i) => `
    <div style="padding:12px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;">
          ${i === 0 ? '<span class="badge badge-amber" style="font-size:10px;">Best</span>' : ''}
          <span style="font-size:13px;font-weight:600;">${r.label}</span>
          <span style="font-size:11px;color:var(--ink3);">${r.count}件</span>
        </div>
        <span style="font-size:13px;font-weight:700;">${shortNum(Math.round(r.avgV))} views</span>
      </div>
      <div style="background:var(--border);border-radius:3px;height:5px;overflow:hidden;margin-bottom:8px;">
        <div style="background:var(--accent);height:100%;width:${(r.avgV/maxV*100).toFixed(0)}%;border-radius:3px;"></div>
      </div>
      <div style="display:flex;gap:16px;font-size:11px;color:var(--ink2);">
        <span>平均ER <strong>${r.avgER.toFixed(2)}%</strong></span>
        <span>平均リポスト <strong>${r.avgRP.toFixed(1)}</strong></span>
        <span>平均返信 <strong>${r.avgRL.toFixed(1)}</strong></span>
      </div>
    </div>`).join('');
}

function renderERDistributionChart(posts) {
  const ctx = document.getElementById('erDistributionChart');
  if (!ctx) return;
  if (charts.erDist) charts.erDist.destroy();

  // ERを0-1%, 1-2%, 2-3%, 3-5%, 5-10%, 10%+ にバケット化
  const buckets = [
    { label: '0-1%',  min: 0,  max: 1  },
    { label: '1-2%',  min: 1,  max: 2  },
    { label: '2-3%',  min: 2,  max: 3  },
    { label: '3-5%',  min: 3,  max: 5  },
    { label: '5-10%', min: 5,  max: 10 },
    { label: '10%+',  min: 10, max: Infinity },
  ];
  const counts = buckets.map(b =>
    posts.filter(p => {
      const er = parseFloat(p.engagementRate || 0);
      return er >= b.min && er < b.max;
    }).length
  );

  charts.erDist = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.label),
      datasets: [{
        label: '投稿数',
        data: counts,
        backgroundColor: counts.map((_, i) => i >= 3 ? 'rgba(17,24,39,0.8)' : 'rgba(17,24,39,0.25)'),
        borderRadius: 4,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.raw}件` } },
      },
      scales: {
        x: { ticks: { color: CHART_OPTS.tick, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: CHART_OPTS.tick, font: { size: 10 }, stepSize: 1 }, grid: { color: CHART_OPTS.grid } },
      },
    },
  });
}

function renderEngBreakdownChart(m) {
  const ctx = document.getElementById('engBreakdownChart');
  if (!ctx) return;
  if (charts.engBreakdown) charts.engBreakdown.destroy();

  charts.engBreakdown = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['いいね', '返信', 'リポスト', '引用'],
      datasets: [{
        data: [m.totalLikes||0, m.totalReplies||0, m.totalReposts||0, m.totalQuotes||0],
        backgroundColor: CHART_OPTS.doughnut,
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: CHART_OPTS.legend, font: { size: 11 }, padding: 14, boxWidth: 10 } },
      },
    },
  });
}

function renderTopViewsChart(posts) {
  const ctx = document.getElementById('topViewsChart');
  if (!ctx) return;
  if (charts.topViews) charts.topViews.destroy();

  const top20 = [...posts].sort((a,b) => (b.views||0)-(a.views||0)).slice(0,20);
  charts.topViews = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top20.map(p => (p.text||'').substring(0,22)+'…'),
      datasets: [{
        label: '閲覧数',
        data: top20.map(p => p.views||0),
        backgroundColor: CHART_OPTS.bar1,
        borderRadius: 3,
        borderWidth: 0,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_OPTS.tick, font: { size: 10 } }, grid: { color: CHART_OPTS.grid } },
        y: { ticks: { color: CHART_OPTS.tick, font: { size: 10 } }, grid: { color: CHART_OPTS.grid } },
      },
    },
  });
}

// ===== Followers Page =====
async function loadFollowersPage() {
  try {
    const data = await fetchAPI('/followers-history');
    let history = data.history || [];

    if (currentInsights?.engagementMetrics?.followersCount) {
      const today = new Date().toISOString().split('T')[0];
      if (!history.find(h => h.date === today)) {
        history.push({ date: today, followers: currentInsights.engagementMetrics.followersCount });
      }
    }

    history.sort((a, b) => a.date.localeCompare(b.date));

    const current = history[history.length - 1]?.followers || 0;
    const max = Math.max(...history.map(h => h.followers), 0);

    setEl('fol-current', num(current));
    setEl('fol-max', num(max));
    setEl('fol-days', history.length + '日');

    renderFollowersChart(history);
    renderFollowersTable(history);
  } catch (e) {
    showToast('error', 'フォロワーデータ取得失敗');
  }
}

function renderFollowersChart(history) {
  const ctx = document.getElementById('followersChart');
  if (!ctx) return;
  if (charts.followers) charts.followers.destroy();

  charts.followers = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.date),
      datasets: [{
        label: 'フォロワー数',
        data: history.map(h => h.followers),
        borderColor: CHART_OPTS.line,
        backgroundColor: function(ctx) {
          const chart = ctx.chart;
          const {ctx: c, chartArea} = chart;
          if (!chartArea) return 'transparent';
          const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(17,24,39,0.12)');
          gradient.addColorStop(1, 'rgba(17,24,39,0)');
          return gradient;
        },
        borderWidth: 1.5,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: CHART_OPTS.line,
        pointRadius: history.length > 30 ? 2 : 3,
        pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString()} フォロワー` },
        },
      },
      scales: {
        x: { ticks: { color: CHART_OPTS.tick, font: { size: 10 }, maxTicksLimit: 12 }, grid: { color: CHART_OPTS.grid } },
        y: {
          ticks: { color: CHART_OPTS.tick, font: { size: 10 }, callback: v => v.toLocaleString() },
          grid: { color: CHART_OPTS.grid },
        },
      },
    },
  });
}

function renderFollowersTable(history) {
  const tbody = document.getElementById('followersTable');
  if (!tbody) return;

  const reversed = [...history].reverse();
  tbody.innerHTML = reversed.map((h, i) => {
    const prev = reversed[i + 1];
    const diff = prev ? h.followers - prev.followers : null;
    const diffStr = diff === null ? '-' :
      diff > 0 ? `<span class="text-success">+${diff.toLocaleString()}</span>` :
      diff < 0 ? `<span class="text-danger">${diff.toLocaleString()}</span>` :
      `<span class="text-muted">±0</span>`;
    return `<tr><td>${h.date}</td><td style="font-weight:700;">${h.followers.toLocaleString()}</td><td>${diffStr}</td></tr>`;
  }).join('');
}

// ===== Post Creator =====
function onPreviewInput() {
  const preview = document.getElementById('postPreview');
  const text = preview.value || '';
  updateCharCount(text);
  document.getElementById('scheduleBtn').disabled = text.trim().length === 0;
}

async function generatePost() {
  const topic = document.getElementById('postTopic').value.trim();
  const category = document.getElementById('postCategory').value;
  const keywords = document.getElementById('postKeywords').value;

  if (!topic) { showToast('error', 'トピックを入力してください'); return; }

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 生成中...';

  const preview = document.getElementById('postPreview');
  preview.value = 'AIが投稿を生成中です...';

  try {
    const resp = await fetchAPI('/generate-post', {
      method: 'POST',
      body: JSON.stringify({ topic, category, keywords }),
    });
    const text = resp.content?.text || resp.text || '';
    preview.value = text;
    updateCharCount(text);
    document.getElementById('scheduleBtn').disabled = false;
    showToast('success', '投稿を生成しました');
  } catch (e) {
    const text = getTemplate(category, topic);
    preview.value = text;
    updateCharCount(text);
    document.getElementById('scheduleBtn').disabled = false;
    const reason = e.message?.includes('credit') || e.message?.includes('balance')
      ? 'APIクレジット不足のため'
      : e.message?.includes('401') || e.message?.includes('auth')
      ? 'APIキーが無効なため'
      : 'AI生成に失敗したため';
    showToast('info', `${reason}テンプレートを使用しています`);
    document.getElementById('postStatus').textContent = `⚠️ ${reason}テンプレート表示中`;
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ AIで投稿を生成';
  }
}

function updateCharCount(text) {
  const el = document.getElementById('charCount');
  if (el) {
    const len = text.length;
    el.textContent = `${len} / 500文字`;
    el.style.color = len > 500 ? 'var(--red)' : '';
  }
}

function clearPost() {
  const preview = document.getElementById('postPreview');
  preview.value = '';
  updateCharCount('');
  document.getElementById('scheduleBtn').disabled = true;
  document.getElementById('postStatus').textContent = '';
  preview.focus();
}

function copyPost() {
  const text = document.getElementById('postPreview').value;
  navigator.clipboard.writeText(text).then(() => showToast('success', 'クリップボードにコピーしました'));
}

function useTemplate(type) {
  const topic = document.getElementById('postTopic').value || 'テーマ';
  const text = getTemplate(type, topic);
  const preview = document.getElementById('postPreview');
  preview.value = text;
  updateCharCount(text);
  document.getElementById('scheduleBtn').disabled = false;
}

function getTemplate(type, topic) {
  const templates = {
    tips: `【${topic}】\n\n知っておくと得する3つのポイント：\n\n1️⃣ まず基本から始める\n→ 小さな一歩が大きな変化につながります\n\n2️⃣ 継続が最大の武器\n→ 毎日少しずつ積み上げることで差がつく\n\n3️⃣ 結果を振り返る習慣\n→ PDCAサイクルで改善し続ける\n\nあなたはどれが一番難しいと感じますか？\n\n#生産性 #自己改善 #習慣化`,
    question: `質問させてください🙋\n\n${topic}\n\n□ 毎日やっている\n□ たまにやっている\n□ やりたいけどできていない\n□ 必要を感じていない\n\nコメントで教えてください！\n\n#アンケート #みんなの意見`,
    story: `正直に話します。\n\n${topic}\n\n最初は全くうまくいきませんでした。\n何度も挫折しかけて...\n\nでもあるきっかけで考え方が変わって——\n今では毎日が楽しくて仕方がありません。\n\n詳しい話、気になる方はコメントください。\n\n#体験談 #気づき`,
    list: `${topic}について\nやってよかったこと5選：\n\n① ______\n② ______\n③ ______\n④ ______\n⑤ ______\n\n特に①が一番インパクトがありました。\n\nあなたは何かやっていますか？\n\n#まとめ #おすすめ`,
    trend: `【${topic}】\n\n最近よく耳にするこのワード。\n実際のところどうなの？と気になって調べてみました。\n\n結論：◯◯が重要でした。\n\n詳しくは続きで👇\n\n#トレンド #最新情報`,
    behind: `投稿作成の裏側を公開します👀\n\n${topic}\n\n実は普段こんな流れで作っています：\n\n📝 ネタ収集 → 🤔 構成を考える → ✍️ 執筆 → 👀 見直し → 🚀 投稿\n\n意外と地道な作業です笑\n\n#裏側 #制作過程`,
    promotion: `お知らせがあります📢\n\n${topic}\n\n▶ どんな人に向けてか\n同じ悩みを持つ方、一度見てみてください。\n\n▶ 得られること\n具体的に◯◯が変わります。\n\n▶ 詳細・お問い合わせ\nプロフィールのリンクから、またはDMでどうぞ！\n\n#お知らせ #新着情報 #ご案内`,
  };
  return templates[type] || templates.tips;
}

async function scheduleCurrentPost() {
  const text = document.getElementById('postPreview').value;
  const dt = document.getElementById('scheduleDateTime').value;

  if (!text.trim()) { showToast('error', '投稿内容を入力してください'); return; }
  if (!dt) { showToast('error', '投稿日時を設定してください'); return; }

  const btn = document.getElementById('scheduleBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 設定中...';

  try {
    await fetchAPI('/schedule-post', {
      method: 'POST',
      body: JSON.stringify({ text, scheduledAt: dt }),
    });
    const dtLabel = new Date(dt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    showToast('success', `${dtLabel} に予約しました`);
    btn.textContent = '✅ 予約完了';
    document.getElementById('postStatus').textContent = `予約済み: ${dtLabel}`;
    setTimeout(() => { btn.textContent = 'この投稿を予約する'; btn.disabled = text.trim().length === 0; }, 3000);
  } catch (e) {
    showToast('error', `予約失敗: ${e.message}`);
    btn.disabled = false;
    btn.textContent = 'この投稿を予約する';
  }
}

// ===== Calendar =====
async function loadCalendarPage() {
  await Promise.all([loadScheduledTimeline(), generatePlan()]);
}

async function loadScheduledTimeline() {
  const el = document.getElementById('scheduledTimeline');
  const countEl = document.getElementById('scheduledCount');
  try {
    const data = await fetchAPI('/schedule');
    const posts = (data.posts || []).filter(p => p.status === 'scheduled');
    posts.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

    if (countEl) countEl.textContent = `${posts.length}件`;

    if (!posts.length) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">予約済みの投稿はありません</div></div>`;
      return;
    }

    // 日付ごとにグループ化
    const grouped = {};
    posts.forEach(p => {
      const d = new Date(p.scheduledAt);
      const key = d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(p);
    });

    el.innerHTML = Object.entries(grouped).map(([date, items]) => `
      <div style="margin-bottom:4px;">
        <div style="font-size:11px;font-weight:700;color:var(--ink2);padding:10px 16px 6px;background:var(--surface-raised);border-bottom:1px solid var(--border);">${date}</div>
        ${items.map(p => {
          const time = new Date(p.scheduledAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
          const text = p.content?.text || p.topic || '-';
          const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;
          return `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);">
            <div style="flex-shrink:0;text-align:center;min-width:44px;">
              <div style="font-size:15px;font-weight:800;color:var(--accent);">${time}</div>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;color:var(--ink);line-height:1.5;white-space:pre-wrap;word-break:break-word;">${escHtml(preview)}</div>
            </div>
            <div style="flex-shrink:0;">
              <button class="btn btn-danger btn-xs" onclick="cancelPostAndRefresh('${p.jobId}')">キャンセル</button>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('');
  } catch (e) {
    if (el) el.innerHTML = `<div class="empty"><div class="empty-text text-muted">読み込み失敗</div></div>`;
  }
}

async function cancelPostAndRefresh(jobId) {
  if (!confirm('この予約投稿をキャンセルしますか？')) return;
  try {
    await fetchAPI(`/schedule/${jobId}`, { method: 'DELETE' });
    showToast('success', 'キャンセルしました');
    loadScheduledTimeline();
  } catch (e) {
    showToast('error', `キャンセル失敗: ${e.message}`);
  }
}

async function generatePlan() {
  showToast('info', 'コンテンツ計画を生成中...');
  try {
    const data = await fetchAPI('/plan', {
      method: 'POST',
      body: JSON.stringify({ postsPerWeek: 7 }),
    });
    const posts = data.plan?.posts || [];
    renderCalendar(posts);
    renderCalendarTable(posts);
    const weekOf = data.plan?.weekOf || '';
    setEl('calWeekLabel', `${weekOf} 週のコンテンツ計画`);
    showToast('success', 'コンテンツ計画を生成しました');
  } catch (e) {
    showToast('error', `生成失敗: ${e.message}`);
  }
}

function renderCalendar(posts) {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return;

  const days = ['月', '火', '水', '木', '金', '土', '日'];
  const grouped = {};
  posts.forEach(p => {
    const d = new Date(p.scheduledAt);
    let dayIdx = d.getDay() - 1;
    if (dayIdx < 0) dayIdx = 6;
    if (!grouped[dayIdx]) grouped[dayIdx] = [];
    grouped[dayIdx].push(p);
  });

  grid.innerHTML = days.map((d, i) => `
    <div class="cal-day">
      <div class="cal-day-header">${d}</div>
      ${(grouped[i] || []).map(p => `
        <div class="cal-post" title="${escHtml(p.topic)}" onclick="prefillCreator('${escHtml(p.topic)}', '${p.categoryId||'tips'}')">
          <div style="font-size:16px;margin-bottom:2px;">${p.categoryEmoji || '📝'}</div>
          <div style="color:var(--text2);line-height:1.3;">${(p.topic||'').substring(0,18)}${(p.topic||'').length>18?'…':''}</div>
          <div style="color:var(--text3);font-size:10px;margin-top:2px;">${(p.scheduledAt||'').split(' ')[1]||''}</div>
        </div>`).join('')}
      ${!(grouped[i]||[]).length ? '<div class="cal-empty">未定</div>' : ''}
    </div>`).join('');
}

function renderCalendarTable(posts) {
  const tbody = document.getElementById('calendarTable');
  if (!tbody) return;
  const engMap = { high: '<span class="badge badge-green">高</span>', medium: '<span class="badge badge-blue">中</span>', low: '<span class="badge badge-amber">低</span>' };
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  if (!posts.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="empty-icon">📋</div><div class="empty-text">計画を生成してください</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = posts.map(p => {
    const d = new Date(p.scheduledAt);
    const dateStr = isNaN(d) ? p.scheduledAt : d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
    const timeStr = isNaN(d) ? '' : d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const wday = isNaN(d) ? '' : `<span style="color:var(--ink2)">${weekdays[d.getDay()]}</span>`;
    return `
    <tr>
      <td style="white-space:nowrap;font-weight:600;">${dateStr} <span style="font-size:12px;color:var(--ink3);">${timeStr}</span></td>
      <td>${wday}</td>
      <td><span class="badge badge-dark">${p.categoryEmoji||''} ${p.category||''}</span></td>
      <td style="max-width:200px;">${p.topic||''}</td>
      <td>${engMap[p.estimatedEngagement] || '-'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="prefillCreator('${escHtml(p.topic)}', '${p.categoryId||'tips'}')">この内容で作成</button>
      </td>
    </tr>`;
  }).join('');
}

function prefillCreator(topic, category) {
  document.getElementById('postTopic').value = topic;
  document.getElementById('postCategory').value = category;
  navigate('creator');
}

// ===== Schedule =====
let scheduleAutoReloadTimer = null;

async function loadSchedule() {
  const container = document.getElementById('scheduleCards');
  try {
    const data = await fetchAPI('/schedule');
    const posts = (data.posts || []).sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));

    const scheduled = posts.filter(p => p.status === 'scheduled').length;
    const published = posts.filter(p => p.status === 'published').length;
    const failed    = posts.filter(p => p.status === 'failed').length;

    setEl('sch-scheduled', scheduled);
    setEl('sch-published', published);
    setEl('sch-failed', failed);
    setEl('sch-last-updated', `最終更新: ${new Date().toLocaleTimeString('ja-JP')}`);

    if (!posts.length) {
      container.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">投稿はまだありません</div></div>`;
      return;
    }

    const statusInfo = {
      scheduled: { badge: 'badge-blue',  label: '予約済み',  icon: '⏳', desc: p => `実行予定: ${fmtDt(p.scheduledAt)}` },
      published: { badge: 'badge-green', label: '投稿済み',  icon: '✅', desc: p => `投稿日時: ${fmtDt(p.publishedAt || p.scheduledAt)}` },
      failed:    { badge: 'badge-red',   label: '失敗',      icon: '❌', desc: p => `エラー: ${p.error || '不明'}` },
      cancelled: { badge: 'badge-gray',  label: 'キャンセル', icon: '🚫', desc: p => `キャンセル済み` },
    };

    container.innerHTML = posts.map(p => {
      const s = statusInfo[p.status] || statusInfo.cancelled;
      const text = p.content?.text || p.topic || '-';
      const preview = text.length > 80 ? text.substring(0, 80) + '…' : text;
      const threadLink = p.postId
        ? `<a href="https://www.threads.com/@kzktone/post/${p.postId}" target="_blank" rel="noopener"
             style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--blue);text-decoration:none;font-weight:500;">
             Threadsで確認
           </a>`
        : '';
      const actions = p.status === 'scheduled'
        ? `<button class="btn btn-danger btn-xs" onclick="cancelPost('${p.jobId}')">キャンセル</button>`
        : threadLink;

      return `
      <div style="display:flex;align-items:flex-start;gap:14px;padding:16px;border-bottom:1px solid var(--border);">
        <div style="font-size:22px;flex-shrink:0;padding-top:2px;">${s.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span class="badge ${s.badge}">${s.label}</span>
            <span style="font-size:11px;color:var(--ink3);">${s.desc(p)}</span>
          </div>
          <div style="font-size:13px;color:var(--ink);line-height:1.6;white-space:pre-wrap;word-break:break-word;margin-bottom:6px;">${escHtml(preview)}</div>
          <div style="font-size:11px;color:var(--ink3);">予約日時: ${fmtDt(p.scheduledAt)}</div>
        </div>
        <div style="flex-shrink:0;">${actions}</div>
      </div>`;
    }).join('');

    // 予約済みがあれば30秒ごとに自動更新
    clearInterval(scheduleAutoReloadTimer);
    if (scheduled > 0) {
      let countdown = 30;
      setEl('sch-autoreload', `${countdown}秒後`);
      scheduleAutoReloadTimer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          loadSchedule();
          countdown = 30;
        }
        setEl('sch-autoreload', `${countdown}秒後`);
      }, 1000);
    } else {
      setEl('sch-autoreload', '待機中');
    }
  } catch (e) {
    if (container) container.innerHTML = `<div class="empty"><div class="empty-text">読み込み失敗: ${e.message}</div></div>`;
  }
}

function fmtDt(dt) {
  if (!dt) return '-';
  return new Date(dt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function cancelPost(jobId) {
  if (!confirm('この予約投稿をキャンセルしますか？')) return;
  try {
    await fetchAPI(`/schedule/${jobId}`, { method: 'DELETE' });
    showToast('success', 'キャンセルしました');
    loadSchedule();
  } catch (e) {
    showToast('error', `キャンセル失敗: ${e.message}`);
  }
}

// ===== Posts Page =====
async function loadPostsPage() {
  if (allPosts.length === 0) await loadDashboard();
  sortPosts();
}

function sortPosts() {
  const sortBy = document.getElementById('postSortBy')?.value || 'views';
  const sorted = [...allPosts].sort((a, b) => {
    if (sortBy === 'views') return (b.views||0) - (a.views||0);
    if (sortBy === 'likes') return (b.like_count||0) - (a.like_count||0);
    if (sortBy === 'er') return (b.engagementRate||0) - (a.engagementRate||0);
    if (sortBy === 'date') return new Date(b.timestamp) - new Date(a.timestamp);
    return 0;
  });

  const tbody = document.getElementById('postsTable');
  if (!tbody) return;

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📭</div><div>投稿データがありません</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((p, i) => {
    const dt = p.timestamp ? new Date(p.timestamp).toLocaleDateString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
    const er = parseFloat(p.engagementRate || 0);
    const erColor = er >= 3 ? 'var(--green)' : er >= 1 ? 'var(--ink)' : 'var(--ink3)';
    const text = p.text || '';
    const short = text.length > 50 ? text.substring(0, 50) + '…' : text;
    const hasMore = text.length > 50;
    const expandId = `post-text-${i}`;
    return `<tr>
      <td style="white-space:nowrap;font-size:12px;color:var(--ink2);">${dt}</td>
      <td style="max-width:280px;font-size:13px;line-height:1.4;color:var(--ink);">
        <span id="${expandId}-short">${escHtml(short)}${hasMore ? `<button onclick="togglePostText('${expandId}')" style="background:none;border:none;color:var(--blue);font-size:11px;cursor:pointer;margin-left:4px;">続きを見る</button>` : ''}</span>
        ${hasMore ? `<span id="${expandId}-full" style="display:none;">${escHtml(text)}<button onclick="togglePostText('${expandId}')" style="background:none;border:none;color:var(--blue);font-size:11px;cursor:pointer;margin-left:4px;">閉じる</button></span>` : ''}
      </td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${shortNum(p.views||0)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${shortNum(p.like_count||0)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${shortNum(p.reply_count||0)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${shortNum(p.repost_count||0)}</td>
      <td style="text-align:right;font-weight:600;color:${erColor};">${er.toFixed(2)}%</td>
      <td style="text-align:center;">${p.permalink ? `<a href="${p.permalink}" target="_blank" style="font-size:13px;color:var(--ink2);" title="Threadsで開く">↗</a>` : '<span style="color:var(--ink3);font-size:12px;">—</span>'}</td>
    </tr>`;
  }).join('');
}

function togglePostText(id) {
  const shortEl = document.getElementById(`${id}-short`);
  const fullEl  = document.getElementById(`${id}-full`);
  if (!shortEl || !fullEl) return;
  const isExpanded = fullEl.style.display !== 'none';
  shortEl.style.display = isExpanded ? '' : 'none';
  fullEl.style.display  = isExpanded ? 'none' : '';
}

// ===== Reports =====
async function generateReport() {
  const type = document.getElementById('reportType').value;
  const client = document.getElementById('reportClient').value;
  let startDate, endDate;

  const now = new Date();
  if (type === 'monthly') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  } else if (type === 'weekly') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    startDate = d.toISOString().split('T')[0];
    endDate = now.toISOString().split('T')[0];
  } else {
    startDate = document.getElementById('reportStart').value;
    endDate = document.getElementById('reportEnd').value;
    if (!startDate || !endDate) { showToast('error', '開始日と終了日を入力してください'); return; }
    if (new Date(endDate) < new Date(startDate)) { showToast('error', '終了日は開始日より後の日付を選んでください'); return; }
    if (new Date(endDate) > now) { showToast('error', '終了日は今日以前の日付を選んでください'); return; }
  }

  const btn = document.querySelector('[onclick="generateReport()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中...'; }

  showToast('info', 'レポートを生成中...');
  try {
    const result = await fetchAPI('/report', {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate, clientName: client }),
    });

    const htmlFile = result.htmlFile || '';
    const excelFile = result.excelFile || '';
    const generatedAt = new Date().toLocaleString('ja-JP');

    const listEl = document.getElementById('reportsList');
    const newItem = document.createElement('div');
    newItem.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:10px;';
    newItem.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="font-weight:700;font-size:13px;">📊 ${startDate} 〜 ${endDate}</div>
        <span class="badge badge-green">生成済み</span>
      </div>
      <div style="font-size:11px;color:var(--ink3);margin-bottom:12px;">生成日時: ${generatedAt}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${htmlFile ? `<a href="/api/report/pdf/${htmlFile}" download style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:var(--accent);color:white;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;">PDFダウンロード</a>` : ''}
        ${htmlFile ? `<a href="/api/report/download/${htmlFile}" download style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:500;color:var(--ink);text-decoration:none;background:white;">HTMLダウンロード</a>` : ''}
        ${excelFile ? `<a href="/api/report/download/${excelFile}" download style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:500;color:var(--ink);text-decoration:none;background:white;">Excelダウンロード</a>` : ''}
      </div>`;
    listEl.insertBefore(newItem, listEl.firstChild);
    newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    showToast('success', 'レポートを生成しました');
  } catch (e) {
    showToast('error', `生成失敗: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'レポートを生成'; }
  }
}

// ===== Timing Analysis Page =====
async function loadTimingPage() {
  if (!currentInsights) await loadDashboard();
  const d = currentInsights || {};
  const ta = d.timeAnalysis;
  const vp = d.viralPosts;
  const cl = d.contentLengthAnalysis;
  const va = d.viralityAnalysis;
  const rec = d.bestTimeRecommendation;

  // 最適時間バナー
  const bannerEl = document.getElementById('bestTimeCard');
  if (bannerEl) {
    if (rec && !rec.dataInsufficient) {
      const topHours = (rec.topHours || []).slice(0, 3).map(h =>
        `<span class="badge badge-dark" style="font-size:13px;padding:5px 12px;">${h.label}</span>`
      ).join(' ');
      const topDay = rec.topDays?.[0] ? `・${rec.topDays[0].label}曜日が最高成果` : '';
      const totalPosts = (d.posts || []).length;
      bannerEl.innerHTML = `
        <div class="card-header">
          <div class="card-title">最適投稿時間（実績データより自動算出）</div>
          <span class="badge badge-blue">${totalPosts}件のデータから算出</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          ${topHours}
          <span style="font-size:12px;color:var(--ink2);">${topDay}</span>
        </div>
        <div style="font-size:12px;color:var(--ink3);margin-top:8px;">${rec.summary || ''}</div>`;
    } else {
      const totalPosts = (d.posts || []).length;
      const needed = 10;
      const progress = Math.min(totalPosts, needed);
      bannerEl.innerHTML = `
        <div class="card-header"><div class="card-title">最適投稿時間</div></div>
        <div style="font-size:13px;color:var(--ink2);margin-bottom:10px;">あと <strong>${Math.max(0, needed - totalPosts)}件</strong>の投稿データが蓄積されると、あなたのアカウント専用の最適時間が自動計算されます。</div>
        <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden;">
          <div style="background:var(--accent);height:100%;width:${(progress/needed*100).toFixed(0)}%;border-radius:4px;transition:width 0.5s;"></div>
        </div>
        <div style="font-size:11px;color:var(--ink3);margin-top:4px;">${totalPosts} / ${needed}件</div>`;
    }
  }

  // 時間帯チャート
  if (ta) {
    renderHourlyChart(ta.hourly || []);
    renderWeeklyChart(ta.weekly || []);
  }

  // バイラル投稿パネル
  const viralEl = document.getElementById('viralPostsPanel');
  if (viralEl) {
    if (vp?.count > 0) {
      const hourDist = Object.entries(vp.hourDistribution || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([h, c]) => `<div class="metric-row"><span class="metric-name">${String(h).padStart(2,'0')}:00台</span><span class="metric-val">${c}件</span></div>`).join('');
      viralEl.innerHTML = `
        <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
          <div class="kpi" style="flex:1;min-width:100px;padding:12px 16px;">
            <div class="kpi-label">バイラル件数</div>
            <div class="kpi-value">${vp.count}</div>
          </div>
          <div class="kpi" style="flex:1;min-width:100px;padding:12px 16px;">
            <div class="kpi-label">最頻時間帯</div>
            <div class="kpi-value">${vp.topHour ? String(vp.topHour.hour).padStart(2,'0') + ':00' : '—'}</div>
          </div>
          <div class="kpi" style="flex:1;min-width:100px;padding:12px 16px;">
            <div class="kpi-label">最頻曜日</div>
            <div class="kpi-value">${vp.topDay?.day || '—'}曜</div>
          </div>
          <div class="kpi" style="flex:1;min-width:100px;padding:12px 16px;">
            <div class="kpi-label">平均テキスト長</div>
            <div class="kpi-value">${vp.avgTextLength || 0}字</div>
          </div>
        </div>
        <div style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:8px;">時間帯分布</div>
        ${hourDist}`;
    } else {
      viralEl.innerHTML = `<div class="empty"><div class="empty-icon">📊</div><div class="empty-text">10万views超えの投稿はまだありません</div></div>`;
    }
  }

  // テキスト長チャート
  if (cl) renderLengthChart(cl.buckets || []);

  // 拡散力テーブル
  const viralityEl = document.getElementById('viralityTable');
  if (viralityEl && va?.posts?.length) {
    viralityEl.innerHTML = va.posts.map(p => `
      <tr>
        <td style="max-width:280px;">${(p.text||'').substring(0,50)}${(p.text||'').length>50?'…':''}</td>
        <td style="text-align:right;">${shortNum(p.views||0)}</td>
        <td style="text-align:right;font-weight:700;color:var(--blue);">${p.viralityScore||0}%</td>
        <td style="text-align:right;color:var(--green);">${p.replyRate||0}%</td>
      </tr>`).join('');
  } else if (viralityEl) {
    viralityEl.innerHTML = `<tr><td colspan="4"><div class="empty">データなし</div></td></tr>`;
  }
}

function renderHourlyChart(hourly) {
  const ctx = document.getElementById('hourlyChart');
  if (!ctx) return;
  if (charts.hourly) charts.hourly.destroy();

  const active = hourly.filter(h => h.postCount > 0);
  charts.hourly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: active.map(h => h.label),
      datasets: [{
        label: '平均閲覧数',
        data: active.map(h => h.avgViews),
        backgroundColor: active.map(h => h.avgViews === Math.max(...active.map(x => x.avgViews)) ? 'rgba(17,24,39,0.9)' : 'rgba(17,24,39,0.35)'),
        borderRadius: 4,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y.toLocaleString()} views` } } },
      scales: {
        x: { ticks: { color: CHART_OPTS.tick, font: { size: 10 } }, grid: { color: CHART_OPTS.grid } },
        y: { ticks: { color: CHART_OPTS.tick, font: { size: 10 }, callback: v => shortNum(v) }, grid: { color: CHART_OPTS.grid } },
      },
    },
  });
}

function renderWeeklyChart(weekly) {
  const ctx = document.getElementById('weeklyChart');
  if (!ctx) return;
  if (charts.weekly) charts.weekly.destroy();

  const active = weekly.filter(d => d.postCount > 0);
  charts.weekly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: active.map(d => d.label + '曜'),
      datasets: [
        {
          label: '平均閲覧数',
          data: active.map(d => d.avgViews),
          backgroundColor: 'rgba(17,24,39,0.75)',
          borderRadius: 4,
          borderWidth: 0,
          yAxisID: 'y',
        },
        {
          label: 'ER (%)',
          data: active.map(d => d.avgEngagementRate),
          backgroundColor: 'rgba(37,99,235,0.5)',
          borderRadius: 4,
          borderWidth: 0,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CHART_OPTS.legend, font: { size: 11 }, boxWidth: 10, padding: 12 } } },
      scales: {
        x:  { ticks: { color: CHART_OPTS.tick, font: { size: 11 } }, grid: { color: CHART_OPTS.grid } },
        y:  { ticks: { color: CHART_OPTS.tick, font: { size: 10 }, callback: v => shortNum(v) }, grid: { color: CHART_OPTS.grid } },
        y2: { position: 'right', ticks: { color: CHART_OPTS.tick, font: { size: 10 }, callback: v => v + '%' }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

function renderLengthChart(buckets) {
  const ctx = document.getElementById('lengthChart');
  if (!ctx) return;
  if (charts.length) charts.length.destroy();

  const active = buckets.filter(b => b.postCount > 0);
  const maxViews = Math.max(...active.map(b => b.avgViews), 1);
  charts.length = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: active.map(b => b.label),
      datasets: [{
        label: '平均閲覧数',
        data: active.map(b => b.avgViews),
        backgroundColor: active.map(b => b.avgViews === maxViews ? 'rgba(17,24,39,0.9)' : 'rgba(17,24,39,0.35)'),
        borderRadius: 4,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y.toLocaleString()} views` } } },
      scales: {
        x: { ticks: { color: CHART_OPTS.tick, font: { size: 10 } }, grid: { color: CHART_OPTS.grid } },
        y: { ticks: { color: CHART_OPTS.tick, font: { size: 10 }, callback: v => shortNum(v) }, grid: { color: CHART_OPTS.grid } },
      },
    },
  });
}

// ===== Velocity Page =====
async function loadVelocityPage() {
  ['vel-tracking', 'vel-first-hour', 'vel-halflife'].forEach(id => setEl(id, '読込中…'));
  try {
    const data = await fetchAPI('/velocity');
    const summary = data.summary;

    // KPIs
    const activeCount = data.activeCount || 0;
    setEl('vel-tracking', activeCount > 0 ? activeCount : '0');
    setEl('vel-first-hour', summary?.avgFirstHourViews != null ? shortNum(summary.avgFirstHourViews) : '—');
    setEl('vel-halflife', summary?.avgHalfLifeHours != null ? summary.avgHalfLifeHours + 'h' : '—');

    // テーブル
    const tbody = document.getElementById('velocityTable');
    if (tbody) {
      const posts = summary?.posts || [];
      if (!posts.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-icon">📡</div><div class="empty-text">追跡データがありません。投稿を実行すると自動追跡が開始されます。</div></div></td></tr>`;
      } else {
        tbody.innerHTML = posts.map(p => {
          const dt = p.publishedAt ? new Date(p.publishedAt).toLocaleDateString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
          const statusBadge = p.completed
            ? '<span class="badge badge-gray">完了</span>'
            : '<span class="badge badge-blue">追跡中</span>';
          return `<tr>
            <td style="white-space:nowrap;font-size:12px;color:var(--ink2);">${dt}</td>
            <td style="max-width:240px;font-size:12px;">${(p.text||'').substring(0,45)}${(p.text||'').length>45?'…':''}</td>
            <td style="text-align:right;">${p.firstHourViews != null ? shortNum(p.firstHourViews) : '—'}</td>
            <td style="text-align:right;">${p.peakHour != null ? p.peakHour + 'h後' : '—'}</td>
            <td style="text-align:right;">${p.halfLifeHours != null ? p.halfLifeHours + 'h' : '—'}</td>
            <td style="text-align:right;">${shortNum(p.views24h||0)}</td>
            <td style="text-align:right;font-weight:700;">${shortNum(p.totalViews||0)}</td>
            <td>${statusBadge}</td>
          </tr>`;
        }).join('');
      }
    }

    // マイルストーンパネル
    const milestonesEl = document.getElementById('milestonesPanel');
    if (milestonesEl) {
      const posts = summary?.posts?.filter(p => Object.keys(p.milestones||{}).length > 0) || [];
      if (!posts.length) {
        milestonesEl.innerHTML = `<div class="empty"><div class="empty-text text-muted">マイルストーンデータがありません</div></div>`;
      } else {
        milestonesEl.innerHTML = posts.map(p => {
          const dt = p.publishedAt ? new Date(p.publishedAt).toLocaleDateString('ja-JP', { month:'numeric', day:'numeric' }) : '';
          const milestoneHtml = Object.entries(p.milestones).map(([key, val]) =>
            `<span class="badge badge-blue" style="margin-right:4px;margin-bottom:4px;">${key}: ${val.hoursAfterPost}h後</span>`
          ).join('');
          return `<div style="padding:12px 0;border-bottom:1px solid var(--border);">
            <div style="font-size:12px;color:var(--ink2);margin-bottom:6px;">[${dt}] ${(p.text||'').substring(0,50)}…</div>
            <div>${milestoneHtml}</div>
          </div>`;
        }).join('');
      }
    }
  } catch (e) {
    const tbody = document.getElementById('velocityTable');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-text">データ取得失敗: ${e.message}</div></div></td></tr>`;
    ['vel-tracking', 'vel-first-hour', 'vel-halflife'].forEach(id => setEl(id, '—'));
  }
}

// ===== Secretary =====
let secretaryStreaming = false;

function secretarySuggest(text) {
  document.getElementById('chatInput').value = text;
  sendSecretaryMessage();
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendSecretaryMessage();
  }
}

function chatAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

async function sendSecretaryMessage() {
  if (secretaryStreaming) return;
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('secretarySuggestions').style.display = 'none';

  const messages = document.getElementById('chatMessages');

  // ユーザーメッセージ追加
  messages.innerHTML += `
    <div class="chat-msg user">
      <div class="chat-avatar">私</div>
      <div class="chat-bubble">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    </div>`;

  // アシスタント返答バブル（ストリーミング用）
  const replyId = 'reply_' + Date.now();
  messages.innerHTML += `
    <div class="chat-msg" id="${replyId}">
      <div class="chat-avatar">秘</div>
      <div class="chat-bubble streaming" id="${replyId}_bubble"></div>
    </div>`;
  messages.scrollTop = messages.scrollHeight;

  secretaryStreaming = true;
  document.getElementById('chatSendBtn').disabled = true;

  try {
    const res = await fetch('/api/secretary/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (res.status === 401) { location.href = '/login'; return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const bubble = document.getElementById(`${replyId}_bubble`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.text) {
            bubble.textContent += data.text;
            messages.scrollTop = messages.scrollHeight;
          }
          if (data.done) bubble.classList.remove('streaming');
          if (data.error) bubble.textContent = 'エラー: ' + data.error;
        } catch { /* skip */ }
      }
    }
    bubble.classList.remove('streaming');
  } catch (e) {
    const bubble = document.getElementById(`${replyId}_bubble`);
    if (bubble) { bubble.textContent = 'エラー: ' + e.message; bubble.classList.remove('streaming'); }
  } finally {
    secretaryStreaming = false;
    document.getElementById('chatSendBtn').disabled = false;
    messages.scrollTop = messages.scrollHeight;
  }
}

async function clearSecretaryChat() {
  await fetch('/api/secretary/clear', { method: 'POST' }).catch(() => {});
  const messages = document.getElementById('chatMessages');
  messages.innerHTML = `
    <div class="chat-msg">
      <div class="chat-avatar">秘</div>
      <div class="chat-bubble">会話をリセットしました。何でも聞いてください。</div>
    </div>`;
  document.getElementById('secretarySuggestions').style.display = 'flex';
}

// ===== Trend Research Page =====
let trendData = null;

async function loadTrendPage(forceRefresh = false) {
  const loading = document.getElementById('trendLoading');
  const content = document.getElementById('trendContent');
  if (!loading || !content) return;

  loading.style.display = 'block';
  content.style.display = 'none';

  try {
    const url = forceRefresh ? '/trend/my-patterns?refresh=1' : '/trend/my-patterns';
    const res = await fetchAPI(url);
    trendData = res.data;
    renderTrendPage(trendData);
    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (e) {
    loading.innerHTML = `<div class="empty"><div class="empty-icon">📊</div><div class="empty-text">分析に失敗しました: ${e.message}</div></div>`;
  }
}

function renderTrendPage(data) {
  // サマリー
  setEl('trendSummary', data.summary || '-');

  // バズパターン
  const patternsEl = document.getElementById('trendPatterns');
  if (patternsEl && data.winningPatterns?.length) {
    patternsEl.innerHTML = data.winningPatterns.map(p => `
      <div style="padding:12px;border-bottom:1px solid var(--border);">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${escHtml(p.pattern)}</div>
        <div style="font-size:13px;color:var(--ink2);margin-bottom:4px;">${escHtml(p.detail)}</div>
        <div style="font-size:11px;color:var(--ink3);">根拠: ${escHtml(p.evidence)}</div>
      </div>`).join('');
  } else if (patternsEl) {
    patternsEl.innerHTML = '<div class="empty"><div class="empty-text text-muted">パターンデータなし</div></div>';
  }

  // 最適化指標
  const ol = data.optimalLength || {};
  setEl('trendOptimalLength', `推奨: ${ol.recommendation || '-'}\n理由: ${ol.reason || '-'}`);
  const ot = data.optimalTiming || {};
  const hours = (ot.bestHours || []).join('時, ') + '時';
  const days = (ot.bestDays || []).join('・');
  setEl('trendOptimalTiming', `時間帯: ${hours}\n曜日: ${days}\n理由: ${ot.reason || '-'}`);
  const hs = data.hashtagStrategy || {};
  setEl('trendHashtag', `推奨: ${hs.recommendation || '-'}\n理由: ${hs.reason || '-'}`);

  // Tips
  const tipsEl = document.getElementById('trendTips');
  if (tipsEl) {
    tipsEl.innerHTML = (data.nextPostTips || []).map(t => `<li>${escHtml(t)}</li>`).join('');
  }

  // 時間帯グラフ
  const features = data.features || {};
  if (features.byHour) {
    const hours2 = Object.keys(features.byHour).map(h => h + '時');
    const erVals = Object.values(features.byHour).map(v => parseFloat(v.avgER) || 0);
    renderOrUpdateChart('trendHourChart', 'bar', hours2, erVals, '平均ER(%)');
  }

  // 文字数・ハッシュタグ比較グラフ
  if (features.byLength && features.byHashtag) {
    const labels = ['短文(<80)', '中文(80-200)', '長文(200+)', 'タグなし', 'タグ1-3', 'タグ4+'];
    const vals = [
      parseFloat(features.byLength.short?.avgER  || 0),
      parseFloat(features.byLength.medium?.avgER || 0),
      parseFloat(features.byLength.long?.avgER   || 0),
      parseFloat(features.byHashtag.none?.avgER  || 0),
      parseFloat(features.byHashtag.some?.avgER  || 0),
      parseFloat(features.byHashtag.many?.avgER  || 0),
    ];
    renderOrUpdateChart('trendLengthChart', 'bar', labels, vals, '平均ER(%)');
  }

  // 上位投稿リスト
  const listEl = document.getElementById('trendTopPostsList');
  if (listEl && data.topPosts?.length) {
    listEl.innerHTML = data.topPosts.map((p, i) => `
      <div style="padding:12px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:800;color:var(--accent);min-width:22px;">#${i + 1}</span>
          <span style="font-size:12px;line-height:1.5;color:var(--ink);">${escHtml(p.text || '')}</span>
        </div>
        <div style="display:flex;gap:12px;font-size:11px;color:var(--ink3);padding-left:30px;">
          <span>👁 ${shortNum(p.views || 0)}</span>
          <span>❤️ ${shortNum(p.like_count || 0)}</span>
          <span>💬 ${shortNum(p.reply_count || 0)}</span>
          <span>🔁 ${shortNum(p.repost_count || 0)}</span>
          <span style="color:var(--accent);font-weight:700;">スコア: ${p.score || 0}</span>
        </div>
      </div>`).join('');
  }
}

function renderOrUpdateChart(canvasId, type, labels, data, label) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{ label, data, backgroundColor: 'rgba(10,10,10,0.75)', borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } } },
    },
  });
}

// ===== Competitor Page =====
let competitorModalOpen = false;

async function loadCompetitorPage() {
  await Promise.all([loadRecommendedCompetitors(), loadCompetitorList(), loadBenchmark()]);
}

async function loadRecommendedCompetitors(forceRefresh = false) {
  const el = document.getElementById('recommendContent');
  const btn = document.getElementById('recommendBtn');
  if (!el) return;

  // forceRefresh=false のとき、既に表示済みなら再実行しない
  if (!forceRefresh && el.dataset.loaded === '1') return;

  el.innerHTML = '<div style="text-align:center;padding:32px;"><div class="spinner" style="margin:0 auto 12px;"></div><div class="text-muted" style="font-size:13px;">自分の投稿670件を分析中...</div></div>';
  if (btn) { btn.disabled = true; btn.textContent = '分析中...'; }

  try {
    const res = await fetchAPI('/trend/recommend-competitors');
    const data = res.data;
    el.dataset.loaded = '1';
    renderCompetitorRecommendations(el, data);
    if (res.data.fromCache) showToast('info', 'キャッシュ結果を表示しています');
    else showToast('success', 'ベンチマーク候補を分析しました');
  } catch (e) {
    el.innerHTML = `<div class="empty"><div class="empty-text text-muted">分析失敗: ${e.message}</div></div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '再分析'; }
  }
}

function renderCompetitorRecommendations(el, data) {
  const analysis = data.accountAnalysis || {};
  const criteria = data.benchmarkCriteria || {};
  const accounts = data.recommendedAccounts || [];
  const keywords = data.searchKeywords || [];

  const confidenceColor = { high: 'var(--green)', medium: 'var(--amber)', low: 'var(--ink3)' };
  const confidenceLabel = { high: '実在確認済み', medium: '要確認', low: '参考候補' };

  el.innerHTML = `
    <!-- アカウント分析 -->
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">あなたのアカウント分析</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        ${(analysis.mainThemes || []).map(t => `<span class="badge badge-dark">${escHtml(t)}</span>`).join('')}
      </div>
      <p style="font-size:13px;color:var(--ink2);line-height:1.7;margin-bottom:8px;">${escHtml(analysis.contentStyle || '')}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
        <div style="background:var(--green-bg);border-radius:var(--radius-sm);padding:12px;">
          <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:6px;">強み</div>
          <ul style="margin:0;padding-left:16px;font-size:12px;color:var(--ink2);line-height:1.9;">
            ${(analysis.currentStrengths || []).map(s => `<li>${escHtml(s)}</li>`).join('')}
          </ul>
        </div>
        <div style="background:var(--blue-bg);border-radius:var(--radius-sm);padding:12px;">
          <div style="font-size:11px;font-weight:700;color:var(--blue);margin-bottom:6px;">伸びしろ</div>
          <ul style="margin:0;padding-left:16px;font-size:12px;color:var(--ink2);line-height:1.9;">
            ${(analysis.growthOpportunities || []).map(s => `<li>${escHtml(s)}</li>`).join('')}
          </ul>
        </div>
      </div>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0;">

    <!-- ベンチマークすべき理由 -->
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">ベンチマーク戦略</div>
      <p style="font-size:13px;color:var(--ink2);line-height:1.7;margin-bottom:12px;">${escHtml(criteria.why || '')}</p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${(criteria.idealProfiles || []).map(p => `
          <div style="padding:10px 12px;border-left:3px solid var(--accent);background:var(--surface-raised);border-radius:0 var(--radius-sm) var(--radius-sm) 0;">
            <div style="font-size:12px;font-weight:700;margin-bottom:3px;">${escHtml(p.type || '')}</div>
            <div style="font-size:12px;color:var(--ink2);">${escHtml(p.reason || '')} → <span style="color:var(--blue);">${escHtml(p.whatToLearn || '')}</span></div>
          </div>`).join('')}
      </div>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0;">

    <!-- 推薦アカウント -->
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">推薦アカウント一覧</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${accounts.map(a => `
          <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;display:flex;align-items:flex-start;gap:12px;">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap;">
                <a href="https://www.threads.com/@${escHtml(a.username)}" target="_blank" rel="noopener"
                   style="font-weight:700;font-size:13px;color:var(--accent);text-decoration:none;">@${escHtml(a.username)}</a>
                ${a.displayName ? `<span style="font-size:12px;color:var(--ink2);">${escHtml(a.displayName)}</span>` : ''}
                <span style="font-size:10px;color:${confidenceColor[a.confidence] || 'var(--ink3)'};">${confidenceLabel[a.confidence] || ''}</span>
                ${a.followerRange ? `<span class="badge badge-gray" style="font-size:10px;">${escHtml(a.followerRange)}</span>` : ''}
              </div>
              <div style="font-size:12px;color:var(--ink2);line-height:1.6;margin-bottom:4px;">${escHtml(a.reason || '')}</div>
              <div style="font-size:11px;color:var(--blue);">学べること: ${escHtml(a.expectedLearning || '')}</div>
            </div>
            <button class="btn btn-ghost btn-xs" style="flex-shrink:0;"
              onclick="addCompetitorFromRecommend('${escHtml(a.username)}')">追加</button>
          </div>`).join('')}
      </div>
    </div>

    <!-- 検索キーワード -->
    ${keywords.length ? `
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:var(--ink3);margin-bottom:8px;">類似アカウント発見キーワード</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${keywords.map(k => `<span class="badge badge-blue">${escHtml(k)}</span>`).join('')}
      </div>
    </div>` : ''}

    <!-- アクションプラン -->
    ${data.actionPlan ? `
    <div style="background:var(--amber-bg);border-radius:var(--radius-sm);padding:14px;">
      <div style="font-size:11px;font-weight:700;color:var(--amber);margin-bottom:6px;">今すぐ実行できるアクション</div>
      <div style="font-size:13px;color:var(--ink2);line-height:1.7;white-space:pre-wrap;">${escHtml(data.actionPlan)}</div>
    </div>` : ''}

    ${data._note ? `<div style="font-size:11px;color:var(--amber);margin-top:8px;padding:8px;background:var(--amber-bg);border-radius:var(--radius-sm);">⚠️ ${escHtml(data._note)}</div>` : ''}
    <div style="font-size:11px;color:var(--ink3);margin-top:8px;">分析対象: ${data.basedOnPosts || 0}件の投稿 · 生成: ${data.generatedAt ? new Date(data.generatedAt).toLocaleString('ja-JP') : '-'}</div>
  `;
}

async function addCompetitorFromRecommend(username) {
  try {
    await fetchAPI('/trend/competitors', { method: 'POST', body: JSON.stringify({ username }) });
    showToast('success', `@${username} を競合リストに追加しました`);
    loadCompetitorList();
  } catch (e) {
    showToast('error', `追加失敗: ${e.message}`);
  }
}

async function loadCompetitorList() {
  const el = document.getElementById('competitorList');
  try {
    const res = await fetchAPI('/trend/competitors');
    const list = res.competitors || [];
    if (!list.length) {
      el.innerHTML = '<div class="empty"><div class="empty-icon">👤</div><div class="empty-text">競合アカウントを追加してください</div></div>';
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>ユーザー名</th><th>フォロワー</th><th>最終取得</th><th></th></tr></thead>
      <tbody>
      ${list.map(c => `
        <tr>
          <td><strong>@${escHtml(c.username)}</strong></td>
          <td>${c.followerCount || '-'}</td>
          <td style="font-size:12px;color:var(--ink3);">${c.lastScrapedAt ? new Date(c.lastScrapedAt).toLocaleDateString('ja-JP') : '未取得'}</td>
          <td style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-xs" onclick="scrapeCompetitor('${c.username}')">データ取得</button>
            <button class="btn btn-danger btn-xs" onclick="removeCompetitor('${c.username}')">削除</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty"><div class="empty-text text-muted">読み込み失敗: ${e.message}</div></div>`;
  }
}

async function loadBenchmark() {
  const el = document.getElementById('benchmarkContent');
  const topEl = document.getElementById('competitorTopPosts');
  try {
    const res = await fetchAPI('/trend/benchmark');
    const { myMetrics, competitors } = res.data || {};

    if (!competitors?.length) {
      el.innerHTML = '<div class="empty"><div class="empty-text text-muted">競合データ取得後に表示されます</div></div>';
      if (topEl) topEl.innerHTML = '<div class="empty"><div class="empty-text text-muted">競合データ取得後に表示されます</div></div>';
      return;
    }

    // KPI比較テーブル（自分 vs 全競合）
    const rows = [
      { label: 'フォロワー数',   myKey: 'followersCount', cKey: 'followerCountRaw', fmt: n => n != null ? shortNum(n) : '-' },
      { label: '平均いいね',     myKey: 'avgLikes',        cKey: 'avgLikes',         fmt: shortNum },
      { label: '平均返信数',     myKey: 'avgReplies',      cKey: 'avgReplies',       fmt: shortNum },
      { label: '平均リポスト',   myKey: 'avgReposts',      cKey: 'avgReposts',       fmt: shortNum },
      { label: '平均閲覧数',     myKey: 'avgViews',        cKey: null,               fmt: shortNum, cNote: '非公開' },
      { label: 'ER(%)',          myKey: 'engagementRate',  cKey: null,               fmt: v => v || '-', cNote: '非公開' },
      { label: '取得投稿数',     myKey: 'postCount',       cKey: 'postCount',        fmt: shortNum },
    ];

    // 各セルに自分との比較バッジを付ける
    const badge = (myVal, cVal) => {
      if (cVal == null || myVal == null) return '';
      const diff = cVal - myVal;
      if (diff > 0) return `<span style="font-size:10px;color:var(--green);margin-left:4px;">▲${shortNum(diff)}</span>`;
      if (diff < 0) return `<span style="font-size:10px;color:var(--red);margin-left:4px;">▼${shortNum(Math.abs(diff))}</span>`;
      return '';
    };

    el.innerHTML = `<div class="table-wrap"><table>
      <thead>
        <tr>
          <th>指標</th>
          <th style="color:var(--accent);background:rgba(10,10,10,0.03);">自分</th>
          ${competitors.map(c => `<th>@${escHtml(c.username)}<div style="font-size:10px;font-weight:400;color:var(--ink3);">${c.followerCount || ''}</div></th>`).join('')}
        </tr>
      </thead>
      <tbody>
      ${rows.map(r => `
        <tr>
          <td style="font-weight:600;white-space:nowrap;">${r.label}</td>
          <td style="font-weight:700;color:var(--accent);background:rgba(10,10,10,0.03);">${r.fmt(myMetrics?.[r.myKey])}</td>
          ${competitors.map(c => {
            const myVal = myMetrics?.[r.myKey];
            const cVal  = r.cKey ? c[r.cKey] : null;
            const display = r.cKey ? r.fmt(cVal) : (r.cNote || '-');
            return `<td>${display}${r.cKey ? badge(myVal, cVal) : ''}</td>`;
          }).join('')}
        </tr>`).join('')}
      </tbody>
    </table></div>
    <div style="font-size:11px;color:var(--ink3);margin-top:8px;">▲緑=競合が上回る ▼赤=自分が上回る（ER・閲覧数は非公開のため比較不可）</div>`;

    // 競合ごとの投稿一覧（タブ切り替え）
    if (topEl) {
      topEl.innerHTML = competitors.map(c => `
        <div style="margin-bottom:24px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid var(--border);">
            @${escHtml(c.username)}
            <span style="font-size:11px;font-weight:400;color:var(--ink3);margin-left:8px;">${c.postCount}件取得 · 最終更新: ${c.scrapedAt ? new Date(c.scrapedAt).toLocaleDateString('ja-JP') : '-'}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>投稿内容</th><th style="text-align:right;">❤️</th><th style="text-align:right;">💬</th><th style="text-align:right;">🔁</th><th>日時</th></tr></thead>
              <tbody>
              ${(c.allPosts || c.topPosts || []).map(p => {
                const dt = p.timestamp ? new Date(p.timestamp).toLocaleDateString('ja-JP', { month:'numeric', day:'numeric' }) : '-';
                const txt = (p.text || '').substring(0, 60);
                return `<tr>
                  <td style="max-width:260px;font-size:12px;line-height:1.5;">
                    ${p.postUrl
                      ? `<a href="${p.postUrl}" target="_blank" rel="noopener" style="color:var(--ink);text-decoration:none;" title="${escHtml(p.text || '')}">${escHtml(txt)}${(p.text||'').length > 60 ? '…' : ''}</a>`
                      : escHtml(txt)}
                  </td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums;font-size:12px;">${shortNum(p.likeCount || 0)}</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums;font-size:12px;">${shortNum(p.replyCount || 0)}</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums;font-size:12px;">${shortNum(p.repostCount || 0)}</td>
                  <td style="font-size:11px;color:var(--ink3);white-space:nowrap;">${dt}</td>
                </tr>`;
              }).join('')}
              </tbody>
            </table>
          </div>
        </div>`).join('');
    }
  } catch (e) {
    el.innerHTML = `<div class="empty"><div class="empty-text text-muted">ベンチマーク読み込み失敗: ${e.message}</div></div>`;
  }
}

function showAddCompetitorModal() {
  const modal = document.getElementById('addCompetitorModal');
  if (modal) { modal.style.display = 'flex'; competitorModalOpen = true; }
}

function hideAddCompetitorModal() {
  const modal = document.getElementById('addCompetitorModal');
  if (modal) { modal.style.display = 'none'; competitorModalOpen = false; }
}

async function addCompetitor() {
  const username = document.getElementById('competitorUsername')?.value?.trim();
  if (!username) { showToast('error', 'ユーザー名を入力してください'); return; }
  try {
    await fetchAPI('/trend/competitors', { method: 'POST', body: JSON.stringify({ username }) });
    showToast('success', `@${username} を追加しました`);
    hideAddCompetitorModal();
    loadCompetitorList();
  } catch (e) {
    showToast('error', `追加失敗: ${e.message}`);
  }
}

async function removeCompetitor(username) {
  if (!confirm(`@${username} を削除しますか？`)) return;
  try {
    await fetchAPI(`/trend/competitors/${username}`, { method: 'DELETE' });
    showToast('success', `@${username} を削除しました`);
    loadCompetitorList();
  } catch (e) {
    showToast('error', `削除失敗: ${e.message}`);
  }
}

async function scrapeCompetitor(username) {
  showToast('info', `@${username} のデータを取得中...`);
  try {
    await fetchAPI(`/trend/competitors/${username}/scrape`, { method: 'POST' });
    showToast('success', `@${username} のデータを更新しました`);
    loadCompetitorPage();
  } catch (e) {
    showToast('error', `取得失敗: ${e.message}`);
  }
}

async function updateAllCompetitors() {
  showToast('info', '全競合アカウントを更新中...');
  try {
    const res = await fetchAPI('/trend/competitors/update-all', { method: 'POST' });
    const success = (res.results || []).filter(r => r.success).length;
    showToast('success', `${success}件更新完了`);
    loadCompetitorPage();
  } catch (e) {
    showToast('error', `更新失敗: ${e.message}`);
  }
}

// ===== Reply Analysis Page =====
let replyData = null;
let currentReplyTab = 'positive';

async function loadRepliesPage() {
  // 投稿一覧をセレクトボックスに読み込む
  const sel = document.getElementById('replyPostSelect');
  if (!sel || sel.options.length > 1) return;

  if (!allPosts.length) await loadDashboard();
  const topPosts = [...allPosts]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 30);

  topPosts.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = (p.text || p.id || '').substring(0, 50) + '…';
    opt.dataset.text = p.text || '';
    sel.appendChild(opt);
  });
}

function onReplyPostSelect() {
  const sel = document.getElementById('replyPostSelect');
  const preview = document.getElementById('replyPostPreview');
  if (!sel || !preview) return;
  const opt = sel.options[sel.selectedIndex];
  if (opt?.dataset?.text) {
    preview.style.display = 'block';
    preview.textContent = opt.dataset.text;
  } else {
    preview.style.display = 'none';
  }
  // 結果をリセット
  const result = document.getElementById('repliesResult');
  if (result) result.style.display = 'none';
}

async function analyzeReplies() {
  const sel = document.getElementById('replyPostSelect');
  const postId = sel?.value;
  if (!postId) { showToast('error', '投稿を選択してください'); return; }

  const opt = sel.options[sel.selectedIndex];
  const postText = opt?.dataset?.text || '';

  showToast('info', '返信を分析中...');
  try {
    const res = await fetchAPI(`/replies/${postId}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ postText }),
    });
    replyData = res.data;
    renderRepliesPage(replyData);
    showToast('success', `${replyData.replyCount}件の返信を分析しました`);
  } catch (e) {
    showToast('error', `分析失敗: ${e.message}`);
  }
}

function renderRepliesPage(data) {
  const result = document.getElementById('repliesResult');
  if (!result) return;
  result.style.display = 'block';

  // サマリーグリッド
  const summary = data.classificationSummary || {};
  const grid = document.getElementById('repliesSummaryGrid');
  if (grid) {
    const items = [
      { label: '総返信数', value: data.replyCount || 0, color: 'var(--blue)' },
      { label: 'ポジティブ', value: summary.positive || 0, color: 'var(--green)' },
      { label: '質問', value: summary.question || 0, color: 'var(--amber)' },
      { label: '感想', value: summary.impression || 0, color: 'var(--ink2)' },
      { label: 'ネガティブ', value: summary.negative || 0, color: 'var(--red)' },
    ];
    grid.innerHTML = items.map(i => `
      <div class="kpi">
        <div class="kpi-label">${i.label}</div>
        <div class="kpi-value" style="color:${i.color};">${i.value}</div>
      </div>`).join('');
  }

  // タブ初期表示
  showReplyTab('positive');

  // FAQ
  const faqEl = document.getElementById('replyFAQs');
  if (faqEl && data.faqs?.length) {
    faqEl.innerHTML = data.faqs.map((f, i) => `
      <div style="padding:10px 0;border-bottom:1px solid var(--border);">
        <span style="font-weight:700;color:var(--amber);margin-right:8px;">Q${i + 1}</span>
        ${escHtml(f.question || '')}
        <span style="font-size:11px;color:var(--ink3);margin-left:8px;">(${f.frequency}件)</span>
      </div>`).join('');
  } else if (faqEl) {
    faqEl.innerHTML = '<div class="empty"><div class="empty-text text-muted">質問コメントはありませんでした</div></div>';
  }

  // テンプレート
  const tmplEl = document.getElementById('replyTemplates');
  if (tmplEl && data.templates) {
    const t = data.templates;
    const tmplItems = [
      { label: 'ポジティブへの返信', text: t.forPositive, color: 'var(--green)' },
      { label: '質問への返信', text: t.forQuestion, color: 'var(--amber)' },
      { label: 'ネガティブへの返信', text: t.forNegative, color: 'var(--red)' },
      { label: '感想への返信', text: t.forImpression, color: 'var(--ink2)' },
      { label: '汎用テンプレート', text: t.universal, color: 'var(--blue)' },
    ];
    tmplEl.innerHTML = tmplItems.filter(i => i.text).map(i => `
      <div style="padding:12px;border-left:3px solid ${i.color};margin-bottom:10px;background:var(--surface-raised);border-radius:0 var(--radius-sm) var(--radius-sm) 0;">
        <div style="font-size:11px;font-weight:700;color:${i.color};margin-bottom:4px;">${i.label}</div>
        <div style="font-size:13px;color:var(--ink);">${escHtml(i.text)}</div>
        <button onclick="copyToClipboard('${escHtml(i.text)}')" style="background:none;border:none;font-size:11px;color:var(--blue);cursor:pointer;margin-top:4px;">コピー</button>
      </div>`).join('');
  }
}

function showReplyTab(tab) {
  currentReplyTab = tab;
  const tabs = document.querySelectorAll('#replyTabs button');
  const tabMap = { positive: 0, question: 1, impression: 2, negative: 3, other: 4 };
  tabs.forEach((btn, i) => {
    btn.classList.toggle('active', i === tabMap[tab]);
  });

  const content = document.getElementById('replyTabContent');
  if (!content || !replyData?.classification) return;

  const replies = replyData.classification[tab] || [];
  if (!replies.length) {
    content.innerHTML = '<div class="empty"><div class="empty-text text-muted">このカテゴリの返信はありません</div></div>';
    return;
  }

  content.innerHTML = replies.map(r => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <div style="font-size:11px;color:var(--ink3);min-width:60px;flex-shrink:0;">@${escHtml(r.username || '?')}</div>
        <div style="font-size:13px;color:var(--ink);flex:1;">${escHtml(r.text || '')}</div>
      </div>
    </div>`).join('');
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).then(() => showToast('success', 'コピーしました'));
}

// ===== Refresh / Daily =====
async function refreshData() {
  const btn = document.getElementById('refreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '取得中...'; }
  try {
    await loadDashboard(true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '更新'; }
  }
}

async function runDailyCycle() {
  showToast('info', '日次サイクルを実行中...');
  await loadDashboard();
  showToast('success', '日次サイクル完了');
}

// ===== API Fetch =====
async function fetchAPI(endpoint, options = {}) {
  const res = await fetch(API_BASE + endpoint, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('UNAUTHORIZED');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.success === false) throw new Error(json.error || 'API Error');
  return json;
}

// ===== Toast =====
function showToast(type, message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: '💜', warning: '⚠️' };
  toast.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span style="flex:1;">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 3500);
  setTimeout(() => toast.remove(), 3800);
}

// ===== Utils =====
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function num(n) {
  return (n || 0).toLocaleString('ja-JP');
}

function shortNum(n) {
  n = n || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString('ja-JP');
}

function escHtml(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ===== Demo Data =====
function getDemoData() {
  return {
    engagementMetrics: {
      followersCount: 1733, engagementRate: '1.16', totalViews: 12848707,
      avgViews: 20892, totalLikes: 62343, totalReplies: 18595, totalReposts: 560, totalQuotes: 93, postCount: 616,
    },
    posts: [],
  };
}
function getDemoTrends() {
  return [{ word: 'AI活用', count: 12 }, { word: '習慣化', count: 9 }, { word: '生産性', count: 8 }, { word: '副業', count: 6 }];
}
function getDemoPosts() {
  return [
    { text: '副業で月10万稼ぐまでにやったこと全部書く', like_count: 312, reply_count: 78, repost_count: 134, views: 28000, engagementScore: 1014 },
    { text: 'フリーランスになって2年。正直なところを話します', like_count: 201, reply_count: 45, repost_count: 67, views: 19000, engagementScore: 629 },
  ];
}

// ===== News Page =====

let _newsArticles = [];       // 取得した記事キャッシュ
let _newsGenerated = [];      // 生成された投稿キャッシュ

function loadNewsPage() {
  loadNewsScheduled();
  // 日時のデフォルト値：翌日 08:00
  const dt = document.getElementById('newsScheduleDateTime');
  if (dt && !dt.value) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    dt.value = d.toISOString().slice(0, 16);
  }
}

async function fetchNewsArticles() {
  showToast('info', 'Google News から記事を取得中...');
  try {
    const res = await fetchAPI('/news/articles');
    _newsArticles = res.data || [];
    renderNewsArticles(_newsArticles);
    showToast('success', `${_newsArticles.length} 件の新着記事を取得しました`);
  } catch (e) {
    showToast('error', `取得失敗: ${e.message}`);
  }
}

function renderNewsArticles(articles) {
  const card = document.getElementById('newsArticlesCard');
  const list = document.getElementById('newsArticleList');
  const count = document.getElementById('newsArticleCount');
  card.style.display = 'block';
  count.textContent = `（${articles.length}件）`;

  if (articles.length === 0) {
    list.innerHTML = '<div style="color:var(--ink3);font-size:13px;padding:8px 0;">新着記事はありません</div>';
    return;
  }

  list.innerHTML = articles.map((a, i) => `
    <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);align-items:flex-start;">
      <input type="checkbox" id="newsChk_${i}" data-idx="${i}" checked style="margin-top:3px;flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;margin-bottom:2px;">
          <a href="${escHtml(a.url)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">${escHtml(a.title)}</a>
        </div>
        <div style="font-size:11px;color:var(--ink3);">
          ${escHtml(a.source)} &nbsp;|&nbsp; ${escHtml(a.pubDateFormatted || '')}
        </div>
        ${a.description ? `<div style="font-size:12px;color:var(--ink2);margin-top:4px;">${escHtml(a.description.slice(0, 120))}...</div>` : ''}
      </div>
    </div>`).join('');
}

function newsSelectAll() {
  document.querySelectorAll('[id^="newsChk_"]').forEach(c => c.checked = true);
}

function newsDeselectAll() {
  document.querySelectorAll('[id^="newsChk_"]').forEach(c => c.checked = false);
}

async function generateNewsPostsFromSelected() {
  const selected = [];
  document.querySelectorAll('[id^="newsChk_"]:checked').forEach(chk => {
    const idx = parseInt(chk.dataset.idx, 10);
    if (_newsArticles[idx]) selected.push(_newsArticles[idx]);
  });

  if (selected.length === 0) {
    showToast('warning', '記事を1件以上選択してください');
    return;
  }

  showToast('info', `${selected.length} 件の記事からThreads投稿を生成中...（Claude API使用）`);
  try {
    const res = await fetchAPI('/news/generate', {
      method: 'POST',
      body: JSON.stringify({ articles: selected }),
    });
    _newsGenerated = res.data || [];
    renderNewsGenerated(_newsGenerated);
    showToast('success', `${_newsGenerated.length} 件の投稿を生成しました`);
  } catch (e) {
    showToast('error', `生成失敗: ${e.message}`);
  }
}

function renderNewsGenerated(posts) {
  const card = document.getElementById('newsGeneratedCard');
  const list = document.getElementById('newsGeneratedList');
  card.style.display = 'block';

  list.innerHTML = posts.map((p, i) => {
    const content = p.content || {};
    const hashtags = (content.hashtags || []).map(t => `#${t}`).join(' ');
    const full = (content.text || '') + (hashtags ? '\n\n' + hashtags : '');
    return `
      <div style="padding:12px 0;border-bottom:1px solid var(--border);">
        <div style="font-size:11px;color:var(--ink3);margin-bottom:6px;">
          ${escHtml(p.article?.title || '')} &nbsp;|&nbsp; ${content.generatedBy === 'claude' ? 'Claude生成' : 'テンプレート'}
        </div>
        <textarea id="newsPostText_${i}" style="width:100%;min-height:120px;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-raised);color:var(--ink);resize:vertical;">${escHtml(full)}</textarea>
      </div>`;
  }).join('');
}

async function scheduleNewsPosts() {
  if (_newsGenerated.length === 0) {
    showToast('warning', '先に投稿を生成してください');
    return;
  }

  const baseStr = document.getElementById('newsScheduleDateTime').value;
  if (!baseStr) {
    showToast('warning', '予約日時を設定してください');
    return;
  }

  const baseTime = new Date(baseStr);
  const posts = _newsGenerated.map((p, i) => {
    const textarea = document.getElementById(`newsPostText_${i}`);
    const editedText = textarea ? textarea.value : '';
    // テキストからハッシュタグを分離
    const lines = editedText.split('\n');
    const hashtagLine = lines.filter(l => l.trim().startsWith('#')).join(' ');
    const textLines = lines.filter(l => !l.trim().startsWith('#')).join('\n').trim();
    const hashtags = hashtagLine.match(/#[\w\u3040-\u30FF\u4E00-\u9FFF\uFF65-\uFF9F]+/g) || [];

    return {
      article: p.article,
      content: { text: textLines, hashtags, generatedBy: p.content?.generatedBy || 'template' },
      scheduledAt: new Date(baseTime.getTime() + i * 30 * 60 * 1000).toISOString(),
    };
  });

  showToast('info', '予約投稿に登録中...');
  try {
    const res = await fetchAPI('/news/schedule', {
      method: 'POST',
      body: JSON.stringify({ posts }),
    });
    showToast('success', `${res.data?.length || 0} 件を予約登録しました`);
    _newsGenerated = [];
    document.getElementById('newsGeneratedCard').style.display = 'none';
    loadNewsScheduled();
  } catch (e) {
    showToast('error', `登録失敗: ${e.message}`);
  }
}

async function newsAutoRun() {
  const baseStr = document.getElementById('newsScheduleDateTime').value;
  showToast('info', 'ニュース取得→生成→予約を自動実行中...');
  try {
    const res = await fetchAPI('/news/auto-run', {
      method: 'POST',
      body: JSON.stringify({ scheduledAt: baseStr || null }),
    });
    if (res.message) {
      showToast('info', res.message);
    } else {
      showToast('success', `${res.data?.length || 0} 件を自動生成・予約しました`);
      loadNewsScheduled();
    }
  } catch (e) {
    showToast('error', `自動実行失敗: ${e.message}`);
  }
}

async function loadNewsScheduled() {
  const list = document.getElementById('newsScheduledList');
  if (!list) return;
  try {
    const res = await fetchAPI('/news/scheduled');
    const posts = res.data || [];
    if (posts.length === 0) {
      list.innerHTML = '<div style="color:var(--ink3);font-size:13px;">スケジュール済みのニュース投稿はありません</div>';
      return;
    }
    list.innerHTML = posts.map(p => {
      const content = p.content || {};
      const dt = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ja-JP') : '即時';
      const preview = (content.text || '').slice(0, 80);
      const statusColor = p.status === 'published' ? 'var(--success)' : p.status === 'failed' ? 'var(--error)' : 'var(--accent)';
      return `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;color:var(--ink3);margin-bottom:2px;">${escHtml(p.article?.title || '')}</div>
            <div style="font-size:13px;margin-bottom:4px;">${escHtml(preview)}${content.text?.length > 80 ? '...' : ''}</div>
            <div style="font-size:11px;color:var(--ink3);">
              <span style="color:${statusColor};font-weight:600;">${p.status || 'draft'}</span>
              &nbsp;|&nbsp; 予約: ${escHtml(dt)}
              &nbsp;|&nbsp; ${content.generatedBy === 'claude' ? 'Claude生成' : 'テンプレート'}
            </div>
          </div>
          <button class="btn btn-ghost btn-xs" onclick="deleteNewsScheduled('${escHtml(p.id)}')">削除</button>
        </div>`;
    }).join('');
  } catch (e) {
    if (list) list.innerHTML = `<div style="color:var(--error);font-size:13px;">読み込み失敗: ${e.message}</div>`;
  }
}

async function deleteNewsScheduled(id) {
  if (!confirm('このニュース投稿スケジュールを削除しますか？')) return;
  try {
    await fetchAPI(`/news/scheduled/${id}`, { method: 'DELETE' });
    showToast('success', '削除しました');
    loadNewsScheduled();
  } catch (e) {
    showToast('error', `削除失敗: ${e.message}`);
  }
}
