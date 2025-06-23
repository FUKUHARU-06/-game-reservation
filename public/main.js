/*document.addEventListener('DOMContentLoaded', function () {
  const calendarEl = document.getElementById('calendar');
  const reserveBtn = document.getElementById('reserve-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const dateInput = document.getElementById('reserve-date');
  const timeSelect = document.getElementById('reserve-time');
  const reserveResult = document.getElementById('reserve-result');

  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const loginResult = document.getElementById('login-result');
  const reserveForm = document.getElementById('reserve-form');
  const displayName = document.getElementById('display-name');

  const menuBtn = document.getElementById('menu-btn');
  const menu = document.getElementById('menu');
  const reservationList = document.getElementById('reservation-list');
  const reservationDetail = document.getElementById('reservation-detail');

  const MAX_CAPACITY = 3;
  const MAX_SUBSCRIBERS = 2;

  const statusColors = {
    '〇': 'green',
    '△': 'orange',
    '✕': 'red',
  };

  let currentUser = null;
  let calendar = null;

  const availableDates = {
    '2025-06-17': true,
    '2025-06-18': true,
    '2025-06-19': true,
    '2025-06-20': true,
    '2025-06-21': true,
    '2025-06-22': true,
    '2025-06-23': true,
    '2025-06-24': true,
    '2025-06-25': true,
    '2025-06-26': true,
    '2025-06-27': true,
    '2025-06-28': true,
    '2025-06-29': true,
    '2025-06-30': true,
  };
  function parseTimeRange(range) {
  const [start, end] = range.split('-');
  const startHour = parseInt(start.split(':')[0]);
  const endHour = parseInt(end.split(':')[0]);
  const result = [];
  for (let h = startHour; h < endHour; h++) {
    result.push(h.toString().padStart(2, '0') + ':00');
  }
  return result;
}


  async function fetchReservations() {
    try {
      const res = await fetch('/reservations');
      if (!res.ok) throw new Error('予約取得失敗');
      return await res.json();
    } catch {
      return [];
    }
  }

  function getStatusLabel(dateStr, _, reservations) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateStr);
  targetDate.setHours(0, 0, 0, 0);

  if (targetDate < today || !availableDates[dateStr]) return '✕';

  // 対象日の予約のみ
  const relevant = reservations.filter(r => r.date === dateStr);
  const confirmed = relevant.filter(r => r.status === 'confirmed');
  const subsConfirmed = confirmed.filter(r => r.hasSub);
  const nonsubsPending = relevant.filter(r => !r.hasSub && r.status === 'pending');

  const lotteryDeadline = new Date(targetDate);
  lotteryDeadline.setDate(lotteryDeadline.getDate() - 1);
  lotteryDeadline.setHours(12, 0, 0, 0);

  const now = new Date();

  if (!currentUser) return '';

  if (currentUser.hasSub) {
    if (confirmed.length >= MAX_CAPACITY || now >= lotteryDeadline) return '✕';
    if (subsConfirmed.length >= MAX_SUBSCRIBERS) return '✕';
    if (subsConfirmed.length === 1) return '△';
    return '〇';
  } else {
    if (now >= lotteryDeadline) return '✕';
    if (confirmed.length >= MAX_CAPACITY) return '✕';
    if (nonsubsPending.length >= 3 || subsConfirmed.length >= MAX_SUBSCRIBERS) return '△';
    return '〇';
  }
}

  async function renderStatusLabels() {
    const reservations = await fetchReservations();
    const dayCells = calendarEl.querySelectorAll('.fc-daygrid-day');

    dayCells.forEach(cell => {
      const dateStr = cell.getAttribute('data-date');
      if (!dateStr) return;

      const existingLabel = cell.querySelector('.status-label');
      if (existingLabel) existingLabel.remove();

      const targetDate = new Date(dateStr);
      targetDate.setHours(0, 0, 0, 0);

      let label = '';
      if (currentUser && targetDate >= new Date()) {
        label = getStatusLabel(dateStr, '09:00', reservations);
      }

      const labelDiv = document.createElement('div');
      labelDiv.textContent = label;
      labelDiv.className = `status-label status-${label}`;
      cell.style.position = 'relative';
      cell.appendChild(labelDiv);
    });
  }

  function initCalendar() {
    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      initialDate: '2025-06-01',
      dayMaxEvents: true,
      events: [],
      datesSet: function () {
        renderStatusLabels();
      },
      dateClick: async function (info) {
        if (!currentUser) {
          alert('ログインしてください。');
          return;
        }
        const reservations = await fetchReservations();
        const label = getStatusLabel(info.dateStr, '09:00', reservations);
        const hasOwnReservation = reservations.some(r =>
          r.date === info.dateStr && r.name === currentUser.tiktokId
        );
        if (label === '✕'&& !hasOwnReservation) {
          alert('この日は予約できません。');
          return;
        }
        dateInput.value = info.dateStr;
        timeSelect.value = '09:00';
        reserveResult.textContent = '';
      },
      height: 'auto',
    });
    calendar.render();
    renderStatusLabels();
  }

  async function checkSession() {
    const res = await fetch('/session');
    const data = await res.json();
    const tiktokIdInput = document.getElementById('accountName');
    const accountTypeSelect = document.getElementById('account-type');
    const epicIdInput = document.getElementById('epicId');
    const subIdInput = document.getElementById('subId');
    if (data.loggedIn) {
      currentUser = data.user;
      tiktokIdInput.value = currentUser.tiktokId;
      accountTypeSelect.value = currentUser.accountType || 'tiktok';
      tiktokIdInput.disabled = true;
      epicIdInput.value = currentUser.epicId;
      epicIdInput.disabled = true;
      subIdInput.value = currentUser.subId || '';
      subIdInput.disabled = true;

      displayName.textContent = currentUser.tiktokId;
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-block';
      reserveForm.style.display = 'block';
      loginResult.textContent = `ログイン中: ${currentUser.tiktokId}（サブスク${currentUser.hasSub ? '有' : '無'}）`;
      await showTodayResult();
    } else {
      currentUser = null;
      displayName.textContent = '';
      tiktokIdInput.disabled = false;
      tiktokIdInput.value = '';
      epicIdInput.disabled = false;
      epicIdInput.value = '';
      subIdInput.disabled = false;
      subIdInput.value = '';

      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';
      reserveForm.style.display = 'none';
      loginResult.textContent = 'ログインしてください。';
      if (!menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        reservationList.innerHTML = '';
        reservationDetail.innerHTML = '';
      }
    }
    await calendar.refetchEvents();
    renderStatusLabels();
  }

  loginBtn.addEventListener('click', async () => {
    const tiktokId = document.getElementById('accountName').value.trim();
    const accountType = document.getElementById('account-type').value;
    const epicId = document.getElementById('epicId').value.trim();
    const subId = document.getElementById('subId').value.trim();

    if (!tiktokId || !epicId) {
      alert('アカウント名とEpic IDは必須です。');
      return;
    }

    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiktokId, epicId, subId, accountType }),

    });
    const data = await res.json();
    if (data.success) {
      await checkSession();
      calendar.refetchEvents();
      renderStatusLabels();
    } else {
      alert('ログインに失敗しました。');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/logout');
    await checkSession();
    calendar.refetchEvents();
    renderStatusLabels();
  });

  reserveBtn.addEventListener('click', async () => {
    if (!currentUser) {
      alert('ログインしてください。');
      return;
    }
    const date = dateInput.value;
    const time = timeSelect.value;
    if (!date || !time) {
      alert('予約日と時間を選択してください。');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(date);
    if (selectedDate < today) {
      alert('過去の日付には予約できません。');
      return;
    }

    if (!availableDates[date]) {
      alert('この日は予約できません。');
      return;
    }

    const res = await fetch('/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, time }),
    });
    const data = await res.json();
    reserveResult.textContent = data.message;
    await showTodayResult();
    calendar.refetchEvents();
    renderStatusLabels();
  });

  cancelBtn.addEventListener('click', async () => {
    if (!currentUser) {
      alert('ログインしてください。');
      return;
    }
    const date = dateInput.value;
    const time = timeSelect.value;
    if (!date || !time) {
      alert('キャンセル日と時間を選択してください。');
      return;
    }

    const confirmCancel = confirm(`「${date} ${time}」の予約を本当にキャンセルしますか？`);
    if (!confirmCancel) return;
    const res = await fetch('/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, time }),
    });
    const data = await res.json();
    reserveResult.textContent = data.message;
    await showTodayResult();
    calendar.refetchEvents();
    renderStatusLabels();
  });

  menuBtn.addEventListener('click', async () => {
    if (!currentUser) {
      alert('ログインしてください。');
      return;
    }
    menu.classList.toggle('hidden');

    //if (!menu.classList.contains('hidden')) {
      //await fetchAndDisplayMyReservations();
    if (!menu.classList.contains('hidden')) {
      if (currentUser.tiktokId === 'admin') {
        await fetchAndDisplayAllReservations(); // 管理者用全表示

        // 10秒おきに自動更新（すでにある場合はクリア）
      if (adminAutoRefreshInterval) clearInterval(adminAutoRefreshInterval);
      adminAutoRefreshInterval = setInterval(() => {
        fetchAndDisplayAllReservations();
      }, 10000); // 10000ms = 10秒
    } else {
      await fetchAndDisplayMyReservations();  // 一般ユーザー用
    }
    } else {
      reservationList.innerHTML = '';
      reservationDetail.innerHTML = '';
      if (adminAutoRefreshInterval) {
      clearInterval(adminAutoRefreshInterval);
      adminAutoRefreshInterval = null;
    }
    }
  });
  async function fetchAndDisplayAllReservations() {
  reservationList.innerHTML = '';
  reservationDetail.innerHTML = '';
  

  try {
    const res = await fetch('/admin/reservations');
    if (!res.ok) throw new Error('全予約取得失敗');
    const reservations = await res.json();

    if (reservations.length === 0) {
      const li = document.createElement('li');
      li.textContent = '予約はありません。';
      reservationList.appendChild(li);
      return;
    }

    reservations.forEach((r, index) => {
      const li = document.createElement('li');
      const statusLabel = r.status === 'pending' ? '⏳抽選待ち' :
                          r.status === 'confirmed' ? '✅確定' :
                          r.status === 'rejected' ? '❌落選' : '';

      li.innerHTML = `
        <div style="padding: 4px;">
          <span style="cursor: pointer;" data-index="${index}">
            ${r.name}｜${r.date} ${r.time}｜${statusLabel}
          </span>
        </div>
      `;

      li.querySelector('span').addEventListener('click', () => {
        showAdminReservationDetail(r);
      });

      reservationList.appendChild(li);
    });

    showAdminReservationDetail(reservations[0]);
  } catch {
    const li = document.createElement('li');
    li.textContent = '予約一覧の取得に失敗しました。';
    reservationList.appendChild(li);
  }
}
function showAdminReservationDetail(reservation) {
  const statusLabel = reservation.status === 'pending' ? '⏳抽選待ち' :
                      reservation.status === 'confirmed' ? '✅確定' :
                      reservation.status === 'rejected' ? '❌落選' : '';
  reservationDetail.innerHTML = `
    <p><strong>ユーザー：</strong>${reservation.name}</p>
    <p><strong>予約日時：</strong>${reservation.date} ${reservation.time} ${statusLabel}</p>
    <p><strong>Epic ID：</strong>${reservation.epicId}</p>
    <p><strong>Sub ID：</strong>${reservation.subId}</p>
    <p><strong>サブスク：</strong>${reservation.hasSub ? '有' : '無'}</p>
  `;
}


  async function fetchAndDisplayMyReservations() {
  reservationList.innerHTML = '';
  reservationDetail.innerHTML = '';

  try {
    const res = await fetch('/my-reservations');
    if (!res.ok) throw new Error('予約一覧取得失敗');
    const reservations = await res.json();

    if (reservations.length === 0) {
      const li = document.createElement('li');
      li.textContent = '予約はありません。';
      reservationList.appendChild(li);
      return;
    }

    reservations.forEach((r, index) => {
      const li = document.createElement('li');
      const statusLabel = r.status === 'pending' ? '⏳抽選待ち' :
                          r.status === 'confirmed' ? '✅確定' :
                          r.status === 'rejected' ? '❌落選' : '';

      li.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="flex-grow: 1; cursor: pointer;" data-index="${index}">
            ${r.date} ${r.time} ${statusLabel}
          </span>
          <button class="cancel-inline-btn" style="font-size: 12px; padding: 2px 6px;" data-date="${r.date}" data-time="${r.time}">キャンセル</button>
        </div>
      `;

      li.querySelector('span').addEventListener('click', () => {
        showReservationDetail(r);
      });

      li.querySelector('.cancel-inline-btn').addEventListener('click', async () => {
        const confirmCancel = confirm(`「${r.date} ${r.time}」の予約を本当にキャンセルしますか？`);
        if (!confirmCancel) return;

        const cancelRes = await fetch('/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: r.date, time: r.time })
        });

        const cancelData = await cancelRes.json();
        alert(cancelData.message);

        await fetchAndDisplayMyReservations();  // 一覧を再取得
        renderStatusLabels();                   // カレンダー更新
      });

      reservationList.appendChild(li);
    });

    showReservationDetail(reservations[0]);
  } catch {
    const li = document.createElement('li');
    li.textContent = '予約一覧の取得に失敗しました。';
    reservationList.appendChild(li);
  }
}

  function showReservationDetail(reservation) {
    const statusLabel = reservation.status === 'pending' ? '⏳抽選待ち' :
                        reservation.status === 'confirmed' ? '✅確定' :
                        reservation.status === 'rejected' ? '❌落選' : '';
    reservationDetail.innerHTML = `
      <p><strong>予約日時：</strong>${reservation.date} ${reservation.time} ${statusLabel}</p>
      <p><strong>Epic ID：</strong>${currentUser.epicId}</p>
    `;
  }
  async function showTodayResult() {
  const res = await fetch('/my-today-result');
  const data = await res.json();

  const notice = document.getElementById('notice-content');

  if (data.status === 'confirmed') {
    notice.innerHTML = `🎉 本日 ${data.time} の抽選に当選しました！（確定）`;
  } else if (data.status === 'rejected') {
    notice.innerHTML = `😢 本日 ${data.time} の抽選は落選しました。`;
  } else if (data.status === 'pending') {
    notice.innerHTML = `⏳ 本日 ${data.time} の抽選結果はまだ確定していません。`;
  } else {
    notice.innerHTML = '📭 本日の抽選予約はありません。';
  }
}

  initCalendar();
  checkSession();
});*/

document.addEventListener('DOMContentLoaded', function () {
  const calendarEl = document.getElementById('calendar');
  const reserveBtn = document.getElementById('reserve-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const dateInput = document.getElementById('reserve-date');
  const timeSelect = document.getElementById('reserve-time');
  const reserveResult = document.getElementById('reserve-result');

  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const loginResult = document.getElementById('login-result');
  const reserveForm = document.getElementById('reserve-form');
  const displayName = document.getElementById('display-name');

  const menuBtn = document.getElementById('menu-btn');
  const menu = document.getElementById('menu');
  const reservationList = document.getElementById('reservation-list');
  const reservationDetail = document.getElementById('reservation-detail');

  const MAX_CAPACITY = 3;
  const MAX_SUBSCRIBERS = 2;

  const statusColors = {
    '〇': 'green',
    '△': 'orange',
    '✕': 'red',
  };

  let currentUser = null;
  let calendar = null;
  let adminAutoRefreshInterval = null;

  const availableDates = {
    '2025-06-17': true,
    '2025-06-18': true,
    '2025-06-19': true,
    '2025-06-20': true,
    '2025-06-21': true,
    '2025-06-22': true,
    '2025-06-23': true,
    '2025-06-24': true,
    '2025-06-25': true,
    '2025-06-26': true,
    '2025-06-27': true,
    '2025-06-28': true,
    '2025-06-29': true,
    '2025-06-30': true,
  };

  // --- 追加 ---  
  // 日付選択(input[type=date])のminとmaxを動的セット（翌日〜月末）
  (function setDateInputRange() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const minDate = `${yyyy}-${mm}-${dd}`;

    const lastDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth() + 1, 0);
    const maxDate = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

    dateInput.min = minDate;
    dateInput.max = maxDate;
  })();

  function parseTimeRange(range) {
    const [start, end] = range.split('-');
    const startHour = parseInt(start.split(':')[0]);
    const endHour = parseInt(end.split(':')[0]);
    const result = [];
    for (let h = startHour; h < endHour; h++) {
      result.push(h.toString().padStart(2, '0') + ':00');
    }
    return result;
  }

  async function fetchReservations() {
    try {
      const res = await fetch('/reservations');
      if (!res.ok) throw new Error('予約取得失敗');
      return await res.json();
    } catch {
      return [];
    }
  }

  function getStatusLabel(dateStr, _, reservations) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(dateStr);
    targetDate.setHours(0, 0, 0, 0);

    if (targetDate < today || !availableDates[dateStr]) return '✕';

    const relevant = reservations.filter(r => r.date === dateStr);
    const confirmed = relevant.filter(r => r.status === 'confirmed');
    const subsConfirmed = confirmed.filter(r => Number(r.hassub) === 1);
    const nonsubsPending = relevant.filter(r => !r.hassub && r.status === 'pending');

    const lotteryDeadline = new Date(targetDate);
    lotteryDeadline.setDate(lotteryDeadline.getDate() - 1);
    lotteryDeadline.setHours(12, 0, 0, 0);

    const now = new Date();

    if (!currentUser) return '';

    if (currentUser.hasSub) {
      if (confirmed.length >= MAX_CAPACITY || now >= lotteryDeadline) return '✕';
      if (subsConfirmed.length >= MAX_SUBSCRIBERS) return '✕';
      if (subsConfirmed.length === 1) return '△';
      return '〇';
    } else {
      if (now >= lotteryDeadline) return '✕';
      if (confirmed.length >= MAX_CAPACITY) return '✕';
      if (nonsubsPending.length >= 3 || subsConfirmed.length >= MAX_SUBSCRIBERS) return '△';
      return '〇';
    }
  }

  async function renderStatusLabels() {
    const reservations = await fetchReservations();
    const dayCells = calendarEl.querySelectorAll('.fc-daygrid-day');

    dayCells.forEach(cell => {
      const dateStr = cell.getAttribute('data-date');
      if (!dateStr) return;

      const existingLabel = cell.querySelector('.status-label');
      if (existingLabel) existingLabel.remove();

      const targetDate = new Date(dateStr);
      targetDate.setHours(0, 0, 0, 0);

      let label = '';
      if (currentUser && targetDate >= new Date().setHours(0,0,0,0)) {
        label = getStatusLabel(dateStr, '09:00', reservations);
      }

      const labelDiv = document.createElement('div');
      labelDiv.textContent = label;
      labelDiv.className = `status-label status-${label}`;
      cell.style.position = 'relative';
      cell.appendChild(labelDiv);
    });
  }

  function initCalendar() {
    // カレンダーの初期日付を「今日」か「翌日」にする例
    const today = new Date();
    const initDate = today.getDate() < 28 ? today : new Date(today.getFullYear(), today.getMonth(), 1);

    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      initialDate: initDate.toISOString().slice(0, 10),
      dayMaxEvents: true,
      events: [],
      datesSet: function () {
        renderStatusLabels();
      },
      dateClick: async function (info) {
        if (!currentUser) {
          alert('ログインしてください。');
          return;
        }

        // 日付制限（min, maxはinputにも設定済みだが念のため）
        const minDate = new Date(dateInput.min);
        const maxDate = new Date(dateInput.max);
        const clickedDate = new Date(info.dateStr);

        if (clickedDate < minDate || clickedDate > maxDate) {
          alert('予約可能な日付を選択してください。');
          return;
        }

        const reservations = await fetchReservations();
        const label = getStatusLabel(info.dateStr, '09:00', reservations);
        const hasOwnReservation = reservations.some(r =>
          r.date === info.dateStr && r.name === currentUser.tiktokId
        );
        if (label === '✕' && !hasOwnReservation) {
          alert('この日は予約できません。');
          return;
        }
        dateInput.value = info.dateStr;
        timeSelect.value = '09:00';
        reserveResult.textContent = '';
      },
      height: 'auto',
    });
    calendar.render();
    renderStatusLabels();
  }

  async function checkSession() {
    const res = await fetch('/session');
    const data = await res.json();
    const tiktokIdInput = document.getElementById('accountName');
    const accountTypeSelect = document.getElementById('account-type');
    const epicIdInput = document.getElementById('epicId');
    const subIdInput = document.getElementById('subId');
    if (data.loggedIn) {
      currentUser = data.user;
      tiktokIdInput.value = currentUser.tiktokId;
      accountTypeSelect.value = currentUser.accountType || 'tiktok';
      tiktokIdInput.disabled = true;
      epicIdInput.value = currentUser.epicId;
      epicIdInput.disabled = true;
      subIdInput.value = currentUser.subId || '';
      subIdInput.disabled = true;

      displayName.textContent = currentUser.tiktokId;
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-block';
      reserveForm.style.display = 'block';
      loginResult.textContent = `ログイン中: ${currentUser.tiktokId}（サブスク${currentUser.hasSub ? '有' : '無'}）`;
      await showTodayResult();
    } else {
      currentUser = null;
      displayName.textContent = '';
      tiktokIdInput.disabled = false;
      tiktokIdInput.value = '';
      epicIdInput.disabled = false;
      epicIdInput.value = '';
      subIdInput.disabled = false;
      subIdInput.value = '';

      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';
      reserveForm.style.display = 'none';
      loginResult.textContent = 'ログインしてください。';
      if (!menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        reservationList.innerHTML = '';
        reservationDetail.innerHTML = '';
      }
    }
    await calendar.refetchEvents();
    renderStatusLabels();
  }

  loginBtn.addEventListener('click', async () => {
    const tiktokId = document.getElementById('accountName').value.trim();
    const accountType = document.getElementById('account-type').value;
    const epicId = document.getElementById('epicId').value.trim();
    const subId = document.getElementById('subId').value.trim();

    if (!tiktokId || !epicId) {
      alert('アカウント名とEpic IDは必須です。');
      return;
    }

    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiktokId, epicId, subId, accountType }),

    });
    const data = await res.json();
    if (data.success) {
      await checkSession();
      calendar.refetchEvents();
      renderStatusLabels();
    } else {
      alert('ログインに失敗しました。');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/logout');
    await checkSession();
    calendar.refetchEvents();
    renderStatusLabels();
  });

  reserveBtn.addEventListener('click', async () => {
    if (!currentUser) {
      alert('ログインしてください。');
      return;
    }
    const date = dateInput.value;
    const time = timeSelect.value;
    if (!date || !time) {
      alert('予約日と時間を選択してください。');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(date);
    if (selectedDate < today) {
      alert('過去の日付には予約できません。');
      return;
    }

    if (!availableDates[date]) {
      alert('この日は予約できません。');
      return;
    }

    const res = await fetch('/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, time }),
    });
    const data = await res.json();
    reserveResult.textContent = data.message;
    await showTodayResult();
    calendar.refetchEvents();
    renderStatusLabels();
  });

  cancelBtn.addEventListener('click', async () => {
    if (!currentUser) {
      alert('ログインしてください。');
      return;
    }
    const date = dateInput.value;
    const time = timeSelect.value;
    if (!date || !time) {
      alert('キャンセル日と時間を選択してください。');
      return;
    }

    const confirmCancel = confirm(`「${date} ${time}」の予約を本当にキャンセルしますか？`);
    if (!confirmCancel) return;
    const res = await fetch('/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, time }),
    });
    const data = await res.json();
    reserveResult.textContent = data.message;
    await showTodayResult();
    calendar.refetchEvents();
    renderStatusLabels();
  });

  menuBtn.addEventListener('click', async () => {
    if (!currentUser) {
      alert('ログインしてください。');
      return;
    }
    menu.classList.toggle('hidden');

    if (!menu.classList.contains('hidden')) {
      if (currentUser.tiktokId === 'admin') {
        await fetchAndDisplayAllReservations();

        if (adminAutoRefreshInterval) clearInterval(adminAutoRefreshInterval);
        adminAutoRefreshInterval = setInterval(() => {
          fetchAndDisplayAllReservations();
        }, 10000);
      } else {
        await fetchAndDisplayMyReservations();
      }
    } else {
      reservationList.innerHTML = '';
      reservationDetail.innerHTML = '';
      if (adminAutoRefreshInterval) {
        clearInterval(adminAutoRefreshInterval);
        adminAutoRefreshInterval = null;
      }
    }
  });

  async function fetchAndDisplayAllReservations() {
    reservationList.innerHTML = '';
    reservationDetail.innerHTML = '';

    try {
      const res = await fetch('/admin/reservations');
      if (!res.ok) throw new Error('全予約取得失敗');
      const reservations = await res.json();

      if (reservations.length === 0) {
        const li = document.createElement('li');
        li.textContent = '予約はありません。';
        reservationList.appendChild(li);
        return;
      }

      reservations.forEach((r, index) => {
        const li = document.createElement('li');
        const statusLabel = r.status === 'pending' ? '⏳抽選待ち' :
                            r.status === 'confirmed' ? '✅確定' :
                            r.status === 'rejected' ? '❌落選' : '';

        li.innerHTML = `
          <div style="padding: 4px;">
            <span style="cursor: pointer;" data-index="${index}">
              ${r.name}｜${r.date} ${r.time}｜${statusLabel}
            </span>
          </div>
        `;

        li.querySelector('span').addEventListener('click', () => {
          showAdminReservationDetail(r);
        });

        reservationList.appendChild(li);
      });

      showAdminReservationDetail(reservations[0]);
    } catch {
      const li = document.createElement('li');
      li.textContent = '予約一覧の取得に失敗しました。';
      reservationList.appendChild(li);
    }
  }

  function showAdminReservationDetail(reservation) {
    const statusLabel = reservation.status === 'pending' ? '⏳抽選待ち' :
                        reservation.status === 'confirmed' ? '✅確定' :
                        reservation.status === 'rejected' ? '❌落選' : '';
    reservationDetail.innerHTML = `
      <p><strong>ユーザー：</strong>${reservation.name}</p>
      <p><strong>予約日時：</strong>${reservation.date} ${reservation.time} ${statusLabel}</p>
      <p><strong>Epic ID：</strong>${reservation.epicid}</p>
      <p><strong>Sub ID：</strong>${reservation.subid}</p>
      <p><strong>サブスク：</strong>${reservation.hassub ? '有' : '無'}</p>
      <p><strong>アカウント：</strong>${reservation.accounttype}</p>
    `;
  }

  async function fetchAndDisplayMyReservations() {
    reservationList.innerHTML = '';
    reservationDetail.innerHTML = '';

    try {
      const res = await fetch('/my-reservations');
      if (!res.ok) throw new Error('予約一覧取得失敗');
      const reservations = await res.json();

      if (reservations.length === 0) {
        const li = document.createElement('li');
        li.textContent = '予約はありません。';
        reservationList.appendChild(li);
        return;
      }

      reservations.forEach((r, index) => {
        const li = document.createElement('li');
        const statusLabel = r.status === 'pending' ? '⏳抽選待ち' :
                            r.status === 'confirmed' ? '✅確定' :
                            r.status === 'rejected' ? '❌落選' : '';

        li.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="flex-grow: 1; cursor: pointer;" data-index="${index}">
              ${r.date} ${r.time} ${statusLabel}
            </span>
            <button class="cancel-inline-btn" style="font-size: 12px; padding: 2px 6px;" data-date="${r.date}" data-time="${r.time}">キャンセル</button>
          </div>
        `;

        li.querySelector('span').addEventListener('click', () => {
          showReservationDetail(r);
        });

        li.querySelector('.cancel-inline-btn').addEventListener('click', async () => {
          const confirmCancel = confirm(`「${r.date} ${r.time}」の予約を本当にキャンセルしますか？`);
          if (!confirmCancel) return;

          const cancelRes = await fetch('/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: r.date, time: r.time })
          });

          const cancelData = await cancelRes.json();
          alert(cancelData.message);

          await fetchAndDisplayMyReservations();
          renderStatusLabels();
        });

        reservationList.appendChild(li);
      });

      showReservationDetail(reservations[0]);
    } catch {
      const li = document.createElement('li');
      li.textContent = '予約一覧の取得に失敗しました。';
      reservationList.appendChild(li);
    }
  }

  function showReservationDetail(reservation) {
    const statusLabel = reservation.status === 'pending' ? '⏳抽選待ち' :
                        reservation.status === 'confirmed' ? '✅確定' :
                        reservation.status === 'rejected' ? '❌落選' : '';
    reservationDetail.innerHTML = `
      <p><strong>予約日時：</strong>${reservation.date} ${reservation.time} ${statusLabel}</p>
      <p><strong>Epic ID：</strong>${currentUser.epicId}</p>
    `;
  }

  async function showTodayResult() {
    const res = await fetch('/my-today-result');
    const data = await res.json();

    const notice = document.getElementById('notice-content');

    if (data.status === 'confirmed') {
      notice.innerHTML = `🎉 本日 ${data.time} の抽選に当選しました！（確定）`;
    } else if (data.status === 'rejected') {
      notice.innerHTML = `😢 本日 ${data.time} の抽選は落選しました。`;
    } else if (data.status === 'pending') {
      notice.innerHTML = `⏳ 本日 ${data.time} の抽選結果はまだ確定していません。`;
    } else {
      notice.innerHTML = '📭 本日の抽選予約はありません。';
    }
  }

  initCalendar();
  checkSession();

  /*const relevant = reservations.filter(r => {
    if (r.date !== dateStr) return false;
    const hours = parseTimeRange(r.time);
    return hours.includes(timeStr); // '09:00' に含まれるか
  });*/
});

