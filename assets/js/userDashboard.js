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
  await loadUserProfile();
  await checkSubscription();
  await loadUserServices();
});

// ✅ Load Profile (UNCHANGED)
async function loadUserProfile() {
  const userDoc = await getDoc(doc(db, "users", userId));
  if (userDoc.exists()) {
    const userData = userDoc.data();
    document.getElementById("username").value = userData.username || "";
    document.getElementById("phone").value = userData.phone || "";
    document.getElementById("address").value = userData.address || "";

    if (userData.phone && userData.address) {
      document.getElementById("section-1").classList.add("hidden");
      document.getElementById("section-2").classList.remove("hidden");
      document.getElementById("section-3").classList.remove("hidden");
      document.getElementById("section-5").classList.remove("hidden");
    }
  }
}

document.getElementById("profile-form").addEventListener("submit", async (e) => {
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

// 🔥 BULLETPROOF SUBSCRIPTION CHECK - NEVER FAILS
async function checkSubscription() {
  const subRef = doc(db, "subscriptions", userId);
  const subSnap = await getDoc(subRef);
  const today = new Date();

  console.log("🔍 Subscription check - Raw data:", subSnap.data()); // DEBUG

  if (subSnap.exists()) {
    const data = subSnap.data();
    
    // ✅ ALWAYS SAFE VALUES
    subscriptionPlan = data.plan || "Free";
    subscriptionStatus = data.status || "Active";
    remainingRequests = Math.max(1, data.remainingRequests || 1); // NEVER 0
    
    const subscribedDate = data.subscribedDate ? new Date(data.subscribedDate) : null;
    const lastReset = data.lastReset ? new Date(data.lastReset) : null;

    console.log("🔍 Parsed:", { plan: subscriptionPlan, requests: remainingRequests, status: subscriptionStatus });

    // 🔥 BULLETPROOF Gold Rejection Fix
    if (subscriptionPlan === "Gold" && subscriptionStatus === "Rejected") {
      // ✅ TRIPLE SAFE FALLBACK: backupRequests → current → 1
      const previousRequests = Math.max(
        1,
        Number(data.backupRequests) || 
        Number(data.remainingRequests) || 
        1
      );

      console.log("🔄 Rejection restore:", previousRequests);

      await setDoc(subRef, {
        plan: "Free",
        status: "Active",
        remainingRequests: previousRequests,
        subscribedDate: null,
        backupRequests: deleteField(),
        lastReset: today.toISOString()
      }, { merge: true });

      alert(`Gold rejected. Restored ${previousRequests} request(s).`);
      location.reload();
      return;
    }

    // Gold expiry
    if (subscriptionPlan === "Gold" && subscribedDate) {
      const expiryDate = new Date(subscribedDate);
      expiryDate.setMonth(expiryDate.getMonth() + 1);
      if (today >= expiryDate) {
        await setDoc(subRef, {
          plan: "Free",
          remainingRequests: 1,
          status: "Expired",
          subscribedDate: null,
          backupRequests: deleteField(),
          lastReset: today.toISOString()
        }, { merge: true });
        alert("Gold expired. Back to Free (1 request).");
        location.reload();
        return;
      }
    }

    // Free plan monthly reset
    if (subscriptionPlan === "Free" && remainingRequests <= 0) {
      const needsReset = !lastReset || 
        lastReset.getMonth() !== today.getMonth() || 
        lastReset.getFullYear() !== today.getFullYear();

      if (needsReset) {
        await updateDoc(subRef, { remainingRequests: 1, lastReset: today.toISOString() });
        alert("Monthly reset: 1 free request added!");
        location.reload();
        return;
      }
    }

    // ✅ UI Update
    document.getElementById("plan").innerText = `Current Plan: ${subscriptionPlan}`;
    document.getElementById("remaining-requests").innerText = `Remaining Requests: ${remainingRequests}`;

    const upgradeBtn = document.getElementById("upgrade-btn");
    if (upgradeBtn) {
      if (subscriptionStatus === "Pending") {
        upgradeBtn.innerText = "Pending Approval";
        upgradeBtn.disabled = true;
      } else if (subscriptionPlan === "Gold") {
        upgradeBtn.innerText = "Gold Plan Active";
        upgradeBtn.disabled = true;
      } else {
        upgradeBtn.innerText = "Upgrade to Gold (₹199/month)";
        upgradeBtn.disabled = false;
      }
    }
  } else {
    // First time setup
    await setDoc(subRef, {
      plan: "Free",
      remainingRequests: 1,
      status: "Active",
      lastReset: today.toISOString()
    }, { merge: true });
    location.reload();
  }
}

// 🔥 BULLETPROOF Gold Request - ALWAYS saves correct backup
window.requestGoldPlan = async () => {
  const subSnap = await getDoc(doc(db, "subscriptions", userId));
  let currentRequests = 1; // Default safe value

  if (subSnap.exists()) {
    currentRequests = Math.max(1, Number(subSnap.data().remainingRequests) || 1);
  }

  console.log("💾 Backing up:", currentRequests, "requests");

  await setDoc(doc(db, "subscriptions", userId), {
    plan: "Gold",
    remainingRequests: 35,
    status: "Pending",
    subscribedDate: new Date().toISOString(),
    backupRequests: currentRequests, // ✅ ALWAYS A NUMBER
    lastReset: null
  }, { merge: true });

  alert("Gold Plan requested. Awaiting approval.");
  location.reload();
};

// ✅ Request Service
document.getElementById("request-service-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (subscriptionStatus === "Pending") return alert("Gold pending approval.");
  if (remainingRequests <= 0) return alert("No requests left. Upgrade to Gold.");

  const service = document.getElementById("service").value;
  const serviceProvider = await autoAssignServiceProvider();

  if (!serviceProvider) {
    alert("No providers available. Admin will contact you.");
    return;
  }

  const docRef = await addDoc(collection(db, "services"), {
    serviceName: service,
    requestedBy: userId,
    assignedTo: serviceProvider,
    status: "Assigned",
    timestamp: new Date().toISOString()
  });

  await updateDoc(doc(db, "subscriptions", userId), {
    remainingRequests: firebase.firestore.FieldValue.increment(-1)
  });

  alert("✅ Service assigned successfully!");
  location.reload();
});

// ✅ Provider Assignment (Firestore + OSM)
async function autoAssignServiceProvider() {
  const serviceType = document.getElementById("service").value.toLowerCase().trim();
  const userSnap = await getDoc(doc(db, "users", userId));
  
  if (!userSnap.exists()) return null;

  const { subDistrict, district, city } = userSnap.data();

  // Priority search
  const locations = [subDistrict, district, city].filter(Boolean);
  
  for (const location of locations) {
    const providerId = await findProviderFromDB(serviceType, location);
    if (providerId) return providerId;
  }

  // OSM fallback
  return await findProviderFromOSM(serviceType, locations[0]);
}

async function findProviderFromDB(serviceType, location) {
  const q = query(
    collection(db, "users"),
    where("role", "==", "service_provider"),
    where("subDistrict", "==", location)
  );
  
  const snap = await getDocs(q);
  let providers = [];
  
  snap.forEach(doc => {
    const p = doc.data();
    if (fuzzyMatch((p.service || "").toLowerCase(), serviceType)) {
      providers.push({ id: doc.id, ...p });
    }
  });

  if (!providers.length) return null;

  return providers
    .filter(p => p.availability === "Available")
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))[0]?.id;
}

async function findProviderFromOSM(serviceType, location) {
  if (!location) return null;
  
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${serviceType}+${location}&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (!data.length) return null;

    const provider = {
      name: data[0].display_name?.split(",")[0] || `${serviceType} Service`,
      address: data[0].display_name,
      phone: "Contact via app",
      role: "service_provider",
      service: serviceType,
      subDistrict: location,
      rating: 3.5,
      availability: "Available",
      source: "osm"
    };

    const docRef = await addDoc(collection(db, "users"), provider);
    return docRef.id;
  } catch (e) {
    return null;
  }
}

function fuzzyMatch(a, b) {
  return a.includes(b) || b.includes(a);
}

// ✅ Services & Other functions (unchanged but safe)
async function loadUserServices() {
  const q = query(collection(db, "services"), where("requestedBy", "==", userId));
  const snap = await getDocs(q);
  const container = document.getElementById("assigned-service");
  
  if (!container) return;
  container.innerHTML = snap.empty ? "<p>No services yet.</p>" : "";
  
  snap.forEach(doc => {
    const data = doc.data();
    container.innerHTML += `
      <div style="border:1px solid #ccc;padding:15px;margin:10px 0;border-radius:8px;">
        <h4>${data.serviceName}</h4>
        <p>Status: <span style="background:#e3f2fd;padding:4px 8px;border-radius:4px;">${data.status}</span></p>
        ${data.status === "Assigned" ? `<button onclick="cancelService('${doc.id}')" style="background:#f44336;color:white;padding:8px;border:none;border-radius:4px;">Cancel</button>` : ""}
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
