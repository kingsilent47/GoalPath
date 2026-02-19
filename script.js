// script.js (FULL FEATURE-COMPLETE VERSION)
// GoalPath Mobile PWA + Firebase Auth + Goals + Analytics + Undo + Pin + Archive

// ------------------------------
// Firebase (MODULAR SDK)
// ------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 🔥 REPLACE WITH YOUR FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyAnljv2fdenxbXmU7ofowyFCzW9xa-WPgk",
    authDomain: "goalpath-web.firebaseapp.com",
    projectId: "goalpath-web",
    storageBucket: "goalpath-web.firebasestorage.app",
    messagingSenderId: "675748316914",
    appId: "1:675748316914:web:47c85078eadbe7f092f26b",
    measurementId: "G-DCYDZ57ZJ2"
  };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ------------------------------
// Helpers
// ------------------------------
const $ = (id) => document.getElementById(id);

const todayStr = () => new Date().toISOString().split("T")[0];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function vibrate(ms = 30) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function toast(msg) {
  const el = $("toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2400);
}

function confettiPop() {
  const el = $("confetti");
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("pop");
  setTimeout(() => {
    el.classList.remove("pop");
    el.classList.add("hidden");
  }, 1200);
}

function safeJSONParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function normalizeText(s = "") {
  return s.toLowerCase().trim();
}

// ------------------------------
// GoalPath App
// ------------------------------
class GoalPathApp {
  constructor() {
    this.user = null;

    // local cache (fallback + fast UI)
    this.goals = safeJSONParse(localStorage.getItem("goals"), []);
    this.theme = localStorage.getItem("theme") || "light";

    // Undo system
    this.lastAction = null;

    // Chart instance
    this.weekChart = null;

    // Streak freeze settings
    this.freezeTokens = parseInt(localStorage.getItem("freezeTokens") || "2", 10);

    // UI state
    this.activeTab = "home";
    this.searchQuery = "";
    this.filterCategory = "all";
    this.filterStatus = "active"; // active | completed | archived | all
    this.filterType = "all"; // habit | target | all
    this.onlyPinned = false;

    // For editing
    this.editingGoalId = null;

    // Init
    this.init();
  }

  async init() {
    // Theme
    document.documentElement.setAttribute("data-theme", this.theme);

    // PWA
    this.registerServiceWorker();

    // Auth UI + state
    this.bindAuthEvents();
    this.bindCoreEvents();

    // Auth state
    onAuthStateChanged(auth, async (user) => {
      this.user = user;

      if (!user) {
        this.showAuthScreen();
        return;
      }

      // logged in
      await this.loadUserData();
      this.showAppScreen();
      this.renderAll();
    });
  }

  // ------------------------------
  // PWA
  // ------------------------------
  registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }

  // ------------------------------
  // Auth
  // ------------------------------
  bindAuthEvents() {
    $("login-btn")?.addEventListener("click", () => this.loginEmail());
    $("signup-btn")?.addEventListener("click", () => this.signupEmail());
    $("google-btn")?.addEventListener("click", () => this.loginGoogle());
    $("reset-btn")?.addEventListener("click", () => this.resetPassword());
    $("logout-btn")?.addEventListener("click", () => this.logout());
  }

  async loginEmail() {
    const email = $("auth-email").value.trim();
    const pass = $("auth-pass").value.trim();
    if (!email || !pass) return toast("Enter email + password");

    try {
      await signInWithEmailAndPassword(auth, email, pass);
      toast("Welcome back 👋");
    } catch (e) {
      toast("Login failed: " + e.message);
    }
  }

  async signupEmail() {
    const email = $("auth-email").value.trim();
    const pass = $("auth-pass").value.trim();
    if (!email || !pass) return toast("Enter email + password");

    try {
      await createUserWithEmailAndPassword(auth, email, pass);
      toast("Account created 🎉");
    } catch (e) {
      toast("Signup failed: " + e.message);
    }
  }

  async loginGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      toast("Logged in with Google ✅");
    } catch (e) {
      toast("Google login failed: " + e.message);
    }
  }

  async resetPassword() {
    const email = $("auth-email").value.trim();
    if (!email) return toast("Enter your email first");

    try {
      await sendPasswordResetEmail(auth, email);
      toast("Password reset email sent 📩");
    } catch (e) {
      toast("Reset failed: " + e.message);
    }
  }

  async logout() {
    try {
      await signOut(auth);
      toast("Logged out");
    } catch {}
  }

  showAuthScreen() {
    $("auth-screen")?.classList.remove("hidden");
    $("app-screen")?.classList.add("hidden");
  }

  showAppScreen() {
    $("auth-screen")?.classList.add("hidden");
    $("app-screen")?.classList.remove("hidden");
  }

  // ------------------------------
  // Firestore Storage (per user)
  // ------------------------------
  async loadUserData() {
    if (!this.user) return;

    const ref = doc(db, "goalpath_users", this.user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // first time
      await setDoc(ref, {
        goals: [],
        freezeTokens: 2,
        createdAt: new Date().toISOString()
      });
      this.goals = [];
      this.freezeTokens = 2;
      localStorage.setItem("goals", JSON.stringify(this.goals));
      localStorage.setItem("freezeTokens", "2");
      return;
    }

    const data = snap.data();
    this.goals = data.goals || [];
    this.freezeTokens = data.freezeTokens ?? 2;

    localStorage.setItem("goals", JSON.stringify(this.goals));
    localStorage.setItem("freezeTokens", String(this.freezeTokens));
  }

  async saveUserData() {
    if (!this.user) return;

    const ref = doc(db, "goalpath_users", this.user.uid);
    await updateDoc(ref, {
      goals: this.goals,
      freezeTokens: this.freezeTokens,
      updatedAt: new Date().toISOString()
    });

    localStorage.setItem("goals", JSON.stringify(this.goals));
    localStorage.setItem("freezeTokens", String(this.freezeTokens));
  }

  // ------------------------------
  // Core UI events
  // ------------------------------
  bindCoreEvents() {
    // Theme toggle
    $("theme-toggle")?.addEventListener("click", () => this.toggleTheme());

    // Tabs
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeTab = btn.dataset.tab;
        this.renderAll();
      });
    });

    // New goal
    $("new-goal-btn")?.addEventListener("click", () => this.openGoalModal());
    $("create-first-goal")?.addEventListener("click", () => this.openGoalModal());

    // Close modals
    $("close-modal")?.addEventListener("click", () => this.closeGoalModal());
    $("close-target-popup")?.addEventListener("click", () => this.closeTargetPopup());
    $("close-calendar")?.addEventListener("click", () => this.closeCalendar());

    // Save goal form
    $("goal-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.saveGoalFromForm();
    });

    // Search + filters
    $("search")?.addEventListener("input", (e) => {
      this.searchQuery = e.target.value;
      this.renderGoals();
    });

    $("filter-category")?.addEventListener("change", (e) => {
      this.filterCategory = e.target.value;
      this.renderGoals();
    });

    $("filter-type")?.addEventListener("change", (e) => {
      this.filterType = e.target.value;
      this.renderGoals();
    });

    $("filter-status")?.addEventListener("change", (e) => {
      this.filterStatus = e.target.value;
      this.renderGoals();
    });

    $("only-pinned")?.addEventListener("change", (e) => {
      this.onlyPinned = e.target.checked;
      this.renderGoals();
    });

    // Undo
    $("undo-btn")?.addEventListener("click", () => this.undoLastAction());

    // Export
    $("export-btn")?.addEventListener("click", () => this.exportGoals());

    // Push notifications
    $("enable-notifs")?.addEventListener("click", () => this.enableNotifications());
  }

  toggleTheme() {
    this.theme = this.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", this.theme);
    localStorage.setItem("theme", this.theme);
  }

  // ------------------------------
  // Goal CRUD
  // ------------------------------
  openGoalModal(goal = null) {
    this.editingGoalId = goal?.id || null;

    $("goal-modal")?.classList.remove("hidden");
    $("goal-form").reset();

    // default type
    const type = goal?.type || "habit";
    this.setTypeUI(type);

    // default category
    $("goal-category").value = goal?.category || "Health";

    // pinned
    $("goal-pinned").checked = !!goal?.pinned;

    // title
    $("goal-title").value = goal?.title || "";

    // habit frequency
    document.querySelectorAll("[data-day]").forEach((btn) => {
      btn.classList.remove("bg-indigo-600", "text-white");
    });

    if (type === "habit") {
      (goal?.frequency || ["mon", "tue", "wed", "thu", "fri"]).forEach((d) => {
        const b = document.querySelector(`[data-day="${d}"]`);
        b?.classList.add("bg-indigo-600", "text-white");
      });
    }

    // target
    $("target-value").value = goal?.targetValue || "";
    $("target-unit").value = goal?.unit || "";

    // If editing, show different title
    $("modal-title").textContent = goal ? "Edit Goal" : "New Goal";
  }

  closeGoalModal() {
    $("goal-modal")?.classList.add("hidden");
    this.editingGoalId = null;
  }

  setTypeUI(type) {
    // highlight buttons
    document.querySelectorAll("[data-type]").forEach((b) => {
      b.classList.remove("bg-indigo-600", "text-white");
    });

    const btn = document.querySelector(`[data-type="${type}"]`);
    btn?.classList.add("bg-indigo-600", "text-white");

    // show/hide sections
    $("frequency-section")?.classList.toggle("hidden", type !== "habit");
    $("target-section")?.classList.toggle("hidden", type !== "target");
  }

  saveGoalFromForm() {
    const title = $("goal-title").value.trim();
    if (!title) return toast("Goal title required");

    const type = document.querySelector("[data-type].bg-indigo-600")?.dataset.type || "habit";
    const category = $("goal-category").value;
    const pinned = $("goal-pinned").checked;

    // Editing
    if (this.editingGoalId) {
      const g = this.goals.find((x) => x.id === this.editingGoalId);
      if (!g) return;

      this.lastAction = {
        type: "edit",
        prev: structuredClone(g)
      };

      g.title = title;
      g.category = category;
      g.pinned = pinned;
      g.type = type;
      g.updatedAt = new Date().toISOString();

      if (type === "habit") {
        const days = Array.from(document.querySelectorAll("[data-day].bg-indigo-600")).map((b) => b.dataset.day);
        g.frequency = days.length ? days : ["mon", "tue", "wed", "thu", "fri"];
        delete g.targetValue;
        delete g.unit;
        delete g.currentValue;
      } else {
        g.targetValue = parseFloat($("target-value").value) || 1;
        g.unit = $("target-unit").value.trim() || "x";
        g.currentValue = g.currentValue || 0;
        delete g.frequency;
      }

      this.closeGoalModal();
      this.saveUserData();
      this.renderAll();
      toast("Goal updated ✏️");
      return;
    }

    // Create new
    const goal = {
      id: Date.now().toString(),
      title,
      type,
      category,
      pinned,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checkIns: [],
      archived: false,
      completed: false,
      completionDate: null
    };

    if (type === "habit") {
      const days = Array.from(document.querySelectorAll("[data-day].bg-indigo-600")).map((b) => b.dataset.day);
      goal.frequency = days.length ? days : ["mon", "tue", "wed", "thu", "fri"];
    } else {
      goal.targetValue = parseFloat($("target-value").value) || 1;
      goal.unit = $("target-unit").value.trim() || "x";
      goal.currentValue = 0;
    }

    this.lastAction = { type: "create", goal: structuredClone(goal) };
    this.goals.push(goal);

    this.closeGoalModal();
    this.saveUserData();
    this.renderAll();
    toast("Goal created ✅");
    vibrate(40);
  }

  archiveGoal(id) {
    const g = this.goals.find((x) => x.id === id);
    if (!g) return;

    this.lastAction = { type: "archive", prev: structuredClone(g) };

    g.archived = true;
    g.updatedAt = new Date().toISOString();
    this.saveUserData();
    this.renderAll();
    toast("Goal archived 📦");
  }

  unarchiveGoal(id) {
    const g = this.goals.find((x) => x.id === id);
    if (!g) return;

    this.lastAction = { type: "unarchive", prev: structuredClone(g) };

    g.archived = false;
    g.updatedAt = new Date().toISOString();
    this.saveUserData();
    this.renderAll();
    toast("Restored ✅");
  }

  togglePin(id) {
    const g = this.goals.find((x) => x.id === id);
    if (!g) return;

    this.lastAction = { type: "pin", prev: structuredClone(g) };

    g.pinned = !g.pinned;
    g.updatedAt = new Date().toISOString();
    this.saveUserData();
    this.renderAll();
  }

  // ------------------------------
  // Mark Done (Habit) / Increment (Target)
  // ------------------------------
  markHabitDone(id) {
    const g = this.goals.find((x) => x.id === id);
    if (!g) return;

    const today = todayStr();
    if (g.checkIns.includes(today)) return toast("Already checked today");

    this.lastAction = { type: "checkin", goalId: id, date: today };

    g.checkIns.push(today);
    g.updatedAt = new Date().toISOString();

    // completion rule for habit: 100% for last 7 scheduled days
    const prog = this.calculateProgress(g);
    if (prog >= 100) {
      g.completed = true;
      g.completionDate = new Date().toISOString();
      confettiPop();
      toast("Goal completed 🎉");
    } else {
      toast("Nice! Keep going 🔥");
    }

    this.saveUserData();
    this.renderAll();
    vibrate(60);
  }

  openTargetPopup(id) {
    const g = this.goals.find((x) => x.id === id);
    if (!g) return;

    $("target-popup")?.classList.remove("hidden");
    $("target-popup-title").textContent = g.title;
    $("target-popup-current").textContent = `${g.currentValue || 0} / ${g.targetValue} ${g.unit || ""}`;

    $("target-popup-input").value = "1";

    // confirm button
    $("target-popup-confirm").onclick = () => {
      const amt = parseFloat($("target-popup-input").value) || 1;
      this.incrementTarget(id, amt);
      this.closeTargetPopup();
    };
  }

  closeTargetPopup() {
    $("target-popup")?.classList.add("hidden");
  }

  incrementTarget(id, amount) {
    const g = this.goals.find((x) => x.id === id);
    if (!g) return;

    const prev = g.currentValue || 0;
    const newVal = clamp(prev + amount, 0, g.targetValue || 999999);

    this.lastAction = { type: "targetIncrement", goalId: id, prevValue: prev };

    g.currentValue = newVal;
    g.updatedAt = new Date().toISOString();

    // record check-in for streak tracking too
    const today = todayStr();
    if (!g.checkIns.includes(today)) g.checkIns.push(today);

    if (g.targetValue && g.currentValue >= g.targetValue) {
      g.completed = true;
      g.completionDate = new Date().toISOString();
      confettiPop();
      toast("Target completed 🎉");
    } else {
      toast("Progress saved ✅");
    }

    this.saveUserData();
    this.renderAll();
    vibrate(50);
  }

  // ------------------------------
  // Streak + Freeze
  // ------------------------------
  calculateStreak(checkIns = []) {
    if (!checkIns.length) return 0;

    const sorted = [...checkIns].sort((a, b) => new Date(b) - new Date(a));
    const today = todayStr();

    // streak must include today OR allow freeze
    if (sorted[0] !== today) {
      // allow freeze if yesterday exists
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const y = yesterday.toISOString().split("T")[0];

      if (sorted[0] !== y) return 0;

      // if last check-in was yesterday, streak continues but only if freeze used today
      // we do not auto-use freeze. It’s a token.
      return this.countBackwardStreak(sorted);
    }

    return this.countBackwardStreak(sorted);
  }

  countBackwardStreak(sorted) {
    let streak = 1;
    let current = new Date(sorted[0]);

    for (let i = 1; i < 365; i++) {
      current.setDate(current.getDate() - 1);
      const d = current.toISOString().split("T")[0];
      if (sorted.includes(d)) streak++;
      else break;
    }
    return streak;
  }

  useFreezeToken(goalId) {
    if (this.freezeTokens <= 0) return toast("No streak freezes left ❄️");

    const g = this.goals.find((x) => x.id === goalId);
    if (!g) return;

    // If user already checked today, no need
    const today = todayStr();
    if (g.checkIns.includes(today)) return toast("You already checked in today");

    // Add a "freeze" check-in marker (we store as real day)
    this.lastAction = { type: "freeze", goalId, prevTokens: this.freezeTokens };

    g.checkIns.push(today);
    g.updatedAt = new Date().toISOString();
    this.freezeTokens -= 1;

    this.saveUserData();
    this.renderAll();
    toast("Streak freeze used ❄️");
  }

  // ------------------------------
  // Progress
  // ------------------------------
  calculateProgress(goal) {
    if (goal.archived) return 0;
    if (goal.completed) return 100;

    if (goal.type === "target") {
      if (!goal.targetValue) return 0;
      return Math.min(100, Math.round(((goal.currentValue || 0) / goal.targetValue) * 100));
    }

    // habit progress = last 7 scheduled days consistency
    const freq = goal.frequency || ["mon", "tue", "wed", "thu", "fri"];
    const last7 = [];
    const now = new Date();

    const dayMap = {
      monday: "mon",
      tuesday: "tue",
      wednesday: "wed",
      thursday: "thu",
      friday: "fri",
      saturday: "sat",
      sunday: "sun"
    };

    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dayName = d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      const short = dayMap[dayName];
      if (freq.includes(short)) last7.push(d.toISOString().split("T")[0]);
      if (last7.length === 7) break;
    }

    if (!last7.length) return 0;

    const done = last7.filter((date) => goal.checkIns.includes(date)).length;
    return Math.round((done / last7.length) * 100);
  }

  // ------------------------------
  // Undo
  // ------------------------------
  undoLastAction() {
    if (!this.lastAction) return toast("Nothing to undo");

    const a = this.lastAction;

    if (a.type === "create") {
      this.goals = this.goals.filter((g) => g.id !== a.goal.id);
    }

    if (a.type === "archive" || a.type === "unarchive" || a.type === "pin" || a.type === "edit") {
      const idx = this.goals.findIndex((g) => g.id === a.prev.id);
      if (idx !== -1) this.goals[idx] = a.prev;
    }

    if (a.type === "checkin") {
      const g = this.goals.find((x) => x.id === a.goalId);
      if (g) g.checkIns = g.checkIns.filter((d) => d !== a.date);
    }

    if (a.type === "targetIncrement") {
      const g = this.goals.find((x) => x.id === a.goalId);
      if (g) g.currentValue = a.prevValue;
    }

    if (a.type === "freeze") {
      const g = this.goals.find((x) => x.id === a.goalId);
      if (g) g.checkIns = g.checkIns.filter((d) => d !== todayStr());
      this.freezeTokens = a.prevTokens;
    }

    this.lastAction = null;
    this.saveUserData();
    this.renderAll();
    toast("Undone ↩️");
  }

  // ------------------------------
  // Export
  // ------------------------------
  exportGoals() {
    const data = JSON.stringify(this.goals, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "goalpath-goals.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("Exported goals ✅");
  }

  // ------------------------------
  // Calendar View
  // ------------------------------
  openCalendar(goalId) {
    const g = this.goals.find((x) => x.id === goalId);
    if (!g) return;

    $("calendar-modal")?.classList.remove("hidden");
    $("calendar-title").textContent = `${g.title} — Streak Calendar`;

    const cal = $("calendar-grid");
    cal.innerHTML = "";

    // last 30 days
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const ds = d.toISOString().split("T")[0];
      const done = g.checkIns.includes(ds);

      const cell = document.createElement("div");
      cell.className =
        "calendar-cell " + (done ? "calendar-done" : "calendar-miss");
      cell.title = ds;
      cell.textContent = d.getDate();
      cal.appendChild(cell);
    }
  }

  closeCalendar() {
    $("calendar-modal")?.classList.add("hidden");
  }

  // ------------------------------
  // Notifications (basic)
  // ------------------------------
  async enableNotifications() {
    if (!("Notification" in window)) return toast("Notifications not supported");

    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Permission denied");

    toast("Notifications enabled 🔔");

    // basic daily reminder (works only while app open)
    setInterval(() => {
      const hour = new Date().getHours();
      if (hour === 18) {
        new Notification("GoalPath", {
          body: "Time to do your habits 💪"
        });
      }
    }, 1000 * 60 * 20);
  }

  // ------------------------------
  // Render
  // ------------------------------
  renderAll() {
    this.renderTabs();
    this.renderStats();
    this.renderGoals();
    this.renderCompleted();
    this.renderDailySummary();
    this.renderAnalytics();
    this.renderFreezeTokens();
  }

  renderTabs() {
    document.querySelectorAll("[data-screen]").forEach((s) => {
      s.classList.add("hidden");
    });

    const screen = document.querySelector(`[data-screen="${this.activeTab}"]`);
    screen?.classList.remove("hidden");

    document.querySelectorAll("[data-tab]").forEach((b) => {
      b.classList.remove("tab-active");
    });

    document.querySelector(`[data-tab="${this.activeTab}"]`)?.classList.add("tab-active");
  }

  renderFreezeTokens() {
    if ($("freeze-count")) $("freeze-count").textContent = String(this.freezeTokens);
  }

  renderStats() {
    const active = this.goals.filter((g) => !g.archived && !g.completed);
    const completed = this.goals.filter((g) => g.completed);
    const archived = this.goals.filter((g) => g.archived);

    const bestStreak = Math.max(
      ...this.goals.map((g) => this.calculateStreak(g.checkIns)),
      0
    );

    $("stat-total").textContent = String(this.goals.length);
    $("stat-active").textContent = String(active.length);
    $("stat-completed").textContent = String(completed.length);
    $("stat-archived").textContent = String(archived.length);
    $("stat-streak").textContent = String(bestStreak);
  }

  getFilteredGoals() {
    let list = [...this.goals];

    // status filter
    if (this.filterStatus === "active") list = list.filter((g) => !g.archived && !g.completed);
    if (this.filterStatus === "completed") list = list.filter((g) => g.completed);
    if (this.filterStatus === "archived") list = list.filter((g) => g.archived);

    // type filter
    if (this.filterType !== "all") list = list.filter((g) => g.type === this.filterType);

    // category
    if (this.filterCategory !== "all") list = list.filter((g) => g.category === this.filterCategory);

    // pinned only
    if (this.onlyPinned) list = list.filter((g) => g.pinned);

    // search
    if (this.searchQuery.trim()) {
      const q = normalizeText(this.searchQuery);
      list = list.filter((g) => normalizeText(g.title).includes(q));
    }

    // pinned top
    list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    return list;
  }

  renderGoals() {
    const list = this.getFilteredGoals();
    const el = $("goals-list");
    const empty = $("empty-state");

    if (!list.length) {
      empty?.classList.remove("hidden");
      el.innerHTML = "";
      return;
    }

    empty?.classList.add("hidden");

    el.innerHTML = list
      .map((g) => {
        const progress = this.calculateProgress(g);
        const streak = this.calculateStreak(g.checkIns);

        const typeBadge =
          g.type === "habit"
            ? `<span class="badge badge-habit">Habit</span>`
            : `<span class="badge badge-target">Target</span>`;

        const statusBadge = g.archived
          ? `<span class="badge badge-archived">Archived</span>`
          : g.completed
          ? `<span class="badge badge-completed">Completed</span>`
          : "";

        return `
        <div class="goal-card">
          <div class="goal-head">
            <div>
              <div class="goal-title">${g.title}</div>
              <div class="goal-meta">
                ${typeBadge}
                <span class="badge badge-category">${g.category || "General"}</span>
                ${statusBadge}
              </div>
            </div>

            <div class="goal-right">
              ${streak > 0 ? `<div class="streak">🔥 ${streak}</div>` : ""}
              <div class="progress-num">${progress}%</div>
            </div>
          </div>

          <div class="progress-bar">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>

          <div class="goal-actions">
            ${
              g.type === "habit"
                ? `<button class="btn btn-secondary small" data-action="done" data-id="${g.id}">Mark Done</button>`
                : `<button class="btn btn-secondary small" data-action="inc" data-id="${g.id}">Mark Done</button>`
            }

            <button class="btn btn-secondary small" data-action="edit" data-id="${g.id}">Edit</button>

            <button class="btn btn-secondary small" data-action="calendar" data-id="${g.id}">Calendar</button>

            <button class="btn btn-secondary small" data-action="pin" data-id="${g.id}">
              ${g.pinned ? "Unpin" : "Pin"}
            </button>

            ${
              g.archived
                ? `<button class="btn btn-secondary small" data-action="restore" data-id="${g.id}">Restore</button>`
                : `<button class="btn btn-danger small" data-action="archive" data-id="${g.id}">Archive</button>`
            }

            ${
              !g.completed && !g.archived
                ? `<button class="btn btn-secondary small" data-action="freeze" data-id="${g.id}">Freeze ❄️</button>`
                : ""
            }
          </div>
        </div>
      `;
      })
      .join("");

    // Bind actions
    el.querySelectorAll("[data-action]").forEach((btn) => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;

      btn.addEventListener("click", () => {
        if (action === "done") {
          const g = this.goals.find((x) => x.id === id);
          if (!g) return;

          if (g.type === "habit") this.markHabitDone(id);
          else this.openTargetPopup(id);
        }

        if (action === "inc") this.openTargetPopup(id);
        if (action === "edit") this.openGoalModal(this.goals.find((x) => x.id === id));
        if (action === "calendar") this.openCalendar(id);
        if (action === "pin") this.togglePin(id);
        if (action === "archive") this.archiveGoal(id);
        if (action === "restore") this.unarchiveGoal(id);
        if (action === "freeze") this.useFreezeToken(id);
      });
    });
  }

  renderCompleted() {
    const list = this.goals.filter((g) => g.completed && !g.archived);
    const el = $("completed-list");

    if (!el) return;

    if (!list.length) {
      el.innerHTML = `<div class="muted">No completed goals yet.</div>`;
      return;
    }

    el.innerHTML = list
      .sort((a, b) => new Date(b.completionDate) - new Date(a.completionDate))
      .map(
        (g) => `
      <div class="goal-card completed-card">
        <div class="goal-title">${g.title}</div>
        <div class="muted">${g.category} • ${g.type}</div>
        <div class="muted">Completed: ${new Date(g.completionDate).toLocaleDateString()}</div>
      </div>
    `
      )
      .join("");
  }

  renderDailySummary() {
    const el = $("daily-summary");
    if (!el) return;

    const today = todayStr();

    const active = this.goals.filter((g) => !g.archived && !g.completed);
    const doneToday = active.filter((g) => g.checkIns.includes(today)).length;

    const habits = active.filter((g) => g.type === "habit").length;
    const targets = active.filter((g) => g.type === "target").length;

    el.innerHTML = `
      <div class="card">
        <div class="summary-title">Daily Summary</div>
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-big">${doneToday}</div>
            <div class="muted">Done today</div>
          </div>
          <div class="summary-item">
            <div class="summary-big">${active.length}</div>
            <div class="muted">Active goals</div>
          </div>
          <div class="summary-item">
            <div class="summary-big">${habits}</div>
            <div class="muted">Habits</div>
          </div>
          <div class="summary-item">
            <div class="summary-big">${targets}</div>
            <div class="muted">Targets</div>
          </div>
        </div>
      </div>
    `;
  }

  renderAnalytics() {
    const canvas = $("weeklyChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    // last 7 days labels
    const labels = [];
    const counts = [];

    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const ds = d.toISOString().split("T")[0];

      labels.push(d.toLocaleDateString("en-US", { weekday: "short" }));

      // count checkins across active goals
      const count = this.goals.filter((g) => !g.archived && !g.completed).filter((g) => g.checkIns.includes(ds)).length;
      counts.push(count);
    }

    if (this.weekChart) this.weekChart.destroy();

    this.weekChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Consistency (Goals done per day)",
            data: counts
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 }
          }
        }
      }
    });
  }
}

// ------------------------------
// Boot
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Force mobile-only message if needed
  if (window.innerWidth > 768) {
    $("desktop-warning")?.classList.remove("hidden");
  }

  window.goalPath = new GoalPathApp();

  // Type buttons
  document.querySelectorAll("[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-type]").forEach((b) => {
        b.classList.remove("bg-indigo-600", "text-white");
      });
      btn.classList.add("bg-indigo-600", "text-white");

      const type = btn.dataset.type;
      window.goalPath?.setTypeUI(type);
    });
  });

  // Day toggles
  document.querySelectorAll("[data-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("bg-indigo-600");
      btn.classList.toggle("text-white");
    });
  });
  // ------------------------------
// Fix Login & Register buttons
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
    // Ensure buttons trigger the right functions
    $("login-btn")?.addEventListener("click", (e) => {
      e.preventDefault(); // prevent form submission
      window.goalPath?.loginEmail();
    });
  
    $("signup-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.goalPath?.signupEmail();
    });
  });
  // ------------------------------
// Fix all Auth buttons (Login, Signup, Google, Reset)
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
    // Login (email/password)
    $("login-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.goalPath?.loginEmail();
    });
  
    // Signup (email/password)
    $("signup-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.goalPath?.signupEmail();
    });
  
    // Google login
    $("google-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.goalPath?.loginGoogle();
    });
  
    // Password reset
    $("reset-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.goalPath?.resetPassword();
    });
  });  
});
