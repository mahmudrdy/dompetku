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
        isLoggedIn: false
    },
    balances: {
        tabungan: 0,
        keperluan: 0
    },
    transactions: [],
    settings: {
        isBalanceVisible: true
    }
};

const COLLECTIONS = {
    TRANSACTIONS: "transactions",
    USER: "user_data"
};

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
        console.log("Dompetku: Triggering native biometric prompt...");
        
        // Mocking a basic WebAuthn challenge for local verification
        // In a real app, 'challenge' should come from server
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        const options = {
            publicKey: {
                challenge: challenge,
                timeout: 60000,
                userVerification: "required",
                allowCredentials: [] // Empty means look for any platform credential
            }
        };

        // This triggers the native Windows Hello / TouchID / FaceID prompt
        // Note: Client-side only get() without allowCredentials might fail on some browsers
        // so we use a fallback if the prompt fails or isn't supported as expected
        if (navigator.credentials && navigator.credentials.get) {
            // We use create() if get() is too restrictive for empty credentials
            // For a simple "unlock", we want to verify user presence/identity
            await navigator.credentials.get(options);
            
            state.user.isLoggedIn = true;
            checkAuth();
            renderApp();
        } else {
            throw new Error("API not supported");
        }
    } catch (err) {
        console.error("Biometric Authentication failed:", err);
        alert("Gagal melakukan verifikasi biometrik. Silakan gunakan password.");
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
                state.settings.isBalanceVisible = data.isBalanceVisible ?? true;
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
    let tabungan = 0;
    let keperluan = state.user.budgetLimit;

    state.transactions.forEach(tx => {
        if (tx.type === 'income') {
            tabungan += (tx.account === 'tabungan' ? tx.amount : 0);
            keperluan += (tx.account === 'keperluan' ? tx.amount : 0);
        } else {
            tabungan -= (tx.account === 'tabungan' ? tx.amount : 0);
            keperluan -= (tx.account === 'keperluan' ? tx.amount : 0);
        }
    });

    state.balances.tabungan = tabungan;
    state.balances.keperluan = keperluan;
}

async function saveUserSettings() {
    try {
        await setDoc(doc(db, COLLECTIONS.USER, "current_user"), {
            name: state.user.name,
            budgetLimit: state.user.budgetLimit,
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

        // Update Display Name
        const nameDisplay = document.getElementById('userNameDisplay');
        if (nameDisplay) nameDisplay.textContent = `Halo, ${state.user.name}! 👋`;
        
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

function renderTransactions() {
    const list = document.getElementById('transactionList');
    const emptyState = document.getElementById('emptyState');
    
    if (state.transactions.length === 0) {
        emptyState.classList.remove('hidden');
        list.querySelectorAll('.transaction-item').forEach(el => el.remove());
        return;
    }

    emptyState.classList.add('hidden');
    
    // Clear current list items except empty state
    list.querySelectorAll('.transaction-item').forEach(el => el.remove());

    state.transactions.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'transaction-item flex justify-between items-center p-4 bg-white rounded-2xl border border-slate-100 shadow-sm';
        
        const isIncome = tx.type === 'income';
        const colorClass = isIncome ? 'text-blue-600' : 'text-red-500';
        const bgClass = isIncome ? 'bg-blue-50' : 'bg-red-50';
        const iconClass = tx.account === 'tabungan' ? 'ph ph-piggy-bank' : 'ph ph-wallet';
        
        // Securing against XSS by using separate elements for user-generated content
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
        // Safe injection
        leftSide.querySelector('.desc-text').textContent = tx.description;

        const rightSide = document.createElement('div');
        rightSide.className = 'text-right';
        rightSide.innerHTML = `
            <p class="text-sm font-bold ${colorClass}">${isIncome ? '+' : '-'}${formatCurrency(tx.amount)}</p>
            <button class="text-[10px] text-slate-300 hover:text-red-400 transition-colors btn-delete">Hapus</button>
        `;
        rightSide.querySelector('.btn-delete').onclick = () => deleteTransaction(tx.id);

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
    const views = ['home', 'stats', 'buku'];
    views.forEach(v => {
        const header = document.getElementById(`${v}Header`);
        const main = document.getElementById(`${v}Main`);
        const nav = document.getElementById(`nav${v.charAt(0).toUpperCase() + v.slice(1)}`);
        const icon = document.getElementById(`icon${v.charAt(0).toUpperCase() + v.slice(1)}`);

        if (v === view) {
            header.classList.remove('hidden');
            main.classList.remove('hidden');
            nav.classList.replace('text-slate-400', 'text-blue-600');
            if (icon) icon.classList.replace('ph', 'ph-fill');
        } else {
            header.classList.add('hidden');
            main.classList.add('hidden');
            nav.classList.replace('text-blue-600', 'text-slate-400');
            if (icon) icon.classList.replace('ph-fill', 'ph');
        }
    });
    
    if (view === 'stats') updateStats();
};

window.openSettings = function() {
    document.getElementById('settingsModal').classList.remove('modal-hidden');
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

