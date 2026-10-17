// js/app.js - メインUI制御 ＆ アプリロジック
import { fetchTripSchedule, fetchFixedRoutine, getNextUpcomingSchedule, fetchTabTitle, formatTabOptionLabel } from './sheets.js?v=1.8';
import { sendChatMessage, chatHistories, clearGeminiHistories } from './gemini.js?v=2.4';
import { testNotification, startScheduler, requestNotificationPermission, scheduleAllLocalNotifications } from './scheduler.js?v=2.0';
import { fetchContext, saveContextToGitHub, formatChatHistoryToMarkdown } from './github.js?v=1.8';
import { isVoiceEnabled, setVoiceEnabled, getVoiceVolume, setVoiceVolume, testPlayVoice } from './audio.js?v=1.0';

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
const btnResetChat = document.getElementById('btnResetChat');

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

// 自動コンテキスト同期（CONTEXT.md自動保存）管理
let hasUnsavedConversations = false;
let isSyncingContext = false;
let autoSyncTimer = null;

function markConversationUnsaved() {
  hasUnsavedConversations = true;
}

async function autoSyncContextToGitHub() {
  const token = localStorage.getItem('mytranscend_github_token');
  if (!token || !hasUnsavedConversations || isSyncingContext) return;

  isSyncingContext = true;
  if (btnSaveContext) {
    btnSaveContext.style.opacity = '0.5';
  }

  try {
    const md = formatChatHistoryToMarkdown(chatHistories);
    await saveContextToGitHub(token, md);
    hasUnsavedConversations = false;
    console.log('[AutoSync] Context automatically synced to GitHub CONTEXT.md');
  } catch (err) {
    console.warn('[AutoSync] Background context sync error:', err);
  } finally {
    isSyncingContext = false;
    if (btnSaveContext) {
      btnSaveContext.style.opacity = '1';
    }
  }
}

function scheduleAutoSync(delayMs = 8000) {
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    autoSyncContextToGitHub();
  }, delayMs);
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

  // 保存されたキャラクター選択とテーマの復元
  const savedChar = localStorage.getItem('mytranscend_selected_character') || 'transcend';
  updateCharacterTheme(savedChar);

  // イベントリスナー設定
  setupEventListeners();

  // 現在時刻時計（案A×パターン1）＆リアルタイムカウントダウンの開始
  startCurrentClock();

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
    updateCharacterTheme('transcend');
  });

  // キャラクター切り替え（ライス）
  tabRice.addEventListener('click', () => {
    updateCharacterTheme('rice');
  });

  // 出張タブ切り替え
  sheetTabSelect.addEventListener('change', async (e) => {
    currentSheetTab = e.target.value;
    localStorage.setItem('mytranscend_sheet_tab', currentSheetTab);
    await loadSchedule(true);
  });

  // スプシ＆共有コンテキスト最新状態の強制同期ボタン (ヘッダーアイコン)
  // ※会話履歴は消去せず、スプシ旅程＆GitHubコンテキストのみを安全に最新化
  btnSyncSheets.addEventListener('click', async () => {
    btnSyncSheets.disabled = true;
    btnSyncSheets.style.opacity = '0.5';
    try {
      await loadSchedule(true);
      alert('最新データ（スプシ旅程＆GitHubコンテキスト）を取り込んだよ、ひろ！✨');
    } catch (err) {
      alert(`最新データの取り込みに失敗しちゃった💦 (${err.message})`);
    } finally {
      btnSyncSheets.disabled = false;
      btnSyncSheets.style.opacity = '1';
    }
  });

  // 会話履歴のクリアボタン（設定モーダル内）
  if (btnResetChat) {
    btnResetChat.addEventListener('click', () => {
      const confirmed = confirm('【確認】これまでの会話履歴をすべて消去して初期化しますか？\n\n※この操作は取り消せません。');
      if (!confirmed) return;

      localStorage.removeItem('mytranscend_chat_ui_messages');
      storedUiMessages.length = 0;
      clearGeminiHistories();

      chatContainer.innerHTML = '';
      appendMessage('assistant', 'ひろ、今日もよろしくね！💍✨\nなんでもウチとライスちゃんに話しかけてね🥰', 'transcend', false);
      appendMessage('assistant', 'ひろお兄さま、ライスもお兄さまの出張サポート一生懸命がんばるね……！🌸', 'rice', false);

      settingsModal.style.display = 'none';
      alert('会話履歴をすっきりクリアしたよ、ひろ！');
    });
  }

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

  // 設定モーダル内のボイス要素
  const voiceEnabledToggle = document.getElementById('voiceEnabledToggle');
  const voiceVolumeSlider = document.getElementById('voiceVolumeSlider');
  const voiceVolumeLabel = document.getElementById('voiceVolumeLabel');
  const btnTestVoiceTranscend = document.getElementById('btnTestVoiceTranscend');
  const btnTestVoiceRice = document.getElementById('btnTestVoiceRice');

  function syncVoiceSettingsUI() {
    if (voiceEnabledToggle) voiceEnabledToggle.checked = isVoiceEnabled();
    if (voiceVolumeSlider) {
      const vol = getVoiceVolume();
      voiceVolumeSlider.value = vol;
      if (voiceVolumeLabel) voiceVolumeLabel.textContent = `${Math.round(vol * 100)}%`;
    }
  }

  if (voiceVolumeSlider) {
    voiceVolumeSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      setVoiceVolume(vol);
      if (voiceVolumeLabel) voiceVolumeLabel.textContent = `${Math.round(vol * 100)}%`;
    });
  }
  if (voiceEnabledToggle) {
    voiceEnabledToggle.addEventListener('change', (e) => {
      setVoiceEnabled(e.target.checked);
    });
  }
  if (btnTestVoiceTranscend) {
    btnTestVoiceTranscend.addEventListener('click', () => {
      testPlayVoice('transcend');
    });
  }
  if (btnTestVoiceRice) {
    btnTestVoiceRice.addEventListener('click', () => {
      testPlayVoice('rice');
    });
  }

  // 設定モーダル
  btnSettings.addEventListener('click', () => {
    syncVoiceSettingsUI();
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

    // ボイス設定保存
    if (voiceEnabledToggle) setVoiceEnabled(voiceEnabledToggle.checked);
    if (voiceVolumeSlider) setVoiceVolume(parseFloat(voiceVolumeSlider.value));

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
        hasUnsavedConversations = false;
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

  // アプリ（ブラウザ）から離れた時・閉じた時の自動コンテキスト保存
  // ホーム画面に戻る、画面スリープ、タブ・アプリ切り替え、ブラウザ終了を検知
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && hasUnsavedConversations) {
      console.log('[Lifecycle] App hidden, auto-syncing context...');
      autoSyncContextToGitHub();
    }
  });

  window.addEventListener('pagehide', () => {
    if (hasUnsavedConversations) {
      console.log('[Lifecycle] Pagehide, auto-syncing context...');
      autoSyncContextToGitHub();
    }
  });

  // 会話履歴の画面復元（保存メッセージがあれば初期メッセージを置き換えて描画）
  if (storedUiMessages && storedUiMessages.length > 0) {
    chatContainer.innerHTML = '';
    storedUiMessages.forEach(m => {
      appendMessage(m.sender, m.text, m.charType, true);
    });
  }
}

// キャラクター選択とテーマカラーの動的連動
function updateCharacterTheme(char) {
  currentCharacter = char;
  if (char === 'rice') {
    document.body.classList.add('theme-rice');
    if (tabRice) tabRice.className = 'char-tab active-rice';
    if (tabTranscend) tabTranscend.className = 'char-tab';
  } else {
    document.body.classList.remove('theme-rice');
    if (tabTranscend) tabTranscend.className = 'char-tab active-transcend';
    if (tabRice) tabRice.className = 'char-tab';
  }
  update2DAvatar();
  localStorage.setItem('mytranscend_selected_character', char);
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

    // Android OSネイティブ（AlarmManager）へ全予定を一括スケジュール予約！
    // ※アプリ終了・スリープ時でも時間になったらOSが自動的に通知を鳴らす
    try {
      await scheduleAllLocalNotifications(tripSchedules, fixedRoutines);
    } catch (localNotifErr) {
      console.warn('[App] LocalNotifications schedule warning:', localNotifErr);
    }

    // スケジューラー（定期監視タイマー）を最新データで起動（毎分バナー更新も兼ねる）
    try {
      startScheduler(tripSchedules, fixedRoutines, () => {
        updateScheduleBanner();
      });
    } catch (schedErr) {
      console.warn('[App] Scheduler start warning:', schedErr);
    }
  } catch (err) {
    console.error('Schedule fetch error:', err);
    scheduleText.textContent = `[${currentSheetTab}] オフラインキャッシュまたは未同期`;
  }
}

// 残り時間の整形（例: あと15分, あと2時間10分, あと3日）
function formatRemainingTime(targetDate) {
  if (!targetDate) return '';
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin === 0) return '（まもなく）';
  if (diffMin < 60) return `（あと${diffMin}分）`;

  const diffHours = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHours < 24) {
    return remMin > 0 ? `（あと${diffHours}時間${remMin}分）` : `（あと${diffHours}時間）`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `（あと${diffDays}日）`;
}

// バナー表示のリアルタイム更新（あと何分表示つき）
function updateScheduleBanner() {
  const nextItem = getNextUpcomingSchedule(tripSchedules, fixedRoutines);
  if (nextItem && nextItem.text) {
    const remaining = nextItem.dateObj ? ` ${formatRemainingTime(nextItem.dateObj)}` : '';
    scheduleText.textContent = `${nextItem.text}${remaining}`;
  } else {
    scheduleText.textContent = `[${currentSheetTab}] これからの予定はありません`;
  }
}

// 現在時刻時計（案A×パターン1）＆リアルタイムカウントダウン更新
function startCurrentClock() {
  const clockEl = document.getElementById('currentClock');
  function tick() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    if (clockEl) {
      clockEl.textContent = `🕒 ${h}:${m}`;
    }
    // バナーの「あと何分」も時計に合わせてリアルタイム更新
    if (tripSchedules.length > 0 || fixedRoutines.length > 0) {
      updateScheduleBanner();
    }
  }
  tick();
  setInterval(tick, 1000); // 1秒ごとに更新チェック
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
    const res = await sendChatMessage(apiKey, text, tripSchedules, sharedContext, targetChar);
    removeTypingIndicator(typingId);

    // トランとライスの分割メッセージを順番に描画！
    if (res.messages && res.messages.length > 0) {
      res.messages.forEach(msg => {
        appendMessage('assistant', msg.text, msg.character);
      });
    } else {
      appendMessage('assistant', res.reply, targetChar);
    }
    updateEngineBadge(res.model);
  } catch (err) {
    console.error('Chat error:', err);
    removeTypingIndicator(typingId);
    const errorMsg = `ひろ、ごめんね……電波か通信の調子がちょっと悪いみたい💦 もう一度話しかけてみて！ (${err.message})`;
    appendMessage('assistant', errorMsg, 'transcend');
  } finally {
    isSending = false;
    btnSend.disabled = false;
    scheduleAutoSync(); // 会話完了から8秒後に裏で自動保存
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
    const avatarSrc = isRice ? './assets/icons/avatar_rice.png' : './assets/icons/avatar_transcend.png';
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
    markConversationUnsaved();
  }
}

// タイピング中インジケーター
function appendTypingIndicator(charType) {
  const id = 'typing_' + Date.now();
  const row = document.createElement('div');
  row.id = id;
  row.className = 'message-row assistant';

  const isRice = charType === 'rice';
  const avatarSrc = isRice ? './assets/icons/avatar_rice.png' : './assets/icons/avatar_transcend.png';
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
