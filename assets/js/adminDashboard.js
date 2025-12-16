import { auth, db } from "./firebase.js";
import {
  doc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ✅ Admin Dashboard Initialization
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    alert("Not signed in. Redirecting...");
    window.location.href = "signin.html";
    return;
  }

    // ✅ Check if user is an admin
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    alert("User data not found. Redirecting...");
    window.location.href = "signin.html";
    return;
  }

  const userData = userSnap.data();
  if (userData.role !== "admin") {
    alert("Unauthorized access! Redirecting to dashboard...");
    window.location.href = "dashboard.html"; // Redirect non-admin users
    return;
  }

  // ✅ Load Admin Dashboard Features
  loadAllUsers();
  loadAllProviders();
  loadAllRequests();
  loadAllStats();
  loadSubscriptionRequests(); 
});

// ✅ Logout
window.logout = function () {
  auth.signOut();
  window.location.href = "signin.html";
};


// ✅ Load All Users
async function loadAllUsers() {
  const usersDiv = document.getElementById("all-users");
  usersDiv.innerHTML = `<p>Loading...</p>`;

  const querySnapshot = await getDocs(collection(db, "users"));
  usersDiv.innerHTML = "";

  querySnapshot.forEach((doc) => {
    const data = doc.data();
    usersDiv.innerHTML += `
      <div>
        <p><b>Username:</b> ${data.username}</p>
        <p><b>Phone:</b> ${data.phone}</p>
        <p><b>Address:</b> ${data.address}</p>
        <p><b>Role:</b> ${data.role}</p>
        <button onclick="viewProfile('${doc.id}')">View Profile</button>
        <button onclick="deleteUser('${doc.id}')">Delete User</button>
      </div>
      <hr>
    `;
  });
}

window.viewProfile = function (userId) {
  window.location.href = `profile.html?id=${userId}`;
};

window.deleteUser = async function (userId) {
  if (confirm("Are you sure you want to delete this user?")) {
    await deleteDoc(doc(db, "users", userId));
    alert("User deleted successfully.");
    loadAllUsers();
  }
};

// ✅ Load All Service Providers
async function loadAllProviders() {
  const providersDiv = document.getElementById("all-providers");
  providersDiv.innerHTML = `<p>Loading...</p>`;

  const q = query(collection(db, "users"), where("role", "==", "service_provider"));
  const querySnapshot = await getDocs(q);
  providersDiv.innerHTML = "";

  querySnapshot.forEach((doc) => {
    const data = doc.data();
    providersDiv.innerHTML += `
      <div>
        <p><b>UserID:</b> ${doc.id}</p>
        <p><b>Name:</b> ${data.username}</p>
        <p><b>Phone:</b> ${data.phone}</p>
        <p><b>Gov ID:</b> <a href="${data.govID}" target="_blank">View ID</a></p>
        <p><b>Location:</b> ${data.address}</p>
        <button onclick="viewProfile('${doc.id}')">View Profile</button>
        <button onclick="deleteUser('${doc.id}')">Delete Provider</button>
      </div>
      <hr>
    `;
  });
}

// ✅ Delete Service Request
window.deleteServiceRequest = async function (serviceId) {
  if (confirm("Are you sure you want to delete this service request?")) {
    await deleteDoc(doc(db, "services", serviceId));
    alert("Service request deleted successfully.");
    loadAllRequests(); // Refresh service requests after deletion
  }
};

// ✅ Modify Load All Service Requests to Include Delete Button
async function loadAllRequests() {
  const requestsDiv = document.getElementById("all-requests");
  requestsDiv.innerHTML = `<p>Loading...</p>`;

  const querySnapshot = await getDocs(collection(db, "services"));
  requestsDiv.innerHTML = "";

  querySnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const serviceId = docSnap.id;

    requestsDiv.innerHTML += `
      <div>
        <p><b>Service:</b> ${data.serviceName}</p>
        <p><b>Requested By:</b> ${data.requestedBy}</p>
        <p><b>Assigned To:</b> ${data.assignedTo || "Unassigned"}</p>
        <p><b>Status:</b> ${data.status}</p>
        <p><b>Request Date:</b> ${data.requestDate || "N/A"}</p>
        <p><b>Feedback:</b> ${data.feedback || "No Feedback"}</p>
        <p><b>Rating:</b> ${data.rating || "Not Rated"}</p>
        <button onclick="reassignService('${serviceId}')">Reassign</button>
        <button onclick="changeStatus('${serviceId}')">Change Status</button>
        ${
          data.status === "Completed" || data.status === "Cancelled" || data.status === "Closed" || data.status === "Assigned" 
            ? `<button onclick="deleteServiceRequest('${serviceId}')">Delete</button>`
            : ""
        }
      </div>
      <hr>
    `;
  });
}


window.reassignService = async function (serviceId) {
  const newProviderId = prompt("Enter new Service Provider ID:");
  await updateDoc(doc(db, "services", serviceId), { assignedTo: newProviderId });
  alert("Service Reassigned!");
  loadAllRequests();
};

window.changeStatus = async function (serviceId) {
  const newStatus = prompt("Enter new Status (In Progress, Completed, Cancelled):");
  await updateDoc(doc(db, "services", serviceId), { status: newStatus });
  alert("Status Changed!");
  loadAllRequests();
};


// ✅ Dashboard Stats
async function loadAllStats() {
  const users = await getDocs(collection(db, "users"));
  const providers = await getDocs(query(collection(db, "users"), where("role", "==", "service_provider")));
  const requests = await getDocs(collection(db, "services"));
  const subscriptions = await getDocs(query(collection(db, "subscriptions"), where("plan", "!=", "Free"))); 
  

  document.getElementById("total-users").textContent = users.size;
  document.getElementById("total-providers").textContent = providers.size;
  document.getElementById("total-requests").textContent = requests.size;
  document.getElementById("total-subscriptions").textContent = subscriptions.size;
}

// ✅ Load Pending Subscription Requests
async function loadSubscriptionRequests() {
  const requestsDiv = document.getElementById("subscription-requests");
  requestsDiv.innerHTML = `<p>Loading...</p>`;

  const q = query(collection(db, "subscriptions"), where("status", "==", "Pending"));
  const querySnapshot = await getDocs(q);
  requestsDiv.innerHTML = "";

  querySnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const userId = docSnap.id;

    requestsDiv.innerHTML += `
      <div>
        <p><b>User ID:</b> ${userId}</p>
        <p><b>Requested Plan:</b> ${data.plan}</p>
        <button onclick="approveSubscription('${userId}')">Approve</button>
        <button onclick="rejectSubscription('${userId}')">Reject</button>
      </div>
      <hr>
    `;
  });
}

// ✅ Approve Subscription Request
window.approveSubscription = async function (userId) {
  await updateDoc(doc(db, "subscriptions", userId), {
    status: "Approved",
    plan: "Gold",
    remainingRequests: 35
  });

  alert("Subscription Approved!");
  loadSubscriptionRequests();
};

// ✅ Reject Subscription Request
window.rejectSubscription = async function (userId) {
  await updateDoc(doc(db, "subscriptions", userId), {
    status: "Rejected",
    plan: "Free",
    remainingRequests: 0
  });

  alert("Subscription Rejected.");
  loadSubscriptionRequests();
};

// ✅ Logout
window.logout = function () {
  auth.signOut();
  window.location.href = "signin.html";
};


      
