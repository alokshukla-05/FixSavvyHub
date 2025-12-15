// Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { 
  getAuth, 
  onAuthStateChanged, 
  signOut,
  updateProfile 
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { 
  getFirestore,
  enableIndexedDbPersistence,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC0dYCbPoH5mH1QeLI31xrfqnUSbT8Bao0",
  authDomain: "fixeasy-568cd.firebaseapp.com",
  projectId: "fixeasy-568cd",
  storageBucket: "fixeasy-568cd.firebasestorage.app",
  messagingSenderId: "839456909521",
  appId: "1:839456909521:web:8555cb99e40cb5e1753df0",
  measurementId: "G-RQD3RPMZKS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
const auth = getAuth(app);

// Initialize Firestore with persistence
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// Enable offline persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn("Multiple tabs open, persistence can only be enabled in one tab at a time.");
  } else if (err.code === 'unimplemented') {
    console.warn("The current browser doesn't support persistence.");
  }
});

// Export for use in other files
export { auth, db, app };
