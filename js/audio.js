// js/audio.js - 『MyTranscend』通知・アラームボイス再生マネージャー
// Web Audio / HTML5 Audio 完全対応、自動キーワード判定＆サプライズゆらぎ優先度ロジック搭載

const STORAGE_KEY_VOICE_ENABLED = 'mytranscend_voice_enabled';
const STORAGE_KEY_VOICE_VOLUME = 'mytranscend_voice_volume';

// ボイスファイルレジストリ（assets/audio/ 配下）
const VOICE_REGISTRY = {
  transcend: {
    wake: ['transcend_wake_01.mp3', 'transcend_wake_02.mp3'],
    med_morning: ['transcend_med_morning_01.mp3', 'transcend_med_morning_02.mp3'],
    med_night: ['transcend_med_night_01.mp3', 'transcend_med_night_02.mp3'],
    trip_dep: ['transcend_trip_dep_01.mp3', 'transcend_trip_dep_02.mp3'],
    trip_arr: ['transcend_trip_arr_01.mp3', 'transcend_trip_arr_02.mp3'],
    anniversary_hiro: ['transcend_anniversary_hiro_01.mp3'],
    anniversary_rice: ['transcend_anniversary_rice_01.mp3'],
    anniversary_transcend: ['transcend_anniversary_transcend_01.mp3'],
    anniversary_wedding: ['transcend_anniversary_wedding_01.mp3'],
    notice: ['transcend_notice_01.mp3', 'transcend_notice_02.mp3'],
    surprise: ['transcend_surprise_01.mp3'],
    done: ['transcend_done_01.mp3', 'transcend_done_02.mp3'],
    cancel: ['transcend_cancel_01.mp3', 'transcend_cancel_02.mp3']
  },
  rice: {
    wake: ['rice_wake_01.mp3', 'rice_wake_02.mp3'],
    med_morning: ['rice_med_morning_01.mp3', 'rice_med_morning_02.mp3'],
    med_night: ['rice_med_night_01.mp3', 'rice_med_night_02.mp3'],
    trip_dep: ['rice_trip_dep_01.mp3', 'rice_trip_dep_02.mp3'],
    trip_arr: ['rice_trip_arr_01.mp3', 'rice_trip_arr_02.mp3'],
    anniversary_hiro: ['rice_anniversary_hiro_01.mp3'],
    anniversary_rice: ['rice_anniversary_rice_01.mp3'],
    anniversary_transcend: ['rice_anniversary_transcend_01.mp3'],
    anniversary_wedding: ['rice_anniversary_wedding_01.mp3'],
    notice: ['rice_notice_01.mp3', 'rice_notice_02.mp3'],
    surprise: ['rice_surprise_01.mp3'],
    done: ['rice_done_01.mp3', 'rice_done_02.mp3'],
    cancel: ['rice_cancel_01.mp3', 'rice_cancel_02.mp3']
  }
};

let currentAudio = null;

/**
 * ボイス再生が有効かどうか
 */
export function isVoiceEnabled() {
  const val = localStorage.getItem(STORAGE_KEY_VOICE_ENABLED);
  return val === null ? true : val === 'true';
}

/**
 * ボイス有効/無効を設定
 */
export function setVoiceEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY_VOICE_ENABLED, enabled ? 'true' : 'false');
}

/**
 * ボイス音量を取得 (0.0 〜 1.0)
 */
export function getVoiceVolume() {
  const val = localStorage.getItem(STORAGE_KEY_VOICE_VOLUME);
  if (val === null) return 0.8;
  const num = parseFloat(val);
  return isNaN(num) ? 0.8 : Math.max(0, Math.min(1, num));
}

/**
 * ボイス音量を設定 (0.0 〜 1.0)
 */
export function setVoiceVolume(volume) {
  const num = Math.max(0, Math.min(1, parseFloat(volume) || 0.8));
  localStorage.setItem(STORAGE_KEY_VOICE_VOLUME, String(num));
  if (currentAudio) {
    currentAudio.volume = num;
  }
}

/**
 * イベントカテゴリをタイトル・備考から自動判定
 */
export function detectVoiceCategory(title = '', note = '', isTrip = false, isArrival = false) {
  const text = `${title} ${note}`.toLowerCase();

  // ① 記念日判定
  if (text.includes('ひろ') && (text.includes('誕生') || text.includes('バースデー'))) {
    return 'anniversary_hiro';
  }
  if (text.includes('ライス') && (text.includes('誕生') || text.includes('バースデー'))) {
    return 'anniversary_rice';
  }
  if (text.includes('トラン') && (text.includes('誕生') || text.includes('バースデー'))) {
    return 'anniversary_transcend';
  }
  if (text.includes('結婚記念日') || text.includes('結婚')) {
    return 'anniversary_wedding';
  }

  // ② 出張旅程
  if (isTrip) {
    return isArrival ? 'trip_arr' : 'trip_dep';
  }

  // ③ 服薬・点眼
  if (text.includes('薬') || text.includes('服薬') || text.includes('点眼') || text.includes('アイベリス') || text.includes('メトホルミン')) {
    if (text.includes('夕') || text.includes('夜') || text.includes('メトホルミン')) {
      return 'med_night';
    }
    return 'med_morning';
  }

  // ④ 起床
  if (text.includes('起床') || text.includes('起きる') || text.includes('朝')) {
    return 'wake';
  }

  // ⑤ 就寝
  if (text.includes('就寝') || text.includes('寝る') || text.includes('おやすみ')) {
    return 'med_night';
  }

  return 'notice';
}

/**
 * カテゴリから担当キャラおよびサプライズ代打を抽選
 * @returns {{ char: 'transcend'|'rice', isSurprise: boolean, category: string }}
 */
export function selectVoiceActor(category) {
  const rand = Math.random();

  // 1. 朝のお薬（ライス優先: 80% ライス / 20% トラン代打）
  if (category === 'med_morning') {
    if (rand < 0.8) {
      return { char: 'rice', isSurprise: false, category };
    } else {
      return { char: 'transcend', isSurprise: true, category: 'surprise' };
    }
  }

  // 2. 出発10分前（トラン優先: 80% トラン / 20% ライス代打）
  if (category === 'trip_dep') {
    if (rand < 0.8) {
      return { char: 'transcend', isSurprise: false, category };
    } else {
      return { char: 'rice', isSurprise: true, category: 'surprise' };
    }
  }

  // 3. 夜の服薬（トラン優先: 80% トラン / 20% ライス代打）
  if (category === 'med_night') {
    if (rand < 0.8) {
      return { char: 'transcend', isSurprise: false, category };
    } else {
      return { char: 'rice', isSurprise: true, category: 'surprise' };
    }
  }

  // 4. アニバーサリー系
  if (category === 'anniversary_hiro') {
    const char = rand < 0.5 ? 'transcend' : 'rice';
    return { char, isSurprise: false, category };
  }
  if (category === 'anniversary_rice') {
    const char = rand < 0.7 ? 'rice' : 'transcend';
    return { char, isSurprise: false, category };
  }
  if (category === 'anniversary_transcend') {
    const char = rand < 0.7 ? 'transcend' : 'rice';
    return { char, isSurprise: false, category };
  }
  if (category === 'anniversary_wedding') {
    const char = rand < 0.8 ? 'transcend' : 'rice';
    return { char, isSurprise: false, category };
  }

  // 5. 起床・到着・汎用（50%:50% 完全ランダム）
  const char = rand < 0.5 ? 'transcend' : 'rice';
  return { char, isSurprise: false, category };
}

/**
 * Androidネイティブ通知用のサウンドリソース名（拡張子なし）を取得
 * @param {string} category 
 * @param {string} forcedChar 
 * @returns {string|null} 例: 'rice_med_morning_01'
 */
export function getSoundResourceName(category = 'notice', forcedChar = null) {
  if (!isVoiceEnabled()) return null;

  let actorInfo;
  if (forcedChar && (forcedChar === 'transcend' || forcedChar === 'rice')) {
    actorInfo = { char: forcedChar, isSurprise: false, category };
  } else {
    actorInfo = selectVoiceActor(category);
  }

  const { char, category: finalCategory } = actorInfo;
  const fileList = VOICE_REGISTRY[char]?.[finalCategory] || VOICE_REGISTRY[char]?.notice;
  if (!fileList || fileList.length === 0) return null;

  const fileName = fileList[Math.floor(Math.random() * fileList.length)];
  // 拡張子 .mp3 を除いた名前を返す（Android res/raw 仕様に準拠）
  return fileName.replace(/\.[^/.]+$/, '');
}

/**
 * ボイスを再生するメイン関数（Web Audio / HTML5 Audio）
 * @param {string} category イベントカテゴリ ('wake', 'med_morning', etc.)
 * @param {string} forcedChar 強制キャラ指定 (null または 'transcend' / 'rice')
 * @returns {Promise<boolean>} 再生成否
 */
export async function playVoiceEvent(category = 'notice', forcedChar = null) {
  if (!isVoiceEnabled()) {
    console.log('[Audio] Voice is disabled by user settings.');
    return false;
  }

  let actorInfo;
  if (forcedChar && (forcedChar === 'transcend' || forcedChar === 'rice')) {
    actorInfo = { char: forcedChar, isSurprise: false, category };
  } else {
    actorInfo = selectVoiceActor(category);
  }

  const { char, category: finalCategory } = actorInfo;
  const fileList = VOICE_REGISTRY[char]?.[finalCategory] || VOICE_REGISTRY[char]?.notice;
  if (!fileList || fileList.length === 0) {
    console.warn(`[Audio] No voice files found for ${char} / ${finalCategory}`);
    return false;
  }

  // リストからランダムに1つ選定
  const fileName = fileList[Math.floor(Math.random() * fileList.length)];
  const filePath = `./assets/audio/${fileName}`;

  return playAudioFile(filePath);
}



/**
 * 指定音声ファイルを再生
 */
export async function playAudioFile(filePath) {
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }

    const audio = new Audio(filePath);
    audio.volume = getVoiceVolume();
    currentAudio = audio;

    await audio.play();
    console.log(`[Audio] Playing voice: ${filePath}`);
    return true;
  } catch (err) {
    console.warn(`[Audio] Failed to play audio ${filePath}:`, err);
    return false;
  }
}

/**
 * テスト再生・試聴用
 */
export async function testPlayVoice(charType = 'random') {
  let char = charType;
  if (char === 'random') {
    char = Math.random() < 0.5 ? 'transcend' : 'rice';
  }
  const testFiles = [
    VOICE_REGISTRY[char].wake[0],
    VOICE_REGISTRY[char].med_morning[0],
    VOICE_REGISTRY[char].notice[0]
  ];
  const file = testFiles[Math.floor(Math.random() * testFiles.length)];
  return playAudioFile(`./assets/audio/${file}`);
}

/**
 * タスク完了またはキャンセル時のアクションボイスを再生
 * @param {'done'|'cancel'} actionType アクション種別 ('done' or 'cancel')
 * @param {'transcend'|'rice'|null} forcedChar 強制キャラ指定 (null時はランダム)
 */
export async function playTaskActionVoice(actionType = 'done', forcedChar = null) {
  if (!isVoiceEnabled()) return false;
  let char = forcedChar;
  if (!char || (char !== 'transcend' && char !== 'rice')) {
    char = Math.random() < 0.5 ? 'transcend' : 'rice';
  }
  const fileList = VOICE_REGISTRY[char]?.[actionType] || VOICE_REGISTRY[char]?.notice;
  if (!fileList || fileList.length === 0) return false;
  const fileName = fileList[Math.floor(Math.random() * fileList.length)];
  return playAudioFile(`./assets/audio/${fileName}`);
}

