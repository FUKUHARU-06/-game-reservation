const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
// node-fetch をインストール済みと仮定
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// SQLiteデータベース初期化
const db = new sqlite3.Database(path.join(__dirname, 'reservations.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    epicId TEXT,
    subId TEXT,
    hasSub INTEGER,
    accountType TEXT,
    date TEXT,
    time TEXT,
    status TEXT
  )`);
});

// --- ロック用のファイルパス（抽選実行管理用） ---
const lotteryLockFile = path.join(__dirname, 'lottery_last_run.txt');

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
}));

const SUBSCRIBER_IDS = ['sub001', 'sub002', 'sub003'];
const MAX_RESERVATIONS_PER_DAY = 3;
const MAX_SUBSCRIBER_SLOTS = 2;

// 管理者判定関数
function isAdmin(user) {
  return user && user.tiktokId === 'admin';
}

app.get('/admin/reservations', (req, res) => {
  const user = req.session.user;
  if (!isAdmin(user)) {
    return res.status(403).json({ message: '管理者権限が必要です' });
  }
  db.all('SELECT * FROM reservations', (err, rows) => {
    if (err) {
      console.error('DB取得エラー:', err);
      return res.status(500).json({ message: 'DB取得エラー' });
    }
    res.json(rows);
  });
});

// 時間帯文字列を1時間単位の配列に分解する関数
function parseTimeRange(timeRange) {
  const [start, end] = timeRange.split('-');
  const startHour = parseInt(start.split(':')[0]);
  const endHour = parseInt(end.split(':')[0]);
  const hours = [];
  for (let h = startHour; h < endHour; h++) {
    hours.push(h.toString().padStart(2, '0') + ':00');
  }
  return hours;
}

// ログイン処理
app.post('/login', (req, res) => {
  const { tiktokId, epicId, subId, accountType } = req.body;
  if (!tiktokId || !epicId) {
    return res.json({ success: false, message: 'アカウント名 と Epic ID は必須です。' });
  }
  const hasSub = subId && SUBSCRIBER_IDS.includes(subId);
  req.session.user = { tiktokId, epicId, subId, hasSub, accountType: accountType || 'TikTok' };
  res.json({ success: true, hasSub, message: 'ログイン成功' });
});

// ログアウト
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'ログアウトしました' });
  });
});

// セッション情報取得
app.get('/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// 全予約取得
app.get('/reservations', (req, res) => {
  db.all('SELECT * FROM reservations', (err, rows) => {
    if (err) {
      console.error('DB取得エラー:', err);
      return res.status(500).json([]);
    }
    res.json(rows);
  });
});

// 自分の予約取得
app.get('/my-reservations', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json([]);
  const sql = 'SELECT * FROM reservations WHERE name = ?';
  db.all(sql, [user.tiktokId], (err, rows) => {
    if (err) {
      console.error('DBエラー:', err);
      return res.status(500).json([]);
    }
    res.json(rows);
  });
});

// 空き時間取得
app.get('/available-times', (req, res) => {
  const { date } = req.query;
  const timeSlots = [
    "09:00-10:00",
    "10:00-11:00",
    "11:00-12:00",
    "09:00-11:00",
    "10:00-12:00",
    "09:00-12:00",
  ];
  const sql = 'SELECT time FROM reservations WHERE date = ? AND status != ?';
  db.all(sql, [date, 'rejected'], (err, rows) => {
    if (err) {
      console.error('DBエラー:', err);
      return res.json({ available: timeSlots });
    }
    const bookedHours = rows.flatMap(r => parseTimeRange(r.time));
    const available = timeSlots.filter(slot => {
      const slotHours = parseTimeRange(slot);
      return !slotHours.some(h => bookedHours.includes(h));
    });
    res.json({ available });
  });
});

// サマリー取得
app.get('/reservations-summary', (req, res) => {
  const sql = `SELECT date, COUNT(*) AS count FROM reservations WHERE status != 'rejected' GROUP BY date`;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('DB読み込みエラー:', err);
      return res.json({});
    }
    const summary = {};
    rows.forEach(row => {
      summary[row.date] = row.count;
    });
    res.json(summary);
  });
});

// 予約登録
app.post('/reserve', (req, res) => {
  const user = req.session.user;
  if (!user) return res.json({ message: '❌ ログインが必要です。' });
  const { date, time } = req.body;
  if (date === '2025-05-27') {
    return res.json({ message: '❌ 5/27は予約できません。' });
  }
  const checkSql = 'SELECT * FROM reservations WHERE date = ?';
  db.all(checkSql, [date], (err, rows) => {
    if (err) {
      console.error('DB読み込みエラー:', err);
      return res.json({ message: '❌ データ取得に失敗しました。' });
    }
    const duplicate = rows.find(r => r.name === user.tiktokId);
    if (duplicate) {
      return res.json({ message: '❌ すでにこの日に予約済みです。' });
    }
    const newHours = parseTimeRange(time);
    const overlap = rows.some(r => {
      if (r.status === 'rejected') return false;
      const existingHours = parseTimeRange(r.time);
      return existingHours.some(h => newHours.includes(h));
    });
    if (overlap) {
      return res.json({ message: '❌ その時間帯はすでに埋まっています。' });
    }
    const confirmedCount = rows.filter(r => r.status === 'confirmed').length;
    const subscriberCount = rows.filter(r => r.status === 'confirmed' && SUBSCRIBER_IDS.includes(r.subId)).length;
    let status = 'pending';
    if (user.hasSub) {
      if (confirmedCount >= MAX_RESERVATIONS_PER_DAY || subscriberCount >= MAX_SUBSCRIBER_SLOTS) {
        return res.json({ message: '❌ この日は満員です。' });
      }
      status = 'confirmed';
    }
    const insertSql = `
      INSERT INTO reservations (accountType, name, epicId, subId, hasSub, date, time, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(insertSql, [
      user.accountType || 'TikTok',
      user.tiktokId,
      user.epicId,
      user.subId,
      user.hasSub ? 1 : 0,
      date,
      time,
      status
    ], function (err) {
      if (err) {
        console.error('予約保存失敗:', err);
        return res.json({ message: '❌ 予約保存に失敗しました。' });
      }
      if (status === 'confirmed') {
        res.json({ message: '✅ サブスク優先予約が完了しました。' });
      } else {
        res.json({ message: '⏳ 抽選予約を受け付けました。結果は前日12:00以降に反映されます。' });
      }
    });
  });
});

// 抽選結果一覧取得
app.get('/lottery-results', (req, res) => {
  const sql = `SELECT * FROM reservations WHERE status = 'confirmed' OR status = 'rejected'`;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('DB読み込みエラー:', err);
      return res.json([]);
    }
    res.json(rows);
  });
});

// 予約キャンセル
app.post('/cancel', (req, res) => {
  const user = req.session.user;
  if (!user) return res.json({ message: '❌ ログインが必要です。' });
  const { date, time } = req.body;
  const sql = 'DELETE FROM reservations WHERE name = ? AND date = ? AND time = ?';
  db.run(sql, [user.tiktokId, date, time], function (err) {
    if (err) {
      console.error('キャンセル失敗:', err);
      return res.json({ message: '❌ キャンセル処理に失敗しました。' });
    }
    if (this.changes === 0) {
      return res.json({ message: '❌ 該当の予約が見つかりません。' });
    }
    res.json({ message: '✅ 予約をキャンセルしました。' });
  });
});

// 今日の抽選結果取得
app.get('/my-today-result', (req, res) => {
  const user = req.session.user;
  if (!user) return res.json({ status: 'none' });
  const today = new Date().toISOString().split('T')[0];
  const sql = `SELECT status, time FROM reservations WHERE name = ? AND date = ? LIMIT 1`;
  db.get(sql, [user.tiktokId, today], (err, row) => {
    if (err) {
      console.error('DBエラー:', err);
      return res.json({ status: 'none' });
    }
    if (!row) return res.json({ status: 'none' });
    res.json({ status: row.status, time: row.time });
  });
});

// 配列シャッフル用関数
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// sqlite3 の run を Promise版で使うラッパー関数
function runAsync(db, sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Discord Webhook URLをグローバル定義（安全な方法で管理推奨）
const webhookUrl = 'https://discord.com/api/webhooks/1385535108143911003/mOjAX4c0kBjf-KMEYiPZNJxiACRBIJsKwiSP1N01fpRik7asfQTnwBrjged1sW-bWwST';

// Discord通知関数（グローバルに1回だけ定義）
function notifyDiscord(message) {
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
  }).catch(err => console.error('Discord通知失敗:', err));
}

// 抽選処理（12時以降かつ未実行なら実行し、一度実行したら当日は二重実行しない）
async function runLottery() {
  const now = new Date();

  // 実行タイミングは12:00以降（例：12:00～12:59）に1回だけ
  if (now.getHours() < 12) return; // 12時以前は実行しない

  const todayStr = now.toISOString().slice(0,10);

  // 最終実行日をファイルから読み込み
  let lastRunDate = null;
  try {
    lastRunDate = fs.readFileSync(lotteryLockFile, 'utf8');
  } catch {
    lastRunDate = null;
  }

  if (lastRunDate === todayStr) {
    // 今日すでに抽選済み
    return;
  }

  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + 1);
  const targetDateStr = targetDate.toISOString().slice(0,10);

  // DBから予約情報取得
  db.all('SELECT * FROM reservations WHERE date = ?', [targetDateStr], async (err, allRows) => {
    if (err) {
      console.error('抽選DB読み込み失敗:', err);
      return;
    }

    const pending = allRows.filter(r => r.status === 'pending');
    if (pending.length === 0) return;

    const confirmed = allRows.filter(r => r.status === 'confirmed');
    const alreadyConfirmed = confirmed.length;
    const subscriberConfirmed = confirmed.filter(r => SUBSCRIBER_IDS.includes(r.subId)).length;
    const availableSlots = MAX_RESERVATIONS_PER_DAY - alreadyConfirmed;

    const candidates = [...pending];
    shuffleArray(candidates);

    let confirmedCount = 0;
    const updates = [];

    for (let r of candidates) {
      const newStatus = confirmedCount < availableSlots ? 'confirmed' : 'rejected';
      if (newStatus === 'confirmed') confirmedCount++;
      updates.push({
        id: r.id,
        status: newStatus
      });
    }

    // トランザクション開始〜コミットまでPromiseで確実に処理
    try {
      await runAsync(db, "BEGIN TRANSACTION");
      for (const u of updates) {
        await runAsync(db, `UPDATE reservations SET status = ? WHERE id = ?`, [u.status, u.id]);
      }
      await runAsync(db, "COMMIT");
    } catch (e) {
      console.error('抽選DB更新エラー:', e);
      await runAsync(db, "ROLLBACK").catch(()=>{});
      return;
    }

    // 実行日時をロックファイルに書き込み（当日実行済み記録）
    try {
      fs.writeFileSync(lotteryLockFile, todayStr, 'utf8');
    } catch(e) {
      console.error('抽選実行ロックファイル書き込み失敗:', e);
    }

    // 抽選ログ保存
    const logEntry = {
      executedAt: now.toISOString(),
      targetDate: targetDateStr,
      results: updates
    };
    const logPath = path.join(__dirname, 'lottery.log.json');
    fs.readFile(logPath, (err, data) => {
      let logs = [];
      if (!err && data.length > 0) {
        try { logs = JSON.parse(data); } catch {}
      }
      logs.push(logEntry);
      fs.writeFile(logPath, JSON.stringify(logs, null, 2), () => {});
    });

    // Discord通知
    notifyDiscord(`✅ ${targetDateStr} の抽選が完了しました。結果はサイト上で確認できます。`);
  });
}

// 1分ごとに抽選実行判定
setInterval(runLottery, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
