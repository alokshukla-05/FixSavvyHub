import { auth, db } from "./firebase.js";

import {
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  updateDoc,
  deleteField
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";


// ======================================================
// GLOBAL VARIABLES
// ======================================================

let userId = null;
let latestServiceId = null;

let subscriptionPlan = "Free";
let remainingRequests = 1;
let subscriptionStatus = "Active";

let currentUserData = null;


// ======================================================
// AUTH STATE
// ======================================================

auth.onAuthStateChanged(async (user) => {

  if (!user) {

    alert("You are not signed in. Redirecting...");

    window.location.href = "signin.html";

    return;
  }

  userId = user.uid;

  try {

    await loadUserProfile();

    await checkSubscription();

    await loadUserServices();

  } catch (error) {

    console.error(
      "Dashboard initialization error:",
      error
    );

    alert(
      "Unable to load dashboard.\n\n" +
      error.message
    );

  }

});


// ======================================================
// LOAD USER PROFILE
// ======================================================

async function loadUserProfile() {

  const userRef =
    doc(db, "users", userId);

  const userSnap =
    await getDoc(userRef);


  if (!userSnap.exists()) {

    console.warn(
      "User profile not found."
    );

    return;
  }


  currentUserData =
    userSnap.data();


  const username =
    document.getElementById("username");

  const phone =
    document.getElementById("phone");

  const address =
    document.getElementById("address");


  if (username) {

    username.value =
      currentUserData.username || "";

  }


  if (phone) {

    phone.value =
      currentUserData.phone || "";

  }


  if (address) {

    address.value =
      currentUserData.address || "";

  }


  // ---------------------------------------------
  // Check profile completion
  // ---------------------------------------------

  const profileComplete =
    currentUserData.username &&
    currentUserData.phone &&
    currentUserData.address;


  if (profileComplete) {

    showElement("section-2");

    showElement("section-3");

    showElement("section-5");

  } else {

    hideElement("section-2");

    hideElement("section-3");

    hideElement("section-5");

  }

}


// ======================================================
// PROFILE FORM
// ======================================================

const profileForm =
  document.getElementById("profile-form");


if (profileForm) {

  profileForm.addEventListener(
    "submit",
    async (e) => {

      e.preventDefault();


      try {

        const username =
          document
            .getElementById("username")
            .value
            .trim();


        const phone =
          document
            .getElementById("phone")
            .value
            .trim();


        const address =
          document
            .getElementById("address")
            .value
            .trim();


        if (
          !username ||
          !phone ||
          !address
        ) {

          alert(
            "Please complete all fields."
          );

          return;
        }


        await setDoc(

          doc(
            db,
            "users",
            userId
          ),

          {

            username,

            phone,

            address,

            role: "user",

            updatedAt:
              new Date().toISOString()

          },

          {
            merge: true
          }

        );


        alert(
          "Profile updated successfully!"
        );


        location.reload();


      } catch (error) {

        console.error(
          "Profile update error:",
          error
        );


        alert(
          "Unable to update profile.\n\n" +
          error.message
        );

      }

    }
  );

}


// ======================================================
// SUBSCRIPTION
// ======================================================

async function checkSubscription() {

  const subRef =
    doc(
      db,
      "subscriptions",
      userId
    );


  const subSnap =
    await getDoc(subRef);


  const today =
    new Date();


  // ====================================================
  // FIRST TIME USER
  // ====================================================

  if (!subSnap.exists()) {

    await setDoc(
      subRef,
      {

        plan: "Free",

        remainingRequests: 1,

        status: "Active",

        lastReset:
          today.toISOString()

      }
    );


    subscriptionPlan =
      "Free";


    remainingRequests =
      1;


    subscriptionStatus =
      "Active";


    updateSubscriptionUI();

    return;
  }


  const data =
    subSnap.data();


  subscriptionPlan =
    data.plan || "Free";


  remainingRequests =
    typeof data.remainingRequests === "number"
      ? data.remainingRequests
      : 0;


  subscriptionStatus =
    data.status || "Active";


  const subscribedDate =
    data.subscribedDate
      ? new Date(data.subscribedDate)
      : null;


  const lastReset =
    data.lastReset
      ? new Date(data.lastReset)
      : null;


  // ====================================================
  // GOLD REJECTED
  // ====================================================

  if (
    subscriptionPlan === "Gold" &&
    subscriptionStatus === "Rejected"
  ) {

    const backup =
      typeof data.backupRequests === "number"
        ? data.backupRequests
        : 1;


    await setDoc(

      subRef,

      {

        plan: "Free",

        status: "Active",

        remainingRequests: backup,

        subscribedDate:
          deleteField(),

        backupRequests:
          deleteField(),

        requestedPlan:
          deleteField(),

        requestedAt:
          deleteField()

      },

      {
        merge: true
      }

    );


    subscriptionPlan =
      "Free";


    subscriptionStatus =
      "Active";


    remainingRequests =
      backup;


    alert(
      `Gold Plan was rejected.\n\n` +
      `Your previous ${backup} request(s) were restored.`
    );


    updateSubscriptionUI();

    return;
  }


  // ====================================================
  // GOLD EXPIRY
  // ====================================================

  if (
    subscriptionPlan === "Gold" &&
    subscriptionStatus === "Active" &&
    subscribedDate
  ) {

    const expiryDate =
      new Date(subscribedDate);


    expiryDate.setMonth(
      expiryDate.getMonth() + 1
    );


    if (today >= expiryDate) {

      await setDoc(

        subRef,

        {

          plan: "Free",

          remainingRequests: 1,

          status: "Expired",

          subscribedDate:
            deleteField(),

          backupRequests:
            deleteField(),

          requestedPlan:
            deleteField(),

          requestedAt:
            deleteField(),

          lastReset:
            today.toISOString()

        },

        {
          merge: true
        }

      );


      subscriptionPlan =
        "Free";


      remainingRequests =
        1;


      subscriptionStatus =
        "Expired";


      alert(
        "Your Gold subscription expired.\n\n" +
        "You have been downgraded to Free."
      );


      updateSubscriptionUI();

      return;
    }

  }


  // ====================================================
  // FREE MONTHLY RESET
  // ====================================================

  if (
    subscriptionPlan === "Free" &&
    remainingRequests <= 0
  ) {

    const needsReset =
      !lastReset ||
      lastReset.getMonth() !== today.getMonth() ||
      lastReset.getFullYear() !== today.getFullYear();


    if (needsReset) {

      await updateDoc(

        subRef,

        {

          remainingRequests: 1,

          lastReset:
            today.toISOString(),

          status: "Active"

        }

      );


      remainingRequests =
        1;


      subscriptionStatus =
        "Active";


      alert(
        "You received 1 free request for this month."
      );

    }

  }


  updateSubscriptionUI();

}


// ======================================================
// SUBSCRIPTION UI
// ======================================================

function updateSubscriptionUI() {

  const plan =
    document.getElementById("plan");


  const requests =
    document.getElementById(
      "remaining-requests"
    );


  const upgrade =
    document.getElementById(
      "upgrade-btn"
    );


  if (plan) {

    plan.innerText =
      subscriptionPlan;

  }


  if (requests) {

    requests.innerText =
      remainingRequests;

  }


  if (!upgrade) {
    return;
  }


  // Pending
  if (
    subscriptionStatus === "Pending"
  ) {

    upgrade.innerText =
      "Gold Request Pending";

    upgrade.disabled =
      true;

    return;
  }


  // Gold active
  if (
    subscriptionPlan === "Gold" &&
    subscriptionStatus === "Active"
  ) {

    upgrade.innerText =
      "Gold Plan Active";

    upgrade.disabled =
      true;

    return;
  }


  // Free
  upgrade.innerText =
    "Upgrade to Gold (₹199/month)";

  upgrade.disabled =
    false;

}


// ======================================================
// REQUEST GOLD
// ======================================================

window.requestGoldPlan =
  async function () {

    if (!userId) {

      alert(
        "User is not authenticated."
      );

      return;
    }


    try {

      const subRef =
        doc(
          db,
          "subscriptions",
          userId
        );


      const subSnap =
        await getDoc(subRef);


      const existing =
        subSnap.exists()
          ? subSnap.data()
          : null;


      if (
        existing &&
        existing.status === "Pending"
      ) {

        alert(
          "Your Gold request is already pending."
        );

        return;
      }


      if (
        existing &&
        existing.plan === "Gold" &&
        existing.status === "Active"
      ) {

        alert(
          "Your Gold Plan is already active."
        );

        return;
      }


      const backupRequests =
        existing &&
        typeof existing.remainingRequests === "number"
          ? existing.remainingRequests
          : 1;


      // IMPORTANT:
      // Do not activate Gold before admin approval.

      await setDoc(

        subRef,

        {

          plan: "Free",

          status: "Pending",

          remainingRequests:
            backupRequests,

          backupRequests,

          requestedPlan:
            "Gold",

          requestedAt:
            new Date().toISOString()

        },

        {
          merge: true
        }

      );


      alert(
        "Gold Plan request submitted.\n\n" +
        "Waiting for Admin approval."
      );


      location.reload();


    } catch (error) {

      console.error(
        "Gold request error:",
        error
      );


      alert(
        "Unable to request Gold Plan.\n\n" +
        error.message
      );

    }

  };


// ======================================================
// REQUEST SERVICE
// ======================================================

const requestServiceForm =
  document.getElementById(
    "request-service-form"
  );


if (requestServiceForm) {

  requestServiceForm.addEventListener(
    "submit",
    async (e) => {

      e.preventDefault();


      try {

        if (!userId) {

          alert(
            "You are not authenticated."
          );

          return;
        }


        if (
          subscriptionStatus === "Pending"
        ) {

          alert(
            "Your Gold request is waiting for Admin approval."
          );

          return;
        }


        if (
          remainingRequests <= 0
        ) {

          alert(
            "You have no remaining requests."
          );

          return;
        }


        const service =
          document
            .getElementById("service")
            .value
            .trim();


        if (!service) {

          alert(
            "Please select a service."
          );

          return;
        }


        // ---------------------------------------------
        // Search Firestore providers first
        // ---------------------------------------------

        let providerId =
          await autoAssignServiceProvider();


        // ---------------------------------------------
        // If no Firestore provider,
        // search free OSM APIs
        // ---------------------------------------------

        if (!providerId) {

          console.log(
            "No local provider found."
          );


          const externalProvider =
            await findExternalProvider(
              service
            );


          if (externalProvider) {

            providerId =
              await saveExternalProvider(
                externalProvider
              );

          }

        }


        if (!providerId) {

          alert(
            "No service provider was found nearby.\n\n" +
            "Your request was not deducted."
          );

          return;
        }


        // ---------------------------------------------
        // Create service
        // ---------------------------------------------

        const serviceRef =
          await addDoc(

            collection(
              db,
              "services"
            ),

            {

              serviceName:
                service,

              requestedBy:
                userId,

              assignedTo:
                providerId,

              status:
                "Assigned",

              createdAt:
                new Date().toISOString(),

              feedbackSubmitted:
                false

            }

          );


        latestServiceId =
          serviceRef.id;


        // ---------------------------------------------
        // Deduct request
        // ---------------------------------------------

        const newRemaining =
          Math.max(
            0,
            remainingRequests - 1
          );


        await updateDoc(

          doc(
            db,
            "subscriptions",
            userId
          ),

          {

            remainingRequests:
              newRemaining

          }

        );


        // ---------------------------------------------
        // Update provider
        // ---------------------------------------------

        await increaseProviderLoad(
          providerId
        );


        alert(
          "Service requested and assigned successfully!"
        );


        location.reload();


      } catch (error) {

        console.error(
          "Service request error:",
          error
        );


        alert(
          "Unable to request service.\n\n" +
          error.message
        );

      }

    }
  );

}


// ======================================================
// FIND LOCAL PROVIDER
// ======================================================

async function autoAssignServiceProvider() {

  if (!currentUserData) {

    const userSnap =
      await getDoc(
        doc(
          db,
          "users",
          userId
        )
      );


    if (!userSnap.exists()) {
      return null;
    }


    currentUserData =
      userSnap.data();

  }


  const service =
    document
      .getElementById("service")
      .value
      .toLowerCase()
      .trim();


  const locations = [

    {
      field: "subDistrict",
      value:
        normalizeLocation(
          currentUserData.subDistrict
        )
    },

    {
      field: "district",
      value:
        normalizeLocation(
          currentUserData.district
        )
    },

    {
      field: "city",
      value:
        normalizeLocation(
          currentUserData.city
        )
    },

    {
      field: "state",
      value:
        normalizeLocation(
          currentUserData.state
        )
    }

  ];


  for (
    const location of locations
  ) {

    if (!location.value) {
      continue;
    }


    console.log(
      `Searching ${location.field}:`,
      location.value
    );


    const providers =
      await findProviders(

        service,

        location.field,

        location.value

      );


    const best =
      selectBestProvider(
        providers
      );


    if (best) {

      console.log(
        "Provider selected:",
        best
      );


      return best.id;

    }

  }


  return null;

}


// ======================================================
// FIRESTORE PROVIDERS
// ======================================================

async function findProviders(
  serviceType,
  locationField,
  locationValue
) {

  try {

    if (!locationValue) {
      return [];
    }


    const q =
      query(

        collection(
          db,
          "users"
        ),

        where(
          "role",
          "==",
          "service_provider"
        ),

        where(
          locationField,
          "==",
          locationValue
        )

      );


    const snapshot =
      await getDocs(q);


    const providers = [];


    snapshot.forEach(
      (docSnap) => {

        const provider =
          docSnap.data();


        const providerService =
          String(
            provider.service || ""
          )
            .toLowerCase()
            .trim();


        const availability =
          String(
            provider.availability ||
            "Available"
          );


        // Only available providers
        if (
          availability.toLowerCase() !==
          "available"
        ) {

          return;
        }


        if (
          !fuzzyMatch(
            providerService,
            serviceType
          )
        ) {

          return;
        }


        providers.push({

          id:
            docSnap.id,

          name:
            provider.username ||
            provider.name ||
            "Service Provider",

          rating:
            Number(
              provider.rating || 0
            ),

          completedJobs:
            Number(
              provider.completedJobs || 0
            ),

          activeRequests:
            Number(
              provider.activeRequests || 0
            ),

          signupDate:
            provider.signupDate ||
            "9999-12-31"

        });

      }
    );


    return providers;


  } catch (error) {

    console.error(
      "Firestore provider search error:",
      error
    );


    return [];

  }

}


// ======================================================
// BEST PROVIDER
// ======================================================

function selectBestProvider(
  providers
) {

  if (
    !providers ||
    providers.length === 0
  ) {

    return null;
  }


  providers.sort(
    (a, b) => {

      // Higher rating
      if (
        b.rating !==
        a.rating
      ) {

        return (
          b.rating -
          a.rating
        );

      }


      // More completed jobs
      if (
        b.completedJobs !==
        a.completedJobs
      ) {

        return (
          b.completedJobs -
          a.completedJobs
        );

      }


      // Lower workload
      if (
        a.activeRequests !==
        b.activeRequests
      ) {

        return (
          a.activeRequests -
          b.activeRequests
        );

      }


      // Older provider first
      return (
        new Date(a.signupDate) -
        new Date(b.signupDate)
      );

    }
  );


  return providers[0] || null;

}


// ======================================================
// FREE API FALLBACK
//
// Nominatim
// +
// Overpass
// ======================================================

async function findExternalProvider(
  serviceType
) {

  if (!currentUserData) {
    return null;
  }


  const address =
    currentUserData.address || "";


  const city =
    currentUserData.city || "";


  const district =
    currentUserData.district || "";


  const state =
    currentUserData.state || "";


  const subDistrict =
    currentUserData.subDistrict || "";


  const locations = [

    [
      subDistrict,
      district,
      city,
      state,
      "India"
    ],

    [
      district,
      city,
      state,
      "India"
    ],

    [
      city,
      state,
      "India"
    ]

  ];


  for (
    const parts of locations
  ) {

    const query =
      parts
        .filter(Boolean)
        .join(", ");


    if (!query) {
      continue;
    }


    console.log(
      "External API location:",
      query
    );


    const coordinates =
      await geocodeLocation(
        query
      );


    if (!coordinates) {
      continue;
    }


    const providers =
      await searchOverpassProviders(

        serviceType,

        coordinates.lat,

        coordinates.lon

      );


    if (
      providers.length > 0
    ) {

      // Sort by distance
      providers.sort(
        (a, b) =>
          a.distance -
          b.distance
      );


      console.log(
        "External providers:",
        providers
      );


      return providers[0];

    }

  }


  return null;

}


// ======================================================
// NOMINATIM
// ======================================================

async function geocodeLocation(
  location
) {

  try {

    const params =
      new URLSearchParams({

        q:
          location,

        format:
          "jsonv2",

        limit:
          "1",

        countrycodes:
          "in"

      });


    const response =
      await fetch(

        "https://nominatim.openstreetmap.org/search?" +
        params.toString(),

        {

          method:
            "GET",

          headers: {

            "Accept":
              "application/json"

          }

        }

      );


    if (!response.ok) {

      throw new Error(
        `Nominatim HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    if (
      !data ||
      data.length === 0
    ) {

      return null;

    }


    return {

      lat:
        Number(
          data[0].lat
        ),

      lon:
        Number(
          data[0].lon
        )

    };


  } catch (error) {

    console.error(
      "Nominatim error:",
      error
    );


    return null;

  }

}


// ======================================================
// OVERPASS
// ======================================================

async function searchOverpassProviders(
  serviceType,
  lat,
  lon
) {

  const radius =
    10000;


  const tags =
    getOSMTags(
      serviceType
    );


  if (
    tags.length === 0
  ) {

    return [];

  }


  const queryParts = [];


  for (
    const tag of tags
  ) {

    queryParts.push(

      `
      nwr
      ["${tag.key}"="${tag.value}"]
      (around:${radius},${lat},${lon});
      `

    );

  }


  const overpassQuery = `

    [out:json][timeout:25];

    (

      ${queryParts.join("\n")}

    );

    out center tags;

  `;


  try {

    const response =
      await fetch(

        "https://overpass-api.de/api/interpreter",

        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/x-www-form-urlencoded",

            "Accept":
              "application/json"

          },

          body:
            new URLSearchParams({

              data:
                overpassQuery

            })

        }

      );


    if (!response.ok) {

      throw new Error(
        `Overpass HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    if (
      !data.elements ||
      data.elements.length === 0
    ) {

      return [];

    }


    return data.elements

      .map(
        element =>
          normalizeOSMProvider(

            element,

            lat,

            lon,

            serviceType

          )
      )

      .filter(Boolean);


  } catch (error) {

    console.error(
      "Overpass error:",
      error
    );


    return [];

  }

}


// ======================================================
// OSM TAGS
// ======================================================

function getOSMTags(
  serviceType
) {

  const service =
    serviceType
      .toLowerCase()
      .trim();


  // Plumbing
  if (
    service.includes("plumb")
  ) {

    return [

      {
        key:
          "craft",

        value:
          "plumber"

      },

      {
        key:
          "shop",

        value:
          "plumber"

      }

    ];

  }


  // Electrician
  if (
    service.includes("electric")
  ) {

    return [

      {
        key:
          "craft",

        value:
          "electrician"

      },

      {
        key:
          "shop",

        value:
          "electrical"

      }

    ];

  }


  // Carpenter
  if (
    service.includes("carpenter")
  ) {

    return [

      {
        key:
          "craft",

        value:
          "carpenter"

      }

    ];

  }


  // AC
  if (
    service.includes("ac") ||
    service.includes("air")
  ) {

    return [

      {
        key:
          "shop",

        value:
          "air_conditioning"

      },

      {
        key:
          "craft",

        value:
          "hvac"

      }

    ];

  }


  return [];

}


// ======================================================
// NORMALIZE OSM DATA
// ======================================================

function normalizeOSMProvider(
  element,
  userLat,
  userLon,
  serviceType
) {

  const tags =
    element.tags || {};


  const lat =
    element.lat ??
    element.center?.lat;


  const lon =
    element.lon ??
    element.center?.lon;


  if (
    lat === undefined ||
    lon === undefined
  ) {

    return null;

  }


  const name =
    tags.name ||
    tags["name:en"] ||
    "Service Provider";


  const address =
    [

      tags["addr:housenumber"],

      tags["addr:street"],

      tags["addr:suburb"],

      tags["addr:city"],

      tags["addr:postcode"]

    ]

      .filter(Boolean)

      .join(", ");


  const phone =
    tags.phone ||
    tags["contact:phone"] ||
    "Not Available";


  const website =
    tags.website ||
    tags["contact:website"] ||
    "Not Available";


  const distance =
    calculateDistance(

      userLat,

      userLon,

      Number(lat),

      Number(lon)

    );


  return {

    name,

    address:
      address ||
      "Address not available",

    phone,

    website,

    service:
      serviceType,

    latitude:
      Number(lat),

    longitude:
      Number(lon),

    distance,

    rating:
      0,

    completedJobs:
      0,

    activeRequests:
      0,

    availability:
      "Available",

    source:
      "OpenStreetMap"

  };

}


// ======================================================
// SAVE EXTERNAL PROVIDER
// ======================================================

async function saveExternalProvider(
  provider
) {

  try {

    const providerRef =
      await addDoc(

        collection(
          db,
          "users"
        ),

        {

          username:
            provider.name,

          name:
            provider.name,

          phone:
            provider.phone,

          address:
            provider.address,

          service:
            provider.service,

          role:
            "service_provider",

          rating:
            provider.rating || 0,

          ratingCount:
            0,

          completedJobs:
            0,

          activeRequests:
            0,

          availability:
            "Available",

          signupDate:
            new Date().toISOString(),

          source:
            provider.source,

          latitude:
            provider.latitude,

          longitude:
            provider.longitude

        }

      );


    console.log(
      "External provider saved:",
      providerRef.id
    );


    return providerRef.id;


  } catch (error) {

    console.error(
      "Saving external provider error:",
      error
    );


    return null;

  }

}


// ======================================================
// DISTANCE
// ======================================================

function calculateDistance(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R =
    6371;


  const dLat =
    toRadians(
      lat2 - lat1
    );


  const dLon =
    toRadians(
      lon2 - lon1
    );


  const a =

    Math.sin(dLat / 2) *
    Math.sin(dLat / 2)

    +

    Math.cos(
      toRadians(lat1)
    )

    *

    Math.cos(
      toRadians(lat2)
    )

    *

    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);


  const c =
    2 *
    Math.atan2(

      Math.sqrt(a),

      Math.sqrt(1 - a)

    );


  return R * c;

}


function toRadians(
  degrees
) {

  return (
    degrees *
    Math.PI /
    180
  );

}


// ======================================================
// INCREASE PROVIDER LOAD
// ======================================================

async function increaseProviderLoad(
  providerId
) {

  try {

    const providerRef =
      doc(
        db,
        "users",
        providerId
      );


    const providerSnap =
      await getDoc(
        providerRef
      );


    if (!providerSnap.exists()) {
      return;
    }


    const data =
      providerSnap.data();


    const activeRequests =
      Number(
        data.activeRequests || 0
      ) + 1;


    await updateDoc(

      providerRef,

      {

        activeRequests,

        availability:
          "Busy"

      }

    );

  } catch (error) {

    console.error(
      "Provider load error:",
      error
    );

  }

}


// ======================================================
// CANCEL SERVICE
// ======================================================

window.cancelService =
  async function (
    serviceId
  ) {

    if (!serviceId) {
      return;
    }


    const confirmed =
      confirm(
        "Are you sure you want to cancel this service?"
      );


    if (!confirmed) {
      return;
    }


    try {

      const serviceRef =
        doc(
          db,
          "services",
          serviceId
        );


      const serviceSnap =
        await getDoc(
          serviceRef
        );


      if (!serviceSnap.exists()) {

        alert(
          "Service not found."
        );

        return;

      }


      const service =
        serviceSnap.data();


      // Security
      if (
        service.requestedBy !==
        userId
      ) {

        alert(
          "You cannot cancel this service."
        );

        return;

      }


      if (
        service.status ===
        "Completed"
      ) {

        alert(
          "Completed service cannot be cancelled."
        );

        return;

      }


      if (
        service.status ===
        "Cancelled"
      ) {

        alert(
          "Service is already cancelled."
        );

        return;

      }


      await updateDoc(

        serviceRef,

        {

          status:
            "Cancelled",

          cancelledAt:
            new Date().toISOString(),

          cancelledBy:
            userId

        }

      );


      // -----------------------------------------------
      // Decrease provider active request
      // -----------------------------------------------

      if (
        service.assignedTo
      ) {

        const providerRef =
          doc(
            db,
            "users",
            service.assignedTo
          );


        const providerSnap =
          await getDoc(
            providerRef
          );


        if (providerSnap.exists()) {

          const provider =
            providerSnap.data();


          const activeRequests =
            Math.max(

              0,

              Number(
                provider.activeRequests || 0
              ) - 1

            );


          await updateDoc(

            providerRef,

            {

              activeRequests,

              availability:
                activeRequests === 0
                  ? "Available"
                  : "Busy"

            }

          );

        }

      }


      alert(
        "Service cancelled successfully."
      );


      location.reload();


    } catch (error) {

      console.error(
        "Cancel error:",
        error
      );


      alert(
        "Unable to cancel service.\n\n" +
        error.message
      );

    }

  };


// ======================================================
// LOAD SERVICES
// ======================================================

async function loadUserServices() {

  const container =
    document.getElementById(
      "assigned-service"
    );


  if (!container) {
    return;
  }


  try {

    const q =
      query(

        collection(
          db,
          "services"
        ),

        where(
          "requestedBy",
          "==",
          userId
        )

      );


    const snapshot =
      await getDocs(q);


    container.innerHTML =
      "";


    if (snapshot.empty) {

      container.innerHTML =
        "<p>No services requested yet.</p>";

      hideElement(
        "section-4"
      );

      return;
    }


    const cards = [];


    let feedbackAvailable =
      false;


    for (
      const serviceDoc of snapshot.docs
    ) {

      const data =
        serviceDoc.data();


      let providerName =
        "Not Assigned";


      if (
        data.assignedTo
      ) {

        const providerSnap =
          await getDoc(

            doc(
              db,
              "users",
              data.assignedTo
            )

          );


        if (
          providerSnap.exists()
        ) {

          const provider =
            providerSnap.data();


          providerName =
            provider.username ||
            provider.name ||
            "Service Provider";

        }

      }


      if (
        data.status === "Completed" &&
        !data.feedbackSubmitted
      ) {

        feedbackAvailable =
          true;

      }


      let buttons = "";


      if (
        data.assignedTo
      ) {

        buttons += `

          <button
            onclick="window.location.href='profile.html?id=${encodeURIComponent(data.assignedTo)}'"
          >
            View Provider Profile
          </button>

        `;

      }


      buttons += `

        <button
          onclick="window.location.href='profile.html?id=${encodeURIComponent(userId)}'"
        >
          View Your Profile
        </button>

      `;


      if (
        data.status === "Assigned" ||
        data.status === "Accepted" ||
        data.status === "Pending"
      ) {

        buttons += `

          <button
            class="danger-btn"
            onclick="cancelService('${serviceDoc.id}')"
          >
            Cancel Service
          </button>

        `;

      }


      if (
        data.status === "Completed" &&
        !data.feedbackSubmitted
      ) {

        buttons += `

          <button
            onclick="openFeedbackForm('${serviceDoc.id}')"
          >
            Give Feedback
          </button>

        `;

      }


      const card = `

        <div class="service-card">

          <h3>
            ${escapeHTML(
              data.serviceName ||
              "Service"
            )}
          </h3>


          <p>
            <b>Status:</b>
            ${escapeHTML(
              data.status ||
              "Unknown"
            )}
          </p>


          <p>
            <b>Service Provider:</b>
            ${escapeHTML(
              providerName
            )}
          </p>


          ${
            data.createdAt
              ? `
                <p>
                  <b>Requested:</b>
                  ${formatDate(
                    data.createdAt
                  )}
                </p>
              `
              : ""
          }


          <div class="service-actions">

            ${buttons}

          </div>

        </div>

      `;


      cards.push(card);

    }


    container.innerHTML =
      cards.join("");


    if (
      feedbackAvailable
    ) {

      showElement(
        "section-4"
      );

    } else {

      hideElement(
        "section-4"
      );

    }


  } catch (error) {

    console.error(
      "Loading services error:",
      error
    );


    container.innerHTML =
      "<p>Unable to load services.</p>";

  }

}


// ======================================================
// FEEDBACK FORM
// ======================================================

window.openFeedbackForm =
  function (
    serviceId
  ) {

    latestServiceId =
      serviceId;


    const section =
      document.getElementById(
        "section-4"
      );


    if (section) {

      section.classList.remove(
        "hidden"
      );


      section.scrollIntoView({

        behavior:
          "smooth"

      });

    }

  };


const feedbackForm =
  document.getElementById(
    "feedback-form"
  );


if (feedbackForm) {

  feedbackForm.addEventListener(
    "submit",
    async (e) => {

      e.preventDefault();


      if (!latestServiceId) {

        alert(
          "Select a completed service first."
        );

        return;

      }


      try {

        const rating =
          Number(
            document
              .getElementById("rating")
              .value
          );


        const feedback =
          document
            .getElementById("feedback")
            .value
            .trim();


        if (
          rating < 1 ||
          rating > 5
        ) {

          alert(
            "Rating must be between 1 and 5."
          );

          return;

        }


        if (!feedback) {

          alert(
            "Please enter feedback."
          );

          return;

        }


        const serviceRef =
          doc(
            db,
            "services",
            latestServiceId
          );


        const serviceSnap =
          await getDoc(
            serviceRef
          );


        if (!serviceSnap.exists()) {

          alert(
            "Service not found."
          );

          return;

        }


        const service =
          serviceSnap.data();


        if (
          service.requestedBy !==
          userId
        ) {

          alert(
            "You cannot review this service."
          );

          return;

        }


        if (
          service.status !==
          "Completed"
        ) {

          alert(
            "Service is not completed."
          );

          return;

        }


        if (
          service.feedbackSubmitted
        ) {

          alert(
            "Feedback has already been submitted."
          );

          return;

        }


        await updateDoc(

          serviceRef,

          {

            rating,

            feedback,

            feedbackSubmitted:
              true,

            feedbackSubmittedAt:
              new Date().toISOString(),

            status:
              "Closed"

          }

        );


        if (
          service.assignedTo
        ) {

          await updateProviderRating(

            service.assignedTo,

            rating

          );

        }


        alert(
          "Feedback submitted successfully!"
        );


        latestServiceId =
          null;


        location.reload();


      } catch (error) {

        console.error(
          "Feedback error:",
          error
        );


        alert(
          "Unable to submit feedback.\n\n" +
          error.message
        );

      }

    }
  );

}


// ======================================================
// UPDATE PROVIDER RATING
// ======================================================

async function updateProviderRating(
  providerId,
  newRating
) {

  try {

    const providerRef =
      doc(
        db,
        "users",
        providerId
      );


    const providerSnap =
      await getDoc(
        providerRef
      );


    if (
      !providerSnap.exists()
    ) {

      return;

    }


    const provider =
      providerSnap.data();


    const oldRating =
      Number(
        provider.rating || 0
      );


    const ratingCount =
      Number(
        provider.ratingCount || 0
      );


    const newCount =
      ratingCount + 1;


    const newAverage =

      (
        oldRating *
        ratingCount +
        newRating
      ) /
      newCount;


    await updateDoc(

      providerRef,

      {

        rating:
          Number(
            newAverage.toFixed(2)
          ),

        ratingCount:
          newCount

      }

    );

  } catch (error) {

    console.error(
      "Rating update error:",
      error
    );

  }

}


// ======================================================
// FUZZY SERVICE MATCH
// ======================================================

function fuzzyMatch(
  a,
  b
) {

  a =
    String(a || "")
      .toLowerCase()
      .trim();


  b =
    String(b || "")
      .toLowerCase()
      .trim();


  if (!a || !b) {
    return false;
  }


  if (a === b) {
    return true;
  }


  if (
    a.includes(b) ||
    b.includes(a)
  ) {

    return true;

  }


  const aliases = {

    plumbing: [
      "plumbing",
      "plumber"
    ],

    electrician: [
      "electrician",
      "electrical",
      "electric"
    ],

    carpenter: [
      "carpenter",
      "carpentry",
      "woodwork"
    ],

    "ac repair": [
      "ac repair",
      "air conditioning",
      "air conditioner",
      "ac service",
      "hvac"
    ]

  };


  for (
    const key in aliases
  ) {

    if (

      aliases[key].includes(a) &&

      aliases[key].includes(b)

    ) {

      return true;

    }

  }


  return (
    levenshteinDistance(
      a,
      b
    ) <= 2
  );

}


// ======================================================
// LEVENSHTEIN
// ======================================================

function levenshteinDistance(
  s1,
  s2
) {

  const dp =
    Array.from(

      {
        length:
          s2.length + 1

      },

      () =>
        Array(
          s1.length + 1
        ).fill(0)

    );


  for (
    let i = 0;
    i <= s2.length;
    i++
  ) {

    dp[i][0] =
      i;

  }


  for (
    let j = 0;
    j <= s1.length;
    j++
  ) {

    dp[0][j] =
      j;

  }


  for (
    let i = 1;
    i <= s2.length;
    i++
  ) {

    for (
      let j = 1;
      j <= s1.length;
      j++
    ) {

      const cost =
        s2[i - 1] ===
        s1[j - 1]
          ? 0
          : 1;


      dp[i][j] =
        Math.min(

          dp[i - 1][j] + 1,

          dp[i][j - 1] + 1,

          dp[i - 1][j - 1] +
            cost

        );

    }

  }


  return dp[
    s2.length
  ][
    s1.length
  ];

}


// ======================================================
// NORMALIZE LOCATION
// ======================================================

function normalizeLocation(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;

  }


  const result =
    String(value)
      .trim()
      .toLowerCase();


  return result || null;

}


// ======================================================
// HTML ESCAPE
// ======================================================

function escapeHTML(
  value
) {

  const div =
    document.createElement(
      "div"
    );


  div.textContent =
    String(value);


  return div.innerHTML;

}


// ======================================================
// DATE
// ======================================================

function formatDate(
  value
) {

  try {

    return new Date(value)
      .toLocaleString(
        "en-IN"
      );

  } catch {

    return "Unknown";

  }

}


// ======================================================
// SHOW / HIDE
// ======================================================

function showElement(
  id
) {

  const element =
    document.getElementById(
      id
    );


  if (element) {

    element.classList.remove(
      "hidden"
    );

  }

}


function hideElement(
  id
) {

  const element =
    document.getElementById(
      id
    );


  if (element) {

    element.classList.add(
      "hidden"
    );

  }

      }
