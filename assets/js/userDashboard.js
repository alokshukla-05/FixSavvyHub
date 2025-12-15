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
    username,
    phone,
    address,
    role: "user"
  }, { merge: true });

  alert("Profile Updated!");
  location.reload();
});

// ✅ FIXED Subscription Check - Restores EXACT previous requests
async function checkSubscription() {
  const subRef = doc(db, "subscriptions", userId);
  const subSnap = await getDoc(subRef);
  const today = new Date();

  if (subSnap.exists()) {
    const data = subSnap.data();
    subscriptionPlan = data.plan;
    remainingRequests = data.remainingRequests;
    subscriptionStatus = data.status || "Active";
    const subscribedDate = data.subscribedDate ? new Date(data.subscribedDate) : null;
    const lastReset = data.lastReset ? new Date(data.lastReset) : null;

    // ✅ FIXED: Gold Rejection - Restore EXACT previous requests (NOT 5)
    if (subscriptionPlan === "Gold" && subscriptionStatus === "Rejected") {
      const previousRequests = data.backupRequests ?? 1;
      
      await setDoc(subRef, {
        plan: "Free",
        status: "Active",
        remainingRequests: previousRequests, // ✅ Exact restore
        subscribedDate: null,
        backupRequests: deleteField()
      }, { merge: true });

      alert(`Gold Plan rejected. Restored your previous ${previousRequests} request(s).`);
      location.reload();
      return;
    }

    // ✅ Auto-expire Gold after 1 month
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

        alert("Your Gold subscription expired. Downgraded to Free with 1 request.");
        location.reload();
        return;
      }
    }

    // ✅ Monthly Reset for Free Plan
    if (subscriptionPlan === "Free" && remainingRequests <= 0) {
      const needsReset = !lastReset ||
        lastReset.getMonth() !== today.getMonth() ||
        lastReset.getFullYear() !== today.getFullYear();

      if (needsReset) {
        await updateDoc(subRef, {
          remainingRequests: 1,
          lastReset: today.toISOString()
        });

        alert("You've received 1 free request for this month.");
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
    await setDoc(subRef, {
      plan: "Free",
      remainingRequests: 1,
      status: "Active",
      lastReset: today.toISOString()
    });
    location.reload();
  }
}

// ✅ FIXED Request Gold Plan - Correct backup
window.requestGoldPlan = async () => {
  const subSnap = await getDoc(doc(db, "subscriptions", userId));
  const existing = subSnap.exists() ? subSnap.data() : { remainingRequests: 1 };

  const backupRequests = existing.remainingRequests; // ✅ Save EXACT count

  await setDoc(doc(db, "subscriptions", userId), {
    plan: "Gold",
    remainingRequests: 35,
    status: "Pending",
    subscribedDate: new Date().toISOString(),
    backupRequests: backupRequests // ✅ Exact previous count saved
  }, { merge: true });

  alert("Gold Plan requested. Awaiting Admin approval.");
  location.reload();
};

// ✅ FIXED Request Service - Production Safe
document.getElementById("request-service-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (subscriptionStatus === "Pending") {
    alert("Gold request is pending approval.");
    return;
  }

  if (remainingRequests <= 0) {
    alert("Request limit reached. Upgrade to Gold.");
    return;
  }

  const service = document.getElementById("service").value;
  const serviceProvider = await autoAssignServiceProvider();

  if (!serviceProvider) {
    alert("No service provider available in your area. Admin will contact you soon.");
    return;
  }

  const docRef = await addDoc(collection(db, "services"), {
    serviceName: service,
    requestedBy: userId,
    assignedTo: serviceProvider,
    status: "Assigned",
    timestamp: new Date().toISOString()
  });

  latestServiceId = docRef.id;

  await updateDoc(doc(db, "subscriptions", userId), {
    remainingRequests: remainingRequests - 1
  });

  alert("Service Requested and Assigned Successfully!");
  location.reload();
});

// 🔥 ✅ MAIN FIX: Production-Safe Auto Assign (Firestore + OSM ONLY)
async function autoAssignServiceProvider() {
  const serviceType = document.getElementById("service").value.toLowerCase().trim();

  // 🔹 Get user location hierarchy
  const userSnap = await getDoc(doc(db, "users", userId));
  if (!userSnap.exists()) {
    console.error("User profile not found");
    return null;
  }

  const userData = userSnap.data();
  const { subDistrict, district, city, state } = userData;

  console.log("🔍 Searching providers for:", serviceType, "in locations:", { subDistrict, district, city });

  // 1️⃣ PRIORITY 1: Firestore SubDistrict
  let providerId = await findProviderFromDB(serviceType, { subDistrict });
  if (providerId) {
    console.log("✅ Found provider in SUBDISTRICT");
    return providerId;
  }

  // 2️⃣ PRIORITY 2: Firestore District  
  providerId = await findProviderFromDB(serviceType, { district });
  if (providerId) {
    console.log("✅ Found provider in DISTRICT");
    return providerId;
  }

  // 3️⃣ PRIORITY 3: Firestore City
  providerId = await findProviderFromDB(serviceType, { city });
  if (providerId) {
    console.log("✅ Found provider in CITY");
    return providerId;
  }

  // 4️⃣ EMERGENCY: OpenStreetMap (FREE & Legal)
  console.log("🔍 No DB providers found. Trying OpenStreetMap...");
  const osmProvider = await findProviderFromOSM(serviceType, subDistrict || district || city || state);
  if (osmProvider) {
    console.log("✅ Found OSM provider:", osmProvider.name);
    return osmProvider.id;
  }

  console.log("❌ No providers found anywhere");
  return null;
}

// ✅ FIRESTORE PROVIDER SEARCH (Primary - Fast & Accurate)
async function findProviderFromDB(serviceType, locationFilter) {
  let constraints = [where("role", "==", "service_provider")];

  // Dynamic location filter
  if (locationFilter.subDistrict) {
    constraints.push(where("subDistrict", "==", locationFilter.subDistrict));
  } else if (locationFilter.district) {
    constraints.push(where("district", "==", locationFilter.district));
  } else if (locationFilter.city) {
    constraints.push(where("city", "==", locationFilter.city));
  }

  const q = query(collection(db, "users"), ...constraints);
  const snap = await getDocs(q);

  if (snap.empty) return null;

  let providers = [];
  snap.forEach((docSnap) => {
    const p = docSnap.data();
    const providerService = (p.service || "").toLowerCase().trim();

    // ✅ Smart fuzzy matching
    if (fuzzyMatch(providerService, serviceType)) {
      providers.push({
        id: docSnap.id,
        rating: p.rating || 0,
        completedJobs: p.completedJobs || 0,
        availability: p.availability || "Available",
        activeRequests: p.activeRequests || 0,
        signupDate: p.signupDate || "9999-12-31"
      });
    }
  });

  if (!providers.length) return null;

  // ✅ Select BEST provider (load balanced)
  const best = providers
    .filter(p => p.availability === "Available" && p.activeRequests < 5)
    .sort((a, b) => {
      const scoreA = (a.rating * 2) + a.completedJobs - (a.activeRequests * 0.5);
      const scoreB = (b.rating * 2) + b.completedJobs - (b.activeRequests * 0.5);
      return scoreB - scoreA || new Date(a.signupDate) - new Date(b.signupDate);
    })[0];

  return best ? best.id : null;
}

// ✅ OPENSTREETMAP FALLBACK (FREE, Legal, Works in Frontend)
async function findProviderFromOSM(serviceType, location) {
  if (!location) return null;

  const queryText = `${serviceType} service in ${location}`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryText)}&limit=3&addressdetails=1`;

  try {
    const res = await fetch(url, {
      headers: { 
        "Accept": "application/json",
        "User-Agent": "ServiceFinder/1.0"
      }
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.length) return null;

    // Pick best match
    const bestMatch = data.find(item => 
      item.display_name.toLowerCase().includes(serviceType) ||
      item.category?.includes(serviceType)
    ) || data[0];

    // ✅ Store as "pending verification" provider
    const provider = {
      name: bestMatch.display_name.split(",")[0] || "Local Service",
      address: bestMatch.display_name || `${serviceType} in ${location}`,
      phone: "Contact via platform",
      website: "Not Available",
      role: "service_provider",
      service: serviceType,
      subDistrict: location,
      district: location,
      city: location,
      rating: 3.5, // Default for new providers
      completedJobs: 0,
      availability: "Available",
      activeRequests: 0,
      signupDate: new Date().toISOString(),
      source: "osm_auto", // Admin can verify later
      verified: false,    // Needs admin approval
      coordinates: bestMatch.lat && bestMatch.lon ? 
        new firebase.firestore.GeoPoint(parseFloat(bestMatch.lat), parseFloat(bestMatch.lon)) : null
    };

    const docRef = await addDoc(collection(db, "users"), provider);
    provider.id = docRef.id;

    console.log(`✅ OSM Provider added: ${provider.name} (${provider.id})`);
    return provider;

  } catch (err) {
    console.error("❌ OSM Error:", err);
    return null;
  }
}

// ✅ FUZZY MATCHING (Improved)
function fuzzyMatch(a, b) {
  const distance = levenshteinDistance(a, b);
  const minLength = Math.min(a.length, b.length);
  return (
    a.includes(b) || 
    b.includes(a) || 
    distance <= Math.max(2, minLength * 0.3)
  );
}

function levenshteinDistance(s1, s2) {
  const dp = Array(s2.length + 1).fill().map(() => Array(s1.length + 1).fill(0));
  for (let i = 0; i <= s2.length; i++) dp[i][0] = i;
  for (let j = 0; j <= s1.length; j++) dp[0][j] = j;

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (s1[j - 1] === s2[i - 1] ? 0 : 1)
      );
    }
  }
  return dp[s2.length][s1.length];
}

// ✅ Load User Services (IMPROVED)
async function loadUserServices() {
  const q = query(collection(db, "services"), where("requestedBy", "==", userId));
  const querySnapshot = await getDocs(q);

  const serviceContainer = document.getElementById("assigned-service");
  serviceContainer.innerHTML = "";

  if (querySnapshot.empty) {
    serviceContainer.innerHTML = `<p class="text-gray-500">No services requested yet.</p>`;
    return;
  }

  querySnapshot.forEach(async (docSnap) => {
    const data = docSnap.data();
    let providerProfile = "Not Assigned";

    if (data.assignedTo) {
      try {
        const providerDoc = await getDoc(doc(db, "users", data.assignedTo));
        if (providerDoc.exists()) {
          const providerData = providerDoc.data();
          providerProfile = providerData.username || providerData.name || "Provider";
        }
      } catch (e) {
        console.error("Provider fetch error:", e);
      }
    }

    serviceContainer.innerHTML += `
      <div style="border:1px solid #ccc; padding:15px; margin-bottom:10px; border-radius:8px;">
        <h4 style="margin:0 0 10px 0; color:#333;"><b>${data.serviceName}</b></h4>
        <p><b>Status:</b> 
          <span style="padding:4px 8px; border-radius:4px; background:#e3f2fd; color:#1976d2; font-size:12px;">
            ${data.status}
          </span>
        </p>
        <p><b>Provider:</b> ${providerProfile}</p>
        <div style="margin-top:10px;">
          <button onclick="window.location.href='profile.html?id=${data.assignedTo}'" 
                  style="padding:6px 12px; margin-right:5px; background:#2196f3; color:white; border:none; border-radius:4px; cursor:pointer;">
            View Provider
          </button>
          <button onclick="window.location.href='profile.html?id=${userId}'" 
                  style="padding:6px 12px; margin-right:5px; background:#757575; color:white; border:none; border-radius:4px; cursor:pointer;">
            Your Profile
          </button>
          ${data.status === "Assigned" ? 
            `<button onclick="cancelService('${docSnap.id}')" 
                    style="padding:6px 12px; background:#f44336; color:white; border:none; border-radius:4px; cursor:pointer;">
              Cancel Service
            </button>` : ""}
          ${data.status === "Completed" ? 
            `<button onclick="openFeedbackForm('${docSnap.id}')" 
                    style="padding:6px 12px; background:#4caf50; color:white; border:none; border-radius:4px; cursor:pointer;">
              Give Feedback
            </button>` : ""}
        </div>
      </div>
    `;

    if (data.status === "Completed") {
      document.getElementById("section-4")?.classList.remove("hidden");
    }
  });
}

// ✅ Cancel Service (Restores request)
window.cancelService = async (serviceId) => {
  await updateDoc(doc(db, "services", serviceId), { status: "Cancelled" });
  
  // ✅ Restore user request count
  await updateDoc(doc(db, "subscriptions", userId), {
    remainingRequests: firebase.firestore.FieldValue.increment(1)
  });
  
  alert("Service Cancelled! Your request has been restored.");
  location.reload();
};

// ✅ Feedback System
window.openFeedbackForm = (serviceId) => {
  latestServiceId = serviceId;
  alert(`Feedback form ready for service ID: ${latestServiceId}`);
};

document.getElementById("feedback-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!latestServiceId) {
    alert("Please select a completed service first.");
    return;
  }

  const rating = document.getElementById("rating").value;
  const feedback = document.getElementById("feedback").value;

  const serviceRef = doc(db, "services", latestServiceId);
  const serviceSnap = await getDoc(serviceRef);
  const serviceData = serviceSnap.data();

  // Update service
  await updateDoc(serviceRef, {
    feedback,
    rating: parseInt(rating),
    status: "Closed"
  });

  // Update provider rating
  if (serviceData.assignedTo) {
    await updateProviderRating(serviceData.assignedTo, parseInt(rating));
  }

  alert("✅ Feedback submitted! Thank you.");
  location.reload();
});

// ✅ Provider Rating Update
async function updateProviderRating(providerId, rating) {
  const providerRef = doc(db, "users", providerId);
  const snap = await getDoc(providerRef);
  
  if (snap.exists()) {
    const data = snap.data();
    const jobs = (data.completedJobs || 0) + 1;
    const newRating = ((data.rating || 0) * (jobs - 1) + rating) / jobs;
    
    await updateDoc(providerRef, {
      rating: newRating,
      completedJobs: jobs,
      activeRequests: firebase.firestore.FieldValue.increment(-1)
    });
  }
        }
