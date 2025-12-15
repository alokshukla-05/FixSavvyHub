import { auth, db } from "./firebase-config.js";
import { 
  doc, setDoc, getDoc, collection, addDoc, query, 
  where, getDocs, updateDoc, deleteField, orderBy,
  GeoPoint, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// Global Variables
let userId = null;
let latestServiceId = null;
let subscriptionPlan = "Free";
let remainingRequests = 1;
let subscriptionStatus = "Active";
let userData = {};
let selectedRating = 0;

// API Configuration
const API_CONFIG = {
  // RapidAPI Keys (Replace with your actual keys)
  RAPIDAPI_KEY: "YOUR_RAPIDAPI_KEY_HERE",
  JUSTDIAL_HOST: "just-dial-india.p.rapidapi.com",
  
  // Other APIs (Configure in firebase-config.js)
  ENABLE_EXTERNAL_APIS: true,
  MAX_EXTERNAL_SEARCH: 3,
  
  // Service limits
  FREE_PLAN_REQUESTS: 1,
  GOLD_PLAN_REQUESTS: 35,
  
  // Plan pricing
  GOLD_PLAN_PRICE: 199,
  GOLD_PLAN_CURRENCY: "₹"
};

// ✅ Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initializeAuth();
    setupEventListeners();
  } catch (error) {
    console.error("Initialization error:", error);
    showNotification("Failed to initialize application. Please refresh.", "error");
  }
});

// ✅ Setup Authentication
async function initializeAuth() {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      showNotification("You need to sign in first. Redirecting...", "error");
      setTimeout(() => window.location.href = "signin.html", 2000);
      return;
    }

    userId = user.uid;
    document.getElementById('userAvatar').textContent = user.email ? user.email[0].toUpperCase() : 'U';
    
    await Promise.all([
      loadUserProfile(),
      checkSubscription(),
      loadUserServices()
    ]);
    
    setupRatingStars();
  });
}

// ✅ Setup Event Listeners
function setupEventListeners() {
  // Profile Form
  document.getElementById("profile-form").addEventListener("submit", handleProfileSubmit);
  
  // Service Request Form
  document.getElementById("request-service-form").addEventListener("submit", handleServiceRequest);
  
  // Feedback Form
  document.getElementById("feedback-form").addEventListener("submit", handleFeedbackSubmit);
  
  // Upgrade Button
  document.getElementById("upgrade-btn").addEventListener("click", requestGoldPlan);
  
  // Service Select for Feedback
  document.getElementById("service-select").addEventListener("change", function() {
    latestServiceId = this.value;
  });
}

// ✅ Show Notification
function showNotification(message, type = "info") {
  const container = document.getElementById('notification-container');
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
    ${message}
  `;
  
  container.appendChild(notification);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// ✅ Load User Profile (FIXED)
async function loadUserProfile() {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    
    if (userDoc.exists()) {
      userData = userDoc.data();
      
      // Populate form fields
      document.getElementById("username").value = userData.username || "";
      document.getElementById("phone").value = userData.phone || "";
      document.getElementById("address").value = userData.address || "";
      document.getElementById("city").value = userData.city || "";
      document.getElementById("state").value = userData.state || "";
      
      // Update greeting
      document.getElementById("userGreeting").textContent = `Hello, ${userData.username || "User"}!`;
      document.getElementById('userAvatar').textContent = userData.username ? userData.username[0].toUpperCase() : 'U';
      
      // Check if profile is complete
      const isProfileComplete = userData.phone && userData.address && userData.city && userData.state;
      
      // Toggle sections
      document.getElementById("section-1").classList.toggle("hidden", isProfileComplete);
      document.getElementById("section-2").classList.toggle("hidden", !isProfileComplete);
      document.getElementById("section-3").classList.toggle("hidden", !isProfileComplete);
      document.getElementById("section-5").classList.toggle("hidden", !isProfileComplete);
      
    } else {
      // Create initial user document
      await setDoc(doc(db, "users", userId), {
        uid: userId,
        email: auth.currentUser?.email || "",
        username: "",
        phone: "",
        address: "",
        city: "",
        state: "",
        role: "user",
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp()
      });
      
      showNotification("Welcome! Please complete your profile.", "info");
    }
    
  } catch (error) {
    console.error("Error loading profile:", error);
    showNotification("Error loading profile data", "error");
  }
}

// ✅ Handle Profile Submit
async function handleProfileSubmit(e) {
  e.preventDefault();
  
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = '<div class="loading"></div> Saving...';
  submitBtn.disabled = true;
  
  try {
    const profileData = {
      username: document.getElementById("username").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      address: document.getElementById("address").value.trim(),
      city: document.getElementById("city").value.trim(),
      state: document.getElementById("state").value.trim(),
      updatedAt: serverTimestamp(),
      profileCompleted: true
    };
    
    // Validate phone number
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(profileData.phone)) {
      throw new Error("Please enter a valid 10-digit phone number");
    }
    
    await setDoc(doc(db, "users", userId), profileData, { merge: true });
    
    showNotification("Profile saved successfully!", "success");
    
    // Reload after short delay
    setTimeout(() => {
      location.reload();
    }, 1500);
    
  } catch (error) {
    console.error("Profile save error:", error);
    showNotification(error.message || "Failed to save profile", "error");
    submitBtn.innerHTML = originalText;
    submitBtn.disabled = false;
  }
}

// ✅ Check Subscription (COMPLETELY FIXED)
async function checkSubscription() {
  try {
    const subRef = doc(db, "subscriptions", userId);
    const subSnap = await getDoc(subRef);
    const today = new Date();
    
    if (subSnap.exists()) {
      const data = subSnap.data();
      
      subscriptionPlan = data.plan || "Free";
      remainingRequests = data.remainingRequests || API_CONFIG.FREE_PLAN_REQUESTS;
      subscriptionStatus = data.status || "Active";
      const subscribedDate = data.subscribedDate ? new Date(data.subscribedDate) : null;
      const lastReset = data.lastReset ? new Date(data.lastReset) : null;
      
      // ✅ CRITICAL FIX: Handle rejected subscription
      if (subscriptionPlan === "Gold" && subscriptionStatus === "Rejected") {
        const backupRequests = data.backupRequests || API_CONFIG.FREE_PLAN_REQUESTS;
        
        await setDoc(subRef, {
          plan: "Free",
          status: "Active",
          remainingRequests: backupRequests,
          lastReset: today.toISOString(),
          rejectionDate: today.toISOString(),
          subscribedDate: deleteField(),
          backupRequests: deleteField()
        }, { merge: true });
        
        showNotification(`Gold Plan was rejected. Restored your ${backupRequests} request(s).`, "info");
        
        // Update local variables
        subscriptionPlan = "Free";
        remainingRequests = backupRequests;
        subscriptionStatus = "Active";
        
        updateSubscriptionUI();
        return;
      }
      
      // ✅ Handle expired Gold plan
      if (subscriptionPlan === "Gold" && subscribedDate) {
        const expiryDate = new Date(subscribedDate);
        expiryDate.setMonth(expiryDate.getMonth() + 1);
        
        if (today >= expiryDate) {
          await setDoc(subRef, {
            plan: "Free",
            remainingRequests: API_CONFIG.FREE_PLAN_REQUESTS,
            status: "Expired",
            lastReset: today.toISOString(),
            subscribedDate: deleteField(),
            backupRequests: deleteField()
          }, { merge: true });
          
          showNotification("Gold subscription expired. Downgraded to Free plan.", "info");
          
          subscriptionPlan = "Free";
          remainingRequests = API_CONFIG.FREE_PLAN_REQUESTS;
          subscriptionStatus = "Expired";
          
          updateSubscriptionUI();
          return;
        }
      }
      
      // ✅ Monthly reset logic for Free plan
      if (subscriptionPlan === "Free") {
        const needsReset = !lastReset || 
          lastReset.getMonth() !== today.getMonth() || 
          lastReset.getFullYear() !== today.getFullYear();
        
        if (needsReset) {
          await updateDoc(subRef, {
            remainingRequests: API_CONFIG.FREE_PLAN_REQUESTS,
            lastReset: today.toISOString()
          });
          
          remainingRequests = API_CONFIG.FREE_PLAN_REQUESTS;
          showNotification("Monthly request limit reset! You have 1 free request.", "success");
        }
      }
      
    } else {
      // First-time user setup
      await setDoc(subRef, {
        plan: "Free",
        remainingRequests: API_CONFIG.FREE_PLAN_REQUESTS,
        status: "Active",
        lastReset: today.toISOString(),
        createdAt: serverTimestamp()
      });
      
      subscriptionPlan = "Free";
      remainingRequests = API_CONFIG.FREE_PLAN_REQUESTS;
      subscriptionStatus = "Active";
    }
    
    updateSubscriptionUI();
    
  } catch (error) {
    console.error("Subscription check error:", error);
    showNotification("Error loading subscription", "error");
  }
}

// ✅ Update Subscription UI
function updateSubscriptionUI() {
  // Update counters
  document.getElementById('remaining-requests').textContent = remainingRequests;
  document.getElementById('requests-counter').textContent = remainingRequests;
  
  // Update progress bar
  const totalRequests = subscriptionPlan === "Gold" ? API_CONFIG.GOLD_PLAN_REQUESTS : API_CONFIG.FREE_PLAN_REQUESTS;
  const progressPercent = (remainingRequests / totalRequests) * 100;
  document.getElementById('requests-progress').style.width = `${progressPercent}%`;
  
  // Update plan display
  const planTitle = document.getElementById('plan-title');
  const planDesc = document.getElementById('plan-description');
  const planIcon = document.getElementById('plan-icon');
  const planCard = document.getElementById('subscription-plan-card');
  const statusText = document.getElementById('status-text');
  const statusDetails = document.getElementById('status-details');
  const upgradeBtn = document.getElementById('upgrade-btn');
  const userPlan = document.getElementById('userPlan');
  
  if (subscriptionPlan === "Gold") {
    planTitle.textContent = "Gold Plan";
    planDesc.textContent = "Premium service access";
    planIcon.textContent = "👑";
    planCard.className = "subscription-plan plan-gold";
    userPlan.textContent = "Gold Plan User";
    
    // Update features
    document.getElementById('plan-features').innerHTML = `
      <li>${API_CONFIG.GOLD_PLAN_REQUESTS} service requests per month</li>
      <li>Priority provider matching</li>
      <li>24/7 premium support</li>
      <li>No geographical restrictions</li>
      <li>Instant assignment</li>
    `;
    
  } else {
    planTitle.textContent = "Free Plan";
    planDesc.textContent = "Basic service access";
    planIcon.textContent = "🆓";
    planCard.className = "subscription-plan plan-free";
    userPlan.textContent = "Free Plan User";
    
    // Update features
    document.getElementById('plan-features').innerHTML = `
      <li>${API_CONFIG.FREE_PLAN_REQUESTS} service request per month</li>
      <li>Standard provider matching</li>
      <li>Basic support</li>
      <li>Local providers only</li>
    `;
  }
  
  // Update status
  statusText.textContent = subscriptionStatus;
  statusDetails.textContent = getStatusDetails(subscriptionStatus);
  
  // Style status based on state
  const statusDiv = document.getElementById('subscription-status');
  statusDiv.style.background = getStatusColor(subscriptionStatus);
  
  // Configure upgrade button
  configureUpgradeButton(upgradeBtn);
}

// ✅ Get Status Details
function getStatusDetails(status) {
  const details = {
    "Active": "Your subscription is active and ready to use",
    "Pending": "Gold upgrade pending admin approval (24-48 hours)",
    "Rejected": "Gold upgrade was rejected. Using Free plan",
    "Expired": "Gold plan expired. Downgraded to Free",
    "Suspended": "Subscription suspended. Contact support"
  };
  return details[status] || "Active";
}

// ✅ Get Status Color
function getStatusColor(status) {
  const colors = {
    "Active": "#d4edda",
    "Pending": "#fff3cd",
    "Rejected": "#f8d7da",
    "Expired": "#d6d8db",
    "Suspended": "#f5c6cb"
  };
  return colors[status] || "#f8f9fa";
}

// ✅ Configure Upgrade Button
function configureUpgradeButton(button) {
  button.innerHTML = '';
  
  if (subscriptionStatus === "Pending") {
    button.innerHTML = '<i class="fas fa-clock"></i> Pending Approval';
    button.disabled = true;
    button.className = "warning";
  } else if (subscriptionPlan === "Gold") {
    button.innerHTML = '<i class="fas fa-crown"></i> Gold Plan Active';
    button.disabled = true;
    button.className = "success";
  } else if (subscriptionStatus === "Rejected") {
    button.innerHTML = `<i class="fas fa-exclamation-circle"></i> Upgrade to Gold (Previously Rejected)`;
    button.disabled = false;
    button.className = "danger";
  } else {
    button.innerHTML = `<i class="fas fa-crown"></i> Upgrade to Gold (${API_CONFIG.GOLD_PLAN_CURRENCY}${API_CONFIG.GOLD_PLAN_PRICE}/month)`;
    button.disabled = false;
    button.className = "";
  }
}

// ✅ Request Gold Plan (FIXED)
async function requestGoldPlan() {
  try {
    // Check current subscription
    const subSnap = await getDoc(doc(db, "subscriptions", userId));
    const currentData = subSnap.exists() ? subSnap.data() : {};
    
    // Prevent duplicate requests
    if (currentData.status === "Pending") {
      showNotification("Gold upgrade is already pending approval", "info");
      return;
    }
    
    // Backup current requests
    const backupRequests = currentData.remainingRequests || API_CONFIG.FREE_PLAN_REQUESTS;
    
    // Request Gold plan
    await setDoc(doc(db, "subscriptions", userId), {
      plan: "Gold",
      remainingRequests: 0, // Will be set to 35 after approval
      status: "Pending",
      subscribedDate: new Date().toISOString(),
      backupRequests: backupRequests,
      requestedAt: serverTimestamp(),
      previousPlan: currentData.plan || "Free"
    }, { merge: true });
    
    // Notify admin (you can implement this function)
    await notifyAdminAboutUpgradeRequest(userId, backupRequests);
    
    showNotification("Gold Plan requested! Awaiting admin approval (24-48 hours).", "success");
    
    // Update UI immediately
    subscriptionStatus = "Pending";
    subscriptionPlan = "Gold";
    updateSubscriptionUI();
    
  } catch (error) {
    console.error("Gold plan request error:", error);
    showNotification("Failed to request Gold plan. Please try again.", "error");
  }
}

// ✅ Notify Admin (Placeholder - implement your notification system)
async function notifyAdminAboutUpgradeRequest(userId, backupRequests) {
  try {
    // Create notification for admin
    await addDoc(collection(db, "adminNotifications"), {
      type: "UPGRADE_REQUEST",
      userId: userId,
      username: userData.username || "Unknown User",
      backupRequests: backupRequests,
      timestamp: serverTimestamp(),
      status: "unread",
      actionRequired: true
    });
    
    console.log("Admin notified about upgrade request");
  } catch (error) {
    console.error("Failed to notify admin:", error);
  }
}

// ✅ Handle Service Request
async function handleServiceRequest(e) {
  e.preventDefault();
  
  // Validation
  if (subscriptionStatus === "Pending") {
    showNotification("Gold upgrade is pending approval. Please wait.", "info");
    return;
  }
  
  if (remainingRequests <= 0) {
    showNotification("No requests left. Upgrade to Gold or wait for monthly reset.", "error");
    return;
  }
  
  const serviceType = document.getElementById("service").value;
  const description = document.getElementById("service-description").value;
  
  if (!serviceType) {
    showNotification("Please select a service type", "error");
    return;
  }
  
  const requestBtn = document.getElementById("request-service-btn");
  const originalContent = requestBtn.innerHTML;
  
  // Start search animation
  requestBtn.innerHTML = '<div class="loading"></div> Searching for providers...';
  requestBtn.disabled = true;
  
  // Show progress bar
  const progressBar = document.getElementById("search-progress");
  const progressFill = progressBar.querySelector(".progress-fill");
  progressBar.classList.remove("hidden");
  
  // Animate progress
  let progress = 0;
  const progressInterval = setInterval(() => {
    progress += 10;
    progressFill.style.width = `${Math.min(progress, 90)}%`;
  }, 300);
  
  try {
    // Step 1: Find service provider
    progressFill.style.width = "30%";
    const serviceProvider = await autoAssignServiceProvider(serviceType);
    
    if (!serviceProvider) {
      clearInterval(progressInterval);
      progressFill.style.width = "100%";
      progressFill.style.background = "#dc3545";
      showNotification("No available providers found. Try different service or location.", "error");
      
      setTimeout(() => {
        requestBtn.innerHTML = originalContent;
        requestBtn.disabled = false;
        progressBar.classList.add("hidden");
        progressFill.style.background = "";
      }, 2000);
      return;
    }
    
    // Step 2: Create service request
    progressFill.style.width = "60%";
    const serviceData = {
      serviceName: serviceType,
      serviceDescription: description,
      requestedBy: userId,
      assignedTo: serviceProvider.id,
      providerName: serviceProvider.name,
      status: "Assigned",
      userLocation: {
        city: userData.city,
        state: userData.state,
        address: userData.address
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      scheduledDate: new Date().toISOString(),
      priority: subscriptionPlan === "Gold" ? "High" : "Normal"
    };
    
    const docRef = await addDoc(collection(db, "services"), serviceData);
    latestServiceId = docRef.id;
    
    // Step 3: Update subscription requests
    progressFill.style.width = "80%";
    await updateDoc(doc(db, "subscriptions", userId), {
      remainingRequests: increment(-1),
      lastServiceRequest: serverTimestamp()
    });
    
    // Step 4: Update provider's active requests
    progressFill.style.width = "90%";
    await updateDoc(doc(db, "users", serviceProvider.id), {
      activeRequests: increment(1),
      lastAssigned: serverTimestamp()
    });
    
    // Complete
    clearInterval(progressInterval);
    progressFill.style.width = "100%";
    progressFill.style.background = "#28a745";
    
    showNotification(`Service requested! Assigned to ${serviceProvider.name}. Request ID: ${docRef.id}`, "success");
    
    // Update local counter
    remainingRequests--;
    updateSubscriptionUI();
    
    // Refresh after delay
    setTimeout(() => {
      location.reload();
    }, 2000);
    
  } catch (error) {
    console.error("Service request error:", error);
    clearInterval(progressInterval);
    
    showNotification("Failed to request service. Please try again.", "error");
    
    requestBtn.innerHTML = originalContent;
    requestBtn.disabled = false;
    progressBar.classList.add("hidden");
  }
}

// ✅ Auto Assign Service Provider (ENHANCED with APIs)
async function autoAssignServiceProvider(serviceType) {
  try {
    console.log(`Searching for ${serviceType} provider...`);
    
    // Get user location data
    const userLocation = {
      city: userData.city || "",
      state: userData.state || "",
      address: userData.address || ""
    };
    
    // Step 1: Try local Firestore providers
    let provider = await findLocalProvider(serviceType, userLocation);
    if (provider) {
      console.log("Found local provider:", provider.name);
      return provider;
    }
    
    // Step 2: Try external APIs if enabled
    if (API_CONFIG.ENABLE_EXTERNAL_APIS) {
      console.log("Searching external APIs...");
      provider = await searchExternalAPIs(serviceType, userLocation);
      if (provider) {
        console.log("Found external provider:", provider.name);
        return provider;
      }
    }
    
    // Step 3: Try RapidAPI JustDial
    provider = await searchJustDialAPI(serviceType, userLocation);
    if (provider) {
      console.log("Found JustDial provider:", provider.name);
      return provider;
    }
    
    return null;
    
  } catch (error) {
    console.error("Provider search error:", error);
    return null;
  }
}

// ✅ Find Local Provider from Firestore
async function findLocalProvider(serviceType, location) {
  try {
    const serviceLower = serviceType.toLowerCase();
    
    // Build search queries
    const queries = [];
    
    // Search by city
    if (location.city) {
      queries.push(
        query(collection(db, "users"),
          where("role", "==", "service_provider"),
          where("serviceTypes", "array-contains", serviceType),
          where("city", "==", location.city),
          where("availability", "==", "Available"),
          where("verificationStatus", "==", "verified"),
          orderBy("rating", "desc"),
          orderBy("completedJobs", "desc")
        )
      );
    }
    
    // Search by state (broader search)
    if (location.state) {
      queries.push(
        query(collection(db, "users"),
          where("role", "==", "service_provider"),
          where("serviceTypes", "array-contains", serviceType),
          where("state", "==", location.state),
          where("availability", "==", "Available"),
          where("verificationStatus", "in", ["verified", "pending"]),
          orderBy("rating", "desc")
        )
      );
    }
    
    // Execute queries
    for (const q of queries) {
      try {
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          // Find best provider
          let bestProvider = null;
          let bestScore = -1;
          
          snapshot.forEach(doc => {
            const provider = doc.data();
            const score = calculateProviderScore(provider);
            
            if (score > bestScore && (provider.activeRequests || 0) < (provider.maxActiveRequests || 5)) {
              bestScore = score;
              bestProvider = {
                id: doc.id,
                name: provider.username || provider.name || "Service Provider",
                rating: provider.rating || 3.5,
                completedJobs: provider.completedJobs || 0,
                ...provider
              };
            }
          });
          
          if (bestProvider) {
            return bestProvider;
          }
        }
      } catch (error) {
        console.error("Query error:", error);
        continue;
      }
    }
    
    return null;
    
  } catch (error) {
    console.error("Local provider search error:", error);
    return null;
  }
}

// ✅ Calculate Provider Score
function calculateProviderScore(provider) {
  let score = 0;
  
  // Rating (0-50 points)
  score += (provider.rating || 0) * 10;
  
  // Completed jobs (0-30 points)
  score += Math.min(provider.completedJobs || 0, 30);
  
  // Availability (10 points)
  if (provider.availability === "Available") score += 10;
  
  // Verification (10 points)
  if (provider.verificationStatus === "verified") score += 10;
  
  // Response time bonus (0-10 points)
  if (provider.avgResponseTime) {
    if (provider.avgResponseTime < 2) score += 10;
    else if (provider.avgResponseTime < 6) score += 5;
  }
  
  // Subtract for active requests
  score -= (provider.activeRequests || 0) * 2;
  
  return Math.max(0, score);
}

// ✅ Search External APIs
async function searchExternalAPIs(serviceType, location) {
  const apis = [
    { name: "OpenStreetMap", func: searchOpenStreetMap },
    { name: "Geonames", func: searchGeonames },
    { name: "Mapbox", func: searchMapbox }
  ];
  
  for (const api of apis) {
    try {
      console.log(`Trying ${api.name}...`);
      const provider = await api.func(serviceType, location);
      if (provider) {
        // Store in Firestore for future use
        await storeExternalProvider(provider, serviceType, location, api.name);
        return provider;
      }
    } catch (error) {
      console.error(`${api.name} search error:`, error);
      continue;
    }
  }
  
  return null;
}

// ✅ Search OpenStreetMap
async function searchOpenStreetMap(serviceType, location) {
  try {
    const query = `${serviceType} in ${location.city}, ${location.state}`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'FixSavvyHub/1.0'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.length > 0) {
        const result = data[0];
        return {
          name: result.display_name.split(",")[0],
          address: result.display_name,
          coordinates: new GeoPoint(parseFloat(result.lat), parseFloat(result.lon)),
          source: "openstreetmap",
          externalId: result.place_id
        };
      }
    }
  } catch (error) {
    console.error("OpenStreetMap error:", error);
  }
  
  return null;
}

// ✅ Search Geonames
async function searchGeonames(serviceType, location) {
  try {
    const username = "fixsavyhub"; // You need to register for a free account
    const url = `http://api.geonames.org/searchJSON?q=${encodeURIComponent(serviceType)}&name_equals=${encodeURIComponent(location.city)}&country=IN&maxRows=1&username=${username}`;
    
    const response = await fetch(url);
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.geonames && data.geonames.length > 0) {
        const result = data.geonames[0];
        return {
          name: result.name,
          address: result.adminName1 ? `${result.name}, ${result.adminName1}` : result.name,
          coordinates: new GeoPoint(parseFloat(result.lat), parseFloat(result.lng)),
          source: "geonames",
          externalId: result.geonameId.toString()
        };
      }
    }
  } catch (error) {
    console.error("Geonames error:", error);
  }
  
  return null;
}

// ✅ Search Mapbox
async function searchMapbox(serviceType, location) {
  try {
    // You need a Mapbox access token
    const accessToken = "YOUR_MAPBOX_TOKEN";
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(serviceType)}.json?proximity=${encodeURIComponent(location.city)}&access_token=${accessToken}&limit=1`;
    
    const response = await fetch(url);
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const result = data.features[0];
        return {
          name: result.text,
          address: result.place_name,
          coordinates: new GeoPoint(result.center[1], result.center[0]),
          source: "mapbox",
          externalId: result.id
        };
      }
    }
  } catch (error) {
    console.error("Mapbox error:", error);
  }
  
  return null;
}

// ✅ Search JustDial API via RapidAPI
async function searchJustDialAPI(serviceType, location) {
  try {
    if (!API_CONFIG.RAPIDAPI_KEY || API_CONFIG.RAPIDAPI_KEY === "YOUR_RAPIDAPI_KEY_HERE") {
      console.warn("RapidAPI key not configured");
      return null;
    }
    
    const serviceMap = {
      "Plumbing": "Plumbers",
      "Electrician": "Electricians", 
      "Carpenter": "Carpenters",
      "AC Repair": "AC Repair & Services",
      "Painting": "Painters",
      "Cleaning": "House Cleaning",
      "Appliance Repair": "Appliance Repair Services",
      "Pest Control": "Pest Control Services"
    };
    
    const justdialCategory = serviceMap[serviceType] || serviceType;
    const searchLocation = location.city || location.state || "India";
    
    const options = {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': API_CONFIG.RAPIDAPI_KEY,
        'X-RapidAPI-Host': API_CONFIG.JUSTDIAL_HOST
      }
    };
    
    const url = `https://${API_CONFIG.JUSTDIAL_HOST}/api/v1/search/listing?query=${encodeURIComponent(justdialCategory)}&location=${encodeURIComponent(searchLocation)}&page=1`;
    
    const response = await fetch(url, options);
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        
        const provider = {
          name: result.company_name || result.name || "JustDial Provider",
          address: result.address || result.locality || searchLocation,
          phone: result.phone || result.contact_number || "Not Available",
          rating: parseFloat(result.rating) || 3.5,
          website: result.website || "",
          source: "justdial",
          externalId: result.id || result.listing_id,
          isExternal: true,
          serviceCount: result.service_count || 1,
          verified: result.verified || false
        };
        
        // Store in Firestore
        return await storeExternalProvider(provider, serviceType, location, "justdial");
      }
    }
  } catch (error) {
    console.error("JustDial API error:", error);
  }
  
  return null;
}

// ✅ Store External Provider in Firestore
async function storeExternalProvider(providerData, serviceType, location, source) {
  try {
    const providerDoc = {
      username: providerData.name,
      name: providerData.name,
      email: providerData.email || "",
      phone: providerData.phone || "",
      address: providerData.address || `${serviceType} service in ${location.city}`,
      city: location.city || "",
      state: location.state || "",
      role: "service_provider",
      service: serviceType,
      serviceTypes: [serviceType],
      rating: providerData.rating || 3.5,
      completedJobs: 0,
      totalJobs: 0,
      availability: "Available",
      activeRequests: 0,
      maxActiveRequests: 5,
      signupDate: serverTimestamp(),
      source: source,
      isExternal: true,
      verificationStatus: providerData.verified ? "verified" : "unverified",
      externalId: providerData.externalId || "",
      coordinates: providerData.coordinates || null,
      website: providerData.website || "",
      workingHours: "9:00 AM - 6:00 PM",
      responseTime: "Within 24 hours",
      metadata: {
        importedFrom: source,
        importDate: new Date().toISOString(),
        originalData: JSON.stringify(providerData)
      }
    };
    
    // Add to users collection
    const docRef = await addDoc(collection(db, "users"), providerDoc);
    
    // Also add to external providers collection
    await setDoc(doc(db, "externalProviders", docRef.id), {
      ...providerDoc,
      userId: docRef.id,
      originalSource: source
    }, { merge: true });
    
    console.log(`✅ Stored external provider: ${providerData.name} (${source})`);
    
    return {
      id: docRef.id,
      name: providerData.name,
      ...providerDoc
    };
    
  } catch (error) {
    console.error("Error storing external provider:", error);
    return null;
  }
}

// ✅ Load User Services
async function loadUserServices() {
  try {
    const q = query(
      collection(db, "services"), 
      where("requestedBy", "==", userId),
      orderBy("createdAt", "desc")
    );
    
    const querySnapshot = await getDocs(q);
    const serviceContainer = document.getElementById("assigned-service");
    const feedbackSelect = document.getElementById("service-select");
    
    // Clear previous content
    serviceContainer.innerHTML = "";
    feedbackSelect.innerHTML = '<option value="" disabled selected>Select a completed service</option>';
    
    if (querySnapshot.empty) {
      serviceContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
          <i class="fas fa-clipboard" style="font-size: 48px; color: #6c757d; margin-bottom: 20px;"></i>
          <p style="color: #6c757d;">No services requested yet. Request your first service!</p>
        </div>
      `;
      return;
    }
    
    let hasCompletedServices = false;
    
    querySnapshot.forEach(async (docSnap) => {
      const data = docSnap.data();
      const serviceId = docSnap.id;
      
      // Get provider details
      let providerName = "Not Assigned";
      let providerPhone = "";
      
      if (data.assignedTo) {
        try {
          const providerDoc = await getDoc(doc(db, "users", data.assignedTo));
          if (providerDoc.exists()) {
            const providerData = providerDoc.data();
            providerName = providerData.username || providerData.name || "Service Provider";
            providerPhone = providerData.phone || "";
          }
        } catch (error) {
          console.error("Error fetching provider:", error);
        }
      }
      
      // Format date
      const requestDate = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
      const formattedDate = requestDate.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // Status badge
      const statusBadge = getStatusBadge(data.status);
      
      // Create service card
      const serviceCard = document.createElement('div');
      serviceCard.className = 'service-card';
      serviceCard.id = `service-${serviceId}`;
      
      serviceCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
          <div>
            <h3 style="margin: 0 0 5px 0; color: #333;">${data.serviceName}</h3>
            <div style="color: #666; font-size: 14px;">
              <i class="far fa-calendar"></i> ${formattedDate}
            </div>
          </div>
          <div class="status-badge ${statusBadge.class}">${statusBadge.text}</div>
        </div>
        
        <div style="margin-bottom: 15px;">
          <div style="font-weight: 600; margin-bottom: 5px;">
            <i class="fas fa-user-tie"></i> Service Provider
          </div>
          <div style="color: #555;">${providerName}</div>
          ${providerPhone ? `<div style="color: #666; font-size: 14px; margin-top: 3px;">
            <i class="fas fa-phone"></i> ${providerPhone}
          </div>` : ''}
        </div>
        
        ${data.serviceDescription ? `
        <div style="margin-bottom: 15px;">
          <div style="font-weight: 600; margin-bottom: 5px;">
            <i class="fas fa-file-alt"></i> Description
          </div>
          <div style="color: #555; font-size: 14px;">${data.serviceDescription}</div>
        </div>` : ''}
        
        <div class="button-group">
          ${data.assignedTo ? `
          <button onclick="viewProviderProfile('${data.assignedTo}')" class="secondary">
            <i class="fas fa-eye"></i> View Provider
          </button>` : ''}
          
          ${data.status === 'Assigned' || data.status === 'In Progress' ? `
          <button onclick="cancelService('${serviceId}')" class="danger">
            <i class="fas fa-times"></i> Cancel
          </button>` : ''}
          
          ${data.status === 'Completed' && !data.feedback ? `
          <button onclick="enableFeedback('${serviceId}')" class="success">
            <i class="fas fa-star"></i> Give Feedback
          </button>` : ''}
          
          ${data.status === 'Completed' && data.feedback ? `
          <button class="success" disabled>
            <i class="fas fa-check"></i> Feedback Submitted
          </button>` : ''}
        </div>
        
        ${data.feedback ? `
        <div style="margin-top: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
          <div style="font-weight: 600; margin-bottom: 5px;">
            <i class="fas fa-comment"></i> Your Feedback
          </div>
          <div style="color: #666; margin-bottom: 5px;">
            Rating: ${'★'.repeat(data.rating || 0)}${'☆'.repeat(5 - (data.rating || 0))}
          </div>
          <div style="color: #555; font-size: 14px;">${data.feedback}</div>
        </div>` : ''}
      `;
      
      serviceContainer.appendChild(serviceCard);
      
      // Add to feedback dropdown if completed
      if (data.status === 'Completed' && !data.feedback) {
        hasCompletedServices = true;
        const option = document.createElement('option');
        option.value = serviceId;
        option.textContent = `${data.serviceName} - ${formattedDate}`;
        feedbackSelect.appendChild(option);
      }
    });
    
    // Show feedback section if there are completed services
    document.getElementById("section-4").classList.toggle("hidden", !hasCompletedServices);
    
  } catch (error) {
    console.error("Error loading services:", error);
    showNotification("Error loading service history", "error");
  }
}

// ✅ Get Status Badge
function getStatusBadge(status) {
  const statuses = {
    "Assigned": { text: "Assigned", class: "status-assigned" },
    "In Progress": { text: "In Progress", class: "status-pending" },
    "Completed": { text: "Completed", class: "status-completed" },
    "Cancelled": { text: "Cancelled", class: "status-cancelled" },
    "Closed": { text: "Closed", class: "status-completed" }
  };
  
  return statuses[status] || { text: status, class: "status-pending" };
}

// ✅ Setup Rating Stars
function setupRatingStars() {
  const stars = document.querySelectorAll('.rating-star');
  const ratingInput = document.getElementById('rating');
  const ratingText = document.getElementById('rating-text');
  
  stars.forEach(star => {
    star.addEventListener('click', function() {
      selectedRating = parseInt(this.getAttribute('data-value'));
      ratingInput.value = selectedRating;
      
      // Update star display
      stars.forEach((s, index) => {
        if (index < selectedRating) {
          s.style.color = '#ffc107';
          s.classList.remove('far');
          s.classList.add('fas');
        } else {
          s.style.color = '#ddd';
          s.classList.remove('fas');
          s.classList.add('far');
        }
      });
      
      // Update text
      const texts = ["Poor", "Fair", "Good", "Very Good", "Excellent"];
      ratingText.textContent = `${selectedRating} star${selectedRating > 1 ? 's' : ''} - ${texts[selectedRating - 1]}`;
      ratingText.style.color = '#333';
    });
    
    // Hover effect
    star.addEventListener('mouseover', function() {
      const hoverRating = parseInt(this.getAttribute('data-value'));
      stars.forEach((s, index) => {
        s.style.color = index < hoverRating ? '#ffc107' : '#ddd';
      });
    });
    
    star.addEventListener('mouseout', function() {
      stars.forEach((s, index) => {
        s.style.color = index < selectedRating ? '#ffc107' : '#ddd';
      });
    });
  });
}

// ✅ Handle Feedback Submit
async function handleFeedbackSubmit(e) {
  e.preventDefault();
  
  if (!latestServiceId) {
    showNotification("Please select a service first", "error");
    return;
  }
  
  const rating = parseInt(document.getElementById('rating').value);
  const feedback = document.getElementById('feedback').value.trim();
  
  if (!rating || rating < 1 || rating > 5) {
    showNotification("Please provide a rating between 1 and 5 stars", "error");
    return;
  }
  
  if (feedback.length < 10) {
    showNotification("Please write more detailed feedback (minimum 10 characters)", "error");
    return;
  }
  
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalContent = submitBtn.innerHTML;
  submitBtn.innerHTML = '<div class="loading"></div> Submitting...';
  submitBtn.disabled = true;
  
  try {
    // Get service details
    const serviceDoc = await getDoc(doc(db, "services", latestServiceId));
    if (!serviceDoc.exists()) {
      throw new Error("Service not found");
    }
    
    const serviceData = serviceDoc.data();
    
    // Update service with feedback
    await updateDoc(doc(db, "services", latestServiceId), {
      feedback: feedback,
      rating: rating,
      feedbackDate: serverTimestamp(),
      status: "Closed",
      updatedAt: serverTimestamp()
    });
    
    // Update provider rating if assigned
    if (serviceData.assignedTo) {
      await updateProviderRating(serviceData.assignedTo, rating);
    }
    
    showNotification("Thank you for your feedback!", "success");
    
    // Reset form
    document.getElementById('feedback-form').reset();
    latestServiceId = null;
    
    // Reset stars
    document.querySelectorAll('.rating-star').forEach(star => {
      star.style.color = '#ddd';
      star.classList.remove('fas');
      star.classList.add('far');
    });
    document.getElementById('rating-text').textContent = "Not rated yet";
    document.getElementById('rating-text').style.color = "#666";
    
    // Refresh services
    setTimeout(() => {
      loadUserServices();
      submitBtn.innerHTML = originalContent;
      submitBtn.disabled = false;
    }, 1000);
    
  } catch (error) {
    console.error("Feedback submit error:", error);
    showNotification("Failed to submit feedback. Please try again.", "error");
    submitBtn.innerHTML = originalContent;
    submitBtn.disabled = false;
  }
}

// ✅ Update Provider Rating
async function updateProviderRating(providerId, newRating) {
  try {
    const providerRef = doc(db, "users", providerId);
    const providerDoc = await getDoc(providerRef);
    
    if (providerDoc.exists()) {
      const providerData = providerDoc.data();
      const currentRating = providerData.rating || 3.5;
      const totalRatings = providerData.totalRatings || 0;
      const completedJobs = (providerData.completedJobs || 0) + 1;
      
      // Calculate new average
      const newAverage = totalRatings > 0 
        ? ((currentRating * totalRatings) + newRating) / (totalRatings + 1)
        : newRating;
      
      await updateDoc(providerRef, {
        rating: newAverage.toFixed(1),
        totalRatings: totalRatings + 1,
        completedJobs: completedJobs,
        lastRatingUpdate: serverTimestamp()
      });
      
      console.log(`Updated provider ${providerId} rating to ${newAverage.toFixed(1)}`);
    }
  } catch (error) {
    console.error("Error updating provider rating:", error);
  }
}

// ✅ Cancel Service
window.cancelService = async function(serviceId) {
  if (!confirm("Are you sure you want to cancel this service request?")) {
    return;
  }
  
  try {
    await updateDoc(doc(db, "services", serviceId), {
      status: "Cancelled",
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    
    // Refund the request if within reasonable time
    const serviceDoc = await getDoc(doc(db, "services", serviceId));
    if (serviceDoc.exists()) {
      const serviceData = serviceDoc.data();
      const createdDate = serviceData.createdAt?.toDate ? serviceData.createdAt.toDate() : new Date(serviceData.createdAt);
      const hoursSinceRequest = (new Date() - createdDate) / (1000 * 60 * 60);
      
      // Refund if cancelled within 1 hour
      if (hoursSinceRequest < 1) {
        await updateDoc(doc(db, "subscriptions", userId), {
          remainingRequests: increment(1)
        });
        remainingRequests++;
        updateSubscriptionUI();
        showNotification("Service cancelled and request refunded", "success");
      } else {
        showNotification("Service cancelled", "info");
      }
    }
    
    // Update provider's active requests
    if (serviceData.assignedTo) {
      await updateDoc(doc(db, "users", serviceData.assignedTo), {
        activeRequests: increment(-1)
      });
    }
    
    // Refresh
    setTimeout(() => location.reload(), 1000);
    
  } catch (error) {
    console.error("Cancel service error:", error);
    showNotification("Failed to cancel service", "error");
  }
};

// ✅ Enable Feedback
window.enableFeedback = function(serviceId) {
  latestServiceId = serviceId;
  document.getElementById('service-select').value = serviceId;
  document.getElementById('section-4').scrollIntoView({ behavior: 'smooth' });
  showNotification("Please provide your feedback for this service", "info");
};

// ✅ View Provider Profile
window.viewProviderProfile = function(providerId) {
  window.open(`profile.html?id=${providerId}`, '_blank');
};

// ✅ Export for use in HTML
window.requestGoldPlan = requestGoldPlan;
