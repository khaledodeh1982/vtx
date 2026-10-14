import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp, runTransaction
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
  const h = location.hash.slice(1);
  const page = ["admin", "codes"].includes(h) ? h : "scripts";
  $("view-scripts").hidden = page !== "scripts";
  $("view-codes").hidden = page !== "codes";
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
  try { return !!sessionStorage.getItem("vtx-admin-key"); } catch { return false; }
}
function checkLock() {
  const ok = isUnlocked();
  $("lock").hidden = ok;
  $("panel").hidden = !ok;
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await sha256($("pass").value) === PASS_HASH) {
    const raw = await deriveRaw($("pass").value, "vtx-admin-salt");
    try { sessionStorage.setItem("vtx-admin-key", b64(raw)); } catch {}
    adminKeyRaw = raw;
    refreshCodes();
    $("pass").value = "";
    $("loginErr").hidden = true;
    checkLock();
  } else {
    $("loginErr").hidden = false;
  }
});
$("logout").onclick = () => {
  try { sessionStorage.removeItem("vtx-admin-key"); } catch {}
  adminKeyRaw = null;
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

/* ---------- الكودات ----------
   - معرّف الوثيقة = SHA-256 للكود، فما يقدر أحد يعرف الكود من قاعدة البيانات
   - السكربت مشفّر (AES-GCM) بمفتاح مشتق من الكود نفسه، ما ينفك إلا بالكود الصحيح
   - نسخة الكود للإدارة مشفّرة بمفتاح مشتق من كلمة سر الإدارة */
const codesCol = collection(db, "codes");
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const norm = (c) => c.trim().toUpperCase();
let adminKeyRaw = (() => { try { const k = sessionStorage.getItem("vtx-admin-key"); return k ? unb64(k) : null; } catch { return null; } })();
let codes = [];

async function deriveRaw(secret, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 150000, hash: "SHA-256" }, base, 256));
}
const aesKey = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
async function encryptWith(raw, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(raw), enc.encode(text));
  return { iv: b64(iv), ct: b64(ct) };
}
async function decryptWith(raw, box) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, await aesKey(raw), unb64(box.ct));
  return dec.decode(pt);
}
const codeId = (c) => sha256("vtx-code:" + norm(c));

// إضافة كود (الإدارة)
$("cGen").onclick = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(10));
  $("cCode").value = "VTX-" + [...r].map(x => chars[x % chars.length]).join("");
};

$("codeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isUnlocked() || !adminKeyRaw) return checkLock();
  const code = norm($("cCode").value);
  if (code.length < 4) { $("cMsg").textContent = "الكود لازم يكون 4 حروف أو أكثر"; return; }
  $("cSave").disabled = true;
  $("cMsg").textContent = "جاري الإضافة…";
  try {
    const id = await codeId(code);
    if ((await getDoc(doc(db, "codes", id))).exists()) {
      $("cMsg").textContent = "هذا الكود موجود من قبل";
      return;
    }
    const payload = JSON.stringify({ name: $("cName").value.trim(), script: $("cScript").value });
    await setDoc(doc(db, "codes", id), {
      box: await encryptWith(await deriveRaw(code, "vtx-code-salt"), payload),
      adminBox: await encryptWith(adminKeyRaw, JSON.stringify({ code, name: $("cName").value.trim() })),
      maxUses: Number($("cMax").value),
      uses: 0,
      createdAt: serverTimestamp()
    });
    e.target.reset();
    $("cMsg").textContent = `تمت إضافة الكود ${code} ✓`;
  } catch (err) {
    $("cMsg").textContent = "صار خطأ: " + err.message;
  } finally {
    $("cSave").disabled = false;
  }
});

let codeDocs = [];
onSnapshot(query(codesCol, orderBy("createdAt", "desc")), (snap) => {
  codeDocs = snap.docs;
  refreshCodes();
}, () => {});
async function refreshCodes() {
  codes = await Promise.all(codeDocs.map(async d => {
    const data = d.data();
    let info = { code: "••••", name: "" };
    if (adminKeyRaw) { try { info = JSON.parse(await decryptWith(adminKeyRaw, data.adminBox)); } catch {} }
    return { id: d.id, ...data, ...info };
  }));
  renderCodeList();
}

function renderCodeList() {
  $("codeList").innerHTML = codes.map(c => {
    const limit = c.maxUses === 0 ? "لا نهائي" : `${c.uses}/${c.maxUses}`;
    const done = c.maxUses !== 0 && c.uses >= c.maxUses;
    return `<li>
      <span><code>${esc(c.code)}</code> — ${esc(c.name)}</span>
      <span class="badge ${done ? "done" : ""}">${done ? "منتهي" : limit}${c.maxUses === 0 ? ` · ${c.uses}` : ""}</span>
      <button class="btn danger small" data-delcode="${c.id}">حذف</button>
    </li>`;
  }).join("") || `<li class="muted">ما فيه كودات</li>`;
}
$("codeList").addEventListener("click", async (e) => {
  const id = e.target.dataset.delcode;
  if (!id || !confirm("متأكد تبي تحذف هذا الكود؟")) return;
  await deleteDoc(doc(db, "codes", id));
});

// استلام السكربت (المستخدم)
$("redeemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = norm($("redeemInput").value);
  $("redeemBtn").disabled = true;
  $("redeemResult").hidden = true;
  $("redeemMsg").textContent = "جاري التحقق…";
  try {
    const ref = doc(db, "codes", await codeId(code));
    const box = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("الكود غير صحيح");
      const d = snap.data();
      if (d.maxUses !== 0 && d.uses >= d.maxUses) throw new Error("هذا الكود انتهى استخدامه");
      tx.update(ref, { uses: d.uses + 1 });
      return d.box;
    });
    const { name, script } = JSON.parse(await decryptWith(await deriveRaw(code, "vtx-code-salt"), box));
    $("redeemName").textContent = name;
    $("redeemCode").textContent = script;
    $("redeemCopy").textContent = "نسخ السكربت";
    $("redeemResult").hidden = false;
    $("redeemMsg").textContent = "تم ✓";
    $("redeemInput").value = "";
  } catch (err) {
    $("redeemMsg").textContent = err.message;
  } finally {
    $("redeemBtn").disabled = false;
  }
});
$("redeemCopy").onclick = async () => {
  await navigator.clipboard.writeText($("redeemCode").textContent);
  $("redeemCopy").textContent = "تم النسخ ✓";
};

route();
