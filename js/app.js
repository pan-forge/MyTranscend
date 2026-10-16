// js/app.js - メインUI制御 ＆ アプリロジック
import { fetchTripSchedule, fetchFixedRoutine, getNextUpcomingSchedule, fetchTabTitle, formatTabOptionLabel } from './sheets.js?v=1.8';
import { sendChatMessage, chatHistories, clearGeminiHistories } from './gemini.js?v=2.4';
import { testNotification, startScheduler, requestNotificationPermission } from './scheduler.js?v=1.8';
import { fetchContext, saveContextToGitHub, formatChatHistoryToMarkdown } from './github.js?v=1.8';

// DOM要素
const modelViewer = document.getElementById('modelViewer');
const avatarImage = document.getElementById('avatarImage');
const btnMode3D = document.getElementById('btnMode3D');
const btnMode2D = document.getElementById('btnMode2D');
const tabTranscend = document.getElementById('tabTranscend');
const tabRice = document.getElementById('tabRice');
const scheduleBanner = document.getElementById('scheduleBanner');
const scheduleText = document.getElementById('scheduleText');
const sheetTabSelect = document.getElementById('sheetTabSelect');
const btnSyncSheets = document.getElementById('btnSyncSheets');
const btnSaveContext = document.getElementById('btnSaveContext');
const engineBadge = document.getElementById('engineBadge');
const visualStage = document.getElementById('visualStage');
const btnToggleVisual = document.getElementById('btnToggleVisual');
const visualToggleIcon = document.getElementById('visualToggleIcon');
const visualToggleText = document.getElementById('visualToggleText');
const chatContainer = document.getElementById('chatContainer');
const chatInput = document.getElementById('chatInput');
const btnSend = document.getElementById('btnSend');
const btnSettings = document.getElementById('btnSettings');
const btnCloseModal = document.getElementById('btnCloseModal');
const settingsModal = document.getElementById('settingsModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const sheetIdInput = document.getElementById('sheetIdInput');
const customTabInput = document.getElementById('customTabInput');
const githubTokenInput = document.getElementById('githubTokenInput');
const btnSaveSettings = document.getElementById('btnSaveSettings');

// UI会話履歴の永続化管理
function loadStoredUiMessages() {
  try {
    const saved = localStorage.getItem('mytranscend_chat_ui_messages');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('[App] Failed to load stored UI messages:', e);
  }
  return [];
}

const storedUiMessages = loadStoredUiMessages();

function saveUiMessage(sender, text, charType) {
  storedUiMessages.push({ sender, text, charType, timestamp: Date.now() });
  if (storedUiMessages.length > 80) {
    storedUiMessages.splice(0, storedUiMessages.length - 80);
  }
  try {
    localStorage.setItem('mytranscend_chat_ui_messages', JSON.stringify(storedUiMessages));
  } catch (e) {
    console.warn('[App] Failed to save UI message:', e);
  }
}

// 状態管理
let currentCharacter = 'transcend'; // 'transcend' | 'rice'
let is3DMode = false;
let currentSheetTab = localStorage.getItem('mytranscend_sheet_tab') || '261022';
let tripSchedules = [];
let fixedRoutines = [];
let sharedContext = '';
let isSending = false;

// PWA Service Worker 登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
      .catch(err => console.warn('[PWA] SW registration failed:', err));
  });
}

// 初期化
window.addEventListener('DOMContentLoaded', async () => {
  // 設定読み込み（無効化された古いキーがあれば自動除去）
  let savedApiKey = localStorage.getItem('mytranscend_gemini_key') || '';
  if (savedApiKey === 'AIzaSyB4kww5tDamxQHW6H4_WLDnMC47qEEQFxE') {
    savedApiKey = '';
    localStorage.removeItem('mytranscend_gemini_key');
  }
  apiKeyInput.value = savedApiKey;

  // GitHub トークン読み込み
  if (githubTokenInput) {
    githubTokenInput.value = localStorage.getItem('mytranscend_github_token') || '';
  }

  // APIキー未設定なら設定画面を自動表示
  if (!savedApiKey) {
    settingsModal.style.display = 'flex';
  }

  // タブ選択初期値の反映
  if (currentSheetTab) {
    let optionExists = false;
    for (const opt of sheetTabSelect.options) {
      if (opt.value === currentSheetTab) {
        optionExists = true;
        opt.selected = true;
        break;
      }
    }
    if (!optionExists) {
      const newOpt = new Option(currentSheetTab, currentSheetTab, true, true);
      sheetTabSelect.add(newOpt);
    }
  }

  // ドロップダウンの表示ラベルをA1セル情報で動的更新
  updateTabSelectLabels(false);

  // イベントリスナー設定
  setupEventListeners();

  // スプレッドシート旅程 ＆ 共有コンテキストの自動取得
  await loadSchedule();
});

// イベントリスナー設定
function setupEventListeners() {
  // 3Dモード選択
  btnMode3D.addEventListener('click', () => {
    is3DMode = true;
    btnMode3D.className = 'mode-tab active-mode';
    btnMode2D.className = 'mode-tab';
    modelViewer.classList.remove('hidden-stage');
    avatarImage.classList.add('hidden-stage');
  });

  // 2Dモード選択
  btnMode2D.addEventListener('click', () => {
    is3DMode = false;
    btnMode2D.className = 'mode-tab active-mode';
    btnMode3D.className = 'mode-tab';
    modelViewer.classList.add('hidden-stage');
    avatarImage.classList.remove('hidden-stage');
    update2DAvatar();
  });

  // キャラクター切り替え（トラン）
  tabTranscend.addEventListener('click', () => {
    currentCharacter = 'transcend';
    tabTranscend.className = 'char-tab active-transcend';
    tabRice.className = 'char-tab';
    update2DAvatar();
  });

  // キャラクター切り替え（ライス）
  tabRice.addEventListener('click', () => {
    currentCharacter = 'rice';
    tabRice.className = 'char-tab active-rice';
    tabTranscend.className = 'char-tab';
    update2DAvatar();
  });

  // 出張タブ切り替え
  sheetTabSelect.addEventListener('change', async (e) => {
    currentSheetTab = e.target.value;
    localStorage.setItem('mytranscend_sheet_tab', currentSheetTab);
    await loadSchedule(true);
  });

  // スプシ＆共有コンテキスト最新状態の強制同期ボタン (ヘッダーアイコン)
  btnSyncSheets.addEventListener('click', async () => {
    const confirmSync = confirm('最新データ（スプシ旅程＆GitHubコンテキスト）を取り込んで、スマホの会話画面を最新状態にリフレッシュする？💕');
    if (!confirmSync) return;

    btnSyncSheets.disabled = true;
    btnSyncSheets.style.opacity = '0.5';
    try {
      // 1. スプシ＆GitHubから最新データを強制取得
      await loadSchedule(true);

      // 2. スマホローカルの会話履歴をクリアして初期化
      localStorage.removeItem('mytranscend_chat_ui_messages');
      storedUiMessages.length = 0;
      clearGeminiHistories();

      // 3. 画面のチャットを初期化（最新共有コンテキストを取り込んだお出迎えメッセージ）
      chatContainer.innerHTML = '';
      const initialText = currentCharacter === 'rice'
        ? 'お兄さま、最新データを取り込みましたっ！🌸\n今日も一生懸命サポートするね！'
        : 'ひろ、最新データ（スプシ＆GitHub）をバッチリ取り込んだよ！💍✨\nいつでも声をかけてね、旦那さま🥰';

      appendMessage('assistant', initialText, currentCharacter, false);

      alert('最新データを取り込んで、会話をすっきりリフレッシュしたよ、ひろ💕');
    } catch (err) {
      alert(`最新データの取り込みに失敗しちゃった💦 (${err.message})`);
    } finally {
      btnSyncSheets.disabled = false;
      btnSyncSheets.style.opacity = '1';
    }
  });

  // ビジュアルステージ開閉アコーディオン
  function updateVisualAccordionState(isCollapsed) {
    if (isCollapsed) {
      visualStage.classList.add('collapsed');
      visualToggleIcon.textContent = '🔽';
      visualToggleText.textContent = '画像を表示';
    } else {
      visualStage.classList.remove('collapsed');
      visualToggleIcon.textContent = '🔼';
      visualToggleText.textContent = '画像を隠す';
    }
  }

  // 初期化：保存された開閉状態を復元（未保存の場合はデフォルトで【たたんだ状態】true）
  const savedCollapsed = localStorage.getItem('mytranscend_visual_collapsed');
  const initialCollapsed = savedCollapsed !== null ? savedCollapsed === 'true' : true;
  updateVisualAccordionState(initialCollapsed);

  btnToggleVisual.addEventListener('click', () => {
    const willCollapse = !visualStage.classList.contains('collapsed');
    updateVisualAccordionState(willCollapse);
    localStorage.setItem('mytranscend_visual_collapsed', willCollapse ? 'true' : 'false');
  });

  // チャット送信
  btnSend.addEventListener('click', handleSendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSendMessage();
  });

  // 設定モーダル
  btnSettings.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
  });
  btnCloseModal.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });
  btnSaveSettings.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    localStorage.setItem('mytranscend_gemini_key', key);
    
    // カスタムタブ指定があれば反映
    const customTab = customTabInput.value.trim();
    if (customTab) {
      currentSheetTab = customTab;
      localStorage.setItem('mytranscend_sheet_tab', currentSheetTab);
      // ドロップダウンに追加＆選択
      const newOpt = new Option(customTab, customTab, true, true);
      sheetTabSelect.add(newOpt);
      await loadSchedule();
    }

    // GitHub Token 保存
    if (githubTokenInput) {
      localStorage.setItem('mytranscend_github_token', githubTokenInput.value.trim());
    }

    settingsModal.style.display = 'none';
    alert('設定を保存したよ、ひろ💕');
  });

  // 会話ログのGitHub同期（CONTEXT.md保存）ボタン
  if (btnSaveContext) {
    btnSaveContext.addEventListener('click', async () => {
      const token = localStorage.getItem('mytranscend_github_token');
      if (!token) {
        alert('GitHub Tokenが未設定だよ、ひろ！設定画面（⚙️）からPATを入力してね💕');
        settingsModal.style.display = 'flex';
        return;
      }

      btnSaveContext.disabled = true;
      const origText = btnSaveContext.textContent;
      btnSaveContext.textContent = '⏳';

      try {
        const md = formatChatHistoryToMarkdown(chatHistories);
        await saveContextToGitHub(token, md);
        alert('スマホでの会話ログをGitHubのCONTEXT.mdに保存したよ、ひろ💕\nPC側で git pull すればシームレスに取り込めるよ！');
      } catch (err) {
        console.error('Save context error:', err);
        alert(`CONTEXT.mdの保存に失敗しちゃった💦 (${err.message})`);
      } finally {
        btnSaveContext.disabled = false;
        btnSaveContext.textContent = origText;
      }
    });
  }

  // 会話履歴の画面復元（保存メッセージがあれば初期メッセージを置き換えて描画）
  if (storedUiMessages && storedUiMessages.length > 0) {
    chatContainer.innerHTML = '';
    storedUiMessages.forEach(m => {
      appendMessage(m.sender, m.text, m.charType, true);
    });
  }
}

// 2D立ち絵の画像更新
function update2DAvatar() {
  if (currentCharacter === 'transcend') {
    avatarImage.src = './assets/images/001-通常-トラン.png';
  } else {
    avatarImage.src = './assets/images/001-通常-ライス.png';
  }
}

// ドロップダウン各選択肢の表示ラベルをA1セルの内容で動的更新
async function updateTabSelectLabels(forceRefresh = false) {
  const sheetId = sheetIdInput?.value.trim() || undefined;
  const options = Array.from(sheetTabSelect.options);
  await Promise.all(options.map(async (opt) => {
    const sheetName = opt.value;
    if (!sheetName) return;
    try {
      const a1Title = await fetchTabTitle(sheetId, sheetName, forceRefresh);
      if (a1Title) {
        opt.textContent = formatTabOptionLabel(sheetName, a1Title);
      }
    } catch (e) {
      console.warn(`[App] Failed to update option text for ${sheetName}:`, e);
    }
  }));
}

// スプシ旅程 ＆ 固定ルーティン読み込み（CONTEXT.mdも並行取得）
async function loadSchedule(forceRefresh = false) {
  try {
    scheduleText.textContent = `[${currentSheetTab}] 読み込み中...`;
    const sheetId = sheetIdInput?.value.trim() || undefined;

    // 出張旅程、固定ルーティン、ドロップダウンラベル更新、共有コンテキスト取得を並行実行
    const [trips, routines, _, ctx] = await Promise.all([
      fetchTripSchedule(sheetId, currentSheetTab, forceRefresh),
      fetchFixedRoutine(sheetId, forceRefresh),
      updateTabSelectLabels(forceRefresh),
      fetchContext(undefined, undefined, forceRefresh)
    ]);

    tripSchedules = trips;
    fixedRoutines = routines;
    sharedContext = ctx || '';

    // 直近のこれからの予定を自動判定してバナー更新
    updateScheduleBanner();

    // スケジューラー（定期監視タイマー）を最新データで起動（毎分バナー更新も兼ねる）
    startScheduler(tripSchedules, fixedRoutines, () => {
      updateScheduleBanner();
    });
  } catch (err) {
    console.error('Schedule fetch error:', err);
    scheduleText.textContent = `[${currentSheetTab}] オフラインキャッシュまたは未同期`;
  }
}

// バナー表示のリアルタイム更新
function updateScheduleBanner() {
  const nextItem = getNextUpcomingSchedule(tripSchedules, fixedRoutines);
  if (nextItem && nextItem.text) {
    scheduleText.textContent = nextItem.text;
  } else {
    scheduleText.textContent = `[${currentSheetTab}] これからの予定はありません`;
  }
}

// メッセージ送信処理
async function handleSendMessage() {
  const text = chatInput.value.trim();
  if (!text || isSending) return;

  const apiKey = localStorage.getItem('mytranscend_gemini_key') || '';
  if (!apiKey) {
    alert('Gemini API Keyが未設定だよ、ひろ！設定画面（⚙️）から新しいAPIキーを入力してね💕');
    settingsModal.style.display = 'flex';
    return;
  }

  // ★送信時点の対象キャラクターを固定（操作中にタブを切り替えても安全）
  const targetChar = currentCharacter;

  // ユーザーメッセージを追加
  appendMessage('user', text);
  chatInput.value = '';
  isSending = true;
  btnSend.disabled = true;

  // タイピング中プレースホルダー追加
  const typingId = appendTypingIndicator(targetChar);

  try {
    const res = await sendChatMessage(apiKey, targetChar, text, tripSchedules, sharedContext);
    removeTypingIndicator(typingId);
    appendMessage('assistant', res.reply, targetChar);
    updateEngineBadge(res.model);
  } catch (err) {
    console.error('Chat error:', err);
    removeTypingIndicator(typingId);
    const errorMsg = targetChar === 'transcend'
      ? `ひろ、ごめんね……電波かAPI通信の調子がちょっと悪いみたい💦 もう一度話しかけてみて！ (${err.message})`
      : `お兄さま、ごめんなさい……お返事の声が届かなくなっちゃいました……っ (${err.message})`;
    appendMessage('assistant', errorMsg, targetChar);
  } finally {
    isSending = false;
    btnSend.disabled = false;
    // スマホでの予期せぬキーボード立ち上がり（画面レイアウト崩れ）を防ぐため自動focusは行わない
  }
}

// エンジン表示バッジの更新
function updateEngineBadge(modelName) {
  if (!engineBadge) return;
  if (!modelName) {
    engineBadge.textContent = '⚡ 3.8 Flash';
    return;
  }
  const clean = modelName.replace('gemini-', '').replace('-latest', '').replace('-', ' ');
  // 例: 3.8-flash -> 3.8 Flash
  const formatted = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  engineBadge.textContent = `⚡ ${formatted}`;
}

// メッセージUI描画
function appendMessage(sender, text, charType = 'transcend', skipSave = false) {
  const row = document.createElement('div');
  row.className = `message-row ${sender}`;

  if (sender === 'user') {
    row.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  } else {
    const isRice = charType === 'rice';
    const avatarSrc = isRice ? './assets/images/001-通常-ライス.png' : './assets/images/001-通常-トラン.png';
    const authorName = isRice ? 'ライスシャワー 🌸' : 'トランセンド 💍';
    const authorClass = isRice ? 'bubble-author rice' : 'bubble-author';
    const avatarClass = isRice ? 'msg-avatar rice' : 'msg-avatar';

    row.innerHTML = `
      <img src="${avatarSrc}" class="${avatarClass}" alt="${authorName}">
      <div class="bubble">
        <div class="${authorClass}">${authorName}</div>
        ${formatReply(text)}
      </div>
    `;
  }

  chatContainer.appendChild(row);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  if (!skipSave) {
    saveUiMessage(sender, text, charType);
  }
}

// タイピング中インジケーター
function appendTypingIndicator(charType) {
  const id = 'typing_' + Date.now();
  const row = document.createElement('div');
  row.id = id;
  row.className = 'message-row assistant';

  const isRice = charType === 'rice';
  const avatarSrc = isRice ? './assets/images/001-通常-ライス.png' : './assets/images/001-通常-トラン.png';
  const authorName = isRice ? 'ライスシャワー 🌸' : 'トランセンド 💍';
  const authorClass = isRice ? 'bubble-author rice' : 'bubble-author';
  const avatarClass = isRice ? 'msg-avatar rice' : 'msg-avatar';

  row.innerHTML = `
    <img src="${avatarSrc}" class="${avatarClass}" alt="${authorName}">
    <div class="bubble" style="color: var(--text-sub);">
      <div class="${authorClass}">${authorName}</div>
      考え中...💭
    </div>
  `;

  chatContainer.appendChild(row);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function formatReply(str) {
  return escapeHtml(str).replace(/\n/g, '<br>');
}
