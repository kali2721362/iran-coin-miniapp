'use strict';

/**
 * IRAN Coin Miniapp - app.js
 * Backend endpoints expected (FastAPI):
 *  GET  /api/v1/user/{user_id}
 *  POST /api/v1/tap            { user_id, count }
 *  POST /api/v1/mine           { user_id }
 *  POST /api/v1/withdraw       { telegram_id, wallet_address, amount }
 *  GET  /api/v1/ads/watch?telegram_id=...
 *  GET  /api/v1/ads/monetag?telegram_id=...&source=...&reward=...
 *  POST /api/v1/spin           { user_id, prize }
 *  POST /api/v1/streak         { user_id, day, reward }
 *  POST /api/v1/check_member   { user_id, channel, reward, task_id }
 */

const CONFIG = {
  API_URL: 'https://iran-coin-bot-production-222d.up.railway.app/api/v1', // ✅ دامنه درست بک‌اند
  BOT_USERNAME: 'IranCoinEarnBot',
  IRAN_TO_TON_RATE: 0.000002,

  // gameplay ui defaults
  TAP_ENERGY_COST: 1,
  ENERGY_REGEN_PER_SEC: 2,

  // rewards (server caps spin prize to 100 in your backend)
  SPIN_REWARDS: [10, 20, 50, 100],
  STREAK_REWARD: 10,

  // ads (backend fixed rewards: watch=50, monetag max=25)
  MONETAG_REWARD: 25,

  // optional: اگر لینک CPX offerwall داری اینجا بذار
  // مثال قالب: 'https://offers.cpx-research.com/index.php?app_id=XXXX&ext_user_id={user_id}&secure_hash=YYYY'
  CPX_OFFERWALL_URL_TEMPLATE: ''
};

const TG = window.Telegram?.WebApp;

const state = {
  user: null,
  page: 'home',
  prev: 'home',
  energy: 1000,
  maxEnergy: 1000,

  // tap batching
  pendingTaps: 0,
  flushTimer: null,
  flushing: false,

  // spin
  spinning: false,
  wheelRotation: 0
};

function fmtCoins(n) {
  const x = Number(n || 0);
  return x.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtTONFromCoins(coins) {
  const ton = Number(coins || 0) * CONFIG.IRAN_TO_TON_RATE;
  return ton.toFixed(4);
}

function toast(msg, type = 'ok') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.style.cssText =
    `position:fixed; top:18px; left:50%; transform:translateX(-50%);` +
    `background:${type === 'ok' ? '#10b981' : '#ef4444'}; color:white;` +
    `padding:10px 16px; border-radius:18px; font-weight:800; z-index:9999; font-size:13px;` +
    `max-width:92vw; text-align:center;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function qs(name) {
  return new URL(location.href).searchParams.get(name);
}

async function apiGet(path) {
  const r = await fetch(CONFIG.API_URL + path, { method: 'GET' });
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(CONFIG.API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return r.json();
}

async function refreshUser() {
  const id = state.user?.telegram_id;
  if (!id) return;
  const res = await apiGet(`/user/${id}`);
  state.user = res || state.user;

  state.maxEnergy = Number(res?.max_energy || state.maxEnergy || 1000);
  if (state.energy > state.maxEnergy) state.energy = state.maxEnergy;
}

async function init() {
  if (TG) {
    TG.ready();
    TG.expand();
  }

  const tgUser = TG?.initDataUnsafe?.user;
  const userId = tgUser?.id;

  // اگر خارج از تلگرام باز شد
  if (!userId) {
    state.user = { telegram_id: 111111, username: 'demo', balance: 1250, tasks: [] };
    state.maxEnergy = 1000;
    state.energy = 1000;
    return;
  }

  // از بک‌اند خودت اطلاعات کاربر رو می‌گیریم
  const res = await apiGet(`/user/${userId}`);
  state.user = res || { telegram_id: userId, balance: 0, tasks: [] };

  state.maxEnergy = Number(res?.max_energy || 1000);
  state.energy = state.maxEnergy;
}

/* ========= Navigation / UI ========= */

function openApp(page) {
  document.getElementById('splash')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');
  navTo(page || 'home');
}

function setBackVisible(v) {
  const b = document.getElementById('backBtn');
  if (b) b.classList.toggle('hidden', !v);
}

function navTo(page) {
  state.prev = state.page;
  state.page = page;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  setBackVisible(page !== 'home');

  const root = document.getElementById('page');
  if (!root) return;
  root.innerHTML = '';

  if (page === 'home') renderHome(root);
  else if (page === 'ads') renderAds(root);
  else if (page === 'miner') renderMiner(root);
  else if (page === 'tasks') renderTasks(root);
  else if (page === 'wallet') renderWallet(root);
  else if (page === 'withdraw') renderWithdraw(root);
  else renderHome(root);
}

function goBack() {
  navTo(state.prev || 'home');
}

/* ========= Pages ========= */

function renderHome(root) {
  const u = state.user || {};
  const ton = fmtTONFromCoins(u.balance);

  root.innerHTML = `
    <div class="card">
      <div class="row">
        <div style="display:flex; align-items:center; gap:10px;">
          <img src="https://flagcdn.com/w80/ir.png" style="width:32px; height:32px; border-radius:50%;" />
          <div>
            <div class="title">IRAN Coin</div>
            <div class="sub">Together for a better future 🇮🇷</div>
          </div>
        </div>
      </div>

      <div class="balance">
        <div class="coin-sm"><img src="assets/miner-new.png" alt="coin" /></div>
        <div class="btxt">
          <div class="blabel">Your Balance</div>
          <div class="bamount">${fmtCoins(u.balance)} <span>IRAN</span></div>
          <div class="bton">≈ ${ton} TON</div>
        </div>
      </div>

      <div class="grid">
        <div class="tile" onclick="navTo('ads')">
          <div class="tico">▶</div><div class="tname">Watch Ads</div><div class="tsub">Earn Coins</div>
        </div>
        <div class="tile" onclick="navTo('tasks')">
          <div class="tico">✓</div><div class="tname">Tasks</div><div class="tsub">Sponsor Tasks</div>
        </div>
        <div class="tile" onclick="shareReferral()">
          <div class="tico">👥</div><div class="tname">Invite Friends</div><div class="tsub">+50 IRAN</div>
        </div>
        <div class="tile" onclick="claimStreak()">
          <div class="tico">🎁</div><div class="tname">Daily Bonus</div><div class="tsub">+${CONFIG.STREAK_REWARD} IRAN</div>
        </div>
      </div>

      <div style="margin-top:12px; display:flex; gap:10px;">
        <button class="btn" style="flex:1" onclick="navTo('miner')">⛏ Miner</button>
        <button class="btn" style="flex:1" onclick="claimMine()">⛏ Mine</button>
      </div>
    </div>

    <div class="card" style="text-align:center;">
      <div class="title">🎡 Daily Lucky Spin</div>
      <div class="sub" style="margin-bottom:10px;">Try your luck once per day</div>

      <div style="position: relative; width: 220px; height: 240px; margin: 10px auto;">
        <div style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 20px solid #ef4444; z-index: 10;"></div>
        <canvas id="wheelCanvas" width="220" height="220"
          style="border-radius: 50%; transition: transform 4s cubic-bezier(0.15, 0.85, 0.35, 1.2);"></canvas>
      </div>

      <button id="spinBtn" class="btn" onclick="spinWheel()" style="width:85%;">Spin 🎰</button>
    </div>
  `;

  setTimeout(() => drawWheel(), 50);
}

function renderMiner(root) {
  const u = state.user || {};
  root.innerHTML = `
    <div class="card" style="text-align:center;">
      <div class="title">⛏ Tap-Tap Miner</div>
      <div class="sub">Tap the coin to earn</div>

      <div class="balance" style="justify-content:center; margin:15px 0;">
        <div class="bamount" id="minerBal">${fmtCoins(u.balance)} <span>IRAN</span></div>
      </div>

      <div class="tap-area">
        <img id="tapCoin" src="assets/miner-new.png" class="tap-coin" onclick="handleTap(event)" />
      </div>

      <div style="margin-top:15px;">
        <div class="row">
          <span style="font-size:12px; color:#94a3b8;">⚡ Energy</span>
          <span style="font-size:12px; font-weight:bold;" id="energyText">${state.energy} / ${state.maxEnergy}</span>
        </div>
        <div class="energy-bar">
          <div class="energy-fill" id="energyFill" style="width:${(state.energy / state.maxEnergy) * 100}%;"></div>
        </div>
      </div>
    </div>
  `;
}

function renderAds(root) {
  root.innerHTML = `
    <div class="card">
      <div class="title">Ads</div>
      <div class="sub" style="margin-bottom:12px;">Watch ads to earn coins</div>

      <div class="row" style="margin-bottom:10px; background:rgba(255,255,255,0.03); padding:10px; border-radius:12px;">
        <div>
          <div style="font-size:13px; font-weight:bold;">Video Ad</div>
          <div style="font-size:11px; color:#10b981;">Reward: +50 IRAN</div>
        </div>
        <button class="btn" onclick="watchAd()">Watch</button>
      </div>

      <div class="row" style="margin-bottom:10px; background:rgba(255,255,255,0.03); padding:10px; border-radius:12px;">
        <div>
          <div style="font-size:13px; font-weight:bold;">Monetag</div>
          <div style="font-size:11px; color:#10b981;">Reward: +${CONFIG.MONETAG_REWARD} IRAN</div>
        </div>
        <button class="btn" onclick="watchMonetag()">Open</button>
      </div>

      <div class="row" style="background:rgba(255,255,255,0.03); padding:10px; border-radius:12px;">
        <div>
          <div style="font-size:13px; font-weight:bold;">Surveys (CPX)</div>
          <div style="font-size:11px; color:#f59e0b;">Earn USD → coins</div>
        </div>
        <button class="btn" onclick="openCPXOfferwall()">Open</button>
      </div>
    </div>
  `;
}

function renderTasks(root) {
  const tasks = state.user?.tasks || [];
  root.innerHTML = `
    <div class="card">
      <div class="title">Tasks</div>
      <div class="sub" style="margin-bottom:12px;">Join & check membership</div>
      <div id="taskBox"></div>
    </div>
  `;

  const box = document.getElementById('taskBox');
  if (!box) return;

  if (!tasks.length) {
    box.innerHTML = `<div class="sub">No tasks available right now.</div>`;
    return;
  }

  box.innerHTML = tasks.map(t => `
    <div class="row" style="margin-bottom:10px; background:rgba(255,255,255,0.03); padding:10px; border-radius:12px;">
      <div style="flex:1">
        <div style="font-size:13px; font-weight:bold;">${t.title}</div>
        <div style="font-size:11px; color:#f59e0b;">+${t.reward} IRAN</div>
      </div>
      <button class="btn" onclick="openTaskLink('${escapeHtml(t.link)}')">Join</button>
      <button class="btn" style="margin-left:8px" onclick="checkTask(${t.id}, '${escapeHtml(t.channel)}', ${t.reward})">Check</button>
    </div>
  `).join('');
}

function renderWallet(root) {
  const u = state.user || {};
  root.innerHTML = `
    <div class="card">
      <div class="title">Wallet</div>
      <div class="sub" style="margin-bottom:8px;">Withdraw your coins to TON wallet</div>

      <div class="balance">
        <div class="btxt">
          <div class="blabel">Balance</div>
          <div class="bamount">${fmtCoins(u.balance)} <span>IRAN</span></div>
          <div class="bton">≈ ${fmtTONFromCoins(u.balance)} TON</div>
        </div>
      </div>

      <button class="btn" style="width:100%; font-size:16px; padding:14px;" onclick="navTo('withdraw')">🚀 Withdraw</button>
    </div>
  `;
}

function renderWithdraw(root) {
  root.innerHTML = `
    <div class="card">
      <div class="title">Withdraw</div>
      <div class="sub" style="margin-bottom:10px;">Minimum 10,000 IRAN</div>

      <input id="tonAddr"
        style="width:100%; padding:12px; margin:10px 0; border-radius:10px; border:1px solid #334155; background:#071018; color:white;"
        placeholder="Enter TON address (UQ...)" />

      <input id="wdAmount" type="number"
        style="width:100%; padding:12px; margin-bottom:10px; border-radius:10px; border:1px solid #334155; background:#071018; color:white;"
        placeholder="Amount (min 10000)" />

      <button class="btn" style="width:100%;" onclick="requestWithdraw()">Request Withdrawal</button>
    </div>
  `;
}

/* ========= Actions ========= */

function handleTap(e) {
  if (!state.user?.telegram_id) return;

  if (state.energy <= 0) {
    toast("Energy is empty. Wait...", "err");
    return;
  }

  // optimistic UI
  state.energy -= CONFIG.TAP_ENERGY_COST;
  state.pendingTaps += 1;

  // floating +1 animation
  const float = document.createElement('div');
  float.className = 'floating-num';
  float.innerText = '+1';
  float.style.position = 'fixed';
  float.style.left = `${(e?.clientX || 0) - 10}px`;
  float.style.top = `${(e?.clientY || 0) - 20}px`;
  float.style.color = '#f5b300';
  float.style.fontWeight = '900';
  float.style.zIndex = '9999';
  document.body.appendChild(float);
  setTimeout(() => float.remove(), 700);

  // energy UI update
  updateEnergyUI();

  if (TG) TG.HapticFeedback?.impactOccurred('light');

  // schedule flush
  if (!state.flushTimer) {
    state.flushTimer = setTimeout(flushTaps, 450);
  }
}

async function flushTaps() {
  state.flushTimer = null;
  if (state.flushing) return;
  if (!state.user?.telegram_id) return;

  const count = state.pendingTaps;
  if (count <= 0) return;

  state.flushing = true;
  state.pendingTaps = 0;

  try {
    const res = await apiPost('/tap', { user_id: state.user.telegram_id, count });

    if (res?.status === 'ok') {
      // sync from server to avoid mismatch
      await refreshUser();
      updateBalanceUI();
    } else if (res?.status === 'blocked') {
      toast(res?.reason || 'Tap blocked', 'err');
      await refreshUser();
      updateBalanceUI();
    } else {
      await refreshUser();
      updateBalanceUI();
    }
  } catch (e) {
    // restore by syncing
    await refreshUser();
    updateBalanceUI();
  } finally {
    state.flushing = false;
  }
}

async function claimMine() {
  if (!state.user?.telegram_id) return;

  try {
    const res = await apiPost('/mine', { user_id: state.user.telegram_id });

    if (res?.status === 'success') {
      toast(`+${fmtCoins(res.coins_added)} mined`, 'ok');
      await refreshUser();
      rerenderIfHomeOrMiner();
    } else if (res?.status === 'not_ready') {
      toast(res?.message || 'Not ready', 'err');
    } else {
      toast('Mine error', 'err');
    }
  } catch {
    toast('Mine error', 'err');
  }
}

async function watchAd() {
  if (!state.user?.telegram_id) return;

  try {
    const res = await apiGet(`/ads/watch?telegram_id=${encodeURIComponent(state.user.telegram_id)}`);

    if (res?.status === 'rewarded') {
      toast(`+${fmtCoins(res.coins || 50)} IRAN`, 'ok');
      await refreshUser();
      rerenderIfHomeOrMiner();
    } else if (res?.status === 'limited') {
      toast(res?.message || 'Ad limit reached', 'err');
    } else {
      toast('Ad error', 'err');
    }
  } catch {
    toast('Ad error', 'err');
  }
}

async function watchMonetag() {
  if (!state.user?.telegram_id) return;

  try {
    const res = await apiGet(`/ads/monetag?telegram_id=${encodeURIComponent(state.user.telegram_id)}&source=miniapp&reward=${CONFIG.MONETAG_REWARD}`);

    if (res?.status === 'rewarded') {
      toast(`+${fmtCoins(res.coins || CONFIG.MONETAG_REWARD)} IRAN`, 'ok');
      await refreshUser();
      rerenderIfHomeOrMiner();
    } else if (res?.status === 'limited') {
      toast('Ad limit reached', 'err');
    } else {
      toast('Monetag error', 'err');
    }
  } catch {
    toast('Monetag error', 'err');
  }
}

function openCPXOfferwall() {
  if (!state.user?.telegram_id) return;

  if (!CONFIG.CPX_OFFERWALL_URL_TEMPLATE) {
    toast("CPX URL is not set in app.js", "err");
    return;
  }

  const url = CONFIG.CPX_OFFERWALL_URL_TEMPLATE.replace('{user_id}', String(state.user.telegram_id));
  if (TG?.openLink) TG.openLink(url);
  else window.open(url, '_blank');
}

function openTaskLink(url) {
  if (!url) return;
  if (TG?.openLink) TG.openLink(url);
  else window.open(url, '_blank');
}

async function checkTask(taskId, channel, reward) {
  if (!state.user?.telegram_id) return;

  try {
    const res = await apiPost('/check_member', {
      user_id: state.user.telegram_id,
      channel,
      reward,
      task_id: String(taskId)
    });

    if (res?.success) {
      toast(`Task completed! +${fmtCoins(reward)} IRAN`, 'ok');
      await refreshUser();
      navTo('tasks');
    } else {
      toast('Join first, then press Check', 'err');
    }
  } catch {
    toast('Task check error', 'err');
  }
}

async function requestWithdraw() {
  const addr = document.getElementById('tonAddr')?.value?.trim();
  const amount = Number(document.getElementById('wdAmount')?.value || 0);

  if (!state.user?.telegram_id) return toast('No user', 'err');
  if (!addr) return toast('Enter wallet address', 'err');
  if (amount < 10000) return toast('Minimum 10,000 coins', 'err');

  try {
    const res = await apiPost('/withdraw', {
      telegram_id: state.user.telegram_id,
      wallet_address: addr,
      amount
    });

    if (res?.status === 'success') {
      toast('Withdrawal request sent', 'ok');
      await refreshUser();
      navTo('wallet');
    } else {
      toast(res?.message || 'Withdraw error', 'err');
    }
  } catch {
    toast('Withdraw error', 'err');
  }
}

async function claimStreak() {
  if (!state.user?.telegram_id) return;

  // simple local once-per-day lock
  const key = `streak_${state.user.telegram_id}`;
  const today = new Date().toISOString().slice(0, 10);
  const last = localStorage.getItem(key);
  if (last === today) {
    toast('Already claimed today', 'err');
    return;
  }

  try {
    await apiPost('/streak', {
      user_id: state.user.telegram_id,
      day: 1,
      reward: CONFIG.STREAK_REWARD
    });
    localStorage.setItem(key, today);
    toast(`+${CONFIG.STREAK_REWARD} IRAN`, 'ok');
    await refreshUser();
    rerenderIfHomeOrMiner();
  } catch {
    toast('Streak error', 'err');
  }
}

function shareReferral() {
  const id = state.user?.telegram_id;
  if (!id) return;

  const link = `https://t.me/${CONFIG.BOT_USERNAME}?start=ref_${id}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("🚀 Join IRAN Coin and earn coins!")}`;

  if (TG?.openTelegramLink) TG.openTelegramLink(shareUrl);
  else window.open(shareUrl, '_blank');
}

/* ========= Wheel (Spin) ========= */

const wheelColors = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444'];

function drawWheel() {
  const canvas = document.getElementById('wheelCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rewards = CONFIG.SPIN_REWARDS;
  const slices = rewards.length;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(cx, cy) - 6;

  ctx.clearRect(0, 0, w, h);

  const sliceAngle = (2 * Math.PI) / slices;

  for (let i = 0; i < slices; i++) {
    const start = i * sliceAngle;
    const end = start + sliceAngle;

    ctx.beginPath();
    ctx.fillStyle = wheelColors[i % wheelColors.length];
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f2230';
    ctx.stroke();

    // label
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.translate(cx + Math.cos(start + sliceAngle / 2) * (r * 0.65),
                  cy + Math.sin(start + sliceAngle / 2) * (r * 0.65));
    ctx.rotate(start + sliceAngle / 2 + Math.PI / 2);
    const txt = String(rewards[i]);
    ctx.fillText(txt, -ctx.measureText(txt).width / 2, 0);
    ctx.restore();
  }
}

async function spinWheel() {
  if (state.spinning) return;
  if (!state.user?.telegram_id) return;

  const btn = document.getElementById('spinBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

  state.spinning = true;

  try {
    // choose reward locally (backend doesn't compute it)
    const rewards = CONFIG.SPIN_REWARDS;
    const targetIndex = Math.floor(Math.random() * rewards.length);
    const prize = rewards[targetIndex];

    const sliceAngle = 360 / rewards.length;
    const stopAngle = 360 - (targetIndex * sliceAngle) - (sliceAngle / 2) - 90;

    state.wheelRotation += (360 * 5) + (stopAngle - (state.wheelRotation % 360));

    const canvas = document.getElementById('wheelCanvas');
    if (canvas) canvas.style.transform = `rotate(${state.wheelRotation}deg)`;

    // tell server
    await apiPost('/spin', { user_id: state.user.telegram_id, prize });

    setTimeout(async () => {
      toast(`🎉 +${prize} IRAN`, 'ok');
      await refreshUser();
      navTo('home');
      state.spinning = false;
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }, 4200);

  } catch (e) {
    toast('Spin error', 'err');
    state.spinning = false;
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
}

/* ========= Helpers ========= */

function updateEnergyUI() {
  const textEl = document.getElementById('energyText');
  if (textEl) textEl.innerText = `${state.energy} / ${state.maxEnergy}`;

  const fillEl = document.getElementById('energyFill');
  if (fillEl) fillEl.style.width = `${(state.energy / state.maxEnergy) * 100}%`;
}

function updateBalanceUI() {
  const balEl = document.getElementById('minerBal');
  if (balEl) balEl.innerHTML = `${fmtCoins(state.user?.balance || 0)} <span>IRAN</span>`;
}

function rerenderIfHomeOrMiner() {
  if (state.page === 'home' || state.page === 'miner' || state.page === 'wallet' || state.page === 'tasks') {
    navTo(state.page);
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/* ========= Energy regen ========= */
setInterval(() => {
  if (state.energy < state.maxEnergy) {
    state.energy = Math.min(state.maxEnergy, state.energy + CONFIG.ENERGY_REGEN_PER_SEC);
    updateEnergyUI();
  }
}, 1000);

/* ========= Globals for HTML onclick ========= */
window.openApp = openApp;
window.navTo = navTo;
window.goBack = goBack;
window.handleTap = handleTap;
window.watchAd = watchAd;
window.watchMonetag = watchMonetag;
window.openCPXOfferwall = openCPXOfferwall;
window.checkTask = checkTask;
window.openTaskLink = openTaskLink;
window.requestWithdraw = requestWithdraw;
window.spinWheel = spinWheel;
window.shareReferral = shareReferral;
window.claimStreak = claimStreak;
window.claimMine = claimMine;

/* ========= Boot ========= */
window.addEventListener('DOMContentLoaded', async () => {
  await init();
  // splash stays until user clicks Start; but we can pre-load wheel
  setTimeout(() => drawWheel(), 100);
});
