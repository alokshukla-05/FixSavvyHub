import { auth, db } from "./firebase.js";
import {
  doc, setDoc, getDoc, collection, addDoc,
  query, where, getDocs, updateDoc, deleteField
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

let userId;
let latestServiceId = null;
let subscriptionPlan = "Free";
let remainingRequests = 1;
let subscriptionStatus = "Active";

// ✅ Authenticate User
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    alert("You are not signed in. Redirecting...");
    window.location.href = "signin.html";
    return;
  }

  userId = user.uid;
  console.log("🔐 User logged in:", userId);
  await loadUserProfile();
  await checkSubscription();
  await loadUserServices();
});

// ✅ Load Profile
async function loadUserProfile() {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      document.getElementById("username").value = userData.username || "";
      document.getElementById("phone").value = userData.phone || "";
      document.getElementById("address").value = userData.address || "";

      if (userData.phone && userData.address) {
        document.getElementById("section-1")?.classList.add("hidden");
        document.getElementById("section-2")?.classList.remove("hidden");
        document.getElementById("section-3")?.classList.remove("hidden");
        document.getElementById("section-5")?.classList.remove("hidden");
      }
    }
  } catch (e) {
    console.error("Profile load error:", e);
  }
}

document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value;
  const phone = document.getElementById("phone").value;
  const address = document.getElementById("address").value;

  await setDoc(doc(db, "users", userId), {
    username, phone, address, role: "user"
  }, { merge: true });
  alert("Profile Updated!");
  location.reload();
});

// 🔥🔥 FINAL BULLETPROOF SUBSCRIPTION FIX
async function checkSubscription() {
  console.log("🔍 === SUBSCRIPTION CHECK START ===");
  const subRef = doc(db, "subscriptions", userId);
  const subSnap = await getDoc(subRef);
  
  if (!subSnap.exists()) {
    console.log("📝 No subscription doc - creating new");
    await setDoc(subRef, {
      plan: "Free",
      remainingRequests: 1,
      status: "Active",
      lastReset: new Date().toISOString()
    }, { merge: true });
    location.reload();
    return;
  }

  const rawData = subSnap.data();
  console.log("📊 RAW FIRESTORE DATA:", rawData);

  // ✅ FORCE SAFE VALUES
  subscriptionPlan = rawData.plan === "Gold" ? "Gold" : "Free";
  subscriptionStatus = rawData.status || "Active";
  remainingRequests = Math.max(1, parseInt(rawData.remainingRequests) || 1);
  
  console.log("✅ PARSED VALUES:", {
    plan: subscriptionPlan,
    status: subscriptionStatus,
    requests: remainingRequests,
    backupRequests: rawData.backupRequests
  });

  // 🔥 CRITICAL FIX: Gold Rejection
  if (subscriptionPlan === "Gold" && subscriptionStatus === "Rejected") {
    console.log("🚨 GOLD REJECTED - RESTORING...");
    
    // TRIPLE SAFE FALLBACK
    let restoreCount = 1;
    if (typeof rawData.backupRequests === 'number' && rawData.backupRequests > 0) {
      restoreCount = rawData.backupRequests;
    }
    
    console.log("🔄 Restoring", restoreCount, "requests");
    
    await setDoc(subRef, {
      plan: "Free",
      status: "Active",
      remainingRequests: restoreCount,
      subscribedDate: null,
      backupRequests: deleteField(),
      lastReset: new Date().toISOString()
    }, { merge: true });

    alert(`Gold rejected. Restored ${restoreCount} request(s)`);
    location.reload();
    return;
  }

  // Gold expiry check
  if (subscriptionPlan === "Gold" && rawData.subscribedDate) {
    const expiry = new Date(rawData.subscribedDate);
    expiry.setMonth(expiry.getMonth() + 1);
    if (new Date() >= expiry) {
      await setDoc(subRef, {
        plan: "Free",
        remainingRequests: 1,
        status: "Expired",
        subscribedDate: null,
        backupRequests: deleteField()
      }, { merge: true });
      alert("Gold expired. 1 free request restored.");
      location.reload();
      return;
    }
  }

  // Free monthly reset
  if (subscriptionPlan === "Free" && remainingRequests <= 0) {
    const lastReset = rawData.lastReset ? new Date(rawData.lastReset) : null;
    const needsReset = !lastReset || 
      lastReset.getMonth() !== new Date().getMonth() || 
      lastReset.getFullYear() !== new Date().getFullYear();

    if (needsReset) {
      await updateDoc(subRef, {
        remainingRequests: 1,
        lastReset: new Date().toISOString()
      });
      alert("Monthly reset: 1 free request!");
      location.reload();
      return;
    }
  }

  // UI Update
  document.getElementById("plan").innerText = `Current Plan: ${subscriptionPlan}`;
  document.getElementById("remaining-requests").innerText = `Remaining Requests: ${remainingRequests}`;

  const upgradeBtn = document.getElementById("upgrade-btn");
  if (upgradeBtn) {
    upgradeBtn.innerText = subscriptionStatus === "Pending" ? "Pending Approval" : 
                          subscriptionPlan === "Gold" ? "Gold Active" : 
                          "Upgrade to Gold (₹199/month)";
    upgradeBtn.disabled = subscriptionStatus === "Pending" || subscriptionPlan === "Gold";
  }

  console.log("✅ === SUBSCRIPTION CHECK COMPLETE ===");
}

// 🔥 PERFECT Gold Request
window.requestGoldPlan = async () => {
  console.log("💰 Gold request started");
  
  const subSnap = await getDoc(doc(db, "subscriptions", userId));
  let currentRequests = 1;
  
  if (subSnap.exists()) {
    currentRequests = Math.max(1, parseInt(subSnap.data().remainingRequests) || 1);
  }
  
  console.log("💾 SAVING BACKUP:", currentRequests);

  await setDoc(doc(db, "subscriptions", userId), {
    plan: "Gold",
    remainingRequests: 35,
    status: "Pending",
    subscribedDate: new Date().toISOString(),
    backupRequests: currentRequests,  // ✅ ALWAYS SAVED AS NUMBER
    lastReset: null
  }, { merge: true });

  alert("Gold requested! Awaiting admin approval.");
  location.reload();
};

// ✅ Service Request
document.getElementById("request-service-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  console.log("📞 Service request:", { status: subscriptionStatus, requests: remainingRequests });
  
  if (subscriptionStatus === "Pending") return alert("Gold pending.");
  if (remainingRequests <= 0) return alert("Upgrade to Gold.");

  const service = document.getElementById("service").value;
  const providerId = await autoAssignServiceProvider();

  if (!providerId) {
    alert("No providers available. Admin will help.");
    return;
  }

  await addDoc(collection(db, "services"), {
    serviceName: service,
    requestedBy: userId,
    assignedTo: providerId,
    status: "Assigned",
    timestamp: new Date().toISOString()
  });

  await updateDoc(doc(db, "subscriptions", userId), {
    remainingRequests: firebase.firestore.FieldValue.increment(-1)
  });

  alert("✅ Service assigned!");
  location.reload();
});

// ✅ Provider assignment (simple)
async function autoAssignServiceProvider() {
  const serviceType = document.getElementById("service").value.toLowerCase();
  const userSnap = await getDoc(doc(db, "users", userId));
  
  if (!userSnap.exists()) return null;
  
  const { subDistrict, district, city } = userSnap.data();
  const locations = [subDistrict, district, city].filter(Boolean);
  
  for (const location of locations) {
    const providers = await getProviders(serviceType, location);
    if (providers.length > 0) return providers[0].id;
  }
  
  return "admin-manual"; // Fallback
}

async function getProviders(serviceType, location) {
  const q = query(
    collection(db, "users"),
    where("role", "==", "service_provider"),
    where("subDistrict", "==", location)
  );
  const snap = await getDocs(q);
  return Array.from(snap.docs).map(doc => ({ id: doc.id, ...doc.data() }));
}

// ✅ Services list
async function loadUserServices() {
  const q = query(collection(db, "services"), where("requestedBy", "==", userId));
  const snap = await getDocs(q);
  const container = document.getElementById("assigned-service");
  
  if (!container) return;
  
  container.innerHTML = snap.empty ? "<p>No services requested.</p>" : "";
  
  snap.forEach((doc) => {
    const data = doc.data();
    container.innerHTML += `
      <div style="border:1px solid #ccc; padding:15px; margin:10px 0; border-radius:8px;">
        <h4>${data.serviceName}</h4>
        <p>Status: <span style="background:#e3f2fd; padding:4px 8px; border-radius:4px;">${data.status}</span></p>
        ${data.status === "Assigned" ? 
          `<button onclick="cancelService('${doc.id}')" style="background:#f44336; color:white; padding:8px 16px; border:none; border-radius:4px;">Cancel</button>` : 
          data.status === "Completed" ? 
          `<button onclick="openFeedbackForm('${doc.id}')" style="background:#4caf50; color:white; padding:8px 16px; border:none; border-radius:4px;">Feedback</button>` : 
          ""
        }
      </div>
    `;
  });
}

window.cancelService = async (serviceId) => {
  await updateDoc(doc(db, "services", serviceId), { status: "Cancelled" });
  await updateDoc(doc(db, "subscriptions", userId), {
    remainingRequests: firebase.firestore.FieldValue.increment(1)
  });
  alert("Cancelled! Request restored.");
  location.reload();
};

window.openFeedbackForm = (serviceId) => {
  latestServiceId = serviceId;
  alert("Feedback ready for service: " + serviceId);
};

document.getElementById("feedback-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!latestServiceId) return alert("Select service first.");
  
  const rating = document.getElementById("rating")?.value || 5;
  const feedback = document.getElementById("feedback")?.value || "";
  
  await updateDoc(doc(db, "services", latestServiceId), {
    feedback, rating: parseInt(rating), status: "Closed"
  });
  
  alert("Feedback saved!");
  location.reload();
});
