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

// ✅ Load Profile
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

// ✅ Check Subscription & Handle Auto-logic
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

    // ✅ If Gold Plan was Rejected, revert to Free and restore backupRequests
    if (subscriptionPlan === "Gold" && subscriptionStatus === "Rejected") {
      const oldReq = typeof data.backupRequests === "number" ? data.backupRequests : 0;

      await setDoc(subRef, {
        plan: "Free",
        status: "Active",
        remainingRequests: oldReq,
        subscribedDate: null,
        backupRequests: deleteField()
      }, { merge: true });

      alert(`Gold Plan was rejected. Restored your previous ${oldReq} request(s).`);
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

        alert("You’ve received 1 free request for this month.");
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
    // ✅ First-time user setup
    await setDoc(subRef, {
      plan: "Free",
      remainingRequests: 1,
      status: "Active",
      lastReset: today.toISOString()
    });
    location.reload();
  }
}

// ✅ Request Gold Plan
window.requestGoldPlan = async () => {
  const subSnap = await getDoc(doc(db, "subscriptions", userId));
  const existing = subSnap.exists() ? subSnap.data() : null;

  // Backup old requests before switching
  const backup = existing ? existing.remainingRequests : 1;

  await setDoc(doc(db, "subscriptions", userId), {
    plan: "Gold",
    remainingRequests: 35,
    status: "Pending",
    subscribedDate: new Date().toISOString(),
    backupRequests: backup
  }, { merge: true });

  alert("Gold Plan requested. Awaiting Admin approval.");
  location.reload();
};

// ✅ Request Service
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
    alert("No available service providers. Try again later.");
    return;
  }

  const docRef = await addDoc(collection(db, "services"), {
    serviceName: service,
    requestedBy: userId,
    assignedTo: serviceProvider,
    status: "Assigned"
  });

  latestServiceId = docRef.id;

  await updateDoc(doc(db, "subscriptions", userId), {
    remainingRequests: remainingRequests - 1
  });

  alert("Service Requested and Assigned!");
  location.reload();
});


// ✅ Function to Auto Assign Best Service Provider
async function autoAssignServiceProvider() {
  let serviceType = document.getElementById("service").value.toLowerCase().trim();

  // ✅ Get User's Sub-District
  const userRef = await getDoc(doc(db, "users", userId));
  if (!userRef.exists()) return null;
  const userSubDistrict = userRef.data().subDistrict;
  const userDistrict = userRef.data().district; // Assuming district is also available
  const userCity = userRef.data().city; // City level fallback
  const userState = userRef.data().state; // State level fallback

  // ✅ Check Firestore for Providers in Sub-District
  let providers = await findProviders(serviceType, userSubDistrict);

  // ✅ If no providers found, search in the District
  if (providers.length === 0) {
    console.log("No providers found in sub-district. Searching in district...");
    providers = await findProviders(serviceType, userDistrict);
  }

  // ✅ If still no providers, search in City
  if (providers.length === 0) {
    console.log("No providers found in district. Searching in city...");
    providers = await findProviders(serviceType, userCity);
  }

  // ✅ If Providers are found, sort and return the best one
  if (providers.length > 0) {
    let bestProvider = providers
      .sort((a, b) => 
        (b.rating + b.completedJobs) - (a.rating + a.completedJobs) ||
        a.activeRequests - b.activeRequests ||
        new Date(a.signupDate) - new Date(b.signupDate)
      )
      .find(provider => provider.availability === "Available");

    return bestProvider ? bestProvider.id : null;
  }

  // ✅ **If No Provider Found, Search External APIs**
  console.log("No local providers found. Searching external APIs...");
  let newProvider = await findServiceProviderEnhanced(serviceType, userSubDistrict, userDistrict, userCity, userState);
  if (newProvider) {
    return newProvider.id; // Return newly added provider's ID
  }
  return null;
}

// ✅ **Find Service Provider using Multiple APIs**
async function findServiceProviderEnhanced(serviceType, subDistrict, district, city, state) {
  // Try APIs in order of reliability and cost
  const locationHierarchy = [subDistrict, district, city, state];
  
  for (const location of locationHierarchy) {
    if (!location) continue;
    
    try {
      // Try free APIs first
      let provider = await tryFreeAPIs(serviceType, location);
      if (provider) return provider;
      
      // Then try APIs that require keys
      provider = await tryKeyAPIs(serviceType, location);
      if (provider) return provider;
      
    } catch (error) {
      console.error(`Error searching in ${location}:`, error);
    }
  }
  
  return null;
}

// ✅ **Try Free APIs (no API key required)**
async function tryFreeAPIs(serviceType, location) {
  // 1. OpenStreetMap (Nominatim)
  try {
    let osmUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${serviceType} in ${location}&extratags=1`;
    let response = await fetch(osmUrl);
    let data = await response.json();
    
    if (data.length > 0) {
      console.log("Found provider via OpenStreetMap");
      return await storeNewProvider(data[0], serviceType, location);
    }
  } catch (error) {
    console.error("OpenStreetMap API Error:", error);
  }

  // 2. Overpass API (for OpenStreetMap data)
  try {
    let overpassQuery = `[out:json][timeout:25];(node["shop"~"${serviceType}"](around:5000,${location});way["shop"~"${serviceType}"](around:5000,${location}););out body;>;out skel qt;`;
    let overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    let response = await fetch(overpassUrl);
    let data = await response.json();
    
    if (data.elements && data.elements.length > 0) {
      console.log("Found provider via Overpass API");
      return await storeNewProvider(data.elements[0], serviceType, location);
    }
  } catch (error) {
    console.error("Overpass API Error:", error);
  }

  // 3. Geonames (free tier available)
  try {
    let geonamesUrl = `http://api.geonames.org/searchJSON?q=${serviceType}&name_equals=${location}&maxRows=1&username=fixsavyhub`;
    let response = await fetch(geonamesUrl);
    let data = await response.json();
    
    if (data.geonames && data.geonames.length > 0) {
      console.log("Found provider via Geonames");
      return await storeNewProvider(data.geonames[0], serviceType, location);
    }
  } catch (error) {
    console.error("Geonames API Error:", error);
  }

  // 4. Mapbox (free tier available)
  try {
    let mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${serviceType}.json?proximity=${location}&access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw`;
    let response = await fetch(mapboxUrl);
    let data = await response.json();
    
    if (data.features && data.features.length > 0) {
      console.log("Found provider via Mapbox");
      return await storeNewProvider(data.features[0], serviceType, location);
    }
  } catch (error) {
    console.error("Mapbox API Error:", error);
  }

  return null;
}

// ✅ **Try APIs that require API keys**
async function tryKeyAPIs(serviceType, location) {
  // 1. Yelp Fusion API
  try {
    let yelpUrl = `https://api.yelp.com/v3/businesses/search?term=${serviceType}&location=${location}&limit=1`;
    let response = await fetch(yelpUrl, {
      headers: {
        "Authorization": `Bearer ${YOUR_YELP_API_KEY}` 
      }
    });

    let data = await response.json();
    if (data.businesses && data.businesses.length > 0) {
      console.log("Found provider via Yelp");
      return await storeNewProvider(data.businesses[0], serviceType, location);
    }
  } catch (error) {
    console.error("Yelp API Error:", error);
  }

  // 2. Google Places API
  try {
    let googleUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${serviceType}+in+${location}&key=${YOUR_GOOGLE_API_KEY}`;
    let response = await fetch(googleUrl);
    let data = await response.json();

    if (data.results && data.results.length > 0) {
      console.log("Found provider via Google Places");
      return await storeNewProvider(data.results[0], serviceType, location);
    }
  } catch (error) {
    console.error("Google Places API Error:", error);
  }

  // 3. Foursquare API
  try {
    let foursquareUrl = `https://api.foursquare.com/v3/places/search?query=${serviceType}&near=${location}`;
    let response = await fetch(foursquareUrl, {
      headers: { "Authorization": "fsq3zz12Qn2PtWIQM1J5Vz+da3Q/SzGR9H9X+W3IjMPYFZo=" }
    });

    let data = await response.json();
    if (data.results && data.results.length > 0) {
      console.log("Found provider via Foursquare");
      return await storeNewProvider(data.results[0], serviceType, location);
    }
  } catch (error) {
    console.error("Foursquare API Error:", error);
  }

  // 4. TomTom Search API
  try {
    let tomtomUrl = `https://api.tomtom.com/search/2/search/${serviceType}.json?limit=1&countrySet=US&lat=37.7749&lon=-122.4194&key=${YOUR_TOMTOM_API_KEY}`;
    let response = await fetch(tomtomUrl);
    let data = await response.json();

    if (data.results && data.results.length > 0) {
      console.log("Found provider via TomTom");
      return await storeNewProvider(data.results[0], serviceType, location);
    }
  } catch (error) {
    console.error("TomTom API Error:", error);
  }

  // 5. Here Places API
  try {
    let hereUrl = `https://discover.search.hereapi.com/v1/discover?at=40.730610,-73.935242&q=${serviceType}&limit=1&apiKey=${YOUR_HERE_API_KEY}`;
    let response = await fetch(hereUrl);
    let data = await response.json();

    if (data.items && data.items.length > 0) {
      console.log("Found provider via Here");
      return await storeNewProvider(data.items[0], serviceType, location);
    }
  } catch (error) {
    console.error("Here API Error:", error);
  }

  return null;
}

// ✅ **Store New Provider in Firestore**
async function storeNewProvider(providerData, serviceType, location) {
  // Normalize provider data from different APIs
  let provider = {
    name: getProviderName(providerData),
    address: getProviderAddress(providerData),
    phone: getProviderPhone(providerData),
    website: getProviderWebsite(providerData),
    role: "service_provider",
    service: serviceType,
    subDistrict: location,
    rating: getProviderRating(providerData),
    completedJobs: 0,
    availability: "Available",
    activeRequests: 0,
    signupDate: new Date().toISOString(),
    source: providerData.source || "external_api",
    coordinates: getProviderCoordinates(providerData)
  };

  const docRef = await addDoc(collection(db, "users"), provider);
  provider.id = docRef.id;

  console.log(`New service provider added: ${provider.name}`);
  return provider;
}

// Helper functions to normalize provider data from different APIs
function getProviderName(data) {
  if (data.name) return data.name;
  if (data.display_name) return data.display_name.split(",")[0];
  if (data.title) return data.title;
  if (data.place_name) return data.place_name.split(",")[0];
  return "Unknown Provider";
}

function getProviderAddress(data) {
  if (data.address) return data.address;
  if (data.location?.formatted_address) return data.location.formatted_address;
  if (data.vicinity) return data.vicinity;
  if (data.display_name) return data.display_name;
  if (data.location?.address) return data.location.address;
  return "Unknown Address";
}

function getProviderPhone(data) {
  if (data.phone) return data.phone;
  if (data.extratags?.phone) return data.extratags.phone;
  if (data.contact?.phone) return data.contact.phone;
  if (data.tel) return data.tel;
  return "Not Available";
}

function getProviderWebsite(data) {
  if (data.website) return data.website;
  if (data.url) return data.url;
  if (data.extratags?.website) return data.extratags.website;
  if (data.contact?.website) return data.contact.website;
  if (data.website_url) return data.website_url;
  return "Not Available";
}

function getProviderRating(data) {
  if (data.rating) return data.rating;
  if (data.avg_rating) return data.avg_rating;
  if (data.score) return data.score / 2; // Normalize to 5-point scale
  return 3.5; // Default average rating
}

function getProviderCoordinates(data) {
  if (data.lat && data.lon) return new GeoPoint(data.lat, data.lon);
  if (data.geometry?.coordinates) return new GeoPoint(data.geometry.coordinates[1], data.geometry.coordinates[0]);
  if (data.position) return new GeoPoint(data.position.lat, data.position.lng);
  return null;
}

// ✅ **Find Providers from Firestore with Improved Matching**
async function findProviders(serviceType, location) {
  const q = query(collection(db, "users"),
    where("role", "==", "service_provider"),
    where("subDistrict", "==", location)
  );

  const providersSnapshot = await getDocs(q);
  let providers = [];
  
  if (!providersSnapshot.empty) {
    providersSnapshot.forEach(docSnap => {
      const provider = docSnap.data();
      let providerService = provider.service.toLowerCase().trim();

      if (fuzzyMatch(providerService, serviceType)) {
        providers.push({
          id: docSnap.id,
          rating: provider.rating || 0,
          completedJobs: provider.completedJobs || 0,
          availability: provider.availability || "Available",
          activeRequests: provider.activeRequests || 0,
          signupDate: provider.signupDate || "9999-12-31"
        });
      }
    });
  }
  return providers;
}

// ✅ **Fuzzy Matching using Levenshtein Distance**
function fuzzyMatch(a, b) {
  return a.includes(b) || b.includes(a) || levenshteinDistance(a, b) <= 2;
}

// ✅ **Levenshtein Distance Calculation**
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






// ✅ Load User Services
async function loadUserServices() {
  const q = query(collection(db, "services"), where("requestedBy", "==", userId));
  const querySnapshot = await getDocs(q);

  const serviceContainer = document.getElementById("assigned-service");
  serviceContainer.innerHTML = "";

  if (querySnapshot.empty) {
    serviceContainer.innerHTML = `<p>No services requested yet.</p>`;
    return;
  }

  querySnapshot.forEach(async (docSnap) => {
    const data = docSnap.data();
    let providerProfile = "Not Assigned";

    if (data.assignedTo) {
      const providerDoc = await getDoc(doc(db, "users", data.assignedTo));
      if (providerDoc.exists()) {
        providerProfile = providerDoc.data().username;
      }
    }

    // ✅ Generate service card with "Give Feedback" button for completed services
    serviceContainer.innerHTML += `
      <div style="border:1px solid #ccc; padding:10px; margin-bottom:10px;">
        <p><b>Service:</b> ${data.serviceName}</p>
        <p><b>Status:</b> ${data.status}</p>
        <p><b>Service Provider:</b> ${providerProfile}</p>
        <button onclick="window.location.href='profile.html?id=${data.assignedTo}'">View Provider Profile</button>
        <button onclick="window.location.href='profile.html?id=${userId}'">View Your Profile</button>
        <button onclick="cancelService('${docSnap.id}')">Cancel Service</button>
        ${data.status === "Completed" ? `<button onclick="openFeedbackForm('${docSnap.id}')">Give Feedback</button>` : ""}
      </div>
    `;

    if (data.status === "Completed") {
      document.getElementById("section-4").classList.remove("hidden");
    }
  });
}

// ✅ Cancel Service
window.cancelService = async (serviceId) => {
  await updateDoc(doc(db, "services", serviceId), { status: "Cancelled" });
  alert("Service Cancelled!");
  location.reload();
};

// ✅ Open Feedback Form & Set latestServiceId
window.openFeedbackForm = (serviceId) => {
  latestServiceId = serviceId;
  alert(`Feedback enabled for service: ${latestServiceId}`);
};

// ✅ Submit Feedback (Fixed)
document.getElementById("feedback-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!latestServiceId) {
    alert("Please select a completed service to give feedback.");
    return;
  }

  const rating = document.getElementById("rating").value;
  const feedback = document.getElementById("feedback").value;

  await updateDoc(doc(db, "services", latestServiceId), {
    feedback,
    rating,
    status: "Closed"
  });

  alert("Feedback Submitted!");
  location.reload();
});

    
