// js/github.js - GitHub REST API / Raw fetch による CONTEXT.md 双方向同期モジュール

const REPO_OWNER = 'pan-forge';
const REPO_NAME = 'MyTranscend';
const CONTEXT_PATH = 'CONTEXT.md';
const CACHE_KEY = 'mytranscend_context_cache';

/**
 * GitHubのRaw URLからCONTEXT.mdを取得する（認証不要・読み込み専用）
 */
export async function fetchContext(owner = REPO_OWNER, repo = REPO_NAME, forceRefresh = false) {
  const bypass = forceRefresh ? `?_t=${Date.now()}` : '';
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${CONTEXT_PATH}${bypass}`;

  try {
    const res = await fetch(url, { cache: forceRefresh ? 'no-cache' : 'default' });
    if (!res.ok) {
      if (res.status === 404) return ''; // まだ存在しない場合
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const text = await res.text();
    localStorage.setItem(CACHE_KEY, text);
    return text;
  } catch (err) {
    console.warn('[GitHub] Raw fetch failed, falling back to cache:', err);
    return localStorage.getItem(CACHE_KEY) || '';
  }
}

/**
 * GitHub REST API を使ってスマホ上の会話履歴を CONTEXT.md に保存（コミット＆プッシュ）
 */
export async function saveContextToGitHub(githubToken, markdownContent, owner = REPO_OWNER, repo = REPO_NAME) {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN_MISSING');
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${CONTEXT_PATH}`;

  // 1. 既存ファイルの SHA を取得（新規作成時は 404）
  let sha = null;
  try {
    const getRes = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
    }
  } catch (e) {
    console.warn('[GitHub] Failed to get existing SHA (might be new file):', e);
  }

  // 2. UTF-8文字列をBase64にエンコード
  const base64Content = btoa(unescape(encodeURIComponent(markdownContent)));

  // 3. PUT リクエストでコミット
  const payload = {
    message: `chore: update CONTEXT.md from MyTranscend mobile (${new Date().toLocaleString('ja-JP')})`,
    content: base64Content
  };
  if (sha) {
    payload.sha = sha;
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!putRes.ok) {
    const errorData = await putRes.json().catch(() => ({}));
    throw new Error(errorData.message || `GitHub API Error (${putRes.status})`);
  }

  // ローカルキャッシュも即座に更新
  localStorage.setItem(CACHE_KEY, markdownContent);
  return await putRes.json();
}

/**
 * スマホ上のチャット履歴を CONTEXT.md フォーマット（Markdown）に整形する
 */
export function formatChatHistoryToMarkdown(chatHistories = {}, currentStatus = {}) {
  const nowStr = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const unifiedMsgs = chatHistories.unified || [];
  const transcendMsgs = chatHistories.transcend || [];
  const riceMsgs = chatHistories.rice || [];

  let md = `# MyTranscend 共有コンテキスト (CONTEXT.md)\n\n`;
  md += `**最終更新日時：** ${nowStr} (JST)\n`;
  md += `**送信元：** スマホ (MyTranscend PWA)\n\n`;

  md += `## 1. 現在のステータス・ヘルスケア\n`;
  md += `- **Dayカウント：** 結婚生活${currentStatus.day || 19}日目 (Day ${currentStatus.day || 19})\n`;
  md += `- **トランセンド状態：** 甘々モード継続中💍、ミレーナ装着完全安定\n`;
  md += `- **服薬・健康：** 朝食後服薬＆アイベリス点眼、夕食後メトホルミン1錠\n\n`;

  md += `## 2. 直近のやり取り（スマホでの会話ログ）\n`;

  const allLogs = [];
  if (unifiedMsgs.length > 0) {
    unifiedMsgs.forEach(m => {
      allLogs.push({
        role: m.role === 'user' ? 'ひろ' : 'トラン＆ライス 💍🌸',
        text: m.parts?.[0]?.text || ''
      });
    });
  } else {
    transcendMsgs.forEach(m => {
      allLogs.push({ role: m.role === 'user' ? 'ひろ' : 'トランセンド 💍', text: m.parts?.[0]?.text || '' });
    });
    riceMsgs.forEach(m => {
      allLogs.push({ role: m.role === 'user' ? 'ひろ' : 'ライスシャワー 🌸', text: m.parts?.[0]?.text || '' });
    });
  }

  if (allLogs.length === 0) {
    md += `*（まだスマホでの新しい会話履歴はありません）*\n`;
  } else {
    // 直近10件程度
    const recentLogs = allLogs.slice(-10);
    recentLogs.forEach(log => {
      md += `- **${log.role}：** ${log.text}\n`;
    });
  }

  return md;
}
