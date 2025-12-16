/*************************************************
 * IMPORTS
 *************************************************/
import { auth, db } from "./firebase.js";
import {
  doc, setDoc, getDoc, collection, addDoc,
  query, where, getDocs, updateDoc, deleteField
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

/*************************************************
 * GLOBAL STATE (READ ONLY CACHE)
 *************************************************/
let CURRENT_USER_ID = null;
let CURRENT_SUBSCRIPTION = null;
let LATEST_SERVICE_ID = null;

/*************************************************
 * AUTH
 *************************************************/
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "signin.html";
    return;
  }
  CURRENT_USER_ID = user.uid;
  await bootstrap();
});

async function bootstrap() {
  await loadUserProfile();
  await syncSubscription();   // 🔥 single source of truth
  await loadUserServices();
}

/*************************************************
 * PROFILE
 *************************************************/
async function loadUserProfile() {
  const ref = doc(db, "users", CURRENT_USER_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const u = snap.data();
  username.value = u.username || "";
  phone.value = u.phone || "";
  address.value = u.address || "";
}

profile-form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await setDoc(doc(db, "users", CURRENT_USER_ID), {
    username: username.value,
    phone: phone.value,
    address: address.value,
    role: "user"
  }, { merge: true });

  alert("Profile updated");
});

/*************************************************
 * SUBSCRIPTION (PROFESSIONAL FIX)
 *************************************************/
async function syncSubscription() {
  const ref = doc(db, "subscriptions", CURRENT_USER_ID);
  const snap = await getDoc(ref);
  const now = new Date();

  // First time
  if (!snap.exists()) {
    const fresh = {
      plan: "Free",
      status: "Active",
      remainingRequests: 1,
      lastReset: now.toISOString()
    };
    await setDoc(ref, fresh);
    CURRENT_SUBSCRIPTION = fresh;
    updateSubscriptionUI();
    return;
  }

  const sub = snap.data();

  // ✅ REJECTED → RESTORE EXACT VALUE
  if (sub.plan === "Gold" && sub.status === "Rejected") {
    const restored = {
      plan: "Free",
      status: "Active",
      remainingRequests:
        typeof sub.backupRequests === "number"
          ? sub.backupRequests
          : 1,
      backupRequests: deleteField(),
      subscribedDate: null
    };

    await updateDoc(ref, restored);
    CURRENT_SUBSCRIPTION = { ...sub, ...restored };
    updateSubscriptionUI();
    alert("Gold rejected. Previous requests restored.");
    return;
  }

  // GOLD EXPIRY
  if (sub.plan === "Gold" && sub.subscribedDate) {
    const expiry = new Date(sub.subscribedDate);
    expiry.setMonth(expiry.getMonth() + 1);
    if (now >= expiry) {
      await updateDoc(ref, {
        plan: "Free",
        status: "Expired",
        remainingRequests: 1,
        subscribedDate: null
      });
      CURRENT_SUBSCRIPTION = { ...sub, plan: "Free", remainingRequests: 1 };
      updateSubscriptionUI();
      return;
    }
  }

  CURRENT_SUBSCRIPTION = sub;
  updateSubscriptionUI();
}

function updateSubscriptionUI() {
  plan.innerText = `Plan: ${CURRENT_SUBSCRIPTION.plan}`;
  remaining-requests.innerText =
    `Remaining Requests: ${CURRENT_SUBSCRIPTION.remainingRequests}`;
}

/*************************************************
 * REQUEST GOLD (SAFE BACKUP)
 *************************************************/
window.requestGoldPlan = async () => {
  const ref = doc(db, "subscriptions", CURRENT_USER_ID);
  const snap = await getDoc(ref);
  const current = snap.data();

  await updateDoc(ref, {
    plan: "Gold",
    status: "Pending",
    remainingRequests: 35,
    subscribedDate: new Date().toISOString(),
    backupRequests: current.remainingRequests
  });

  alert("Gold request sent for approval");
  await syncSubscription();
};

/*************************************************
 * SERVICE REQUEST
 *************************************************/
request-service-form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (CURRENT_SUBSCRIPTION.status === "Pending") {
    alert("Gold approval pending");
    return;
  }

  if (CURRENT_SUBSCRIPTION.remainingRequests <= 0) {
    alert("No requests left");
    return;
  }

  const providerId = await autoAssignProvider();
  if (!providerId) return;

  await addDoc(collection(db, "services"), {
    serviceName: service.value,
    requestedBy: CURRENT_USER_ID,
    assignedTo: providerId,
    status: "Assigned",
    createdAt: new Date().toISOString()
  });

  await updateDoc(
    doc(db, "subscriptions", CURRENT_USER_ID),
    { remainingRequests: CURRENT_SUBSCRIPTION.remainingRequests - 1 }
  );

  await syncSubscription();
  alert("Service assigned");
});

/*************************************************
 * AUTO ASSIGN (PRODUCTION LOGIC)
 *************************************************/
async function autoAssignProvider() {
  const userSnap = await getDoc(doc(db, "users", CURRENT_USER_ID));
  if (!userSnap.exists()) return null;

  const { subDistrict, district, city } = userSnap.data();
  const s = service.value.toLowerCase().trim();

  const levels = [
    ["subDistrict", subDistrict],
    ["district", district],
    ["city", city]
  ];

  for (const [field, value] of levels) {
    if (!value) continue;
    const providers = await getProviders(s, field, value);
    if (providers.length) return pickBest(providers);
  }

  alert("No provider available. Admin will contact you.");
  return null;
}

async function getProviders(service, field, value) {
  const q = query(
    collection(db, "users"),
    where("role", "==", "service_provider"),
    where(field, "==", value)
  );

  const snap = await getDocs(q);
  let list = [];

  snap.forEach(d => {
    const p = d.data();
    if ((p.service || "").toLowerCase().includes(service)) {
      list.push({
        id: d.id,
        rating: p.rating || 0,
        completedJobs: p.completedJobs || 0,
        activeRequests: p.activeRequests || 0,
        availability: p.availability || "Available",
        signupDate: p.signupDate || "9999-12-31"
      });
    }
  });

  return list;
}

function pickBest(list) {
  return list
    .filter(p => p.availability === "Available")
    .sort((a, b) =>
      (b.rating + b.completedJobs) - (a.rating + a.completedJobs) ||
      a.activeRequests - b.activeRequests ||
      new Date(a.signupDate) - new Date(b.signupDate)
    )[0]?.id || null;
}

/*************************************************
 * SERVICES & FEEDBACK
 *************************************************/
async function loadUserServices() {
  const q = query(
    collection(db, "services"),
    where("requestedBy", "==", CURRENT_USER_ID)
  );
  const snap = await getDocs(q);
  assigned-service.innerHTML = "";

  snap.forEach(d => {
    const s = d.data();
    assigned-service.innerHTML += `
      <div>
        <b>${s.serviceName}</b> - ${s.status}
        ${s.status === "Completed"
          ? `<button onclick="openFeedback('${d.id}')">Feedback</button>`
          : ""}
      </div>`;
  });
}

window.openFeedback = (id) => LATEST_SERVICE_ID = id;

feedback-form.addEventListener("submit", async e => {
  e.preventDefault();
  if (!LATEST_SERVICE_ID) return;

  await updateDoc(
    doc(db, "services", LATEST_SERVICE_ID),
    {
      rating: rating.value,
      feedback: feedback.value,
      status: "Closed"
    }
  );

  alert("Feedback submitted");
});
