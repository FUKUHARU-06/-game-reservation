require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
// node-fetch をインストール済みと仮定
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Supabaseクライアント
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// --- 抽選実行ロック用ファイルパス ---
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

// Discord Webhook URL (環境変数で管理推奨)
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

// Discord通知関数
function notifyDiscord(message) {
  console.log("📢 Discord通知内容:", message);
  fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
  }).catch(err => console.error('Discord通知失敗:', err));
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

// 管理者専用 全予約取得
app.get('/admin/reservations', async (req, res) => {
  const user = req.session.user;
  if (!isAdmin(user)) {
    return res.status(403).json({ message: '管理者権限が必要です' });
  }
  const { data, error } = await supabase
    .from('reservations')
    .select('*');
  if (error) {
    console.error('DB取得エラー:', error);
    return res.status(500).json({ message: 'DB取得エラー' });
  }
  res.json(data);
});

// 全予約取得（管理者用ではない場合も、従来通り必要なら修正してください）
app.get('/reservations', async (req, res) => {
  const { data, error } = await supabase
    .from('reservations')
    .select('*');
  if (error) {
    console.error('DB取得エラー:', error);
    return res.status(500).json([]);
  }
  res.json(data);
});

// 自分の予約取得
app.get('/my-reservations', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json([]);
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('name', user.tiktokId)
    .eq('epicid', user.epicId);
  if (error) {
    console.error('DBエラー:', error);
    return res.status(500).json([]);
  }
  res.json(data);
});

// 空き時間取得
app.get('/available-times', async (req, res) => {
  const { date } = req.query;
  const timeSlots = [
    "09:00-10:00",
    "10:00-11:00",
    "11:00-12:00",
    "09:00-11:00",
    "10:00-12:00",
    "09:00-12:00",
  ];

  const { data, error } = await supabase
    .from('reservations')
    .select('time')
    .eq('date', date)
    .neq('status', 'rejected');

  if (error) {
    console.error('DBエラー:', error);
    return res.json({ available: timeSlots });
  }

  const bookedHours = data.flatMap(r => parseTimeRange(r.time));
  const available = timeSlots.filter(slot => {
    const slotHours = parseTimeRange(slot);
    return !slotHours.some(h => bookedHours.includes(h));
  });
  res.json({ available });
});

// サマリー取得
app.get('/reservations-summary', async (req, res) => {
  // Supabaseでgroup byはRPCかビューが必要なためここは簡易的に全件取得して集計
  const { data, error } = await supabase
    .from('reservations')
    .select('date, status');

  if (error) {
    console.error('DB読み込みエラー:', error);
    return res.json({});
  }

  const summary = {};
  data.forEach(row => {
    if (row.status !== 'rejected') {
      summary[row.date] = (summary[row.date] || 0) + 1;
    }
  });
  res.json(summary);
});

// 予約登録
app.post('/reserve', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.json({ message: '❌ ログインが必要です。' });

  const { date, time } = req.body;

  // その日に既に予約してるか確認
  const { data: existing, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('name', user.tiktokId)
    .eq('epicid', user.epicId)  // ← 追加
    .eq('date', date);

  if (error) {
    console.error('データ取得エラー:', error);
    return res.json({ message: '❌ データ取得に失敗しました。' });
  }
  if (existing.length > 0) {
    return res.json({ message: '❌ すでにこの日に予約済みです。' });
  }

  // 同日の予約全体を取得
  const { data: allReservations, error: allErr } = await supabase
    .from('reservations')
    .select('*')
    .eq('date', date);

  if (allErr) {
    console.error('予約取得エラー:', allErr);
    return res.json({ message: '❌ 状況確認に失敗しました。' });
  }

  const confirmed = allReservations.filter(r => r.status === 'confirmed');
  const confirmedSubs = confirmed.filter(r => Number(r.hassub) === 1);  // ← 修正ポイント

  let status = 'pending';

  // サブスク有 → confirmed枠が2人未満なら確定予約
 if (user.hasSub) {
  if (confirmedSubs.length >= MAX_SUBSCRIBER_SLOTS) {
    return res.json({ message: '❌ サブスク優先枠が上限に達しています。' });
  }
  if (confirmed.length >= MAX_RESERVATIONS_PER_DAY) {
    return res.json({ message: '❌ 予約人数が上限に達しています。' });
  }
  status = 'confirmed';
} else {
  // サブスク無：仮予約（抽選対象）として受付
  status = 'pending';
}

  const { error: insertError } = await supabase
    .from('reservations')
    .insert([{
      name: user.tiktokId,
      epicid: user.epicId,
      subid: user.subId,
      hassub: user.hasSub ? 1 : 0,
      accounttype: user.accountType,
      date,
      time,
      status
    }]);

  if (insertError) {
    console.error('予約登録エラー:', insertError);
    return res.json({ message: '❌ 予約登録に失敗しました。' });
  }

  if (status === 'confirmed') {
    res.json({ message: '✅ サブスク優先予約が完了しました。' });
  } else {
    res.json({ message: '⏳ 仮予約を受け付けました。抽選結果は前日に通知されます。' });
  }
});


// 抽選結果一覧取得（確定または落選の予約のみ）
app.get('/lottery-results', async (req, res) => {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .or('status.eq.confirmed,status.eq.rejected');

  if (error) {
    console.error('DB読み込みエラー:', error);
    return res.json([]);
  }
  res.json(data);
});

// 予約キャンセル
app.post('/cancel', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.json({ message: '❌ ログインが必要です。' });

  const { date, time } = req.body;

  const { error } = await supabase
    .from('reservations')
    .delete()
    .eq('name', user.tiktokId)
    .eq('epicid', user.epicId)  // ← 追加
    .eq('date', date)
    .eq('time', time);

  if (error) {
    console.error('キャンセル失敗:', error);
    return res.json({ message: '❌ キャンセル処理に失敗しました。' });
  }
  res.json({ message: '✅ 予約をキャンセルしました。' });
});

// 今日の抽選結果取得
app.get('/my-today-result', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.json({ status: 'none' });

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('reservations')
    .select('status, time')
    .eq('name', user.tiktokId)
    .eq('epicid', user.epicId)  // ← 追加
    .eq('date', today)
    .limit(1)
    .single();

  if (error || !data) {
    if (error && error.code !== 'PGRST116') {
      console.error('DBエラー:', error);
    }
    return res.json({ status: 'none' });
  }
  res.json({ status: data.status, time: data.time });
});

// 配列シャッフル用関数
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// 抽選処理（12時以降に1日1回だけ実行）
async function runLottery() {
  const now = new Date();
  if (now.getHours() < 12) return;

  const todayStr = now.toISOString().slice(0, 10);

  let lastRunDate = null;
  try {
    lastRunDate = fs.readFileSync(lotteryLockFile, 'utf8');
  } catch {
    lastRunDate = null;
  }
  if (lastRunDate === todayStr) return; // 当日すでに実行済み

  // 対象は翌日の予約
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + 1);
  const targetDateStr = targetDate.toISOString().slice(0, 10);

  // 予約取得
  const { data: allRows, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('date', targetDateStr);

  if (error) {
    console.error('抽選DB読み込み失敗:', error);
    return;
  }
  if (!allRows || allRows.length === 0) return;

  const pending = allRows.filter(r => r.status === 'pending');
  if (pending.length === 0) return;

  const confirmed = allRows.filter(r => r.status === 'confirmed');
  const alreadyConfirmed = confirmed.length;

  const availableSlots = MAX_RESERVATIONS_PER_DAY - alreadyConfirmed;

  // 抽選対象シャッフル
  const candidates = [...pending];
  shuffleArray(candidates);

  let confirmedCount = 0;
  const updates = [];

  for (const r of candidates) {
    const newStatus = confirmedCount < availableSlots ? 'confirmed' : 'rejected';
    if (newStatus === 'confirmed') confirmedCount++;
    updates.push({
      id: r.id,
      status: newStatus
    });
  }

  // ステータス更新をバルクで行う（1件ずつ個別更新する方法がSupabaseにはないため複数回更新を逐次実行）
  try {
    for (const u of updates) {
      await supabase
        .from('reservations')
        .update({ status: u.status })
        .eq('id', u.id);
    }
  } catch (e) {
    console.error('抽選DB更新エラー:', e);
    return;
  }

  // 実行日時をロックファイルに書き込み
  try {
    fs.writeFileSync(lotteryLockFile, todayStr, 'utf8');
  } catch (e) {
    console.error('抽選実行ロックファイル書き込み失敗:', e);
  }

  // 抽選ログ追記
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
    fs.writeFile(logPath, JSON.stringify(logs, null, 2), () => {
      // Discord通知
      const confirmedUsers = updates.filter(u => u.status === 'confirmed').map(u => {
        const userObj = allRows.find(row => row.id === u.id);
        return userObj ? userObj.name : '(不明)';
      });
      const rejectedUsers = updates.filter(u => u.status === 'rejected').map(u => {
        const userObj = allRows.find(row => row.id === u.id);
        return userObj ? userObj.name : '(不明)';
      });

      let message = `@everyone\n🎯 ${targetDateStr} 抽選結果\n`;
      message += `✅ 当選: ${confirmedUsers.length > 0 ? confirmedUsers.join(', ') : 'なし'}\n`;
      message += `❌ 落選: ${rejectedUsers.length > 0 ? rejectedUsers.join(', ') : 'なし'}`;

      notifyDiscord(message);
      console.log("✅ Discord通知を送信しました:", message);
    });
  });
}
// 秘密キー付きの抽選実行エンドポイント（セッション不要）
app.post('/cron/lottery', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  await runLottery();
  res.json({ message: '✅ 抽選実行完了' });
});


// Discord Webhook テスト用（管理者専用）
app.get('/admin/test-webhook', (req, res) => {
  const user = req.session.user;
  if (!isAdmin(user)) return res.status(403).send('管理者権限が必要です');

  const testMessage = '✅ Discord Webhook テスト送信（' + new Date().toLocaleString() + '）';
  notifyDiscord(testMessage);
  res.send('✅ テスト通知を送信しました！');
});

// 管理者専用 抽選強制実行API
app.post('/admin/force-lottery', async (req, res) => {
  const user = req.session.user;
  if (!isAdmin(user)) {
    return res.status(403).json({ message: '管理者専用エンドポイントです' });
  }
  try {
    await runLottery();
    res.json({ message: '✅ 抽選を強制実行しました' });
  } catch (err) {
    console.error('強制抽選エラー:', err);
    res.status(500).json({ message: '❌ 抽選実行中にエラーが発生しました' });
  }
});

// 1分ごとに抽選判定を実行
setInterval(runLottery, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// 起動時に1回抽選を実行
//runLottery();
console.log("✅ runLotteryが呼び出されました");
