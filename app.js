/**
 * Dompetku - Core Logic
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
import { 
    initializeFirestore, 
    collection, 
    onSnapshot, 
    doc, 
    setDoc, 
    addDoc, 
    deleteDoc, 
    query, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyAQ9y8HlhTpRyu9-DQWElLSHvCgciGcl7Y",
  authDomain: "dompeetku.firebaseapp.com",
  projectId: "dompeetku",
  storageBucket: "dompeetku.firebasestorage.app",
  messagingSenderId: "539510262396",
  appId: "1:539510262396:web:7a60adbebb7a57f05d17f9",
  measurementId: "G-07CTQEF08D"
};

console.log(`Dompetku: Initializing Firebase (Unified) for project: ${firebaseConfig.projectId}`);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
let analytics;
try {
    analytics = getAnalytics(app);
} catch (e) {
    console.warn("Dompetku: Analytics initialization failed");
}

// Initialize Firestore with Long Polling to bypass blocked WebSockets
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

// --- STATE MANAGEMENT ---
let state = {
    user: {
        name: "Pengguna",
        budgetLimit: 300000,
        budgetStartDate: "", // Will be "YYYY-MM"
        isLoggedIn: false
    },
    detail: {
        account: 'tabungan',
        currentDate: new Date() // For month filtering
    },
    currentView: 'home',
    balances: {
        tabungan: 0,
        keperluan: 0
    },
    transactions: [],
    settings: {
        isBalanceVisible: true,
        showAllTransactions: false
    }
};

const COLLECTIONS = {
    TRANSACTIONS: "transactions",
    USER: "users"
};

const MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

// --- INITIALIZATION ---
async function init() {
    // Check for file protocol
    if (window.location.protocol === 'file:') {
        console.warn("Dompetku: Running on file:// protocol. Firebase & Biometrics might be limited.");
    }

    await checkBiometricSupport();
    checkAuth();
    setupFirestoreListeners();
    setupEventListeners();
    renderApp();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('./sw.js');
            console.log("Dompetku: Service Worker registered");
        } catch (e) {
            console.error("Dompetku: Service Worker registration failed", e);
        }
    }
}

async function checkBiometricSupport() {
    const btn = document.getElementById('btnBiometric');
    if (!btn) return;

    if (window.PublicKeyCredential && 
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) {
        btn.classList.remove('hidden');
        console.log("Dompetku: Biometric support detected");
    } else {
        btn.classList.add('hidden');
        console.log("Dompetku: Biometric support not available on this device");
    }
}

// --- AUTHENTICATION ---
function checkAuth() {
    const loginView = document.getElementById('loginView');
    const mainApp = document.getElementById('mainApp');
    
    if (!loginView || !mainApp) return;

    if (state.user.isLoggedIn) {
        console.log("Dompetku: Access granted");
        loginView.classList.add('hidden');
        mainApp.classList.remove('hidden');
        document.body.classList.remove('overflow-hidden');
    } else {
        console.log("Dompetku: Login required");
        loginView.classList.remove('hidden');
        mainApp.classList.add('hidden');
        document.body.classList.add('overflow-hidden');
    }
}

window.tryBiometricLogin = async function() {
    try {
        // 1. Check if we have a registered credential ID
        const credentialId = localStorage.getItem('dompetku_biometric_id');
        
        if (!credentialId) {
            const wantRegister = confirm("Biometrik belum didaftarkan di perangkat ini.\n\nIngin mendaftarkan sidik jari/wajah Anda sekarang?\n(Anda harus login manual sekali untuk ini)");
            if (wantRegister) {
                alert("Silakan login manual dengan Username & Password terlebih dahulu. Setelah masuk, buka Pengaturan untuk mendaftarkan Biometrik.");
                showPasswordForm();
            }
            return;
        }

        console.log("Dompetku: Triggering native biometric prompt...");
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        const options = {
            publicKey: {
                challenge: challenge,
                timeout: 60000,
                userVerification: "required",
                allowCredentials: [{
                    id: Uint8Array.from(atob(credentialId), c => c.charCodeAt(0)),
                    type: 'public-key',
                    transports: ['internal']
                }]
            }
        };

        if (navigator.credentials && navigator.credentials.get) {
            await navigator.credentials.get(options);
            state.user.isLoggedIn = true;
            checkAuth();
            renderApp();
        } else {
            throw new Error("WebAuthn API not supported");
        }
    } catch (err) {
        console.error("Biometric Authentication failed:", err);
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
            alert("GAGAL: Biometrik hanya bisa digunakan di koneksi HTTPS yang aman.\n\nJika Anda membuka lewat IP (seperti 192.168...), fitur ini akan diblokir oleh Browser.");
        } else {
            alert("Verifikasi Gagal: " + err.message + "\n\nPastikan Anda sudah mendaftarkan perangkat ini di menu Pengaturan.");
        }
    }
};

window.registerBiometric = async function() {
    try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        const options = {
            publicKey: {
                challenge: challenge,
                rp: { name: "Dompetku", id: window.location.hostname },
                user: {
                    id: new Uint8Array(16),
                    name: "user@dompetku",
                    displayName: state.user.name
                },
                pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    userVerification: "required"
                },
                timeout: 60000
            }
        };

        const credential = await navigator.credentials.create(options);
        const idBase64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
        localStorage.setItem('dompetku_biometric_id', idBase64);
        
        alert("BERHASIL! Biometrik Anda sudah terdaftar. Sekarang Anda bisa masuk menggunakan sidik jari.");
    } catch (err) {
        console.error("Biometric Registration failed:", err);
        alert("Gagal mendaftarkan biometrik: " + err.message + "\n\nPastikan perangkat mendukung dan Anda menggunakan HTTPS.");
    }
};

window.showPasswordForm = function() {
    const form = document.getElementById('passwordLoginForm');
    if (form) form.classList.toggle('hidden');
};

window.handlePasswordLogin = function(event) {
    event.preventDefault();
    const user = document.getElementById('loginUsername').value;
    const pass = document.getElementById('loginPassword').value;
    const error = document.getElementById('loginError');

    if (user === 'admin' && pass === 'admin') {
        state.user.isLoggedIn = true;
        checkAuth();
        renderApp();
    } else {
        if (error) error.classList.remove('hidden');
    }
};

// --- FIRESTORE LISTENERS ---
function setupFirestoreListeners() {
    console.log("Dompetku: Syncing with Firestore...");
    
    try {
        // Listen for Transactions
        const qTransactions = query(collection(db, COLLECTIONS.TRANSACTIONS), orderBy("date", "desc"));
        onSnapshot(qTransactions, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            state.transactions = data;
            calculateBalances();
            renderApp();
        }, (error) => {
            console.error("Dompetku: Transaction Sync Error:", error);
            if (error.code === 'permission-denied') {
                alert("Firebase Access Denied! \n\nData tidak bisa masuk karena aturan keamanan (Rules) di Firebase Console Anda. \n\nSilakan ubah Rules di Firestore menjadi: \nallow read, write: if true;");
            } else if (error.code === 'unavailable') {
                alert("Firebase sedang tidak tersedia. Periksa koneksi internet Anda.");
            }
        });

        // Listen for User Data
        onSnapshot(doc(db, COLLECTIONS.USER, "current_user"), (docSnap) => {
            if (docSnap.exists()) {
                console.log("Dompetku: User settings synced");
                const data = docSnap.data();
                state.user.name = data.name || "Pengguna";
                state.user.budgetLimit = data.budgetLimit || 300000;
                state.user.budgetStartDate = data.budgetStartDate || "";
                state.settings.isBalanceVisible = data.isBalanceVisible ?? true;
                
                // Initialize start date if missing
                if (!state.user.budgetStartDate) {
                    const now = new Date();
                    state.user.budgetStartDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                    saveUserSettings();
                }
                
                calculateBalances();
                renderApp();
            } else {
                saveUserSettings();
            }
        }, (error) => {
            console.error("Dompetku: Sync Error:", error);
        });
    } catch (e) {
        console.error("Dompetku: Init Error:", e);
    }
}

function calculateBalances() {
    let totalIncome = 0;
    let incomeKeperluan = 0;
    let expensesTabungan = 0;
    let expensesKeperluan = 0;

    state.transactions.forEach(tx => {
        if (tx.type === 'income') {
            totalIncome += tx.amount;
            // Respect income added specifically to "Sehari-hari"
            if (tx.account === 'keperluan') incomeKeperluan += tx.amount;
        } else {
            if (tx.account === 'tabungan') {
                expensesTabungan += tx.amount;
            } else {
                expensesKeperluan += tx.amount;
            }
        }
    });
    
    // Calculate how many months have passed since start date
    let monthsPassed = 1;
    if (state.user.budgetStartDate) {
        const start = new Date(state.user.budgetStartDate + "-01");
        const now = new Date();
        monthsPassed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
    }
    
    // Budget priority: Fund "Sehari-hari" first
    // We target the cumulative budget limit OR the specific income added (whichever is higher)
    const budgetNeeded = monthsPassed * state.user.budgetLimit;
    const targetKeperluan = Math.max(budgetNeeded, incomeKeperluan);
    
    const allocatedToKeperluan = Math.min(totalIncome, targetKeperluan);
    const remainingForTabungan = totalIncome - allocatedToKeperluan;

    // Final Balances = Allocation - Expenses
    state.balances.keperluan = allocatedToKeperluan - expensesKeperluan;
    state.balances.tabungan = remainingForTabungan - expensesTabungan;
}

async function saveUserSettings() {
    try {
        await setDoc(doc(db, COLLECTIONS.USER, "current_user"), {
            name: state.user.name,
            budgetLimit: state.user.budgetLimit,
            budgetStartDate: state.user.budgetStartDate,
            isBalanceVisible: state.settings.isBalanceVisible
        });
    } catch (e) {
        console.error("Error saving user settings: ", e);
        alert("GAGAL SIMPAN PENGATURAN: " + e.message);
    }
}

// --- UI UPDATES ---
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount).replace('Rp', 'Rp ');
}

function renderApp() {
    try {

        // Update Display Name & Greeting
        const nameDisplay = document.getElementById('userNameDisplay');
        if (nameDisplay) {
            nameDisplay.innerHTML = `Halo, ${state.user.name}! <i class="ph ph-hand-waving text-blue-500"></i>`;
        }

        const greetingDisplay = document.getElementById('userGreetingText');
        if (greetingDisplay) {
            if (!window._currentGreeting) {
                const greetings = [
                    "Semangat mencatat keuangan hari ini! <i class='ph ph-rocket-launch'></i>",
                    "Sudahkah Anda berhemat hari ini? <i class='ph ph-coins'></i>",
                    "Kelola uang dengan bijak, masa depan cerah. <i class='ph ph-sparkle'></i>",
                    "Satu rupiah sangat berarti untuk masa depan. <i class='ph ph-coins'></i>",
                    "Catat setiap pengeluaran, kendalikan masa depan. <i class='ph ph-chart-line-up'></i>",
                    "Tabungan sedikit-sedikit lama-lama jadi bukit. <i class='ph ph-mountains'></i>",
                    "Jangan lupa sisihkan untuk masa depan ya! <i class='ph ph-bank'></i>"
                ];
                window._currentGreeting = greetings[Math.floor(Math.random() * greetings.length)];
            }
            greetingDisplay.innerHTML = window._currentGreeting;
            console.log("Dompetku: Greeting rendered ->", window._currentGreeting);
        }

        const nameInput = document.getElementById('userNameInput');
        if (nameInput) nameInput.value = state.user.name;
        
        const budgetInp = document.getElementById('budgetInput');
        if (budgetInp) budgetInp.value = state.user.budgetLimit.toLocaleString('id-ID');

        // Update Balances
        const total = state.balances.tabungan + state.balances.keperluan;
        
        const balanceElements = {
            'totalBalance': state.settings.isBalanceVisible ? formatCurrency(total) : 'Rp ••••••••',
            'tabunganBalance': state.settings.isBalanceVisible ? formatCurrency(state.balances.tabungan) : 'Rp ••••',
            'keperluanBalance': state.settings.isBalanceVisible ? formatCurrency(state.balances.keperluan) : 'Rp ••••',
            'bukuTabunganBalance': formatCurrency(state.balances.tabungan),
            'bukuKeperluanBalance': formatCurrency(state.balances.keperluan)
        };

        for (const [id, value] of Object.entries(balanceElements)) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        }
        
        // Update Visibility Icon
        const icon = document.getElementById('visibilityIcon');
        if (icon) {
            icon.className = state.settings.isBalanceVisible ? 'ph ph-eye text-lg' : 'ph ph-eye-slash text-lg';
        }

        renderTransactions();
        updateStats();
        if (state.currentView === 'bukuDetail') renderBukuDetail();
    } catch (e) {
        console.error("Dompetku: Render Error:", e);
        // Alert but only if it's the first time to avoid loops
        if (!window._lastRenderError) {
            window._lastRenderError = e.message;
            alert("Ada kesalahan saat menampilkan data. Coba hapus cache atau periksa input terakhir Anda.");
        }
    }
}

window.toggleBalanceVisibility = async function() {
    state.settings.isBalanceVisible = !state.settings.isBalanceVisible;
    await saveUserSettings();
};

// --- TRANSACTION MANAGEMENT ---
window.openModal = function() {
    const modal = document.getElementById('transactionModal');
    modal.classList.remove('modal-hidden');
};

window.closeModal = function() {
    const modal = document.getElementById('transactionModal');
    modal.classList.add('modal-hidden');
    document.getElementById('transactionForm').reset();
    updateFormUI();
};

window.updateFormUI = function() {
    const type = document.querySelector('input[name="type"]:checked').value;
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.textContent = type === 'income' ? 'Simpan Pemasukan' : 'Simpan Pengeluaran';
    submitBtn.className = type === 'income' 
        ? 'w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/30 transition-all cursor-pointer'
        : 'w-full py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold shadow-lg shadow-red-500/30 transition-all cursor-pointer';
};

function setupEventListeners() {
    const form = document.getElementById('transactionForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
            const type = document.querySelector('input[name="type"]:checked').value;
            const account = document.querySelector('input[name="account"]:checked').value;
            const amountStr = document.getElementById('amount').value.replace(/\./g, '').trim();
            const amount = parseInt(amountStr);
            const description = document.getElementById('description').value.trim().substring(0, 100); // Limit length and trim

            if (!amountStr || isNaN(amount) || amount <= 0) {
                alert("Mohon masukkan nominal yang valid!");
                return;
            }
            if (!description) {
                alert("Mohon masukkan keterangan transaksi!");
                return;
            }

            const transaction = {
                type,
                account,
                amount,
                description,
                date: new Date().toISOString()
            };

            await addDoc(collection(db, COLLECTIONS.TRANSACTIONS), transaction);
            closeModal();
        } catch (error) {
            console.error("Dompetku: Save Error:", error);
            alert("Gagal menyimpan transaksi!\n\nKode Error: " + error.code + "\nPesan: " + error.message + "\n\nBiasanya ini karena 'Rules' di Firebase Console belum diatur ke mode 'Test Mode'.");
        }
    });

    // Formatting amount input
    const amountInput = document.getElementById('amount');
    amountInput.addEventListener('input', function(e) {
        let val = this.value.replace(/\D/g, '');
        if (val) {
            this.value = parseInt(val).toLocaleString('id-ID');
        } else {
            this.value = '';
        }
    });

    const budgetInput = document.getElementById('budgetInput');
    budgetInput.addEventListener('input', function(e) {
        let val = this.value.replace(/\D/g, '');
        if (val) {
            this.value = parseInt(val).toLocaleString('id-ID');
        } else {
            this.value = '';
        }
    });

    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        state.user.name = document.getElementById('userNameInput').value;
        state.user.budgetLimit = parseInt(document.getElementById('budgetInput').value.replace(/\./g, '')) || 0;
        await saveUserSettings();
        closeSettings();
    });
}

function renderTransactions(toggle = null) {
    const list = document.getElementById('transactionList');
    const emptyState = document.getElementById('emptyState');
    const allBtn = document.getElementById('toggleAllHomeBtn');
    const container = document.getElementById('transactionListContainer');

    if (toggle !== null) {
        state.settings.showAllTransactions = toggle;
    }

    const showAll = state.settings.showAllTransactions;
    
    // Determine which transactions to show
    let displayTransactions = [];
    
    if (showAll) {
        // Show all transactions from all time
        displayTransactions = state.transactions;
        if (allBtn) {
            allBtn.textContent = 'Sembunyikan';
            allBtn.onclick = () => renderTransactions(false);
        }
        if (container) container.classList.add('show-all');
    } else {
        // Default: Show latest transactions (limit to 5)
        displayTransactions = state.transactions.slice(0, 5); 
        if (allBtn) {
            allBtn.textContent = 'Semua';
            allBtn.onclick = () => renderTransactions(true);
        }
        if (container) container.classList.remove('show-all');
    }

    if (displayTransactions.length === 0) {
        emptyState.classList.remove('hidden');
        list.querySelectorAll('.transaction-item').forEach(el => el.remove());
        return;
    }

    emptyState.classList.add('hidden');
    
    // Clear current list items
    list.querySelectorAll('.transaction-item').forEach(el => el.remove());

    displayTransactions.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'transaction-item flex justify-between items-center p-4 bg-white rounded-2xl border border-slate-100 shadow-sm transition-all hover:bg-slate-50';
        
        const isIncome = tx.type === 'income';
        const colorClass = isIncome ? 'text-blue-600' : 'text-red-500';
        const bgClass = isIncome ? 'bg-blue-50' : 'bg-red-50';
        const iconClass = tx.account === 'tabungan' ? 'ph ph-piggy-bank' : 'ph ph-wallet';
        
        const leftSide = document.createElement('div');
        leftSide.className = 'flex items-center gap-3';
        leftSide.innerHTML = `
            <div class="w-10 h-10 rounded-full ${bgClass} ${colorClass} flex items-center justify-center">
                <i class="${iconClass} text-xl"></i>
            </div>
            <div>
                <p class="text-sm font-semibold text-slate-800 desc-text"></p>
                <p class="text-[11px] text-slate-400 capitalize">${tx.account} • ${new Date(tx.date).toLocaleDateString('id-ID')}</p>
            </div>
        `;
        leftSide.querySelector('.desc-text').textContent = tx.description;

        const rightSide = document.createElement('div');
        rightSide.className = 'text-right';
        rightSide.innerHTML = `
            <p class="text-sm font-bold ${colorClass}">${isIncome ? '+' : '-'}${formatCurrency(tx.amount)}</p>
        `;

        item.appendChild(leftSide);
        item.appendChild(rightSide);
        list.appendChild(item);
    });
}

window.deleteTransaction = async function(id) {
    if (confirm('Hapus transaksi ini?')) {
        try {
            await deleteDoc(doc(db, COLLECTIONS.TRANSACTIONS, id));
        } catch (e) {
            console.error("Error deleting transaction: ", e);
            alert("Gagal menghapus transaksi.");
        }
    }
};

// --- VIEW NAVIGATION ---
window.switchView = function(view) {
    state.currentView = view;
    const views = ['home', 'stats', 'buku', 'bukuDetail'];
    views.forEach(v => {
        const header = document.getElementById(`${v}Header`);
        const main = document.getElementById(`${v}Main`);
        
        // Navigation bar highlighting (only for main 3 views)
        const navItems = ['Home', 'Stats', 'Buku'];
        if (navItems.includes(v.charAt(0).toUpperCase() + v.slice(1))) {
            const nav = document.getElementById(`nav${v.charAt(0).toUpperCase() + v.slice(1)}`);
            const icon = document.getElementById(`icon${v.charAt(0).toUpperCase() + v.slice(1)}`);
            
            if (v === view) {
                nav.classList.replace('text-slate-400', 'text-blue-600');
                if (icon) icon.classList.replace('ph', 'ph-fill');
            } else {
                nav.classList.replace('text-blue-600', 'text-slate-400');
                if (icon) icon.classList.replace('ph-fill', 'ph');
            }
        }

        if (v === view) {
            header.classList.remove('hidden');
            main.classList.remove('hidden');
        } else {
            header.classList.add('hidden');
            main.classList.add('hidden');
        }
    });
    
    if (view === 'stats') updateStats();
    if (view === 'bukuDetail') renderBukuDetail();
};

window.openBukuDetail = function(account) {
    state.detail.account = account;
    state.detail.currentDate = new Date(); // Default to current month
    switchView('bukuDetail');
};

window.changeMonth = function(delta) {
    const d = state.detail.currentDate;
    d.setMonth(d.getMonth() + delta);
    renderBukuDetail();
};

function renderBukuDetail() {
    const account = state.detail.account;
    const date = state.detail.currentDate;
    
    const label = document.getElementById('detailAccountLabel');
    if (label) label.textContent = account === 'tabungan' ? 'Buku Tabungan' : 'Buku Sehari-hari';
    
    const monthYear = document.getElementById('currentMonthYear');
    if (monthYear) monthYear.textContent = `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
    
    const list = document.getElementById('detailTransactionList');
    list.innerHTML = '';
    
    const filtered = state.transactions.filter(tx => {
        const txDate = new Date(tx.date);
        return tx.account === account && 
               txDate.getMonth() === date.getMonth() && 
               txDate.getFullYear() === date.getFullYear();
    });
    
    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="text-center text-slate-400 text-sm py-20">
                <i class="ph ph-calendar-blank text-4xl mb-2 opacity-50"></i>
                <p>Tidak ada transaksi di bulan ini</p>
            </div>
        `;
        return;
    }
    
    filtered.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'flex justify-between items-center p-4 bg-white rounded-2xl border border-slate-100 shadow-sm';
        
        const isIncome = tx.type === 'income';
        const colorClass = isIncome ? 'text-blue-600' : 'text-red-500';
        const bgClass = isIncome ? 'bg-blue-50' : 'bg-red-50';
        
        item.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full ${bgClass} ${colorClass} flex items-center justify-center">
                    <i class="ph ${isIncome ? 'ph-trend-up' : 'ph-trend-down'} text-xl"></i>
                </div>
                <div>
                    <p class="text-sm font-semibold text-slate-800">${tx.description}</p>
                    <p class="text-[10px] text-slate-400">${new Date(tx.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}</p>
                </div>
            </div>
            <div class="text-right flex flex-col items-end">
                <p class="text-sm font-bold ${colorClass}">${isIncome ? '+' : '-'}${formatCurrency(tx.amount)}</p>
                <button onclick="deleteTransaction('${tx.id}')" class="text-[10px] text-slate-300 hover:text-red-400 mt-1">Hapus</button>
            </div>
        `;
        list.appendChild(item);
    });
}

window.openSettings = async function() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('modal-hidden');

    // Show biometric registration if supported
    const biometricDiv = document.getElementById('biometricSettings');
    if (biometricDiv && window.PublicKeyCredential) {
        const isAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (isAvailable) biometricDiv.classList.remove('hidden');
    }
};

window.closeSettings = function() {
    document.getElementById('settingsModal').classList.add('modal-hidden');
};

// --- STATS LOGIC ---
function updateStats() {
    const expenses = state.transactions.filter(t => t.type === 'expense');
    const incomes = state.transactions.filter(t => t.type === 'income');
    
    const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
    const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
    
    // Sehari-hari stats
    const spentDaily = expenses
        .filter(t => t.account === 'keperluan')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const budget = state.user.budgetLimit;
    const percent = budget > 0 ? Math.min(Math.round((spentDaily / budget) * 100), 100) : 0;
    
    const statsSpent = document.getElementById('statsSpent');
    const statsBudget = document.getElementById('statsBudget');
    const statsPercentage = document.getElementById('statsPercentage');
    const statsProgressBar = document.getElementById('statsProgressBar');
    const statsTotalIncome = document.getElementById('statsTotalIncome');
    const statsTotalExpense = document.getElementById('statsTotalExpense');

    if (statsSpent) statsSpent.textContent = formatCurrency(spentDaily);
    if (statsBudget) statsBudget.textContent = formatCurrency(budget);
    if (statsPercentage) statsPercentage.textContent = `${percent}%`;
    if (statsProgressBar) statsProgressBar.style.width = `${percent}%`;
    if (statsTotalIncome) statsTotalIncome.textContent = formatCurrency(totalIncome);
    if (statsTotalExpense) statsTotalExpense.textContent = formatCurrency(totalExpense);
}

// --- FINAL INITIALIZATION ---
init();
console.log("Dompetku: Application initialized and ready.");

