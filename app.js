// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => console.log('SW registered'))
      .catch((error) => console.log('SW registration failed:', error));
  });
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, setDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCskmkr4NiESLklUz_tFfCkKN9SaPVA2cg",
    authDomain: "mydompett.firebaseapp.com",
    projectId: "mydompett",
    storageBucket: "mydompett.firebasestorage.app",
    messagingSenderId: "117090715890",
    appId: "1:117090715890:web:30c824d5f9a21c1c01a86b",
    measurementId: "G-T4Q2FBZD33"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// State Management
let transactions = [];
let monthlyBudget = 300000;
let isBalanceVisible = localStorage.getItem('dompetku_visibility') !== 'false'; // default true
let isLoggedIn = false;

let unsubTransactions = null;
let unsubBudget = null;

// DOM Elements
const mainApp = document.getElementById('mainApp');
const loginView = document.getElementById('loginView');
const passwordLoginForm = document.getElementById('passwordLoginForm');
const loginUsernameInput = document.getElementById('loginUsername');
const loginPasswordInput = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');

const totalBalanceEl = document.getElementById('totalBalance');
const tabunganBalanceEl = document.getElementById('tabunganBalance');
const keperluanBalanceEl = document.getElementById('keperluanBalance');
const transactionListEl = document.getElementById('transactionList');
const emptyStateEl = document.getElementById('emptyState');
const modal = document.getElementById('transactionModal');
const settingsModal = document.getElementById('settingsModal');
const form = document.getElementById('transactionForm');
const settingsForm = document.getElementById('settingsForm');
const amountInput = document.getElementById('amount');
const budgetInput = document.getElementById('budgetInput');
const submitBtn = document.getElementById('submitBtn');

// View & Stats Elements
const homeHeader = document.getElementById('homeHeader');
const homeMain = document.getElementById('homeMain');
const statsHeader = document.getElementById('statsHeader');
const statsMain = document.getElementById('statsMain');
const navHome = document.getElementById('navHome');
const navStats = document.getElementById('navStats');
const iconHome = document.getElementById('iconHome');
const iconStats = document.getElementById('iconStats');

const statsSpent = document.getElementById('statsSpent');
const statsBudget = document.getElementById('statsBudget');
const statsProgressBar = document.getElementById('statsProgressBar');
const statsPercentage = document.getElementById('statsPercentage');
const statsTotalIncome = document.getElementById('statsTotalIncome');
const statsTotalExpense = document.getElementById('statsTotalExpense');

const bukuHeader = document.getElementById('bukuHeader');
const bukuMain = document.getElementById('bukuMain');
const navBuku = document.getElementById('navBuku');
const iconBuku = document.getElementById('iconBuku');

const bukuTabunganBalance = document.getElementById('bukuTabunganBalance');
const bukuKeperluanBalance = document.getElementById('bukuKeperluanBalance');

const visibilityIcon = document.getElementById('visibilityIcon');

// Current State
let currentView = 'home';

// Auth Login Logic
function executeLogin() {
    isLoggedIn = true;
    loginView.classList.add('hidden');
    mainApp.classList.remove('hidden');
    mainApp.classList.add('flex'); // Because the class is flex-col
    
    // Start syncing with Firebase
    loadDataFromFirebase();
}

function loadDataFromFirebase() {
    // Listen to budget changes
    const budgetDoc = doc(db, "settings", "budget");
    unsubBudget = onSnapshot(budgetDoc, (docSnap) => {
        if (docSnap.exists()) {
            monthlyBudget = docSnap.data().amount || 300000;
        } else {
            // First time running app on this DB instance, set default
            setDoc(budgetDoc, { amount: 300000 });
        }
        updateBalances();
    });

    // Listen to real-time transactions
    const q = query(collection(db, "transactions"), orderBy("date", "desc"));
    unsubTransactions = onSnapshot(q, (snapshot) => {
        transactions = []; // reset local memory
        snapshot.forEach((docSnap) => {
            transactions.push({ id: docSnap.id, ...docSnap.data() });
        });
        updateBalances();
        renderTransactions();
    });
}

window.showPasswordForm = () => {
    document.getElementById('btnBiometric').classList.add('hidden');
    passwordLoginForm.classList.remove('hidden');
};

window.tryBiometricLogin = async () => {
    try {
        if (window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) {
            const credentialIdStr = localStorage.getItem('dompetku_biometric_id');
            
            if (credentialIdStr) {
                // Try to authenticate
                const challenge = new Uint8Array(32);
                crypto.getRandomValues(challenge);
                
                const assertion = await navigator.credentials.get({
                    publicKey: {
                        challenge: challenge,
                        allowCredentials: [{
                            type: "public-key",
                            id: Uint8Array.from(atob(credentialIdStr), c => c.charCodeAt(0))
                        }],
                        userVerification: "required"
                    }
                });
                
                if (assertion) executeLogin();
                
            } else {
                // First time, register (Mocking RP for local/demo use)
                const challenge = new Uint8Array(32);
                crypto.getRandomValues(challenge);
                const userId = new Uint8Array(16);
                crypto.getRandomValues(userId);

                const credential = await navigator.credentials.create({
                    publicKey: {
                        challenge: challenge,
                        rp: { name: "Dompetku App", id: window.location.hostname || "localhost" },
                        user: { id: userId, name: "user", displayName: "User" },
                        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
                        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" }
                    }
                });
                
                if (credential) {
                    const idStr = btoa(String.fromCharCode.apply(null, new Uint8Array(credential.rawId)));
                    localStorage.setItem('dompetku_biometric_id', idStr);
                    executeLogin();
                }
            }
        } else {
            // Biometric not available
            showPasswordForm();
        }
    } catch (err) {
        console.warn("Biometric failed or cancelled", err);
        showPasswordForm();
    }
};

window.handlePasswordLogin = (e) => {
    e.preventDefault();
    const u = loginUsernameInput.value;
    const p = loginPasswordInput.value;
    
    // Default fallback credentials: admin / admin
    if (u === 'admin' && p === 'admin') {
        executeLogin();
        // Clear inputs for security
        loginUsernameInput.value = '';
        loginPasswordInput.value = '';
        loginError.classList.add('hidden');
    } else {
        loginError.classList.remove('hidden');
    }
};

// Helper: Format to IDR
const formatRupiah = (number) => {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(number);
};

// Helper: Format Date
const formatDate = (dateString) => {
    const options = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(dateString).toLocaleDateString('id-ID', options);
};

// Initialize App
function initApp() {
    updateBalances();
    renderTransactions();
}

// Update Balances Calculation
function updateBalances() {
    let totalIncome = 0;
    let tabunganExpense = 0;
    let keperluanExpense = 0;

    // Determine the number of months since the user started recording (first transaction)
    let totalAllocatedBudget = monthlyBudget;
    
    if (transactions.length > 0) {
        const oldestDate = new Date(Math.min(...transactions.map(t => new Date(t.date))));
        const currentDate = new Date();
        
        // Month difference. e.g. same month/year = 0 difference -> 1 month budget
        const monthsPassed = (currentDate.getFullYear() - oldestDate.getFullYear()) * 12 + 
                             (currentDate.getMonth() - oldestDate.getMonth());
        
        totalAllocatedBudget = monthlyBudget * (monthsPassed + 1);
    }

    // Calculate all incomes and expenses
    transactions.forEach(t => {
        const amount = parseFloat(t.amount);
        if (t.type === 'income') {
            totalIncome += amount;
        } else {
            if (t.account === 'tabungan') tabunganExpense += amount;
            if (t.account === 'keperluan') keperluanExpense += amount;
        }
    });

    // Saldo Sehari-hari adalah Total Budget yang telah dialokasikan (tiap bulan bertambah) dikurangi Pengeluaran Sehari-hari
    let keperluan = totalAllocatedBudget - keperluanExpense;
    
    // Saldo Tabungan adalah Total Semua Pemasukan dikurangi (Total Budget Sehari-hari yang disisihkan + Pengeluaran Tabungan)
    // Jika Total Pemasukan belum mencapai Budget Sehari-hari, tabungan bisa minus atau kita anggap 0.  
    let tabungan = totalIncome - totalAllocatedBudget - tabunganExpense;

    // Total Saldo keseluruhan uang yang ada saat ini
    const total = tabungan + keperluan;

    if (isBalanceVisible) {
        totalBalanceEl.textContent = formatRupiah(total);
        tabunganBalanceEl.textContent = formatRupiah(tabungan);
        keperluanBalanceEl.textContent = formatRupiah(keperluan);
        visibilityIcon.className = "ph ph-eye text-lg";
    } else {
        totalBalanceEl.textContent = "Rp •••••••";
        tabunganBalanceEl.textContent = "Rp •••••";
        keperluanBalanceEl.textContent = "Rp •••••";
        visibilityIcon.className = "ph ph-eye-closed text-lg";
    }

    // Update Views
    updateStatsView(totalAllocatedBudget, keperluanExpense, totalIncome, tabunganExpense + keperluanExpense);
    updateBukuView(tabungan, keperluan);
}

// Update Buku DOM
function updateBukuView(tabungan, keperluan) {
    if(!bukuTabunganBalance) return;
    bukuTabunganBalance.textContent = formatRupiah(tabungan);
    bukuKeperluanBalance.textContent = formatRupiah(keperluan);
}

// Update Stats DOM
function updateStatsView(budget, spent, income, totalExpense) {
    if(!statsSpent) return; // safety check if DOM not loaded yet

    statsSpent.textContent = formatRupiah(spent);
    statsBudget.textContent = formatRupiah(budget);
    
    let percentage = 0;
    if (budget > 0) {
        percentage = Math.min(100, Math.round((spent / budget) * 100));
    }
    
    statsProgressBar.style.width = `${percentage}%`;
    statsPercentage.textContent = `${percentage}% Terpakai`;
    
    // Color change on progress bar if near full
    if (percentage > 85) {
        statsProgressBar.className = "h-full bg-red-500 rounded-full transition-all duration-1000 ease-out";
    } else if (percentage > 60) {
        statsProgressBar.className = "h-full bg-amber-500 rounded-full transition-all duration-1000 ease-out";
    } else {
        statsProgressBar.className = "h-full bg-blue-500 rounded-full transition-all duration-1000 ease-out";
    }

    statsTotalIncome.textContent = formatRupiah(income);
    statsTotalExpense.textContent = formatRupiah(totalExpense);
}

// Render Transaction List
function renderTransactions() {
    transactionListEl.innerHTML = '';
    
    if (transactions.length === 0) {
        transactionListEl.appendChild(emptyStateEl);
        emptyStateEl.style.display = 'block';
        return;
    }
    
    emptyStateEl.style.display = 'none';

    // Sort by newest
    const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

    sorted.forEach((t, index) => {
        const isIncome = t.type === 'income';
        const sign = isIncome ? '+' : '-';
        // According to the screenshot, Income is blue, Expense would likely be a red/orange.
        const colorClass = isIncome ? 'text-blue-600' : 'text-slate-800'; // Make expense darker or red, income blue
        const iconBg = isIncome ? 'bg-blue-50' : 'bg-slate-50';
        const iconColor = isIncome ? 'text-blue-600' : 'text-slate-600';
        
        // Let's use simpler line icons to match the design (e.g., arrow down left or up right, or just simple carets)
        const icon = isIncome ? 'ph-arrow-down-left' : 'ph-arrow-up-right';
        
        let accountIcon = t.account === 'tabungan' ? 'ph-piggy-bank' : 'ph-wallet';
        let accountLabel = t.account === 'tabungan' ? 'Tabungan' : 'Sehari-hari';

        const item = document.createElement('div');
        item.className = 'relative w-full bg-white p-[18px] sm:p-5 rounded-3xl shadow-[0_2px_20px_rgba(0,0,0,0.03)] flex items-center gap-4 mb-3 border border-slate-50 hover:border-slate-100 transition-all group';
        item.innerHTML = `
            <!-- Left Arrow Icon -->
            <div class="w-[46px] h-[46px] sm:w-[50px] sm:h-[50px] shrink-0 rounded-full ${iconBg} flex items-center justify-center ${iconColor}">
                <i class="ph ${icon} text-lg sm:text-xl font-medium"></i>
            </div>
            
            <!-- Middle Text & Right Amount -->
            <div class="flex-1 min-w-0 flex flex-col justify-center gap-1.5 relative">
                <!-- Top Row: Title & Amount -->
                <div class="flex justify-between items-start gap-2">
                    <h4 class="text-slate-800 font-semibold text-[15px] sm:text-[16px] truncate">${t.description}</h4>
                    <span class="font-bold whitespace-nowrap text-[14px] sm:text-[15px] tracking-tight ${colorClass} mt-0.5">${sign} ${formatRupiah(t.amount)}</span>
                </div>
                
                <!-- Bottom Row: Pill, Date & Trash -->
                <div class="flex justify-between items-center pr-1 sm:pr-0">
                    <div class="flex items-center gap-2 text-[11px] sm:text-xs font-medium text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis w-full pr-6">
                        <span class="flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-200/60 bg-white text-slate-500 shrink-0 shadow-sm">
                            <i class="ph ${accountIcon} text-blue-500"></i> ${accountLabel}
                        </span>
                        <span class="opacity-40 shrink-0">•</span>
                        <span class="truncate">${formatDate(t.date)}</span>
                    </div>
                </div>
            </div>
            
            <!-- Absolute Trash Button (Bottom Right Aligned) -->
            <button onclick="deleteTransaction('${t.id}')" class="absolute bottom-[16px] sm:bottom-[18px] right-[16px] sm:right-[18px] text-slate-300 hover:text-red-500 transition-colors cursor-pointer p-1.5 -m-1.5 rounded flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100">
                <i class="ph ph-trash text-base"></i>
            </button>
        `;
        transactionListEl.appendChild(item);
    });
}

// Delete Transaction
window.deleteTransaction = async (id) => {
    if(confirm('Hapus transaksi ini?')) {
        try {
            await deleteDoc(doc(db, "transactions", id));
        } catch(err) {
            console.error("Error deleting document: ", err);
        }
    }
};
// Toggle Balance Visibility
window.toggleBalanceVisibility = () => {
    isBalanceVisible = !isBalanceVisible;
    localStorage.setItem('dompetku_visibility', isBalanceVisible.toString());
    updateBalances();
};

// Modal Functions - Transaction
window.openModal = () => {
    modal.classList.remove('modal-hidden');
    form.reset();
    updateFormUI();
    // small delay to focus
    setTimeout(() => amountInput.focus(), 100);
};

window.closeModal = () => {
    modal.classList.add('modal-hidden');
};

// Modal Functions - Settings
window.openSettings = () => {
    settingsModal.classList.remove('modal-hidden');
    budgetInput.value = formatRupiahInput(monthlyBudget.toString());
};

window.closeSettings = () => {
    settingsModal.classList.add('modal-hidden');
};

// Expose safeBudget
window.saveBudget = async (newBudget) => {
    // UI update gets triggered by onSnapshot automatically
    try {
        await setDoc(doc(db, "settings", "budget"), { amount: newBudget });
    } catch(err) {
        console.error("Error setting budget:", err);
    }
};

// View Switcher
window.switchView = (view) => {
    currentView = view;
    
    // Hide all panels
    homeHeader.classList.add('hidden');
    homeMain.classList.add('hidden');
    statsHeader.classList.add('hidden');
    statsMain.classList.add('hidden');
    if(bukuHeader) bukuHeader.classList.add('hidden');
    if(bukuMain) bukuMain.classList.add('hidden');
    
    // Reset all nav icons
    navHome.className = "flex flex-col items-center text-slate-400 gap-1 hover:text-blue-600 transition-colors w-12";
    iconHome.className = "ph ph-house text-2xl";
    navStats.className = "flex flex-col items-center text-slate-400 gap-1 hover:text-blue-600 transition-colors w-12";
    iconStats.className = "ph ph-chart-line-up text-2xl";
    if(navBuku) {
        navBuku.className = "flex flex-col items-center text-slate-400 gap-1 hover:text-blue-600 transition-colors w-12";
        iconBuku.className = "ph ph-credit-card text-2xl";
    }
    
    if (view === 'home') {
        homeHeader.classList.remove('hidden');
        homeMain.classList.remove('hidden');
        navHome.className = "flex flex-col items-center text-blue-600 gap-1 w-12 transition-colors";
        iconHome.className = "ph-fill ph-house text-2xl";
    } else if (view === 'stats') {
        statsHeader.classList.remove('hidden');
        statsMain.classList.remove('hidden');
        navStats.className = "flex flex-col items-center text-blue-600 gap-1 w-12 transition-colors";
        iconStats.className = "ph-fill ph-chart-line-up text-2xl";
    } else if (view === 'buku') {
        if(bukuHeader) bukuHeader.classList.remove('hidden');
        if(bukuMain) bukuMain.classList.remove('hidden');
        if(navBuku) {
            navBuku.className = "flex flex-col items-center text-blue-600 gap-1 w-12 transition-colors";
            iconBuku.className = "ph-fill ph-credit-card text-2xl";
        }
    }
};

// Close modals when clicking outside
modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
});

// Update Form UI based on Type
window.updateFormUI = () => {
    const type = document.querySelector('input[name="type"]:checked').value;
    if (type === 'income') {
        submitBtn.className = "w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-500/30 transition-all cursor-pointer";
        submitBtn.textContent = 'Simpan Pemasukan';
    } else {
        submitBtn.className = "w-full py-3.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold shadow-lg shadow-red-500/30 transition-all cursor-pointer";
        submitBtn.textContent = 'Simpan Pengeluaran';
    }
};

// Handle Form Submit
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const type = document.querySelector('input[name="type"]:checked').value;
    const account = document.querySelector('input[name="account"]:checked').value;
    
    const amountStr = amountInput.value.replace(/[^0-9]/g, '');
    const amount = parseFloat(amountStr);
    const description = document.getElementById('description').value;

    if (isNaN(amount) || amount <= 0 || !description) {
        alert('Masukkan nominal dan deskripsi yang valid');
        return;
    }

    const newTransaction = {
        type: type,
        // If it's an income, we default the account to 'tabungan' strictly in logic 
        // to simplify the flow (all incoming money goes to main pool).
        account: type === 'income' ? 'tabungan' : account,
        amount: amount,
        description: description,
        date: new Date().toISOString()
    };

    closeModal();
    try {
        await addDoc(collection(db, "transactions"), newTransaction);
    } catch(err) {
        console.error("Error adding document", err);
    }
});

// Handle Settings Submit
settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const rawAmount = budgetInput.value.replace(/\./g, '').replace(/,/g, '');
    const amount = parseFloat(rawAmount);

    if (isNaN(amount) || amount < 0) {
        alert('Masukkan nominal yang valid');
        return;
    }

    window.saveBudget(amount);
    closeSettings();
});

// Helper for real-time formatting
function formatRupiahInput(value) {
    let cleanVal = value.replace(/[^,\d]/g, '').toString();
    const split = cleanVal.split(',');
    const sisa = split[0].length % 3;
    let rupiah = split[0].substr(0, sisa);
    const ribuan = split[0].substr(sisa).match(/\d{3}/gi);

    if (ribuan) {
        const separator = sisa ? '.' : '';
        rupiah += separator + ribuan.join('.');
    }

    return split[1] != undefined ? rupiah + ',' + split[1] : rupiah;
}

// Realtime Rupiah formatting on Input
amountInput.addEventListener('input', function(e) {
    this.value = formatRupiahInput(this.value);
});

budgetInput.addEventListener('input', function(e) {
    this.value = formatRupiahInput(this.value);
});

// Call init on load
initApp();
