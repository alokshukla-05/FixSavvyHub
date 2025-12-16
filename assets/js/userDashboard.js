/*************************************************
 * FIREBASE IMPORTS
 *************************************************/
import { auth, db } from "./firebase.js";
import {
  doc, setDoc, getDoc, collection, addDoc,
  query, where, getDocs, updateDoc, deleteField
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

/*************************************************
 * GLOBAL STATE
 *************************************************/
let userId = null;
let latestServiceId = null;
let subscriptionPlan = "Free";
let remainingRequests = 1;
let subscriptionStatus = "Active";

/*************************************************
 * AUTH STATE
 *************************************************/
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    alert("Not signed in");
    window.location.href = "signin.html";
    return;
  }
  userId = user.uid;
  await loadUserProfile();
  await checkSubscription();
  await loadUserServices();
});

/*************************************************
 * USER PROFILE
 *************************************************/
async function loadUserProfile() {
  const snap = await getDoc(doc(db, "users", userId));
  if (!snap.exists()) return;

  const d = snap.data();
  document.getElementById("username").value = d.username || "";
  document.getElementById("phone").value = d.phone || "";
  document.getElementById("address").value = d.address || "";

  if (d.phone && d.address) {
    document.getElementById("section-1").classList.add("hidden");
    document.getElementById("section-2").classList.remove("hidden");
    document.getElementById("section-3").classList.remove("hidden");
    document.getElementById("section-5").classList.remove("hidden");
  }
}

document.getElementById("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  await setDoc(doc(db, "users", userId), {
    username: username.value,
    phone: phone.value,
    address: address.value,
    role: "user"
  }, { merge: true });

  alert("Profile updated");
  location.reload();
});

/*************************************************
 * SUBSCRIPTION LOGIC (FIXED)
 *************************************************/
async function checkSubscription() {
  const ref = doc(db, "subscriptions", userId);
  const snap = await getDoc(ref);
  const today = new Date();

  if (!snap.exists()) {
    await setDoc(ref, {
      plan: "Free",
      remainingRequests: 1,
      status: "Active",
      lastReset: today.toISOString()
    });
    location.reload();
    return;
  }

  const d = snap.data();
  subscriptionPlan = d.plan;
  remainingRequests = d.remainingRequests;
  subscriptionStatus = d.status;

  // ✅ GOLD REJECTED → RESTORE PREVIOUS REQUESTS
  if (subscriptionPlan === "Gold" && subscriptionStatus === "Rejected") {
    await setDoc(ref, {
      plan: "Free",
      status: "Active",
      remainingRequests: d.backupRequests ?? 1,
      subscribedDate: null,
      backupRequests: deleteField()
    }, { merge: true });

    alert("Gold rejected. Previous requests restored.");
    location.reload();
    return;
  }

  // ✅ GOLD EXPIRY
  if (subscriptionPlan === "Gold" && d.subscribedDate) {
    const expiry = new Date(d.subscribedDate);
    expiry.setMonth(expiry.getMonth() + 1);
    if (today >= expiry) {
      await setDoc(ref, {
        plan: "Free",
        remainingRequests: 1,
        status: "Expired",
        subscribedDate: null
      }, { merge: true });

      alert("Gold plan expired");
      location.reload();
      return;
    }
  }

  document.getElementById("plan").innerText = `Plan: ${subscriptionPlan}`;
  document.getElementById("remaining-requests").innerText =
    `Remaining Requests: ${remainingRequests}`;
}

/*************************************************
 * REQUEST GOLD PLAN
 *************************************************/
window.requestGoldPlan = async () => {
  const ref = doc(db, "subscriptions", userId);
  const snap = await getDoc(ref);
  const backup = snap.exists() ? snap.data().remainingRequests : 1;

  await setDoc(ref, {
    plan: "Gold",
    remainingRequests: 35,
    status: "Pending",
    subscribedDate: new Date().toISOString(),
    backupRequests: backup
  }, { merge: true });

  alert("Gold requested. Awaiting approval.");
  location.reload();
};

/*************************************************
 * REQUEST SERVICE
 *************************************************/
document.getElementById("request-service-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    if (subscriptionStatus === "Pending") {
      alert("Gold approval pending");
      return;
    }
    if (remainingRequests <= 0) {
      alert("No requests left");
      return;
    }

    const serviceType = document.getElementById("service").value;
    const providerId = await autoAssignServiceProvider(serviceType);

    if (!providerId) return;

    await addDoc(collection(db, "services"), {
      serviceName: serviceType,
      requestedBy: userId,
      assignedTo: providerId,
      status: "Assigned"
    });

    await updateDoc(doc(db, "subscriptions", userId), {
      remainingRequests: remainingRequests - 1
    });

    alert("Service assigned");
    location.reload();
  });

/*************************************************
 * AUTO ASSIGN PROVIDER (SAFE)
 *************************************************/
async function autoAssignServiceProvider(serviceType) {
  const userSnap = await getDoc(doc(db, "users", userId));
  if (!userSnap.exists()) return null;

  const { subDistrict, district, city } = userSnap.data();
  const service = serviceType.toLowerCase().trim();

  const levels = [
    { field: "subDistrict", value: subDistrict },
    { field: "district", value: district },
    { field: "city", value: city }
  ];

  for (const lvl of levels) {
    if (!lvl.value) continue;
    const providers = await findProviders(service, lvl.field, lvl.value);
    if (providers.length) return selectBestProvider(providers);
  }

  alert("No provider found. Admin will contact you.");
  return null;
}

/*************************************************
 * FIRESTORE PROVIDER SEARCH
 *************************************************/
async function findProviders(service, field, value) {
  const q = query(
    collection(db, "users"),
    where("role", "==", "service_provider"),
    where(field, "==", value)
  );

  const snap = await getDocs(q);
  let list = [];

  snap.forEach(d => {
    const p = d.data();
    const s = (p.service || "").toLowerCase();
    if (s.includes(service) || service.includes(s)) {
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

function selectBestProvider(list) {
  const best = list
    .filter(p => p.availability === "Available")
    .sort((a, b) =>
      (b.rating + b.completedJobs) - (a.rating + a.completedJobs) ||
      a.activeRequests - b.activeRequests ||
      new Date(a.signupDate) - new Date(b.signupDate)
    )[0];

  return best ? best.id : null;
}

/*************************************************
 * LOAD USER SERVICES
 *************************************************/
async function loadUserServices() {
  const q = query(
    collection(db, "services"),
    where("requestedBy", "==", userId)
  );

  const snap = await getDocs(q);
  const container = document.getElementById("assigned-service");
  container.innerHTML = "";

  if (snap.empty) {
    container.innerHTML = "<p>No services yet</p>";
    return;
  }

  snap.forEach(d => {
    const s = d.data();
    container.innerHTML += `
      <div style="border:1px solid #ccc;padding:10px;margin-bottom:10px">
        <b>${s.serviceName}</b><br>
        Status: ${s.status}<br>
        ${s.status === "Completed"
          ? `<button onclick="openFeedbackForm('${d.id}')">Give Feedback</button>`
          : ""}
      </div>`;
  });
}

/*************************************************
 * FEEDBACK
 *************************************************/
window.openFeedbackForm = (id) => {
  latestServiceId = id;
  alert("Feedback enabled");
};

document.getElementById("feedback-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!latestServiceId) return;

    await updateDoc(doc(db, "services", latestServiceId), {
      rating: document.getElementById("rating").value,
      feedback: document.getElementById("feedback").value,
      status: "Closed"
    });

    alert("Feedback submitted");
    location.reload();
  });

/*************************************************
 * CANCEL SERVICE
 *************************************************/
window.cancelService = async (id) => {
  await updateDoc(doc(db, "services", id), { status: "Cancelled" });
  alert("Service cancelled");
  location.reload();
};
