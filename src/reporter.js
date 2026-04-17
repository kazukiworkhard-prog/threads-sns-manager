/**
 * Reporter - クライアント向けプロフェッショナルレポート生成
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import dayjs from 'dayjs';
import 'dayjs/locale/ja.js';
import * as XLSX from 'xlsx';
import { config } from '../config/config.js';
import { SheetsManager } from './spreadsheet.js';

dayjs.locale('ja');

export class Reporter {
  constructor() {
    this.sheets = new SheetsManager();
    this.reportDir = config.system.reportDir;
  }

  async generateDailyReport(cycleResults) {
    const date = dayjs().format('YYYY-MM-DD');
    const report = {
      type: 'daily', date, generatedAt: dayjs().format(),
      insights: cycleResults.insights?.engagementMetrics || {},
      topPosts: cycleResults.insights?.topPosts || [],
      scheduledPosts: cycleResults.scheduled || [],
      kpiStatus: this._evaluateKPIs(cycleResults.insights?.engagementMetrics),
      recommendations: this._generateRecommendations(cycleResults.insights),
    };
    await this._saveReportJson(report, `daily_${date}`);
    this._printDailyReport(report);
    return report;
  }

  async generateClientReport(insightData, options = {}) {
    const spinner = ora('クライアントレポートを生成中...').start();
    try {
      const period = options.period || this._getCurrentMonthPeriod();
      const reportData = this._compileReportData(insightData, period, options);
      const htmlPath = await this._generateHTMLReport(reportData);
      const excelPath = await this._generateExcelReport(reportData);
      try { await this.sheets.saveMonthlyReport(reportData); } catch { /* optional */ }
      spinner.succeed(chalk.green('クライアントレポート生成完了'));
      return { htmlPath, excelPath, data: reportData };
    } catch (error) {
      spinner.fail(`レポート生成失敗: ${error.message}`);
      throw error;
    }
  }

  async _generateHTMLReport(data) {
    const html = this._buildHTMLTemplate(data);
    const filename = `report_${data.period.start}_${data.period.end}.html`;
    const filepath = path.join(this.reportDir, filename);
    await fs.mkdir(this.reportDir, { recursive: true });
    await fs.writeFile(filepath, html, 'utf-8');
    return filepath;
  }

  // ===== データ集計 =====
  _compileReportData(insightData, period, options) {
    const metrics = insightData?.engagementMetrics || {};
    const posts = (insightData?.posts || []).map(p => ({
      ...p,
      engagementScore: (p.like_count||0)*2 + (p.reply_count||0)*3 + (p.repost_count||0)*4 + (p.quote_count||0)*4,
      er: p.views > 0 ? (((p.like_count||0)+(p.reply_count||0)+(p.repost_count||0)+(p.quote_count||0)) / p.views * 100) : 0,
    }));
    const topPosts = [...posts].sort((a,b) => b.engagementScore - a.engagementScore).slice(0, 10);

    // 統計計算
    const stats = this._calcStats(posts, metrics);
    // 時間帯・曜日別分析
    const timeAnalysis = this._analyzePostTiming(posts);
    // カテゴリ別（テキスト分類なので投稿長でグループ）
    const contentAnalysis = this._analyzeContent(posts);

    return {
      period, metrics, posts, topPosts, stats, timeAnalysis, contentAnalysis,
      kpiStatus: this._evaluateKPIs(metrics),
      recommendations: this._generateRecommendations(insightData),
      trendTopics: insightData?.trendTopics || [],
      clientName: options.clientName || '',
      generatedAt: dayjs().format('YYYY年MM月DD日 HH:mm'),
    };
  }

  _calcStats(posts, metrics) {
    if (!posts.length) return {};
    const scores = posts.map(p => p.engagementScore);
    const views = posts.map(p => p.views || 0);
    const likes = posts.map(p => p.like_count || 0);
    const ers = posts.map(p => p.er || 0);

    const mean = arr => arr.reduce((a,b) => a+b, 0) / arr.length;
    const median = arr => { const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
    const stddev = arr => { const m=mean(arr); return Math.sqrt(arr.reduce((a,b)=>a+Math.pow(b-m,2),0)/arr.length); };
    const max = arr => Math.max(...arr);

    // ER分布（バケット）
    const erBuckets = [0,0,0,0,0,0];
    ers.forEach(e => {
      if (e < 1) erBuckets[0]++;
      else if (e < 2) erBuckets[1]++;
      else if (e < 3) erBuckets[2]++;
      else if (e < 5) erBuckets[3]++;
      else if (e < 10) erBuckets[4]++;
      else erBuckets[5]++;
    });

    // フォロワー換算リーチ率
    const followers = metrics.followersCount || 0;
    const avgViews = views.length ? mean(views) : 0;
    const reachRate = followers > 0 ? (avgViews / followers * 100) : 0;

    return {
      postCount: posts.length,
      avgScore: mean(scores).toFixed(1),
      medianScore: median(scores).toFixed(1),
      stddevScore: stddev(scores).toFixed(1),
      maxScore: max(scores),
      avgViews: Math.round(mean(views)),
      maxViews: max(views),
      avgLikes: mean(likes).toFixed(1),
      avgER: mean(ers).toFixed(2),
      maxER: max(ers).toFixed(2),
      reachRate: reachRate.toFixed(1),
      erBuckets,
      topPostRatio: posts.length > 1 ? (scores[0] / (mean(scores)||1)).toFixed(1) : 1,
      // エンゲージメント内訳
      totalLikes: posts.reduce((a,p)=>a+(p.like_count||0),0),
      totalReplies: posts.reduce((a,p)=>a+(p.reply_count||0),0),
      totalReposts: posts.reduce((a,p)=>a+(p.repost_count||0),0),
      totalQuotes: posts.reduce((a,p)=>a+(p.quote_count||0),0),
    };
  }

  _analyzePostTiming(posts) {
    const dayNames = ['日','月','火','水','木','金','土'];
    const dayScores = Array(7).fill(0).map(()=>({count:0,score:0}));
    const hourScores = Array(24).fill(0).map(()=>({count:0,score:0}));

    posts.forEach(p => {
      if (!p.timestamp) return;
      const d = dayjs(p.timestamp);
      const dow = d.day();
      const h = d.hour();
      dayScores[dow].count++;
      dayScores[dow].score += p.engagementScore || 0;
      hourScores[h].count++;
      hourScores[h].score += p.engagementScore || 0;
    });

    const dayAvg = dayScores.map((d,i) => ({
      label: dayNames[i],
      avg: d.count > 0 ? Math.round(d.score / d.count) : 0,
      count: d.count,
    }));
    const hourAvg = hourScores.map((h,i) => ({
      label: `${i}時`,
      avg: h.count > 0 ? Math.round(h.score / h.count) : 0,
      count: h.count,
    }));

    const bestDay = dayAvg.reduce((a,b) => b.avg > a.avg ? b : a, {label:'不明',avg:0});
    const bestHour = hourAvg.reduce((a,b) => b.avg > a.avg ? b : a, {label:'不明',avg:0});

    return { dayAvg, hourAvg, bestDay, bestHour };
  }

  _analyzeContent(posts) {
    // テキスト長で分類（短文/中文/長文）
    const groups = { short: [], medium: [], long: [] };
    posts.forEach(p => {
      const len = (p.text||'').length;
      if (len < 50) groups.short.push(p);
      else if (len < 150) groups.medium.push(p);
      else groups.long.push(p);
    });
    const avg = arr => arr.length ? arr.reduce((a,p)=>a+(p.engagementScore||0),0)/arr.length : 0;
    return [
      { label: '短文（〜50字）', count: groups.short.length, avgScore: avg(groups.short).toFixed(0) },
      { label: '中文（50〜150字）', count: groups.medium.length, avgScore: avg(groups.medium).toFixed(0) },
      { label: '長文（150字〜）', count: groups.long.length, avgScore: avg(groups.long).toFixed(0) },
    ];
  }

  // ===== SVGチャート生成 =====
  _svgBarChart(labels, values, opts = {}) {
    const W = opts.width || 480;
    const H = opts.height || 200;
    const pad = { top: 16, right: 16, bottom: 40, left: 48 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const maxVal = Math.max(...values, 1);
    const barW = chartW / labels.length * 0.6;
    const gap = chartW / labels.length;
    const color = opts.color || '#0a0a0a';
    const highlightIdx = opts.highlightIdx ?? values.indexOf(Math.max(...values));

    let bars = '';
    let xLabels = '';
    let yLines = '';

    // Y軸グリッド
    [0, 0.25, 0.5, 0.75, 1].forEach(ratio => {
      const y = pad.top + chartH * (1 - ratio);
      const val = Math.round(maxVal * ratio);
      yLines += `<line x1="${pad.left}" y1="${y}" x2="${pad.left+chartW}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`;
      yLines += `<text x="${pad.left-6}" y="${y+4}" text-anchor="end" font-size="10" fill="#9ca3af">${val}</text>`;
    });

    labels.forEach((label, i) => {
      const x = pad.left + i * gap + gap / 2 - barW / 2;
      const barH = (values[i] / maxVal) * chartH;
      const y = pad.top + chartH - barH;
      const fill = i === highlightIdx ? color : opts.altColor || '#d1d5db';
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${fill}" rx="3"/>`;
      if (opts.showValues) {
        bars += `<text x="${x+barW/2}" y="${y-4}" text-anchor="middle" font-size="10" fill="#6b7280">${values[i]}</text>`;
      }
      // X軸ラベル（長すぎる場合は省略）
      const shortLabel = label.length > 5 ? label.slice(0, 5) + '…' : label;
      xLabels += `<text x="${x+barW/2}" y="${H-8}" text-anchor="middle" font-size="10" fill="#6b7280">${shortLabel}</text>`;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${yLines}
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top+chartH}" stroke="#e5e7eb" stroke-width="1"/>
      ${bars}${xLabels}
    </svg>`;
  }

  _svgDonutChart(segments) {
    // segments: [{label, value, color}]
    const total = segments.reduce((a,s)=>a+s.value, 0) || 1;
    const cx = 80, cy = 80, r = 60, innerR = 36;
    let startAngle = -Math.PI / 2;
    let paths = '';
    let legends = '';

    segments.forEach((seg, i) => {
      const angle = (seg.value / total) * Math.PI * 2;
      const endAngle = startAngle + angle;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const ix1 = cx + innerR * Math.cos(endAngle);
      const iy1 = cy + innerR * Math.sin(endAngle);
      const ix2 = cx + innerR * Math.cos(startAngle);
      const iy2 = cy + innerR * Math.sin(startAngle);
      const large = angle > Math.PI ? 1 : 0;
      const pct = Math.round(seg.value / total * 100);

      paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${large},0 ${ix2},${iy2} Z" fill="${seg.color}"/>`;

      const ly = 24 + i * 20;
      legends += `<rect x="172" y="${ly-10}" width="12" height="12" fill="${seg.color}" rx="2"/>`;
      legends += `<text x="190" y="${ly}" font-size="12" fill="#374151">${seg.label}</text>`;
      legends += `<text x="300" y="${ly}" font-size="12" fill="#6b7280" text-anchor="end">${pct}%</text>`;

      startAngle = endAngle;
    });

    const maxSeg = segments.reduce((a,b) => b.value>a.value?b:a, segments[0]);
    const pctMax = Math.round((maxSeg?.value||0)/total*100);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      ${paths}
      <circle cx="${cx}" cy="${cy}" r="${innerR-2}" fill="white"/>
      <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="11" fill="#6b7280">最多</text>
      <text x="${cx}" y="${cy+10}" text-anchor="middle" font-size="13" font-weight="600" fill="#111">${maxSeg?.label||''}</text>
      <text x="${cx}" y="${cy+26}" text-anchor="middle" font-size="11" fill="#6b7280">${pctMax}%</text>
      ${legends}
    </svg>`;
  }

  _svgLineChart(labels, values, opts = {}) {
    const W = opts.width || 480;
    const H = opts.height || 160;
    const pad = { top: 16, right: 16, bottom: 32, left: 48 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const maxVal = Math.max(...values, 1);
    const color = opts.color || '#0a0a0a';

    const pts = values.map((v, i) => {
      const x = pad.left + (i / (values.length - 1 || 1)) * chartW;
      const y = pad.top + chartH - (v / maxVal) * chartH;
      return `${x},${y}`;
    });

    let yLines = '';
    [0, 0.5, 1].forEach(ratio => {
      const y = pad.top + chartH * (1 - ratio);
      const val = Math.round(maxVal * ratio);
      yLines += `<line x1="${pad.left}" y1="${y}" x2="${pad.left+chartW}" y2="${y}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="4,4"/>`;
      yLines += `<text x="${pad.left-6}" y="${y+4}" text-anchor="end" font-size="10" fill="#9ca3af">${val}</text>`;
    });

    const areaPoints = `${pad.left},${pad.top+chartH} ${pts.join(' ')} ${pad.left+chartW},${pad.top+chartH}`;

    let xLabels = '';
    const step = Math.max(1, Math.floor(labels.length / 6));
    labels.forEach((label, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return;
      const x = pad.left + (i / (labels.length - 1 || 1)) * chartW;
      xLabels += `<text x="${x}" y="${H-6}" text-anchor="middle" font-size="10" fill="#9ca3af">${label}</text>`;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${yLines}
      <polygon points="${areaPoints}" fill="${color}" opacity="0.06"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
      ${values.map((v,i) => `<circle cx="${pts[i].split(',')[0]}" cy="${pts[i].split(',')[1]}" r="3" fill="${color}"/>`).join('')}
      ${xLabels}
    </svg>`;
  }

  // ===== HTML テンプレート =====
  _buildHTMLTemplate(data) {
    const m = data.metrics || {};
    const s = data.stats || {};
    const posts = data.posts || [];
    const topPosts = data.topPosts || [];
    const timing = data.timeAnalysis || {};
    const erVal = parseFloat(m.engagementRate || 0);
    const erTarget = config.kpiTargets.engagementRate;

    // 総合スコア算出
    let score = 0;
    if (erVal >= erTarget) score += 35; else if (erVal >= erTarget*0.7) score += 18;
    if ((s.postCount||0) >= 15) score += 25; else if ((s.postCount||0) >= 7) score += 12;
    if (parseFloat(s.avgER||0) >= 2) score += 25; else if (parseFloat(s.avgER||0) >= 1) score += 12;
    if ((s.avgViews||0) >= 1000) score += 15; else if ((s.avgViews||0) >= 300) score += 8;

    const verdict = score >= 75
      ? { label:'良好', color:'#059669', bg:'#f0fdf4', icon:'✅', text:`今期の運用は目標水準を達成しています（総合スコア${score}点）。このペースを維持しながら、さらなる上積みを目指してください。` }
      : score >= 50
      ? { label:'改善余地あり', color:'#d97706', bg:'#fffbeb', icon:'⚠️', text:`基本的な数値は出ていますが、いくつかの指標で改善の余地があります（総合スコア${score}点）。以下のアクションプランを優先的に実行してください。` }
      : { label:'要改善', color:'#dc2626', bg:'#fef2f2', icon:'🔴', text:`複数の指標が目標を下回っています（総合スコア${score}点）。投稿頻度・コンテンツ品質・エンゲージメント促進の3点を重点的に改善してください。` };

    // トップ3アクション
    const top3Actions = [];
    if (erVal < erTarget) top3Actions.push({ no:'01', title:'エンゲージメント率を上げる', body:`現在${erVal}%→目標${erTarget}%。質問・投票型投稿を週2本追加。`, color:'#dc2626' });
    if ((s.postCount||0) < 12) top3Actions.push({ no:`0${top3Actions.length+1}`, title:'投稿頻度を上げる', body:`${s.postCount||0}件→週3〜4本ペース（月12件以上）を目指す。`, color:'#d97706' });
    if (timing.bestDay?.label) top3Actions.push({ no:`0${top3Actions.length+1}`, title:`${timing.bestDay.label}曜日に集中投稿`, body:`${timing.bestDay.label}曜日が最高スコア（${timing.bestDay.avg}）。この曜日を重点的に活用。`, color:'#2563eb' });
    if (top3Actions.length < 3 && topPosts[0]) top3Actions.push({ no:`0${top3Actions.length+1}`, title:'ヒット投稿を横展開する', body:`スコア${topPosts[0].engagementScore}の投稿パターンを週1本ペースで再現。`, color:'#059669' });
    while (top3Actions.length < 3) top3Actions.push({ no:`0${top3Actions.length+1}`, title:'最適時間帯に投稿する', body:'7:00/12:00/21:00の3枠に集中投稿することでリーチを最大化。', color:'#6b7280' });

    // チャート生成
    const engBreakdown = this._svgDonutChart([
      { label:'いいね', value:s.totalLikes||0, color:'#f97316' },
      { label:'返信', value:s.totalReplies||0, color:'#3b82f6' },
      { label:'リポスト', value:s.totalReposts||0, color:'#10b981' },
      { label:'引用', value:s.totalQuotes||0, color:'#8b5cf6' },
    ]);
    const erLabels = ['〜1%','1〜2%','2〜3%','3〜5%','5〜10%','10%〜'];
    const erChart = this._svgBarChart(erLabels, s.erBuckets||[0,0,0,0,0,0], { width:400, height:160, color:'#0a0a0a', altColor:'#d1d5db', showValues:true });
    const dayChart = this._svgBarChart((timing.dayAvg||[]).map(d=>d.label), (timing.dayAvg||[]).map(d=>d.avg), { width:340, height:160, color:'#0a0a0a', altColor:'#d1d5db' });
    const top5Posts = topPosts.slice(0,5);
    const top5Chart = this._svgBarChart(top5Posts.map((_,i)=>`#${i+1}`), top5Posts.map(p=>p.engagementScore||0), { width:300, height:160, color:'#0a0a0a', altColor:'#d1d5db', showValues:true });
    const engHistory = posts.filter(p=>p.timestamp).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)).slice(-20);
    const histChart = engHistory.length >= 3 ? this._svgLineChart(engHistory.map(p=>dayjs(p.timestamp).format('M/D')), engHistory.map(p=>p.engagementScore||0), { width:460, height:140, color:'#0a0a0a' }) : '';

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Threads 運用レポート | ${data.period.start}〜${data.period.end}</title>
  <style>
    :root{--ink:#111827;--ink2:#6b7280;--ink3:#9ca3af;--bg:#f9fafb;--surface:#fff;--border:#e5e7eb;--border2:#f3f4f6}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Hiragino Sans','Yu Gothic UI','Meiryo','Segoe UI',sans-serif;color:var(--ink);background:var(--bg);font-size:13px;line-height:1.7}
    .page{max-width:880px;margin:0 auto;padding:40px 28px}
    .cover{background:#111;color:#fff;border-radius:14px;padding:44px 44px 36px;margin-bottom:20px;position:relative;overflow:hidden}
    .cover::before{content:'';position:absolute;right:-80px;top:-80px;width:320px;height:320px;border-radius:50%;background:rgba(255,255,255,.03)}
    .cover-eyebrow{font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.45;margin-bottom:12px}
    .cover h1{font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1.2;margin-bottom:8px}
    .cover-client{font-size:18px;opacity:.65;font-weight:400;display:block;margin-top:4px}
    .cover-period{display:inline-block;background:rgba(255,255,255,.1);padding:6px 16px;border-radius:100px;font-size:12px;margin-top:18px}
    .cover-meta{display:flex;gap:20px;margin-top:16px;font-size:11px;opacity:.45}
    .section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px 28px;margin-bottom:16px}
    .sec-label{font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:8px}
    .sec-label::after{content:'';flex:1;height:1px;background:var(--border2)}
    .sec-h{font-size:15px;font-weight:700;margin-bottom:4px}
    .sec-sub{font-size:12px;color:var(--ink2);margin-bottom:16px;line-height:1.6}
    .verdict-box{border-radius:10px;padding:20px 24px;display:flex;align-items:flex-start;gap:16px;margin-bottom:16px}
    .verdict-icon{font-size:28px;flex-shrink:0;margin-top:2px}
    .verdict-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px}
    .verdict-text{font-size:13px;line-height:1.7}
    .score-row{display:flex;align-items:center;gap:12px;margin-top:14px}
    .score-num{font-size:22px;font-weight:800;flex-shrink:0}
    .score-bar-bg{flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}
    .score-bar-fill{height:100%;border-radius:4px}
    .action-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .action-card{border-radius:10px;padding:16px;border:1px solid var(--border);background:var(--bg)}
    .action-no{font-size:10px;font-weight:700;letter-spacing:.08em;margin-bottom:6px}
    .action-title{font-size:13px;font-weight:700;margin-bottom:5px;line-height:1.3}
    .action-body{font-size:11px;color:var(--ink2);line-height:1.6}
    .kpi-table{width:100%;border-collapse:collapse}
    .kpi-table th{font-size:10px;color:var(--ink3);font-weight:600;letter-spacing:.06em;text-align:left;padding:8px 12px;background:var(--bg);border-bottom:1px solid var(--border)}
    .kpi-table td{padding:11px 12px;border-bottom:1px solid var(--border2);font-size:13px;vertical-align:middle}
    .kpi-table tr:last-child td{border-bottom:none}
    .kpi-val{font-weight:800;font-size:18px}
    .kpi-bar-bg{height:4px;background:#e5e7eb;border-radius:2px;overflow:hidden;margin-top:4px;width:100px}
    .kpi-bar-fill{height:100%;border-radius:2px}
    .badge{display:inline-block;padding:2px 10px;border-radius:100px;font-size:10px;font-weight:700}
    .bg{background:#f0fdf4;color:#059669}.br{background:#fef2f2;color:#dc2626}.ba{background:#fffbeb;color:#d97706}
    .data-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    .data-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center}
    .data-val{font-size:22px;font-weight:800;letter-spacing:-.02em}
    .data-lbl{font-size:10px;color:var(--ink3);margin-top:4px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
    .data-sub{font-size:11px;color:var(--ink2);margin-top:2px}
    .two-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    .post-item{padding:12px 0;border-bottom:1px solid var(--border2)}
    .post-item:last-child{border-bottom:none}
    .post-rank{font-size:10px;font-weight:700;color:var(--ink3);margin-bottom:3px}
    .post-text{font-size:13px;margin-bottom:6px;line-height:1.5}
    .post-nums{display:flex;gap:14px;font-size:11px;color:var(--ink2)}
    .post-score{font-size:12px;font-weight:700;color:var(--ink);margin-left:auto}
    .post-bar-bg{height:3px;background:#f3f4f6;border-radius:2px;margin-top:6px}
    .post-bar-fill{height:100%;border-radius:2px;background:#111}
    .stat-tbl{width:100%;border-collapse:collapse}
    .stat-tbl th{font-size:10px;color:var(--ink3);font-weight:600;text-align:left;padding:7px 10px;background:var(--bg);border-bottom:1px solid var(--border)}
    .stat-tbl td{padding:9px 10px;border-bottom:1px solid var(--border2);font-size:13px}
    .stat-tbl tr:last-child td{border-bottom:none}
    .insight{background:var(--bg);border:1px solid var(--border);border-left:3px solid #111;border-radius:0 8px 8px 0;padding:11px 16px;margin-top:10px;font-size:12px;color:var(--ink2);line-height:1.7}
    .insight strong{color:var(--ink)}
    .rec-item{padding:14px;border-radius:10px;border:1px solid var(--border2);border-left-width:3px;margin-bottom:10px}
    .rec-item:last-child{margin-bottom:0}
    .rec-priority{font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:4px}
    .rec-title{font-size:13px;font-weight:700;margin-bottom:4px}
    .rec-body{font-size:12px;color:var(--ink2);line-height:1.6}
    .next-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .next-card{text-align:center;padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:10px}
    .next-val{font-size:20px;font-weight:800}
    .next-lbl{font-size:10px;color:var(--ink3);margin-top:3px}
    .footer{text-align:center;font-size:10px;color:var(--ink3);padding:24px 0;border-top:1px solid var(--border);margin-top:8px;line-height:2}
    @media print{body{background:#fff}.page{padding:0}.cover{border-radius:0}.section{break-inside:avoid}}
  </style>
</head>
<body><div class="page">

<div class="cover">
  <div class="cover-eyebrow">Threads SNS Management Report</div>
  <h1>運用パフォーマンス レポート${data.clientName?`<span class="cover-client">${data.clientName}</span>`:''}</h1>
  <div class="cover-period">対象期間：${data.period.start} 〜 ${data.period.end}</div>
  <div class="cover-meta"><span>生成：${data.generatedAt}</span><span>投稿数：${s.postCount||0}件</span><span>フォロワー：${(m.followersCount||0).toLocaleString()}人</span></div>
</div>

<!-- ① 結論 -->
<div class="section">
  <div class="sec-label">① 結論 — 今期の総合評価</div>
  <div class="verdict-box" style="background:${verdict.bg};border:1px solid ${verdict.color}33">
    <div class="verdict-icon">${verdict.icon}</div>
    <div style="flex:1">
      <div class="verdict-label" style="color:${verdict.color}">${verdict.label}</div>
      <div class="verdict-text">${verdict.text}</div>
      <div class="score-row">
        <div class="score-num" style="color:${verdict.color}">${score}<span style="font-size:13px;font-weight:400;opacity:.6">点</span></div>
        <div style="flex:1"><div style="font-size:10px;color:var(--ink3);margin-bottom:4px">総合スコア（100点満点）</div><div class="score-bar-bg"><div class="score-bar-fill" style="width:${score}%;background:${verdict.color}"></div></div></div>
      </div>
    </div>
  </div>
  <div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:10px">今すぐやるべき 3つのアクション</div>
  <div class="action-grid">
    ${top3Actions.slice(0,3).map(a=>`<div class="action-card"><div class="action-no" style="color:${a.color}">ACTION ${a.no}</div><div class="action-title">${a.title}</div><div class="action-body">${a.body}</div></div>`).join('')}
  </div>
</div>

<!-- ② データ：KPI -->
<div class="section">
  <div class="sec-label">② データ — KPI 達成状況</div>
  <table class="kpi-table">
    <thead><tr><th>指標</th><th>実績値</th><th>目標値</th><th>達成率</th><th>判定</th></tr></thead>
    <tbody>
      ${[
        {label:'エンゲージメント率', val:`${erVal}%`, target:`${erTarget}%`, rate:Math.min(Math.round(erVal/erTarget*100),100), achieved:erVal>=erTarget},
        {label:'平均閲覧数 / 投稿', val:`${(s.avgViews||0).toLocaleString()}`, target:'1,000', rate:Math.min(Math.round((s.avgViews||0)/1000*100),100), achieved:(s.avgViews||0)>=1000},
        {label:'月間投稿数', val:`${s.postCount||0}件`, target:'12件', rate:Math.min(Math.round((s.postCount||0)/12*100),100), achieved:(s.postCount||0)>=12},
        {label:'平均ER（投稿別）', val:`${s.avgER||0}%`, target:'2.0%', rate:Math.min(Math.round(parseFloat(s.avgER||0)/2*100),100), achieved:parseFloat(s.avgER||0)>=2},
      ].map(k=>`<tr>
        <td>${k.label}</td>
        <td><span class="kpi-val">${k.val}</span></td>
        <td style="color:var(--ink3);font-size:12px">${k.target}</td>
        <td><div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;font-weight:700;color:${k.achieved?'#059669':'#dc2626'}">${k.rate}%</span><div class="kpi-bar-bg"><div class="kpi-bar-fill" style="width:${k.rate}%;background:${k.achieved?'#059669':'#dc2626'}"></div></div></div></td>
        <td><span class="badge ${k.achieved?'bg':'br'}">${k.achieved?'達成':'未達'}</span></td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div style="margin-top:20px">
    <div class="data-grid">
      <div class="data-card"><div class="data-val">${(m.followersCount||0).toLocaleString()}</div><div class="data-lbl">フォロワー</div></div>
      <div class="data-card"><div class="data-val" style="color:${erVal>=erTarget?'#059669':'#dc2626'}">${m.engagementRate||0}%</div><div class="data-lbl">エンゲージ率</div><div class="data-sub">目標 ${erTarget}%</div></div>
      <div class="data-card"><div class="data-val">${(s.avgViews||0).toLocaleString()}</div><div class="data-lbl">平均閲覧数</div><div class="data-sub">最高 ${(s.maxViews||0).toLocaleString()}</div></div>
      <div class="data-card"><div class="data-val">${s.reachRate||0}%</div><div class="data-lbl">リーチ率</div><div class="data-sub">フォロワー換算</div></div>
    </div>
  </div>
</div>

<!-- ② データ：推移・分布 -->
<div class="section">
  <div class="sec-label">② データ — 推移・エンゲージメント分布</div>
  ${histChart?`<div style="margin-bottom:20px"><div style="font-size:12px;font-weight:700;margin-bottom:6px">エンゲージメントスコア 推移（直近${engHistory.length}投稿）</div><div style="overflow-x:auto">${histChart}</div></div>`:''}
  <div class="two-cols">
    <div>
      <div style="font-size:12px;font-weight:700;margin-bottom:6px">ER 分布（全${s.postCount||0}投稿）</div>
      <div style="overflow-x:auto">${erChart}</div>
      <div style="font-size:10px;color:var(--ink3);margin-top:4px">ER = エンゲージ合計 ÷ 閲覧数 × 100</div>
    </div>
    <div>
      <div style="font-size:12px;font-weight:700;margin-bottom:6px">エンゲージメント内訳</div>
      <div style="overflow-x:auto">${engBreakdown}</div>
      <table class="stat-tbl" style="margin-top:8px">
        <tbody>
          <tr><td>いいね</td><td style="font-weight:700;text-align:right">${(s.totalLikes||0).toLocaleString()}</td></tr>
          <tr><td>返信</td><td style="font-weight:700;text-align:right">${(s.totalReplies||0).toLocaleString()}</td></tr>
          <tr><td>リポスト＋引用（拡散）</td><td style="font-weight:700;text-align:right">${((s.totalReposts||0)+(s.totalQuotes||0)).toLocaleString()}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- ③ 考察 -->
<div class="section">
  <div class="sec-label">③ 考察 — パターン分析とインサイト</div>
  <div class="sec-h">パフォーマンスの高い投稿の特徴</div>
  <div class="sec-sub">上位5投稿を分析し、成功パターンを抽出します</div>
  <div class="two-cols">
    <div>
      ${top5Posts.map((p,i)=>{
        const icons=['🥇','🥈','🥉','4位','5位'];
        const maxSc=top5Posts[0]?.engagementScore||1;
        const pct=Math.round((p.engagementScore||0)/maxSc*100);
        return `<div class="post-item">
          <div class="post-rank">${icons[i]}</div>
          <div class="post-text">${(p.text||'').substring(0,70)}${(p.text||'').length>70?'…':''}</div>
          <div class="post-nums"><span>❤️ ${p.like_count||0}</span><span>💬 ${p.reply_count||0}</span><span>🔁 ${(p.repost_count||0)+(p.quote_count||0)}</span><span>👁 ${(p.views||0).toLocaleString()}</span><span class="post-score">スコア ${p.engagementScore||0}</span></div>
          <div class="post-bar-bg"><div class="post-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
      }).join('')}
    </div>
    <div>
      <div style="font-size:12px;font-weight:700;margin-bottom:8px">スコア比較</div>
      <div style="overflow-x:auto">${top5Chart}</div>
      <div style="margin-top:16px">
        <table class="stat-tbl">
          <thead><tr><th>統計指標</th><th style="text-align:right">値</th></tr></thead>
          <tbody>
            <tr><td>平均スコア</td><td style="font-weight:700;text-align:right">${s.avgScore||0}</td></tr>
            <tr><td>中央値</td><td style="font-weight:700;text-align:right">${s.medianScore||0}</td></tr>
            <tr><td>標準偏差</td><td style="font-weight:700;text-align:right">${s.stddevScore||0}</td></tr>
            <tr><td>最高スコア</td><td style="font-weight:700;text-align:right">${s.maxScore||0}</td></tr>
            <tr><td>平均 ÷ 最高（均一性）</td><td style="font-weight:700;text-align:right">${Math.round(parseFloat(s.avgScore||0)/(s.maxScore||1)*100)}%</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  ${timing.dayAvg?`
  <div style="margin-top:24px">
    <div class="sec-h" style="margin-bottom:4px">投稿タイミングと成果の関係</div>
    <div class="sec-sub">曜日・コンテンツ長によってエンゲージメントに明確な差が出ています</div>
    <div class="two-cols">
      <div>
        <div style="font-size:12px;font-weight:700;margin-bottom:6px">曜日別 平均スコア</div>
        <div style="overflow-x:auto">${dayChart}</div>
        <div class="insight"><strong>${timing.bestDay?.label}曜日</strong>が最もエンゲージメントが高く（平均スコア ${timing.bestDay?.avg}）、重点的な投稿で成果の最大化が見込めます。</div>
      </div>
      <div>
        <div style="font-size:12px;font-weight:700;margin-bottom:6px">コンテンツ長別 パフォーマンス</div>
        <table class="stat-tbl">
          <thead><tr><th>投稿タイプ</th><th style="text-align:right">件数</th><th style="text-align:right">平均スコア</th></tr></thead>
          <tbody>
            ${(data.contentAnalysis||[]).map(c=>{
              const best=Math.max(...(data.contentAnalysis||[]).map(x=>parseInt(x.avgScore)||0));
              const isBest=parseInt(c.avgScore)===best&&best>0;
              return `<tr><td>${c.label}${isBest?' <span style="font-size:10px;background:#f0fdf4;color:#059669;padding:1px 6px;border-radius:4px">最高</span>':''}</td><td style="text-align:right">${c.count}</td><td style="text-align:right;font-weight:700">${c.avgScore}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        <div class="insight" style="margin-top:10px">
          ${(()=>{const ca=data.contentAnalysis||[];if(!ca.length)return'';const best=ca.reduce((a,b)=>parseInt(b.avgScore)>parseInt(a.avgScore)?b:a,ca[0]);return `<strong>${best.label}</strong>が最も高いスコア（${best.avgScore}）。この長さのコンテンツを優先制作することを推奨します。`;})()}
        </div>
      </div>
    </div>
  </div>`:''
  }
</div>

<!-- アクションプラン（結論に戻る） -->
<div class="section">
  <div class="sec-label">→ 結論に戻る — 次期アクションプラン</div>
  <div class="sec-h">優先度付き改善施策</div>
  <div class="sec-sub">上記の考察に基づき、効果の高い順に施策を提案します</div>
  ${(data.recommendations||[]).map((r,i)=>{
    const ps=[{lbl:'優先度 高',bd:'#dc2626',bg:'#fef2f2'},{lbl:'優先度 中',bd:'#d97706',bg:'#fffbeb'},{lbl:'優先度 中',bd:'#d97706',bg:'#fffbeb'},{lbl:'参考',bd:'#e5e7eb',bg:'#f9fafb'}];
    const p=ps[i]||ps[3];
    return `<div class="rec-item" style="background:${p.bg};border-left-color:${p.bd}"><div class="rec-priority" style="color:${p.bd}">${p.lbl}</div><div class="rec-title">${r.title.replace(/^[\S]+\s/,'')}</div><div class="rec-body">${r.description}</div></div>`;
  }).join('')}
  <div style="margin-top:18px;padding:16px;background:var(--bg);border:1px solid var(--border);border-radius:10px">
    <div style="font-size:11px;font-weight:700;color:var(--ink);margin-bottom:10px">次期 目標値（データに基づく設定）</div>
    <div class="next-grid">
      <div class="next-card"><div class="next-val">${(erVal+0.5).toFixed(1)}%</div><div class="next-lbl">目標ER（現在+0.5pt）</div></div>
      <div class="next-card"><div class="next-val">${Math.ceil((s.avgViews||0)*1.15).toLocaleString()}</div><div class="next-lbl">目標平均閲覧数（+15%）</div></div>
      <div class="next-card"><div class="next-val">${Math.max((s.postCount||0),12)}</div><div class="next-lbl">目標投稿数（件/月）</div></div>
    </div>
  </div>
</div>

<div class="footer">
  本レポートは Threads Graph API データを元に自動生成 ／ ${data.generatedAt}<br>
  エンゲージメントスコア = いいね×2＋返信×3＋リポスト×4＋引用×4
</div>
</div></body></html>`;
  }

  // ===== Excel =====
  async _generateExcelReport(data) {
    const workbook = XLSX.utils.book_new();
    const m = data.metrics || {};
    const s = data.stats || {};

    // シート1: サマリー
    const summaryData = [
      ['Threads 運用レポート', ''],
      ['対象期間', `${data.period.start} 〜 ${data.period.end}`],
      ['生成日時', data.generatedAt],
      ['クライアント', data.clientName || ''],
      ['', ''],
      ['=== KPI指標 ===', ''],
      ['フォロワー数', m.followersCount || 0],
      ['エンゲージメント率 (%)', m.engagementRate || 0],
      ['KPI目標 (%)', config.kpiTargets.engagementRate],
      ['KPI達成状況', parseFloat(m.engagementRate||0) >= config.kpiTargets.engagementRate ? '達成' : '未達'],
      ['', ''],
      ['=== 統計分析 ===', ''],
      ['投稿数', s.postCount || 0],
      ['平均エンゲージメントスコア', s.avgScore || 0],
      ['中央値スコア', s.medianScore || 0],
      ['標準偏差', s.stddevScore || 0],
      ['最高スコア', s.maxScore || 0],
      ['平均閲覧数/投稿', s.avgViews || 0],
      ['最高閲覧数', s.maxViews || 0],
      ['平均ER (%)', s.avgER || 0],
      ['最高ER (%)', s.maxER || 0],
      ['フォロワーリーチ率 (%)', s.reachRate || 0],
      ['', ''],
      ['=== エンゲージメント内訳 ===', ''],
      ['総いいね数', s.totalLikes || 0],
      ['総返信数', s.totalReplies || 0],
      ['総リポスト数', s.totalReposts || 0],
      ['総引用数', s.totalQuotes || 0],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    ws1['!cols'] = [{ wch: 30 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, ws1, 'サマリー');

    // シート2: 投稿パフォーマンス
    if (data.posts?.length) {
      const postsData = data.posts.map(p => ({
        '投稿日時': dayjs(p.timestamp).format('YYYY/MM/DD HH:mm'),
        '本文（冒頭100字）': p.text?.substring(0, 100) || '',
        'いいね': p.like_count || 0,
        '返信': p.reply_count || 0,
        'リポスト': p.repost_count || 0,
        '引用': p.quote_count || 0,
        '閲覧数': p.views || 0,
        'エンゲージメントスコア': p.engagementScore || 0,
        'ER (%)': p.er?.toFixed(2) || 0,
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(postsData), '投稿パフォーマンス');
    }

    // シート3: KPI達成状況
    const kpiData = Object.entries(data.kpiStatus || {}).map(([key, val]) => ({
      'KPI指標': key,
      '実績値': val.value,
      '目標値': val.target,
      '達成状況': val.status,
      '達成率 (%)': val.target > 0 ? ((val.value / val.target) * 100).toFixed(1) : '-',
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(kpiData), 'KPI達成状況');

    // シート4: 曜日別分析
    if (data.timeAnalysis?.dayAvg) {
      const timingData = data.timeAnalysis.dayAvg.map(d => ({
        '曜日': d.label + '曜日',
        '投稿数': d.count,
        '平均スコア': d.avg,
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(timingData), '曜日別分析');
    }

    const filename = `threads_report_${data.period.start}_${data.period.end}.xlsx`;
    const filepath = path.join(this.reportDir, filename);
    await fs.mkdir(this.reportDir, { recursive: true });
    XLSX.writeFile(workbook, filepath);
    return filepath;
  }

  _getCurrentMonthPeriod() {
    return {
      start: dayjs().startOf('month').format('YYYY-MM-DD'),
      end: dayjs().endOf('month').format('YYYY-MM-DD'),
    };
  }

  _evaluateKPIs(metrics) {
    const targets = config.kpiTargets;
    if (!metrics) return {};
    return {
      engagementRate: {
        value: parseFloat(metrics.engagementRate || 0),
        target: targets.engagementRate,
        status: parseFloat(metrics.engagementRate || 0) >= targets.engagementRate ? '達成' : '未達',
      },
      reachRate: {
        value: parseFloat(metrics.reachRate || 0),
        target: targets.reachRate,
        status: parseFloat(metrics.reachRate || 0) >= targets.reachRate ? '達成' : '未達',
      },
    };
  }

  _generateRecommendations(insightData) {
    const recommendations = [];
    const metrics = insightData?.engagementMetrics || {};
    const topPosts = insightData?.topPosts || [];
    const trendTopics = insightData?.trendTopics || [];

    if (parseFloat(metrics.engagementRate) < config.kpiTargets.engagementRate) {
      recommendations.push({
        title: '🔴 エンゲージメント率の改善',
        description: `現在 ${metrics.engagementRate}% は目標 ${config.kpiTargets.engagementRate}% を下回っています。質問投稿・投票・読者参加型コンテンツを増やし、コメントへの返信率を高めることでエンゲージメントが改善します。目安として週1〜2本の問いかけ系投稿を組み込んでください。`,
      });
    }

    if (topPosts.length > 0) {
      recommendations.push({
        title: '✅ ヒット投稿のパターン横展開',
        description: `スコア ${topPosts[0].engagementScore} を記録したトップ投稿のテーマ・文体・構成を分析し、類似コンテンツを週1本以上継続的に制作してください。成功パターンの再現が最も効率的なエンゲージメント向上策です。`,
      });
    }

    if (trendTopics.length > 0) {
      recommendations.push({
        title: '📈 トレンドキーワードの活用',
        description: `「${trendTopics.slice(0,3).map(t=>t.word).join('」「')}」などのキーワードがフォロワーの関心を集めています。これらを軸にしたコンテンツを優先的に企画することで、リーチとエンゲージメントの向上が期待できます。`,
      });
    }

    recommendations.push({
      title: '⏰ 投稿時間の最適化',
      description: '平日 7:00・12:00・18:00・21:00、週末 9:00・12:00・15:00・20:00 が最適投稿時間帯です。特に月〜水曜の朝と夜の投稿はリーチが高い傾向があります。予約投稿機能を活用して一定のペースを維持してください。',
    });

    return recommendations;
  }

  async _saveReportJson(report, filename) {
    await fs.mkdir(this.reportDir, { recursive: true });
    const filepath = path.join(this.reportDir, `${filename}.json`);
    await fs.writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8');
    return filepath;
  }

  _printDailyReport(report) {
    console.log(chalk.bold('\n--- 日次レポート サマリー ---'));
    console.log(`  フォロワー        : ${report.insights.followersCount?.toLocaleString() || '-'}`);
    console.log(`  エンゲージメント率 : ${report.insights.engagementRate || '-'}%`);
    console.log(`  リーチ            : ${report.insights.totalReach?.toLocaleString() || '-'}`);
    console.log(chalk.bold('\n  KPI達成状況:'));
    Object.entries(report.kpiStatus).forEach(([key, val]) => {
      const icon = val.status === '達成' ? chalk.green('✅') : chalk.red('❌');
      console.log(`  ${icon} ${key}: ${val.value} / 目標 ${val.target}`);
    });
    console.log(chalk.bold('\n  次のアクション:'));
    report.recommendations.slice(0, 2).forEach(r => console.log(`  • ${r.title}`));
  }
}
