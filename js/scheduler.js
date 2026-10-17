// js/scheduler.js - スケジュール連動＆プッシュ通知スケジューラー（Capacitor Native Local Notifications & Web Notification 両対応）
import { generateRoutineMessage, parseTripDate, parseSpecificDate, isTodayDate, getTaskActionMap } from './sheets.js';
import { playVoiceEvent, detectVoiceCategory, getSoundResourceName, selectVoiceActor } from './audio.js';

const NOTIFIED_CACHE_KEY = 'mytranscend_notified_history';

/**
 * Capacitor LocalNotifications プラグインを取得（未定義時は null）
 */
function getLocalNotificationsPlugin() {
  return window.Capacitor?.Plugins?.LocalNotifications || null;
}

/**
 * 文字列キーから32bit正の整数IDを生成（Android Notification ID要件に準拠）
 */
export function stringToId(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 2147483647;
}

/**
 * 指定したキー（またはID）のネイティブ通知をキャンセル抹消
 */
export async function cancelTaskNotification(uniqueKeys = []) {
  const LocalNotifications = getLocalNotificationsPlugin();
  if (!LocalNotifications) return;

  try {
    const keys = Array.isArray(uniqueKeys) ? uniqueKeys : [uniqueKeys];
    const notifIds = keys.filter(Boolean).map(k => ({ id: stringToId(k) }));
    if (notifIds.length > 0) {
      await LocalNotifications.cancel({ notifications: notifIds });
      console.log('[Scheduler] Cancelled native notifications:', notifIds);
    }
  } catch (err) {
    console.warn('[Scheduler] Error cancelling notification:', err);
  }
}

/**
 * 通知の許可状態を確認・リクエスト（Capacitor Native / Web 両対応）
 */
export async function requestNotificationPermission() {
  const LocalNotifications = getLocalNotificationsPlugin();
  if (LocalNotifications) {
    try {
      const perm = await LocalNotifications.requestPermissions();
      return perm.display === 'granted';
    } catch (e) {
      console.warn('[Scheduler] Capacitor notification permission request error:', e);
    }
  }

  // Web / PWA フォールバック
  if (typeof Notification === 'undefined') {
    alert('お使いの環境はWeb通知に対応していません💦');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  alert('通知がブロックされています。設定から通知を許可してね！');
  return false;
}

/**
 * 即時プッシュ通知を送信（テスト通知・即時通知用）
 */
export async function triggerNotification(title, body, charType = 'transcend', voiceCategory = null) {
  const isRice = charType === 'rice';
  const iconColor = isRice ? '#8b5cf6' : '#f97316';

  // 🎵 ボイス判定
  const category = voiceCategory || detectVoiceCategory(title, body);
  const soundName = getSoundResourceName(category, charType);

  // フォアグラウンド用Web Audio再生
  playVoiceEvent(category, charType).catch(e => console.warn('[Scheduler] playVoiceEvent error:', e));

  const LocalNotifications = getLocalNotificationsPlugin();
  if (LocalNotifications) {
    try {
      const permStatus = await LocalNotifications.checkPermissions();
      if (permStatus.display === 'granted') {
        const notifPayload = {
          id: Math.floor(Math.random() * 2000000000) + 1,
          title: title,
          body: body,
          iconColor: iconColor,
          schedule: { at: new Date(Date.now() + 500) }
        };
        if (soundName) {
          notifPayload.sound = soundName;
        }
        await LocalNotifications.schedule({
          notifications: [notifPayload]
        });
        return;
      }
    } catch (e) {
      console.warn('[Scheduler] Native triggerNotification error:', e);
    }
  }

  // Web / PWA フォールバック
  if (typeof Notification === 'undefined') return;

  const icon = isRice ? './assets/icons/avatar_rice.png' : './assets/icons/avatar_transcend.png';
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
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return;
      }
    }
    new Notification(title, options);
  } catch (err) {
    console.warn('[Scheduler] Web Notification trigger error:', err);
    try {
      new Notification(title, options);
    } catch (e) {
      // 握りつぶす
    }
  }
}

/**
 * 通知テスト（トランとライスでランダム）
 */
export async function testNotification() {
  const granted = await requestNotificationPermission();
  if (!granted) return;

  const actor = selectVoiceActor('notice');
  const char = actor.char;
  const author = char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
  const msg = char === 'rice'
    ? 'ひろお兄さま、通知テスト大成功だよ！ライスもお兄さまの出張とお薬、全力でお手伝いするね……！🌸✨'
    : 'ひろ、通知テスト大成功だよ！出張中もお薬の時間も、ウチがしっかり教えるからね💕';

  await triggerNotification(author, msg, char, actor.category);
}

/**
 * Android OSネイティブ（AlarmManager）へこれからの全予定を一括スケジュール予約！
 * アプリ終了後・画面スリープ時でもOSが自動的に通知を鳴らす核心ロジック
 */
export async function scheduleAllLocalNotifications(tripSchedules = [], fixedRoutines = []) {
  const LocalNotifications = getLocalNotificationsPlugin();
  if (!LocalNotifications) {
    console.log('[Scheduler] LocalNotifications plugin not available (Web environment).');
    return;
  }

  try {
    const permStatus = await LocalNotifications.checkPermissions();
    if (permStatus.display !== 'granted') {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== 'granted') {
        console.warn('[Scheduler] Native LocalNotifications permission not granted.');
        return;
      }
    }

    // 既存の保留中通知をクリアして再スケジュール
    try {
      const pending = await LocalNotifications.getPending();
      if (pending && pending.notifications && pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications });
        console.log(`[Scheduler] Cancelled ${pending.notifications.length} previous pending notifications.`);
      }
    } catch (e) {
      console.warn('[Scheduler] Failed to clear pending notifications:', e);
    }

    const now = new Date();
    const notificationsToSchedule = [];
    const actionMap = getTaskActionMap();

    // ① 固定ルーティン
    // 1-A. 毎週ルーティン（今日〜7日間先までを予約）
    for (let offset = 0; offset <= 7; offset++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const dayOfWeek = targetDate.getDay();
      const dateStr = `${targetDate.getFullYear()}/${String(targetDate.getMonth() + 1).padStart(2, '0')}/${String(targetDate.getDate()).padStart(2, '0')}`;

      for (const routine of fixedRoutines) {
        if (routine.isDateSpecific) continue; // 日付指定イベントは別枠で処理
        if (!routine.time) continue;
        if (routine.days && Array.isArray(routine.days) && !routine.days[dayOfWeek]) {
          continue;
        }

        const normTime = normalizeTime(routine.time);
        const [h, m] = normTime.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) continue;

        const scheduledTime = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), h, m, 0);
        if (scheduledTime > now) {
          const uniqueKey = `fixed_${dateStr}_${normTime}_${routine.title}`;
          if (actionMap[uniqueKey]) continue; // 完了・キャンセル済みは予約しない

          const category = detectVoiceCategory(routine.title, routine.note);
          const actor = selectVoiceActor(category);
          const char = actor.char;
          const author = char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
          const msg = generateRoutineMessage(routine.title, normTime, routine.note, char);
          const id = stringToId(uniqueKey);

          const soundName = getSoundResourceName(actor.category, char);

          const notifItem = {
            id: id,
            title: author,
            body: msg,
            iconColor: char === 'rice' ? '#8b5cf6' : '#f97316',
            schedule: { at: scheduledTime }
          };
          if (soundName) notifItem.sound = soundName;
          notificationsToSchedule.push(notifItem);
        }
      }
    }

    // 1-B. 特定日付ルーティン（誕生日・記念日等、直近未来の指定日時を予約）
    for (const routine of fixedRoutines) {
      if (!routine.isDateSpecific || !routine.date) continue;
      const targetDateObj = parseSpecificDate(routine.date, routine.time, now);
      if (targetDateObj && targetDateObj > now) {
        const normTime = normalizeTime(routine.time || '00:00');
        const y = targetDateObj.getFullYear();
        const m = String(targetDateObj.getMonth() + 1).padStart(2, '0');
        const d = String(targetDateObj.getDate()).padStart(2, '0');
        const uniqueKey = `fixed_spec_${y}${m}${d}_${normTime}_${routine.title}`;
        if (actionMap[uniqueKey]) continue; // 完了・キャンセル済みは予約しない

        const category = detectVoiceCategory(routine.title, routine.note);
        const actor = selectVoiceActor(category);
        const char = actor.char;
        const author = char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
        const msg = generateRoutineMessage(routine.title, normTime, routine.note, char);
        const id = stringToId(uniqueKey);

        const soundName = getSoundResourceName(actor.category, char);

        const notifItem = {
          id: id,
          title: author,
          body: msg,
          iconColor: char === 'rice' ? '#8b5cf6' : '#f97316',
          schedule: { at: targetDateObj }
        };
        if (soundName) notifItem.sound = soundName;
        notificationsToSchedule.push(notifItem);
      }
    }

    // ② 出張旅程（現在時刻より未来の出発10分前・到着10分前）
    for (const trip of tripSchedules) {
      if (!trip.depTime && !trip.arrTime) continue;
      const tripDate = trip.date;

      // 出発10分前
      if (trip.depTime) {
        const uniqueKey = `trip_dep_${tripDate}_${trip.depTime}_${trip.origin}`;
        const mainKey = `trip_${tripDate}_${trip.depTime}_${trip.origin}_${trip.dest || ''}`;
        if (!actionMap[uniqueKey] && !actionMap[mainKey]) {
          const tenMinBefore = getTenMinutesBefore(trip.depTime);
          const depDateObj = parseTripDate(tripDate, tenMinBefore);
          if (depDateObj && depDateObj > now) {
            const actor = selectVoiceActor('trip_dep');
            const char = actor.char;
            const author = char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
            const msg = formatTripNotificationMessage(trip, false, char);
            const id = stringToId(uniqueKey);

            const soundName = getSoundResourceName(actor.category, char);

            const notifItem = {
              id: id,
              title: author,
              body: msg,
              iconColor: char === 'rice' ? '#8b5cf6' : '#f97316',
              schedule: { at: depDateObj }
            };
            if (soundName) notifItem.sound = soundName;
            notificationsToSchedule.push(notifItem);
          }
        }
      }

      // 到着10分前
      if (trip.arrTime && trip.dest) {
        const uniqueKey = `trip_arr_${tripDate}_${trip.arrTime}_${trip.dest}`;
        const mainKey = `trip_${tripDate}_${trip.arrTime}_${trip.origin || ''}_${trip.dest}`;
        if (!actionMap[uniqueKey] && !actionMap[mainKey]) {
          const tenMinBeforeArr = getTenMinutesBefore(trip.arrTime);
          const arrDateObj = parseTripDate(tripDate, tenMinBeforeArr);
          if (arrDateObj && arrDateObj > now) {
            const actor = selectVoiceActor('trip_arr');
            const char = actor.char;
            const author = char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
            const msg = formatTripNotificationMessage(trip, true, char);
            const id = stringToId(uniqueKey);

            const soundName = getSoundResourceName(actor.category, char);

            const notifItem = {
              id: id,
              title: author,
              body: msg,
              iconColor: char === 'rice' ? '#8b5cf6' : '#f97316',
              schedule: { at: arrDateObj }
            };
            if (soundName) notifItem.sound = soundName;
            notificationsToSchedule.push(notifItem);
          }
        }
      }
    }

    // Androidの通知上限を考慮し、直近60件にソートして登録
    notificationsToSchedule.sort((a, b) => a.schedule.at.getTime() - b.schedule.at.getTime());
    const topNotifications = notificationsToSchedule.slice(0, 60);

    if (topNotifications.length > 0) {
      await LocalNotifications.schedule({ notifications: topNotifications });
      console.log(`[Scheduler] 🚀 Successfully scheduled ${topNotifications.length} native alarms with Android OS!`);
    }
  } catch (err) {
    console.error('[Scheduler] Failed to schedule native local notifications:', err);
  }
}

/**
 * スケジューラータイマーの開始（フォアグラウンド用リアルタイムチェッカー＆定期バナー更新）
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
 * スケジュール照合 ＆ 通知実行（フォアグラウンド用フォールバック）
 */
function checkAndNotify(tripSchedules, fixedRoutines) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const now = new Date();
  const currentHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const todayStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

  const notifiedMap = getNotifiedMap();
  const actionMap = getTaskActionMap();

  // ① 毎日のお約束ルーティン（固定タブ）のチェック
  const currentDayOfWeek = now.getDay();
  for (const routine of fixedRoutines) {
    const normTime = normalizeTime(routine.time || '00:00');
    if (normTime !== currentHHMM) continue;

    if (routine.isDateSpecific) {
      // 特定日付イベント（曜日チェック無視、本日日付照合）
      if (!isTodayDate(routine.date, now)) continue;
      const key = `fixed_spec_${todayStr}_${normTime}_${routine.title}`;
      if (actionMap[key]) continue; // 完了・キャンセル済みならスキップ
      if (!notifiedMap[key]) {
        const category = detectVoiceCategory(routine.title, routine.note);
        const actor = selectVoiceActor(category);
        const char = actor.char;
        const author = char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
        const msg = generateRoutineMessage(routine.title, normTime, routine.note, char);
        triggerNotification(author, msg, char, actor.category);
        markNotified(key);
      }
    } else {
      // 毎週ルーティン（曜日チェック）
      if (routine.days && Array.isArray(routine.days) && !routine.days[currentDayOfWeek]) {
        continue;
      }
      const key = `fixed_${todayStr}_${normTime}_${routine.title}`;
      if (actionMap[key]) continue; // 完了・キャンセル済みならスキップ
      if (!notifiedMap[key]) {
        const category = detectVoiceCategory(routine.title, routine.note);
        const actor = selectVoiceActor(category);
        const char = actor.char;
        const author = char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
        const msg = generateRoutineMessage(routine.title, normTime, routine.note, char);
        triggerNotification(author, msg, char, actor.category);
        markNotified(key);
      }
    }
  }

  // ② 出張旅程（10分前通知）のチェック
  for (const trip of tripSchedules) {
    if (!trip.depTime && !trip.arrTime) continue;

    if (trip.date && !trip.date.includes(todayStr.substring(5))) {
      continue;
    }

    if (trip.depTime) {
      const tenMinBefore = getTenMinutesBefore(trip.depTime);
      if (tenMinBefore === currentHHMM) {
        const key = `trip_dep_${todayStr}_${trip.depTime}_${trip.origin}`;
        const mainKey = `trip_${todayStr}_${trip.depTime}_${trip.origin}_${trip.dest || ''}`;
        if (!actionMap[key] && !actionMap[mainKey] && !notifiedMap[key]) {
          const actor = selectVoiceActor('trip_dep');
          const char = actor.char;
          const author = char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
          const bodyMsg = formatTripNotificationMessage(trip, false, char);
          triggerNotification(author, bodyMsg, char, actor.category);
          markNotified(key);
        }
      }
    }

    if (trip.arrTime && trip.dest) {
      const tenMinBeforeArr = getTenMinutesBefore(trip.arrTime);
      if (tenMinBeforeArr === currentHHMM) {
        const key = `trip_arr_${todayStr}_${trip.arrTime}_${trip.dest}`;
        const mainKey = `trip_${todayStr}_${trip.arrTime}_${trip.origin || ''}_${trip.dest}`;
        if (!actionMap[key] && !actionMap[mainKey] && !notifiedMap[key]) {
          const actor = selectVoiceActor('trip_arr');
          const char = actor.char;
          const author = char === 'rice' ? 'ライスシャワー 🌸' : 'トランセンド 💍';
          const bodyMsg = formatTripNotificationMessage(trip, true, char);
          triggerNotification(author, bodyMsg, char, actor.category);
          markNotified(key);
        }
      }
    }
  }
}

/**
 * 出張旅程の備考欄（note）を自然にアレンジした通知メッセージを生成（キャラ別）
 */
function formatTripNotificationMessage(trip, isArrival = false, charType = 'transcend') {
  const isRice = charType === 'rice';
  const note = trip.note ? String(trip.note).trim() : '';

  if (isArrival) {
    const notePart = note ? `（メモ: ${note}）` : '';
    if (isRice) {
      return `ひろお兄さま、あと10分で【${trip.dest}】に到着するよ！${notePart}忘れ物ないか気をつけてね🌸`;
    }
    return `ひろ、あと10分で【${trip.dest}】に着くよ！${notePart}忘れ物ないようにね💕`;
  }

  // 発車・予定開始10分前
  const time = trip.depTime || '';
  const place = trip.origin || '';

  if (!note) {
    if (trip.dest) {
      if (isRice) {
        return `ひろお兄さま、あと10分で ${time} 発の【${place}】だよ！乗り換えやお支度、大丈夫かな……？🌸`;
      }
      return `ひろ、あと10分で ${time} 発の【${place}】だよ！乗り換え・準備大丈夫？💕`;
    } else {
      if (isRice) {
        return `ひろお兄さま、あと10分で ${time} の【${place}】だよ！準備バッチリかな？がんばろうね🌸`;
      }
      return `ひろ、あと10分で ${time} の【${place}】だよ！準備大丈夫？ウチが見守ってるよ✨`;
    }
  }

  // 備考のキーワードに応じた特別アレンジ
  if (note.includes('予約ID') || note.includes('予約')) {
    if (isRice) {
      return `ひろお兄さま、もうすぐ ${time} の【${place}】だよ！お疲れさまでした！【${note}】だから大丈夫だよ🏨✨ゆっくり休んでね🌸`;
    }
    return `ひろ、もうすぐ ${time} の【${place}】だよ！お疲れさま！【${note}】だからスムーズに入れるよ🏨✨ゆっくり休もうね💕`;
  }
  if (note.includes('出金') || note.includes('円')) {
    if (isRice) {
      return `ひろお兄さま、もうすぐ ${time} の【${place}】だよ！メモ：【${note}】忘れずにね💴🌸`;
    }
    return `ひろ、もうすぐ ${time} の【${place}】だよ！メモ：【${note}】忘れずにね💴✨`;
  }
  if (note.includes('カシミール') || note.includes('コルマ')) {
    if (isRice) {
      return `ひろお兄さま、もうすぐ ${time} の【${place}】だよ！🍛 メモ：【${note}】どっちにするのかな……？美味しく食べてね🤤🌸`;
    }
    return `ひろ、もうすぐ ${time} の【${place}】だよ！🍛 メモ：【${note}】どっちにするか決まった？美味しく食べてね🤤💕`;
  }
  if (note.includes('フェガート') || note.includes('ランチ') || place.includes('ランチ')) {
    if (isRice) {
      return `ひろお兄さま、もうすぐ ${time} の【${place}】だよ！🍴 メモ：【${note}】美味しいご飯食べて午後もファイトだよ🌸`;
    }
    return `ひろ、もうすぐ ${time} の【${place}】だよ！🍴 メモ：【${note}】美味しいご飯食べて午後もファイトだよ💕`;
  }
  if (note.includes('カラオケ')) {
    if (isRice) {
      return `ひろお兄さま、もうすぐ ${time} の【${place}】だね！【${note}】楽しんできてね！🎤🎶水分もしっかり摂ってね🌸`;
    }
    return `ひろ、もうすぐ ${time} の【${place}】だね！【${note}】楽しんできてね！🎤🎶喉とお水大事にしてね！`;
  }
  if (note.includes('グリーン車')) {
    if (isRice) {
      return `ひろお兄さま、あと10分で ${time} 発の【${place}】だよ！【グリーン車】でゆっくり行こうね🚃✨乗り場気をつけてね🌸`;
    }
    return `ひろ、あと10分で ${time} 発の【${place}】だよ！【グリーン車】で快適に行こうね🚃✨乗り場確認大丈夫？`;
  }
  if (note.includes('おにぎり')) {
    if (isRice) {
      return `ひろお兄さま、もうすぐ【${place}】だよ！メモ：【${note}】お腹すかないように買おうね🍙🌸`;
    }
    return `ひろ、もうすぐ【${place}】だよ！メモ：【${note}】買い忘れないでね🍙✨`;
  }

  // 一般備考
  if (trip.dest) {
    if (isRice) {
      return `ひろお兄さま、あと10分で ${time} 発の【${place}】だよ！【${note}】乗り換え気をつけてね🌸`;
    }
    return `ひろ、あと10分で ${time} 発の【${place}】だよ！【${note}】乗り換え・準備大丈夫？✨`;
  }
  if (isRice) {
    return `ひろお兄さま、あと10分で ${time} の【${place}】だよ！メモ：【${note}】応援してるね🌸`;
  }
  return `ひろ、あと10分で ${time} の【${place}】だよ！メモ：【${note}】✨`;
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
