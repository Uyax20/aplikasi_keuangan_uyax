const API_URL = 'https://script.google.com/macros/s/AKfycbw9lPgGUdDcuAd6fw1o34p7M00ROKb_RtXob1coJZmSDBaz-lwZK6fx4iVKt4xHagPUSw/exec';

// ===== HELPER =====
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmt = n => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const monthOf = t => String(t.tanggal).slice(0, 7);
const allCats = () => state.categories.flatMap(g => g.categories);
function shiftMonth(m, d) {
  const [y, mo] = m.split('-').map(Number);
  const dt = new Date(y, mo - 1 + d, 1);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
}
function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

const state = {
  transactions: [], allBudgets: {}, categories: [], targets: {},
  budgetMonth: todayStr().slice(0, 7),
  transFilterMonth: todayStr().slice(0, 7),
  laporanMonth: todayStr().slice(0, 7),
  newTipe: 'outflow', editId: null, charts: {}, imageBase64: null, aiParsedTransactions: []
};

// ===== KONEKSI KE API GAS =====
async function callAPI(action, payload = {}) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // hindari CORS preflight
      body: JSON.stringify({ action, ...payload })
    });
  } catch (e) {
    throw new Error('Tidak bisa terhubung ke server. Cek URL /exec dan akses deployment (Anyone).');
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error('Respon server bukan JSON. Cek deployment Apps Script (versi terbaru & akses Anyone).'); }
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function loadAll() {
  try {
    const data = await callAPI('getAllData');
    state.transactions = data.transactions || [];
    state.allBudgets = data.budgets || {};
    state.categories = data.categories || [];
    state.targets = data.targets || {};
    renderAll();
  } catch (e) { alert('Gagal memuat data: ' + e.message); }
}

function renderAll() {
  renderKategoriSelect();
  renderBudget();
  renderTransactions();
  renderPengaturan();
  if ($('tab-laporan').classList.contains('active')) renderLaporan();
}

// ===== TAB =====
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'laporan') renderLaporan();
}

// ===== VOICE & FOTO =====
let recognition = null, isRecording = false;
function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('btn-mic').style.display = 'none'; return; }
  recognition = new SR();
  recognition.lang = 'id-ID'; recognition.continuous = false; recognition.interimResults = false;
  recognition.onresult = e => {
    const ta = $('ai-text');
    ta.value += (ta.value ? ' ' : '') + e.results[0][0].transcript;
  };
  recognition.onend = () => {
    isRecording = false;
    $('mic-text').innerText = 'Rekam';
    $('btn-mic').classList.remove('recording');
  };
  recognition.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') alert('Gagal merekam: ' + e.error); };
}
function toggleVoice() {
  if (!recognition) return;
  if (isRecording) { recognition.stop(); return; }
  recognition.start(); isRecording = true;
  $('mic-text').innerText = 'Stop...';
  $('btn-mic').classList.add('recording');
}
function handleImage(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1000;
      const scale = img.width > MAX ? MAX / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale; canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      state.imageBase64 = dataUrl.split(',')[1];
      $('img-preview').src = dataUrl;
      $('image-preview').style.display = 'block';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(input.files[0]);
}
function clearImage() {
  state.imageBase64 = null;
  $('ai-image').value = '';
  $('image-preview').style.display = 'none';
}

// ===== AI =====
async function submitAI() {
  const text = $('ai-text').value.trim();
  if (!text && !state.imageBase64) return alert('Ketik, rekam, atau upload foto dulu!');
  const btn = $('btn-ai-submit');
  btn.disabled = true; btn.innerText = 'Menganalisis...';
  try {
    const res = await callAPI('processAI', { payload: { text, imageBase64: state.imageBase64 } });
    state.aiParsedTransactions = res.transactions || [];
    if (!state.aiParsedTransactions.length) throw new Error('Tidak ada transaksi yang terdeteksi.');
    renderAIReview();
    $('ai-input-section').style.display = 'none';
    $('ai-review-section').style.display = 'block';
  } catch (e) { alert(e.message); }
  finally { btn.disabled = false; btn.innerText = 'Proses dengan AI 🚀'; }
}

function renderAIReview() {
  const cats = [...allCats(), 'Lainnya'];
  $('review-list').innerHTML = state.aiParsedTransactions.map((t, i) => `
    <div class="review-card">
      <div class="review-row">
        <select class="review-input" onchange="updAI(${i},'tipe',this.value)">
          <option value="outflow" ${t.tipe === 'outflow' ? 'selected' : ''}>💸 Pengeluaran</option>
          <option value="inflow" ${t.tipe === 'inflow' ? 'selected' : ''}>💵 Pemasukan</option>
        </select>
        <input class="review-input" type="number" value="${Number(t.nominal) || 0}" onchange="updAI(${i},'nominal',this.value)">
      </div>
      <div class="review-row">
        <select class="review-input" onchange="updAI(${i},'kategori',this.value)">
          ${cats.map(c => `<option ${c === t.kategori ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <input class="review-input" type="date" value="${esc(t.tanggal)}" onchange="updAI(${i},'tanggal',this.value)">
      </div>
      <div class="review-row">
        <input class="review-input" type="text" value="${esc(t.catatan)}" placeholder="Catatan" onchange="updAI(${i},'catatan',this.value)">
        <button type="button" class="hapus" style="flex:0 0 auto" onclick="hapusAI(${i})">Hapus</button>
      </div>
    </div>`).join('');
}
function updAI(i, f, v) { state.aiParsedTransactions[i][f] = f === 'nominal' ? (Number(v) || 0) : v; }
function hapusAI(i) { state.aiParsedTransactions.splice(i, 1); renderAIReview(); }
function batalAIReview() {
  state.aiParsedTransactions = [];
  $('review-list').innerHTML = '';
  $('ai-text').value = '';
  clearImage();
  $('ai-review-section').style.display = 'none';
  $('ai-input-section').style.display = 'block';
}
async function simpanAIReview() {
  if (!state.aiParsedTransactions.length) return alert('Tidak ada transaksi.');
  const btn = document.querySelector('#ai-review-section .btn-primary');
  btn.disabled = true; btn.innerText = 'Menyimpan...';
  try {
    const res = await callAPI('saveBulkTransactions', { transactions: state.aiParsedTransactions });
    alert(`✅ Berhasil menyimpan ${res.count} transaksi!`);
    batalAIReview();
    await loadAll();
  } catch (e) { alert(e.message); }
  finally { btn.disabled = false; btn.innerText = '✅ Simpan Semua'; }
}

// ===== BUDGET =====
function spentIn(cat, m) {
  return state.transactions.filter(t => t.tipe === 'outflow' && t.kategori === cat && monthOf(t) === m).reduce((s, t) => s + t.nominal, 0);
}
function spentUpTo(cat, m) {
  return state.transactions.filter(t => t.tipe === 'outflow' && t.kategori === cat && monthOf(t) <= m).reduce((s, t) => s + t.nominal, 0);
}
function assignedUpTo(cat, m) {
  return Object.keys(state.allBudgets).filter(b => b <= m).reduce((s, b) => s + (state.allBudgets[b][cat] || 0), 0);
}

function renderBudget() {
  const m = state.budgetMonth;
  $('budget-month-label').textContent = monthLabel(m);
  const income = state.transactions.filter(t => t.tipe === 'inflow' && monthOf(t) <= m).reduce((s, t) => s + t.nominal, 0);
  let assigned = 0;
  Object.keys(state.allBudgets).forEach(b => { if (b <= m) Object.values(state.allBudgets[b]).forEach(v => assigned += v); });
  $('rta-amount').textContent = fmt(income - assigned);

  $('budget-content').innerHTML = state.categories.map(g => `
    <div class="card">
      <div class="group-header">${esc(g.name)}</div>
      ${g.categories.map(c => {
        const thisAssigned = (state.allBudgets[m] || {})[c] || 0;
        const avail = assignedUpTo(c, m) - spentUpTo(c, m);
        const target = state.targets[c] || 0;
        const butuh = target > thisAssigned ? ` · butuh ${fmt(target - thisAssigned)}` : (target ? ' · ✓' : '');
        return `
        <div class="budget-row">
          <div>
            <div class="cat-name">${esc(c)}</div>
            <div class="cat-target">${target ? 'Target ' + fmt(target) + butuh : 'Belum ada target'}</div>
            <div class="target-input-wrap">
              <input class="target-input" type="number" data-cat="${esc(c)}" placeholder="Target" value="${target || ''}">
              <button class="target-btn" onclick="saveTarget(this.previousElementSibling)">Set</button>
            </div>
          </div>
          <input class="assign-input" type="number" data-cat="${esc(c)}" value="${thisAssigned || ''}" placeholder="0" onchange="saveBudget(this.dataset.cat, this.value)">
          <div class="avail ${avail > 0 ? 'positive' : avail < 0 ? 'negative' : ''}">${fmt(avail)}</div>
        </div>`;
      }).join('')}
    </div>`).join('') || '<div class="empty-state"><div class="icon">📭</div>Belum ada kategori</div>';
}
function navMonth(d) { state.budgetMonth = shiftMonth(state.budgetMonth, d); renderBudget(); }

async function saveBudget(cat, val) {
  const v = Number(val) || 0, m = state.budgetMonth;
  if (!state.allBudgets[m]) state.allBudgets[m] = {};
  if (v > 0) state.allBudgets[m][cat] = v; else delete state.allBudgets[m][cat];
  renderBudget();
  try { await callAPI('setBudget', { bulan: m, kategori: cat, jumlah: v }); }
  catch (e) { alert('Gagal menyimpan budget: ' + e.message); loadAll(); }
}
async function saveTarget(input) {
  const cat = input.dataset.cat, v = Number(input.value) || 0;
  if (v > 0) state.targets[cat] = v; else delete state.targets[cat];
  renderBudget();
  try { await callAPI('setTarget', { kategori: cat, jumlah: v }); }
  catch (e) { alert('Gagal menyimpan target: ' + e.message); loadAll(); }
}

// ===== TRANSAKSI =====
function setTipe(t) {
  state.newTipe = t;
  document.querySelectorAll('.tipe-btn').forEach(b => b.classList.toggle('active', b.dataset.tipe === t));
  $('f-kategori-wrap').style.display = t === 'outflow' ? 'block' : 'none';
}
function renderKategoriSelect() {
  const sel = $('f-kategori'), cur = sel.value;
  sel.innerHTML = [...allCats(), 'Lainnya'].map(c => `<option>${esc(c)}</option>`).join('');
  if (cur) sel.value = cur;
}
function renderTransactions() {
  const list = state.transactions.filter(t => monthOf(t) === state.transFilterMonth);
  $('trans-list').innerHTML = list.length ? list.map(t => `
    <div class="transaksi-item">
      <div class="transaksi-info">
        <div class="kategori">${esc(t.tipe === 'inflow' ? 'Pemasukan' : (t.kategori || 'Lainnya'))}</div>
        <div class="meta">${esc(t.tanggal)}${t.catatan ? ' · ' + esc(t.catatan) : ''}</div>
      </div>
      <div class="transaksi-amount">
        <div class="nominal ${t.tipe === 'inflow' ? 'income' : 'expense'}">${t.tipe === 'inflow' ? '+' : '-'}${fmt(t.nominal)}</div>
        <button class="edit-btn" onclick="editTransaksi('${esc(t.id)}')">Edit</button>
        <button class="hapus" onclick="hapusTransaksi('${esc(t.id)}')">Hapus</button>
      </div>
    </div>`).join('') : '<div class="empty-state"><div class="icon">📭</div>Belum ada transaksi bulan ini</div>';
}
function editTransaksi(id) {
  const t = state.transactions.find(x => x.id === id);
  if (!t) return;
  state.editId = id;
  setTipe(t.tipe);
  $('f-nominal').value = t.nominal;
  if (t.kategori) $('f-kategori').value = t.kategori;
  $('f-tanggal').value = t.tanggal;
  $('f-catatan').value = t.catatan || '';
  $('form-title').textContent = '✏️ Edit Transaksi';
  $('btn-submit').textContent = '💾 Update';
  $('btn-cancel-edit').style.display = 'inline';
  $('form-card').scrollIntoView({ behavior: 'smooth' });
}
function cancelEdit() {
  state.editId = null;
  $('formTransaksi').reset();
  $('f-tanggal').value = todayStr();
  setTipe('outflow');
  $('form-title').textContent = '➕ Tambah Manual';
  $('btn-submit').textContent = '💾 Simpan';
  $('btn-cancel-edit').style.display = 'none';
}
async function hapusTransaksi(id) {
  if (!confirm('Hapus transaksi ini?')) return;
  try {
    await callAPI('deleteTransaction', { id });
    state.transactions = state.transactions.filter(t => t.id !== id);
    renderAll();
  } catch (e) { alert(e.message); }
}
async function submitForm(e) {
  e.preventDefault();
  const fd = {
    tipe: state.newTipe,
    nominal: Number($('f-nominal').value),
    kategori: state.newTipe === 'outflow' ? $('f-kategori').value : '',
    tanggal: $('f-tanggal').value,
    catatan: $('f-catatan').value.trim()
  };
  if (!fd.nominal || fd.nominal <= 0) return alert('Nominal harus lebih dari 0.');
  const btn = $('btn-submit');
  btn.disabled = true; btn.textContent = 'Menyimpan...';
  try {
    if (state.editId) await callAPI('updateTransaction', { id: state.editId, formData: fd });
    else await callAPI('addTransaction', { formData: fd });
    cancelEdit();
    await loadAll();
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; btn.textContent = state.editId ? '💾 Update' : '💾 Simpan'; }
}

// ===== LAPORAN =====
const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#64748b'];
function drawChart(key, canvasId, config) {
  if (typeof Chart === 'undefined') return;
  if (state.charts[key]) state.charts[key].destroy();
  state.charts[key] = new Chart($(canvasId), config);
}
function renderLaporan() {
  const m = state.laporanMonth;
  $('laporan-month').value = m;
  const rows = allCats().map(c => ({ c, budget: (state.allBudgets[m] || {})[c] || 0, actual: spentIn(c, m) }));

  const pie = rows.filter(r => r.actual > 0);
  drawChart('pie', 'chart-pie', {
    type: 'doughnut',
    data: { labels: pie.map(r => r.c), datasets: [{ data: pie.map(r => r.actual), backgroundColor: pie.map((_, i) => PALETTE[i % PALETTE.length]) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });

  const groups = state.categories.map(g => ({
    name: g.name,
    budget: g.categories.reduce((s, c) => s + ((state.allBudgets[m] || {})[c] || 0), 0),
    actual: g.categories.reduce((s, c) => s + spentIn(c, m), 0)
  }));
  drawChart('bar', 'chart-bar', {
    type: 'bar',
    data: {
      labels: groups.map(g => g.name),
      datasets: [
        { label: 'Budget', data: groups.map(g => g.budget), backgroundColor: '#6366f1' },
        { label: 'Aktual', data: groups.map(g => g.actual), backgroundColor: '#f59e0b' }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  const detail = rows.filter(r => r.budget > 0 || r.actual > 0);
  $('laporan-list').innerHTML = detail.length ? detail.map(r => {
    const sisa = r.budget - r.actual;
    return `<div class="transaksi-item">
      <div class="transaksi-info"><div class="kategori">${esc(r.c)}</div>
        <div class="meta">Budget ${fmt(r.budget)} · Aktual ${fmt(r.actual)}</div></div>
      <div class="transaksi-amount"><div class="nominal ${sisa >= 0 ? 'income' : 'expense'}">${sisa >= 0 ? 'Sisa ' : 'Lebih '}${fmt(Math.abs(sisa))}</div></div>
    </div>`;
  }).join('') : '<div class="empty-state"><div class="icon">📭</div>Belum ada data bulan ini</div>';
}

// ===== PENGATURAN =====
function renderPengaturan() {
  $('groups-list').innerHTML = state.categories.map((g, gi) => `
    <div style="margin-bottom:16px;">
      <div class="group-header">${esc(g.name)}</div>
      ${g.categories.map((c, ci) => `
        <div class="transaksi-item"><span style="font-size:13px;">${esc(c)}</span>
          <button class="hapus" onclick="hapusKategori(${gi},${ci})">Hapus</button></div>`).join('')}
      <div style="display:flex;gap:6px;margin-top:8px;">
        <input id="nk-${gi}" placeholder="Kategori baru">
        <button class="btn btn-primary" style="width:auto;" onclick="tambahKategori(${gi})">+</button>
      </div>
    </div>`).join('');
}
async function persistCategories() {
  try { await callAPI('saveCategories', { groups: state.categories }); }
  catch (e) { alert('Gagal menyimpan kategori: ' + e.message); loadAll(); }
}
function tambahKategori(gi) {
  const name = $('nk-' + gi).value.trim();
  if (!name) return;
  if (allCats().includes(name)) return alert('Kategori sudah ada.');
  state.categories[gi].categories.push(name);
  renderAll(); persistCategories();
}
function hapusKategori(gi, ci) {
  const name = state.categories[gi].categories[ci];
  if (!confirm(`Hapus kategori "${name}"? Transaksi lama tetap tersimpan.`)) return;
  state.categories[gi].categories.splice(ci, 1);
  renderAll(); persistCategories();
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('formTransaksi').addEventListener('submit', submitForm);
  $('f-tanggal').value = todayStr();
  $('filter-month').value = state.transFilterMonth;
  $('laporan-month').value = state.laporanMonth;
  $('filter-month').addEventListener('change', e => { state.transFilterMonth = e.target.value; renderTransactions(); });
  $('laporan-month').addEventListener('change', e => { state.laporanMonth = e.target.value; renderLaporan(); });
  initVoice();
  loadAll();
});
