// js/scheduler.js - スケジュール連動＆Webプッシュ通知スケジューラー

const NOTIFIED_CACHE_KEY = 'mytranscend_notified_history';

/**
 * 通知の許可状態を確認・リクエスト
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('お使いのブラウザはWeb通知に対応していません💦');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  alert('通知がブロックされています。スマホのブラウザ設定から通知を許可してね！');
  return false;
}

/**
 * プッシュ通知を送信（Service Worker優先）
 */
export async function triggerNotification(title, body, charType = 'transcend') {
  const isRice = charType === 'rice';
  const icon = isRice ? './assets/images/001-通常-ライス.png' : './assets/images/001-通常-トラン.png';

  const options = {
    body: body,
    icon: icon,
    badge: './assets/icons/icon_character_toggle.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'mytranscend-' + Date.now(),
    renotify: true,
    data: { url: './index.html' }
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg.showNotification) {
        await reg.showNotification(title, options);
        return;
      }
    }
    // フォールバック
    new Notification(title, options);
  } catch (err) {
    console.warn('[Scheduler] Notification trigger error:', err);
    // フォールバック
    new Notification(title, options);
  }
}

/**
 * 通知テスト
 */
export async function testNotification() {
  const granted = await requestNotificationPermission();
  if (!granted) return;

  await triggerNotification(
    'トランセンド 💍',
    'ひろ、通知テスト大成功だよ！出張中もお薬の時間も、ウチがしっかり教えるからね💕'
  );
}

/**
 * スケジューラータイマーの開始
 */
let timerId = null;
export function startScheduler(tripSchedules = [], fixedRoutines = [], onTickCallback = null) {
  if (timerId) clearInterval(timerId);

  // 1分ごとにチェック
  timerId = setInterval(() => {
    checkAndNotify(tripSchedules, fixedRoutines);
    if (typeof onTickCallback === 'function') {
      onTickCallback();
    }
  }, 60000);

  // 起動時にも即座に1回チェック
  checkAndNotify(tripSchedules, fixedRoutines);
  console.log('[Scheduler] Background schedule checker started');
}

/**
 * スケジュール照合 ＆ 通知実行
 */
function checkAndNotify(tripSchedules, fixedRoutines) {
  if (Notification.permission !== 'granted') return;

  const now = new Date();
  const currentHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const todayStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

  // 本日の通知済みリスト
  const notifiedMap = getNotifiedMap();

  // ① 毎日のお約束ルーティン（固定タブ）のチェック
  const currentDayOfWeek = now.getDay(); // 0:日, 1:月, 2:火, 3:水, 4:木, 5:金, 6:土
  for (const routine of fixedRoutines) {
    if (!routine.time) continue;

    // 曜日チェック（チェックボックスがオフの曜日はスキップ）
    if (routine.days && Array.isArray(routine.days)) {
      if (!routine.days[currentDayOfWeek]) {
        continue;
      }
    }

    // 時刻が一致 (例: 06:00, 6:00)
    const normTime = normalizeTime(routine.time);
    if (normTime === currentHHMM) {
      const key = `fixed_${todayStr}_${normTime}_${routine.title}`;
      if (!notifiedMap[key]) {
        const author = routine.char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
        triggerNotification(author, routine.message, routine.char);
        markNotified(key);
      }
    }
  }

  // ② 出張旅程（10分前通知）のチェック
  for (const trip of tripSchedules) {
    if (!trip.depTime && !trip.arrTime) continue;

    // 出張日チェック（例: 2026/10/22(木)）
    if (trip.date && !trip.date.includes(todayStr.substring(5))) { // 簡易日付照合
      // 日付が一致しない場合はスキップ
      continue;
    }

    // 発車時刻の10分前を計算
    if (trip.depTime) {
      const tenMinBefore = getTenMinutesBefore(trip.depTime);
      if (tenMinBefore === currentHHMM) {
        const key = `trip_dep_${todayStr}_${trip.depTime}_${trip.origin}`;
        if (!notifiedMap[key]) {
          triggerNotification(
            'トランセンド 💍',
            `ひろ、あと10分で ${trip.depTime} 発の【${trip.origin}】だよ！乗り換え・準備大丈夫？`
          );
          markNotified(key);
        }
      }
    }

    // 到着時刻の10分前を計算
    if (trip.arrTime && trip.dest) {
      const tenMinBeforeArr = getTenMinutesBefore(trip.arrTime);
      if (tenMinBeforeArr === currentHHMM) {
        const key = `trip_arr_${todayStr}_${trip.arrTime}_${trip.dest}`;
        if (!notifiedMap[key]) {
          triggerNotification(
            'トランセンド 💍',
            `ひろ、あと10分で【${trip.dest}】に着くよ！忘れ物ないようにね💕`
          );
          markNotified(key);
        }
      }
    }
  }
}

function normalizeTime(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.trim().split(':');
  if (parts.length !== 2) return timeStr;
  return String(parts[0]).padStart(2, '0') + ':' + String(parts[1]).padStart(2, '0');
}

function getTenMinutesBefore(timeStr) {
  const norm = normalizeTime(timeStr);
  const [h, m] = norm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return '';
  let date = new Date(2000, 0, 1, h, m - 10);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function getNotifiedMap() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function markNotified(key) {
  const map = getNotifiedMap();
  map[key] = Date.now();
  localStorage.setItem(NOTIFIED_CACHE_KEY, JSON.stringify(map));
}
