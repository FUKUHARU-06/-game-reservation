const fs = require('fs');
const path = require('path');

const RESERVATIONS_FILE = path.join(__dirname, 'reservations.json');

// 日付文字列（例: "2025-05-30"）を Date に変換
function toDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 前日の日付を YYYY-MM-DD 形式で取得
function getYesterdayDateString() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return now.toISOString().split('T')[0];
}

// 抽選処理
function runLottery() {
  fs.readFile(RESERVATIONS_FILE, (err, data) => {
    if (err) {
      console.error('予約ファイルの読み込みに失敗しました。');
      return;
    }

    let reservations;
    try {
      reservations = JSON.parse(data);
    } catch (e) {
      console.error('予約データのパースに失敗しました。');
      return;
    }

    const yesterday = getYesterdayDateString();

    // 前日分の pending 予約のみ抽出
    const pendingReservations = reservations.filter(r => r.date === yesterday && r.status === 'pending');

    if (pendingReservations.length === 0) {
      console.log('抽選対象の予約はありません。');
      return;
    }

    // ランダムに最大3件選出
    const shuffled = pendingReservations.sort(() => Math.random() - 0.5);
    const confirmed = shuffled.slice(0, 3);
    const confirmedIds = new Set(confirmed.map(r => r.name + r.time));

    // 状態更新
    const updatedReservations = reservations.map(r => {
      if (r.date !== yesterday || r.status !== 'pending') return r;
      const id = r.name + r.time;
      if (confirmedIds.has(id)) {
        return { ...r, status: 'confirmed' };
      } else {
        return { ...r, status: 'rejected' };
      }
    });

    // 保存
    fs.writeFile(RESERVATIONS_FILE, JSON.stringify(updatedReservations, null, 2), err => {
      if (err) {
        console.error('抽選結果の保存に失敗しました。');
      } else {
        console.log(`抽選完了：${confirmed.length}件を確定、${pendingReservations.length - confirmed.length}件を落選に設定しました。`);
      }
    });
  });
}

runLottery();
