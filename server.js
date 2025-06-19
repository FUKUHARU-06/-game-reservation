const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();

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

// 時間帯文字列を1時間単位の配列に分解する関数（変更なし）
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

// ログイン処理（変更なし）
app.post('/login', (req, res) => {
  const { tiktokId, epicId, subId, accountType } = req.body;
  if (!tiktokId || !epicId) {
    return res.json({ success: false, message: 'アカウント名 と Epic ID は必須です。' });
  }

  const hasSub = subId && SUBSCRIBER_IDS.includes(subId);
  req.session.user = { tiktokId, epicId, subId, hasSub, accountType: accountType || 'TikTok' };
  res.json({ success: true, hasSub, message: 'ログイン成功' });
});

// ログアウト（変更なし）
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'ログアウトしました' });
  });
});

// セッション情報取得（変更なし）
app.get('/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// 全予約取得（SQLite対応）
app.get('/reservations', (req, res) => {
  db.all('SELECT * FROM reservations', (err, rows) => {
    if (err) {
      console.error('DB取得エラー:', err);
      return res.status(500).json([]);
    }
    res.json(rows);
  });
});

// 自分の予約取得（SQLite対応）
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

// 空き時間取得（SQLite対応）
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

// サマリー取得（SQLite対応）
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

// 予約登録（SQLite対応）
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

    // すでに同日に予約済みか確認
    const duplicate = rows.find(r => r.name === user.tiktokId);
    if (duplicate) {
      return res.json({ message: '❌ すでにこの日に予約済みです。' });
    }

    // 時間帯重複チェック
    const newHours = parseTimeRange(time);
    const overlap = rows.some(r => {
      if (r.status === 'rejected') return false;
      const existingHours = parseTimeRange(r.time);
      return existingHours.some(h => newHours.includes(h));
    });

    if (overlap) {
      return res.json({ message: '❌ その時間帯はすでに埋まっています。' });
    }

    // 予約数チェック
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

// 抽選結果一覧取得（SQLite対応）
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

// 予約キャンセル（SQLite対応）
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

// 今日の抽選結果取得（SQLite対応）
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

// 配列シャッフル用関数（変更なし）
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// 抽選処理（SQLite対応）
function runLottery() {
  const now = new Date();

  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + 1);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  if (now.getHours() === 12 && now.getMinutes() === 0) {
    const sql = `SELECT * FROM reservations WHERE date = ?`;
    db.all(sql, [targetDateStr], (err, allRows) => {
      if (err) return console.error('抽選DB読み込み失敗:', err);

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

      // 一括更新（トランザクションで安全に）
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        updates.forEach(u => {
          db.run(`UPDATE reservations SET status = ? WHERE id = ?`, [u.status, u.id]);
        });
        db.run("COMMIT");
      });

      // 🎯 抽選ログ保存（オプション）
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
    });
  }
}

// 抽選処理は1分ごとにチェック
setInterval(runLottery, 60 * 1000);

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
