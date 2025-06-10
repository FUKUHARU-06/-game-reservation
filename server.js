const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
const PORT = 3000;
const RESERVATIONS_FILE = path.join(__dirname, 'reservations.json');

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
}));
// サブスクID登録
const SUBSCRIBER_IDS = ['sub001', 'sub002', 'sub003'];
const MAX_RESERVATIONS_PER_DAY = 3;
const MAX_SUBSCRIBER_SLOTS = 2;

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
  const { tiktokId, epicId, subId } = req.body;
  if (!tiktokId || !epicId) {
    return res.json({ success: false, message: 'TikTok ID と Epic ID は必須です。' });
  }

  const hasSub = subId && SUBSCRIBER_IDS.includes(subId);
  req.session.user = { tiktokId, epicId, subId, hasSub };
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
  fs.readFile(RESERVATIONS_FILE, (err, data) => {
    if (err) return res.json([]);
    try {
      const reservations = JSON.parse(data);
      res.json(reservations);
    } catch {
      res.json([]);
    }
  });
});

// 自分の予約取得
app.get('/my-reservations', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json([]);

  fs.readFile(RESERVATIONS_FILE, (err, data) => {
    if (err) return res.json([]);
    const reservations = JSON.parse(data);
    const myReservations = reservations.filter(r => r.name === user.tiktokId);
    res.json(myReservations);
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

  fs.readFile(RESERVATIONS_FILE, (err, data) => {
    if (err) return res.json({ available: timeSlots });

    const reservations = JSON.parse(data).filter(r => r.date === date && r.status !== 'rejected');
    const bookedHours = reservations.flatMap(r => parseTimeRange(r.time));

    const available = timeSlots.filter(slot => {
      const slotHours = parseTimeRange(slot);
      return !slotHours.some(h => bookedHours.includes(h));
    });

    res.json({ available });
  });
});

// サマリー取得
app.get('/reservations-summary', (req, res) => {
  fs.readFile(RESERVATIONS_FILE, (err, data) => {
    if (err) return res.json({});
    const reservations = JSON.parse(data);
    const summary = {};
    reservations.forEach(r => {
      if (r.status === 'rejected') return;
      if (!summary[r.date]) summary[r.date] = 0;
      summary[r.date]++;
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

  fs.readFile(RESERVATIONS_FILE, (err, data) => {
    const reservations = err ? [] : JSON.parse(data);

    const duplicate = reservations.find(r => r.name === user.tiktokId && r.date === date);
    if (duplicate) {
      return res.json({ message: '❌ すでにこの日に予約済みです。' });
    }

    const newHours = parseTimeRange(time);
    const overlap = reservations.some(r => {
      if (r.date !== date || r.status === 'rejected') return false;
      const existingHours = parseTimeRange(r.time);
      return existingHours.some(h => newHours.includes(h));
    });

    const confirmedCount = reservations.filter(r => r.date === date && r.status === 'confirmed').length;
    const subscriberCount = reservations.filter(r => r.date === date && r.status === 'confirmed' && SUBSCRIBER_IDS.includes(r.subId)).length;

    if (user.hasSub) {
      if (confirmedCount >= MAX_RESERVATIONS_PER_DAY || subscriberCount >= MAX_SUBSCRIBER_SLOTS) {
        return res.json({ message: '❌ この日は満員です。' });
      }
      reservations.push({
        name: user.tiktokId,
        epicId: user.epicId,
        subId: user.subId,
        hasSub: user.hasSub,
        date,
        time,
        status: 'confirmed'
      });
      fs.writeFile(RESERVATIONS_FILE, JSON.stringify(reservations, null, 2), (err) => {
        if (err) return res.json({ message: '❌ 予約保存に失敗しました。' });
        res.json({ message: '✅ サブスク優先予約が完了しました。' });
      });
    } else {
      reservations.push({
        name: user.tiktokId,
        epicId: user.epicId,
        subId: user.subId,
        hasSub: user.hasSub,
        date,
        time,
        status: 'pending'
      });
      fs.writeFile(RESERVATIONS_FILE, JSON.stringify(reservations, null, 2), (err) => {
        if (err) return res.json({ message: '❌ 仮予約保存に失敗しました。' });
        res.json({ message: '⏳ 抽選予約を受け付けました。結果は前日12:00以降に反映されます。' });
      });
    }
  });
});

// 抽選結果一覧取得
app.get('/lottery-results', (req, res) => {
  fs.readFile(RESERVATIONS_FILE, (err, data) => {
    if (err) return res.json([]);
    const reservations = JSON.parse(data);
    const results = reservations.filter(r => r.status === 'confirmed' || r.status === 'rejected');
    res.json(results);
  });
});

// 予約キャンセル
app.post('/cancel', (req, res) => {
  const user = req.session.user;
  if (!user) return res.json({ message: '❌ ログインが必要です。' });

  const { date, time } = req.body;
  fs.readFile(RESERVATIONS_FILE, (err, data) => {
    if (err) return res.json({ message: '❌ 予約情報の読み込みに失敗しました。' });

    let reservations;
    try {
      reservations = JSON.parse(data);
    } catch {
      return res.json({ message: '❌ 予約情報が壊れています。' });
    }

    const index = reservations.findIndex(r => r.name === user.tiktokId && r.date === date && r.time === time);
    if (index === -1) return res.json({ message: '❌ 該当の予約が見つかりません。' });

    reservations.splice(index, 1);
    fs.writeFile(RESERVATIONS_FILE, JSON.stringify(reservations, null, 2), (err) => {
      if (err) return res.json({ message: '❌ キャンセル保存に失敗しました。' });
      res.json({ message: '✅ 予約をキャンセルしました。' });
    });
  });
});

// 抽選処理
function runLottery() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + 1);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  if (now.getHours() === 12 && now.getMinutes() === 0) {
    fs.readFile(RESERVATIONS_FILE, (err, data) => {
      if (err) return;
      let reservations = JSON.parse(data);

      const pending = reservations.filter(r => r.date === targetDateStr && r.status === 'pending');
      if (pending.length === 0) return;

      const confirmed = reservations.filter(r => r.date === targetDateStr && r.status === 'confirmed');
      const alreadyConfirmed = confirmed.length;

      const subscriberConfirmed = confirmed.filter(r => SUBSCRIBER_IDS.includes(r.subId)).length;
      const availableSlots = MAX_RESERVATIONS_PER_DAY - alreadyConfirmed;

      const candidates = [...pending];
      shuffleArray(candidates);

      let confirmedCount = 0;
      for (let r of candidates) {
        if (confirmedCount < availableSlots) {
          r.status = 'confirmed';
          confirmedCount++;
        } else {
          r.status = 'rejected';
        }
      }

      fs.writeFile(RESERVATIONS_FILE, JSON.stringify(reservations, null, 2), () => {});

      // 🎯 抽選ログ保存
      const logEntry = {
        executedAt: now.toISOString(),
        targetDate: targetDateStr,
        results: resultLog,
      };
      const logPath = path.join(__dirname, 'lottery.log.json');
      fs.readFile(logPath, (err, data) => {
        let logs = [];
        if (!err && data.length > 0) {
          try {
            logs = JSON.parse(data);
          } catch {}
        }
        logs.push(logEntry);
        fs.writeFile(logPath, JSON.stringify(logs, null, 2), () => {});
      });
    });
  }
}

// 配列シャッフル用関数
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
// 自分の今日の抽選結果取得（ログイン中のユーザー向け）
app.get('/my-today-result', (req, res) => {
  const user = req.session.user;
  if (!user) return res.json({ status: 'none' });

  const today = new Date().toISOString().split('T')[0];

  fs.readFile(RESERVATIONS_FILE, (err, data) => {
    if (err) return res.json({ status: 'none' });
    const reservations = JSON.parse(data);
    const my = reservations.find(r => r.name === user.tiktokId && r.date === today);
    if (!my) return res.json({ status: 'none' });

    res.json({ status: my.status, time: my.time });
  });
});


// 抽選処理は1分ごとにチェック
setInterval(runLottery, 60 * 1000);

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
