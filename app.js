import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const scriptsCol = collection(db, "scripts");

// SHA-256 لكلمة سر الإدارة (لا نحفظ كلمة السر نفسها في الكود)
const PASS_HASH = "8b8d5f95d5558acd6d29dce761e46612370283c3edf21b9450426ad724fedb2e";

const $ = (id) => document.getElementById(id);
let all = [];

/* ---------- التنقل ---------- */
function route() {
  const page = location.hash === "#admin" ? "admin" : "scripts";
  $("view-scripts").hidden = page !== "scripts";
  $("view-admin").hidden = page !== "admin";
  document.querySelectorAll("nav a").forEach(a =>
    a.classList.toggle("active", a.dataset.link === page));
  if (page === "admin") checkLock();
}
window.addEventListener("hashchange", route);

/* ---------- قراءة السكربتات ---------- */
onSnapshot(query(scriptsCol, orderBy("createdAt", "desc")), (snap) => {
  all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderGrid();
  renderAdminList();
}, (err) => {
  $("status").textContent = "تعذّر الاتصال بقاعدة البيانات: " + err.message;
});

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(ts) {
  try { return ts?.toDate().toLocaleDateString("ar-SA"); } catch { return ""; }
}

function renderGrid() {
  const q = $("search").value.trim().toLowerCase();
  const list = all.filter(s => (s.name || "").toLowerCase().includes(q));
  $("status").textContent = list.length ? "" : (all.length ? "ما فيه نتائج" : "ما فيه سكربتات للحين");
  $("grid").innerHTML = list.map(s => `
    <article class="item" data-id="${s.id}">
      <div class="thumb">${s.image ? `<img src="${s.image}" alt="" loading="lazy">` : "VTX"}</div>
      <div class="body"><h3>${esc(s.name)}</h3><small>${fmtDate(s.createdAt)}</small></div>
    </article>`).join("");
}
$("search").addEventListener("input", renderGrid);

$("grid").addEventListener("click", (e) => {
  const card = e.target.closest(".item");
  if (!card) return;
  const s = all.find(x => x.id === card.dataset.id);
  $("vTitle").textContent = s.name;
  $("vCode").textContent = s.code;
  $("vCopy").textContent = "نسخ السكربت";
  $("viewer").showModal();
});
$("vClose").onclick = () => $("viewer").close();
$("vCopy").onclick = async () => {
  await navigator.clipboard.writeText($("vCode").textContent);
  $("vCopy").textContent = "تم النسخ ✓";
};

/* ---------- الإدارة ---------- */
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function isUnlocked() {
  try { return sessionStorage.getItem("vtx-admin") === "1"; } catch { return false; }
}
function checkLock() {
  const ok = isUnlocked();
  $("lock").hidden = ok;
  $("panel").hidden = !ok;
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await sha256($("pass").value) === PASS_HASH) {
    try { sessionStorage.setItem("vtx-admin", "1"); } catch {}
    $("pass").value = "";
    $("loginErr").hidden = true;
    checkLock();
  } else {
    $("loginErr").hidden = false;
  }
});
$("logout").onclick = () => {
  try { sessionStorage.removeItem("vtx-admin"); } catch {}
  checkLock();
};

// تصغير الصورة وتحويلها لنص Base64 (تنحفظ مباشرة في Firestore بدون Storage)
function compressImage(file, max = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

let imageData = "";
$("image").addEventListener("change", async () => {
  const f = $("image").files[0];
  imageData = f ? await compressImage(f) : "";
  $("preview").hidden = !imageData;
  if (imageData) $("preview").src = imageData;
});

$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isUnlocked()) return checkLock();
  const btn = $("saveBtn");
  btn.disabled = true;
  $("addMsg").textContent = "جاري النشر…";
  try {
    await addDoc(scriptsCol, {
      name: $("name").value.trim(),
      code: $("code").value,
      image: imageData,
      createdAt: serverTimestamp()
    });
    e.target.reset();
    imageData = "";
    $("preview").hidden = true;
    $("addMsg").textContent = "تم نشر السكربت ✓";
  } catch (err) {
    $("addMsg").textContent = "صار خطأ: " + err.message;
  } finally {
    btn.disabled = false;
  }
});

function renderAdminList() {
  $("adminList").innerHTML = all.map(s => `
    <li>
      ${s.image ? `<img src="${s.image}" alt="">` : `<div class="ph"></div>`}
      <span>${esc(s.name)}</span>
      <button class="btn danger small" data-del="${s.id}">حذف</button>
    </li>`).join("") || `<li class="muted">ما فيه شي</li>`;
}
$("adminList").addEventListener("click", async (e) => {
  const id = e.target.dataset.del;
  if (!id || !confirm("متأكد تبي تحذف هذا السكربت؟")) return;
  await deleteDoc(doc(db, "scripts", id));
});

route();
