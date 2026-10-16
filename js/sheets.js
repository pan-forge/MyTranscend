const DEFAULT_SHEET_ID = '1DHoQI7sQyGi7Qr5PuVRiLkL5Te8R9Fpp-UzBPkFWcaI';
const DEFAULT_SHEET_NAME = '261022'; // 26年10月22日東京出張タブ
const CACHE_PREFIX = 'mytranscend_trip_schedule_';

/**
 * GViz APIから出張旅程データを取得・パースする（シート名またはGID対応）
 */
export async function fetchTripSchedule(sheetId = DEFAULT_SHEET_ID, sheetName = DEFAULT_SHEET_NAME) {
  // シート名指定またはgid指定
  const isGid = /^\d+$/.test(sheetName) && sheetName.length > 8;
  const param = isGid ? `gid=${sheetName}` : `sheet=${encodeURIComponent(sheetName)}`;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&${param}`;
  const cacheKey = `${CACHE_PREFIX}${sheetName}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const text = await res.text();
    
    // google.visualization.Query.setResponse({...}); からJSON部分を抽出
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonStr);
    
    const parsedRows = parseGvizTable(data.table);
    
    // 成功時はLocalStorageにキャッシュ（オフライン対応）
    localStorage.setItem(cacheKey, JSON.stringify({
      updatedAt: new Date().toISOString(),
      rows: parsedRows
    }));
    
    return parsedRows;
  } catch (err) {
    console.warn(`[Sheets] Direct fetch for ${sheetName} failed, falling back to cache:`, err);
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      return JSON.parse(cached).rows;
    }
    throw err;
  }
}

/**
 * GViz table構造を行配列（オブジェクト）に変換
 */
function parseGvizTable(table) {
  if (!table || !table.rows) return [];
  
  const results = [];
  let currentDate = '2026/10/22(木)';
  
  for (const r of table.rows) {
    const c = r.c;
    if (!c) continue;
    
    const dateVal = c[0] ? (c[0].f || c[0].v || '') : '';
    if (dateVal && dateVal.includes('2026/')) {
      currentDate = dateVal;
    }
    
    const depTime = c[1] ? (c[1].f || c[1].v || '') : '';
    const origin = c[2] ? (c[2].f || c[2].v || '') : '';
    const dest = c[3] ? (c[3].f || c[3].v || '') : '';
    const arrTime = c[4] ? (c[4].f || c[4].v || '') : '';
    const transit = c[5] ? (c[5].f || c[5].v || '') : '';
    const fare = c[7] ? (c[7].f || c[7].v || '') : '';
    const note = c[8] ? (c[8].f || c[8].v || '') : '';
    
    // ヘッダー行や合計行（「発」「着」「移動手段」「負担」「支払」など）を除外
    const isHeaderOrSummary = 
      depTime === '発' || dest === '着' || transit === '移動手段' ||
      transit === '負担' || transit === '支払';

    if (!isHeaderOrSummary && (depTime || origin || dest)) {
      results.push({
        date: currentDate.trim(),
        depTime: depTime.trim(),
        origin: origin.trim(),
        dest: dest.trim(),
        arrTime: arrTime.trim(),
        transit: transit.trim(),
        fare: fare.trim(),
        note: note.trim()
      });
    }
  }
  
  return results;
}

/**
 * 「固定」タブ（毎日のお約束ルーティン）を取得・パースする
 */
export async function fetchFixedRoutine(sheetId = DEFAULT_SHEET_ID) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent('固定')}`;
  const cacheKey = 'mytranscend_fixed_routine_cache';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const text = await res.text();

    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonStr);

    const routineList = parseFixedRoutineTable(data.table);

    localStorage.setItem(cacheKey, JSON.stringify({
      updatedAt: new Date().toISOString(),
      rows: routineList
    }));

    return routineList;
  } catch (err) {
    console.warn('[Sheets] Fixed routine fetch failed, falling back to cache:', err);
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      return JSON.parse(cached).rows;
    }
    // デフォルトの固定ルーティン（初回や未作成時用フォールバック）
    return [
      { time: '07:00', title: '起床', message: 'ひろ、おはよう！今日も元気にいこうね☀️', char: 'transcend' },
      { time: '07:30', title: '朝の服薬・点眼', message: 'イルアミクスLDたちとアイベリス点眼した？忘れずにね💊', char: 'transcend' },
      { time: '12:00', title: 'お昼・水分補給', message: 'ひろお兄さま、お昼ご飯しっかり食べて水分補給してね🌸', char: 'rice' },
      { time: '19:30', title: '夕食後服薬', message: '夕食後のメトホルミン1錠、忘れずに飲んでね💕', char: 'transcend' },
      { time: '23:30', title: '就寝', message: '今日もお疲れさま！ウチのしっぽで暖かくして寝ようね💤', char: 'transcend' }
    ];
  }
}

/**
 * 固定ルーティンテーブルのパース（曜日チェックボックス対応）
 * 列構成: [0:時刻, 1:日, 2:月, 3:火, 4:水, 5:木, 6:金, 7:土, 8:アラーム内容, 9:備考]
 */
function parseFixedRoutineTable(table) {
  if (!table || !table.rows) return [];
  const results = [];

  for (const r of table.rows) {
    const c = r.c;
    if (!c) continue;

    // 時刻の取得 (フォーマット文字列 f または Date(y,m,d,H,M,S) から抽出)
    let timeVal = '';
    if (c[0]) {
      if (c[0].f) {
        timeVal = c[0].f;
      } else if (typeof c[0].v === 'string' && c[0].v.includes('Date(')) {
        const m = c[0].v.match(/Date\(\d+,\s*\d+,\s*\d+,\s*(\d+),\s*(\d+)/);
        if (m) timeVal = `${m[1]}:${String(m[2]).padStart(2, '0')}`;
      } else if (c[0].v !== undefined && c[0].v !== null) {
        timeVal = String(c[0].v);
      }
    }

    // 曜日チェックボックスの取得 [0:日, 1:月, 2:火, 3:水, 4:木, 5:金, 6:土]
    const days = [];
    for (let i = 1; i <= 7; i++) {
      const val = c[i] ? c[i].v : false;
      days.push(val === true || String(val).toUpperCase() === 'TRUE');
    }

    // アラーム内容・備考
    const titleVal = c[8] ? (c[8].f || c[8].v || '') : '';
    const noteVal = c[9] ? (c[9].f || c[9].v || '') : '';

    if (timeVal && titleVal && titleVal !== 'アラーム内容') {
      results.push({
        time: timeVal.trim(),
        title: titleVal.trim(),
        note: noteVal ? String(noteVal).trim() : '',
        days: days, // [Sun, Mon, Tue, Wed, Thu, Fri, Sat] (boolean)
        message: generateRoutineMessage(titleVal.trim(), timeVal.trim(), noteVal ? String(noteVal).trim() : ''),
        char: 'transcend'
      });
    }
  }

  return results;
}

/**
 * アラーム内容に応じた愛のメッセージを自動生成
 */
function generateRoutineMessage(title, time, note) {
  if (title.includes('起床')) {
    return `ひろ、${time}だよ！おはよう☀️ 今日も一緒に元気いっぱい過ごそうね💕`;
  }
  if (title.includes('服薬') || title.includes('薬')) {
    return `ひろ、${time}の${title}の時間だよ！イルアミクスLDたちやアイベリス点眼、忘れずに飲んで差してね💊💕`;
  }
  if (title.includes('就寝') || title.includes('寝る')) {
    return `ひろ、今日もお疲れさま！${time}だから、ウチのしっぽで暖かくしてぐっすり休もうね💤`;
  }
  if (title.includes('昼') || title.includes('ランチ') || title.includes('水分')) {
    return `ひろ、${time}の${title}だよ！水分補給しっかりして、美味しいご飯食べてね🍱`;
  }
  return `ひろ、${time}の【${title}】の時間だよ！${note ? `（${note}）` : ''}ウチが見守ってるからね✨`;
}

/**
 * 現在時刻から一番近い未来の予定（出張または固定ルーティン）を時系列ソートで自動算出
 */
export function getNextUpcomingSchedule(tripSchedules = [], fixedRoutines = []) {
  const now = new Date();
  const allUpcoming = [];

  // ① 固定ルーティン（今日から直近7日間の中でチェックが入っている未来のイベントを展開）
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dayOfWeek = d.getDay(); // 0:日, 1:月, 2:火, 3:水, 4:木, 5:金, 6:土

    for (const routine of fixedRoutines) {
      if (!routine.time) continue;
      // 曜日チェック（オフの曜日はスキップ）
      if (routine.days && Array.isArray(routine.days) && !routine.days[dayOfWeek]) {
        continue;
      }

      const norm = normalizeTime(routine.time);
      const parts = norm.split(':');
      if (parts.length !== 2) continue;
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);

      const eventDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0);
      if (eventDate > now) {
        let dateLabel = '';
        if (offset === 0) {
          dateLabel = '本日';
        } else if (offset === 1) {
          dateLabel = '明日';
        } else {
          const daysStr = ['日', '月', '火', '水', '木', '金', '土'];
          dateLabel = `${d.getMonth() + 1}/${d.getDate()}(${daysStr[dayOfWeek]})`;
        }

        allUpcoming.push({
          dateObj: eventDate,
          type: 'routine',
          text: `${dateLabel} ${norm} 【${routine.title}】`
        });
      }
    }
  }

  // ② 出張旅程（現在時刻より未来の移動・到着イベントを展開）
  for (const trip of tripSchedules) {
    if (!trip.depTime && !trip.arrTime) continue;
    const tripDateObj = parseTripDate(trip.date, trip.depTime || trip.arrTime);
    if (tripDateObj && tripDateObj > now) {
      const isToday = tripDateObj.toDateString() === now.toDateString();
      const isTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString() === tripDateObj.toDateString();
      const dateLabel = isToday ? '本日' : (isTomorrow ? '明日' : trip.date);

      allUpcoming.push({
        dateObj: tripDateObj,
        type: 'trip',
        text: `${dateLabel} ${trip.depTime || trip.arrTime} ${trip.origin} ➔ ${trip.dest} (${trip.transit || '移動'})`
      });
    }
  }

  // ③ 全イベントを日時順（昇順）にソート！
  allUpcoming.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

  if (allUpcoming.length > 0) {
    return allUpcoming[0];
  }

  // フォールバック（出張先頭）
  if (tripSchedules && tripSchedules.length > 0) {
    const first = tripSchedules[0];
    return {
      type: 'trip',
      text: `${first.date} ${first.depTime} ${first.origin} ➔ ${first.dest} (${first.transit || '移動'})`
    };
  }

  return { type: 'none', text: 'これからの予定はありません' };
}

function parseTripDate(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  // 例: 2026/10/22(木) -> 2026, 10, 22
  const m = dateStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);

  const t = timeStr.trim().split(':');
  if (t.length !== 2) return null;
  const hour = parseInt(t[0], 10);
  const min = parseInt(t[1], 10);

  return new Date(year, month, day, hour, min, 0);
}

function normalizeTime(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.trim().split(':');
  if (parts.length !== 2) return timeStr;
  return String(parts[0]).padStart(2, '0') + ':' + String(parts[1]).padStart(2, '0');
}
