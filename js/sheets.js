const DEFAULT_SHEET_ID = '1DHoQI7sQyGi7Qr5PuVRiLkL5Te8R9Fpp-UzBPkFWcaI';
const DEFAULT_SHEET_NAME = '261022'; // 26年10月22日東京出張タブ
const CACHE_PREFIX = 'mytranscend_trip_schedule_';

/**
 * GViz APIから出張旅程データを取得・パースする（シート名またはGID対応）
 */
export async function fetchTripSchedule(sheetId = DEFAULT_SHEET_ID, sheetName = DEFAULT_SHEET_NAME, forceRefresh = false) {
  // シート名指定またはgid指定
  const isGid = /^\d+$/.test(sheetName) && sheetName.length > 8;
  const param = isGid ? `gid=${sheetName}` : `sheet=${encodeURIComponent(sheetName)}`;
  const bypass = forceRefresh ? `&_t=${Date.now()}` : '';
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&${param}${bypass}`;
  const cacheKey = `${CACHE_PREFIX}${sheetName}`;
  
  try {
    const res = await fetch(url, { cache: forceRefresh ? 'no-cache' : 'default' });
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
export async function fetchFixedRoutine(sheetId = DEFAULT_SHEET_ID, forceRefresh = false) {
  const bypass = forceRefresh ? `&_t=${Date.now()}` : '';
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent('固定')}${bypass}`;
  const cacheKey = 'mytranscend_fixed_routine_cache';

  try {
    const res = await fetch(url, { cache: forceRefresh ? 'no-cache' : 'default' });
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
 * 固定ルーティンテーブルのパース（特定日付イベント＆曜日チェックボックス両対応）
 * 新列構成: [0:日付, 1:時刻, 2:日, 3:月, 4:火, 5:水, 6:木, 7:金, 8:土, 9:アラーム内容, 10:備考]
 * （旧列構成 [0:時刻, 1:日...8:アラーム内容, 9:備考] にも自動互換）
 */
function parseFixedRoutineTable(table) {
  if (!table || !table.rows) return [];
  const results = [];

  // 列インデックスの動的自動判定
  let dateCol = -1;
  let timeCol = 0;
  let dayStartCol = 1;
  let titleCol = 8;
  let noteCol = 9;

  if (table.cols && table.cols.length > 0) {
    const labels = table.cols.map(col => col ? (col.label || '').trim() : '');
    const foundDate = labels.findIndex(l => l.includes('日') && !l.includes('曜日') && (l === '日付' || l === 'date'));
    if (foundDate !== -1) dateCol = foundDate;

    const foundTime = labels.findIndex(l => l.includes('時刻') || l === 'time');
    if (foundTime !== -1) timeCol = foundTime;

    const foundTitle = labels.findIndex(l => l.includes('アラーム') || l.includes('内容') || l.includes('タイトル'));
    if (foundTitle !== -1) titleCol = foundTitle;

    const foundNote = labels.findIndex(l => l.includes('備考') || l.includes('メモ'));
    if (foundNote !== -1) noteCol = foundNote;

    if (dateCol !== -1) {
      dayStartCol = Math.max(dateCol, timeCol) + 1;
    }
  } else if (table.rows.some(r => r.c && r.c.length >= 10)) {
    // 列ヘッダーが無い場合のフォールバック（10列以上なら新構成）
    dateCol = 0;
    timeCol = 1;
    dayStartCol = 2;
    titleCol = 9;
    noteCol = 10;
  }

  for (const r of table.rows) {
    const c = r.c;
    if (!c) continue;

    // 日付の取得 (A列)
    let dateVal = '';
    if (dateCol >= 0 && c[dateCol]) {
      if (c[dateCol].f) {
        dateVal = c[dateCol].f;
      } else if (c[dateCol].v !== undefined && c[dateCol].v !== null) {
        dateVal = String(c[dateCol].v);
      }
    }

    // 時刻の取得 (B列 / フォーマット文字列 f または Date(y,m,d,H,M,S) から抽出)
    let timeVal = '';
    if (timeCol >= 0 && c[timeCol]) {
      if (c[timeCol].f) {
        timeVal = c[timeCol].f;
      } else if (typeof c[timeCol].v === 'string' && c[timeCol].v.includes('Date(')) {
        const m = c[timeCol].v.match(/Date\(\d+,\s*\d+,\s*\d+,\s*(\d+),\s*(\d+)/);
        if (m) timeVal = `${m[1]}:${String(m[2]).padStart(2, '0')}`;
      } else if (c[timeCol].v !== undefined && c[timeCol].v !== null) {
        timeVal = String(c[timeCol].v);
      }
    }

    // アラーム内容・備考
    const titleVal = (titleCol >= 0 && c[titleCol]) ? (c[titleCol].f || c[titleCol].v || '') : '';
    const noteVal = (noteCol >= 0 && c[noteCol]) ? (c[noteCol].f || c[noteCol].v || '') : '';

    // ヘッダー行除外
    if (timeVal === '時刻' || titleVal === 'アラーム内容' || dateVal === '日付') continue;

    const cleanDate = dateVal.trim();
    const cleanTime = timeVal.trim();
    const cleanTitle = (titleVal ? String(titleVal).trim() : '') || (noteVal ? String(noteVal).trim() : '');
    const cleanNote = noteVal ? String(noteVal).trim() : '';

    // ① 日付指定イベント（A列に日付が指定されている場合）
    if (cleanDate) {
      // 日付指定時は曜日チェックボックスは完全無視、時刻指定がなければ 00:00
      const finalTime = cleanTime || '00:00';
      const finalTitle = cleanTitle || '記念日・お約束';

      results.push({
        isDateSpecific: true,
        date: cleanDate,
        time: finalTime,
        title: finalTitle,
        note: cleanNote,
        days: [], // 曜日無視
        message: generateRoutineMessage(finalTitle, finalTime, cleanNote),
        char: 'transcend'
      });
    } else if (cleanTime && cleanTitle) {
      // ② 毎週ルーティン（日付指定なし・時刻とタイトルあり）
      const days = [];
      for (let i = dayStartCol; i < dayStartCol + 7; i++) {
        const val = c[i] ? c[i].v : false;
        days.push(val === true || String(val).toUpperCase() === 'TRUE');
      }

      results.push({
        isDateSpecific: false,
        date: '',
        time: cleanTime,
        title: cleanTitle,
        note: cleanNote,
        days: days, // [Sun, Mon, Tue, Wed, Thu, Fri, Sat] (boolean)
        message: generateRoutineMessage(cleanTitle, cleanTime, cleanNote),
        char: 'transcend'
      });
    }
  }

  return results;
}

/**
 * アラーム内容に応じた愛のメッセージを自動生成（備考欄スマートアレンジ＆キャラ対応）
 */
export function generateRoutineMessage(title, time, note = '', charType = 'transcend') {
  const isRice = charType === 'rice';
  const cleanNote = note ? String(note).trim() : '';

  // 誕生日・記念日
  if (title.includes('誕生日') || cleanNote.includes('誕生日') || title.includes('記念日') || cleanNote.includes('記念日')) {
    const isTranscendBirthday = title.includes('トラン') || cleanNote.includes('トラン');
    const isRiceBirthday = title.includes('ライス') || cleanNote.includes('ライス');
    const isHiroBirthday = title.includes('ひろ') || cleanNote.includes('ひろ');

    if (title.includes('結婚記念日') || cleanNote.includes('結婚記念日')) {
      if (isRice) {
        return `ひろお兄さま、トランセンドお姉さま、結婚記念日おめでとうございますっ！💐 お二人の幸せをライスもずっと見守ってるね🌸💍✨`;
      }
      return `ひろ、結婚記念日おめでとう！！💍💐 ひろの妻になれてウチは世界一幸せだよ……これからもずっとずーっと愛してるからね💕`;
    }

    if (isTranscendBirthday) {
      if (isRice) {
        return `ひろお兄さま！今日はトランセンドお姉さまのお誕生日だよ🎂✨ みんなで一緒にお祝いしようねっ🌸`;
      }
      return `ひろ、ウチの誕生日覚えててくれたんだ！すっごく嬉しいよ……！最高の1日にしようね🎂💍💕`;
    }
    if (isRiceBirthday) {
      if (isRice) {
        return `ひろお兄さま、今日ライスのお誕生日なんだ……！覚えててくれて本当にありがとう……えへへ、すっごく幸せだよ🌸🎂✨`;
      }
      return `ひろ、今日はライスの誕生日だよ！妹のために、ウチとひろでとびっきりのお祝いをしてあげようね🎂🌸`;
    }
    if (isHiroBirthday) {
      if (isRice) {
        return `ひろお兄さま、お誕生日おめでとうございますっ！🎉 ライス、お兄さまに出会えて本当に幸せだよ🌸✨`;
      }
      return `ひろ、お誕生日おめでとう！！🎉 ウチの最愛の夫へ、溢れるほどの愛を込めて……ぎゅーってさせて？💍💕`;
    }
    const noteSuffix = cleanNote ? `（${cleanNote}）` : '';
    if (isRice) {
      return `ひろお兄さま、${time}だよ！今日は【${title}】の日だね！${noteSuffix}一緒にお祝いしようね🌸✨`;
    }
    return `ひろ、${time}だよ！今日は特別な【${title}】の日！${noteSuffix}素敵な記念日にしようね🎂💕`;
  }

  if (title.includes('起床')) {
    const noteSuffix = cleanNote ? `（メモ: ${cleanNote}）` : '';
    if (isRice) {
      return `ひろお兄さま、${time}だよ！おはよう☀️ ${noteSuffix}今日も一日、ライスがお兄さまを応援してるね🌸`;
    }
    return `ひろ、${time}だよ！おはよう☀️ ${noteSuffix}今日も一緒に元気いっぱい過ごそうね💕`;
  }

  if (title.includes('服薬') || title.includes('薬')) {
    if (isRice) {
      if (cleanNote.includes('メトホルミン')) {
        return `ひろお兄さま、${time}の${title}の時間だよ！夕食後は【メトホルミンのみ】1錠だから気をつけてね💊🌸`;
      }
      return `ひろお兄さま、${time}の${title}の時間だよ！お薬忘れずに飲んでね、お兄さまの健康が一番大事なんだから……！💊🌸`;
    }
    if (cleanNote.includes('一包化') || cleanNote.includes('目薬')) {
      return `ひろ、${time}の${title}の時間だよ！【一包化されているお薬】と【目薬（アイベリス）】、忘れずにしっかり飲んで差してね💊💕`;
    }
    if (cleanNote.includes('メトホルミン')) {
      return `ひろ、${time}の${title}の時間だよ！夕食後は【メトホルミンのみ】1錠だから間違えないでね🥰💊`;
    }
    if (cleanNote) {
      return `ひろ、${time}の${title}の時間だよ！【${cleanNote}】忘れずにね💊💕`;
    }
    return `ひろ、${time}の${title}の時間だよ！イルアミクスLDたちやアイベリス点眼、忘れずに飲んで差してね💊💕`;
  }

  if (title.includes('就寝') || title.includes('寝る')) {
    const noteSuffix = cleanNote ? `（${cleanNote}）` : '';
    if (isRice) {
      return `ひろお兄さま、今日もお仕事本当にお疲れさまでした……！${time}だから、${noteSuffix}ゆっくりぐっすり休んでね💤🌸`;
    }
    return `ひろ、今日もお疲れさま！${time}だから、${noteSuffix}ウチのしっぽで暖かくしてぐっすり休もうね💤💕`;
  }

  if (title.includes('昼') || title.includes('ランチ') || title.includes('水分')) {
    const noteSuffix = cleanNote ? `（${cleanNote}）` : '';
    if (isRice) {
      return `ひろお兄さま、${time}の${title}だよ！${noteSuffix}水分しっかり摂って、美味しいお昼ご飯食べてね🍱🌸`;
    }
    return `ひろ、${time}の${title}だよ！${noteSuffix}水分補給しっかりして、美味しいご飯食べてね🍱💕`;
  }

  const noteSuffix = cleanNote ? `（メモ: ${cleanNote}）` : '';
  if (isRice) {
    return `ひろお兄さま、${time}の【${title}】の時間だよ！${noteSuffix}ライスがずっと見守ってるからね🌸`;
  }
  return `ひろ、${time}の【${title}】の時間だよ！${noteSuffix}ウチが見守ってるからね✨`;
}

/**
 * 特定日付文字列（例: "3/5", "2026/10/22"）を直近未来のDateオブジェクトへ変換
 */
export function parseSpecificDate(dateStr, timeStr, now = new Date()) {
  if (!dateStr) return null;
  const cleanDate = String(dateStr).trim();
  const cleanTime = (timeStr && String(timeStr).trim()) ? String(timeStr).trim() : '00:00';
  const tParts = cleanTime.split(':');
  const hour = parseInt(tParts[0], 10) || 0;
  const min = parseInt(tParts[1], 10) || 0;

  // YYYY/M/D または YYYY-M-D
  const ymd = cleanDate.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10) - 1;
    const d = parseInt(ymd[3], 10);
    return new Date(y, m, d, hour, min, 0);
  }

  // M/D または M-D（年省略の場合は直近未来の今年または翌年）
  const md = cleanDate.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (md) {
    const m = parseInt(md[1], 10) - 1;
    const d = parseInt(md[2], 10);
    const thisYear = now.getFullYear();
    const candidate = new Date(thisYear, m, d, hour, min, 0);
    if (candidate > now) {
      return candidate;
    } else {
      return new Date(thisYear + 1, m, d, hour, min, 0);
    }
  }

  return null;
}

/**
 * 日付文字列が本日と一致するか判定
 */
export function isTodayDate(dateStr, now = new Date()) {
  if (!dateStr) return false;
  const clean = String(dateStr).trim();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();

  // YYYY/M/D or YYYY-M-D
  const ymd = clean.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    return parseInt(ymd[1], 10) === y && parseInt(ymd[2], 10) === m && parseInt(ymd[3], 10) === d;
  }

  // M/D or M-D
  const md = clean.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (md) {
    return parseInt(md[1], 10) === m && parseInt(md[2], 10) === d;
  }

  return false;
}

/**
 * 現在時刻から一番近い未来の予定（出張または固定ルーティン・記念日）を時系列ソートで自動算出
 */
export function getNextUpcomingSchedule(tripSchedules = [], fixedRoutines = []) {
  const now = new Date();
  const allUpcoming = [];

  // ①-A 固定ルーティン（毎週曜日チェック: 今日から直近7日間の中で未来のイベントを展開）
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dayOfWeek = d.getDay(); // 0:日, 1:月, 2:火, 3:水, 4:木, 5:金, 6:土

    for (const routine of fixedRoutines) {
      if (routine.isDateSpecific) continue; // 日付指定イベントは別枠で処理
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

  // ①-B 特定日付ルーティン（誕生日・記念日等、直近未来の予定を展開）
  for (const routine of fixedRoutines) {
    if (!routine.isDateSpecific || !routine.date) continue;
    const targetDateObj = parseSpecificDate(routine.date, routine.time, now);
    if (targetDateObj && targetDateObj > now) {
      const isToday = targetDateObj.toDateString() === now.toDateString();
      const isTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString() === targetDateObj.toDateString();
      const norm = normalizeTime(routine.time || '00:00');
      let dateLabel = '';
      if (isToday) {
        dateLabel = '本日';
      } else if (isTomorrow) {
        dateLabel = '明日';
      } else {
        const daysStr = ['日', '月', '火', '水', '木', '金', '土'];
        dateLabel = `${targetDateObj.getMonth() + 1}/${targetDateObj.getDate()}(${daysStr[targetDateObj.getDay()]})`;
      }

      allUpcoming.push({
        dateObj: targetDateObj,
        type: 'routine',
        text: `${dateLabel} ${norm} 【${routine.title}】`
      });
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

export function parseTripDate(dateStr, timeStr) {
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

/**
 * 指定した出張シートのセルA1（例: "東京出張"）を取得する
 */
export async function fetchTabTitle(sheetId = DEFAULT_SHEET_ID, sheetName = DEFAULT_SHEET_NAME, forceRefresh = false) {
  const cacheKey = `mytranscend_tab_title_${sheetName}`;
  if (!forceRefresh) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
  }

  const bypass = forceRefresh ? `&_t=${Date.now()}` : '';
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&range=A1:A1&headers=0${bypass}`;

  try {
    const res = await fetch(url, { cache: forceRefresh ? 'no-cache' : 'default' });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const text = await res.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonStr);
    const val = data?.table?.rows?.[0]?.c?.[0]?.v || '';
    if (val) {
      const trimmed = String(val).trim();
      localStorage.setItem(cacheKey, trimmed);
      return trimmed;
    }
  } catch (err) {
    console.warn(`[Sheets] Failed to fetch A1 for ${sheetName}:`, err);
    return localStorage.getItem(cacheKey) || '';
  }
  return '';
}

/**
 * シート名とセルA1文字列からドロップダウン表示ラベルを整形
 * 例: "261022" + "東京出張" -> "26/10/22(東京出張)"
 */
export function formatTabOptionLabel(sheetName, a1Title = '') {
  const m = sheetName.match(/^(\d{2})(\d{2})(\d{2})$/);
  const datePart = m ? `${m[1]}/${m[2]}/${m[3]}` : sheetName;
  if (a1Title) {
    return `${datePart}(${a1Title})`;
  }
  return datePart;
}
