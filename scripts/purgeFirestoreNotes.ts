import dotenv from "dotenv";
dotenv.config();

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyDummyKeyForBuildVerification",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "academy-connect-500d1.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "academy-connect-500d1",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "academy-connect-500d1.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "835356071946",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:835356071946:web:5450b3be3cb3ee79aa67f3",
};

async function purgeFirestoreNotes() {
  console.log("==================================================");
  console.log("PURGING ALL EXISTING NOTES FROM FIRESTORE COLLECTIONS");
  console.log("==================================================");

  try {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const collectionsToPurge = ["class_notes", "upsc_notes", "notes"];
    for (const colName of collectionsToPurge) {
      console.log(`Checking collection "${colName}"...`);
      try {
        const colRef = collection(db, colName);
        const snapshot = await getDocs(colRef);
        console.log(`Found ${snapshot.size} documents in "${colName}". Deleting...`);
        for (const docSnap of snapshot.docs) {
          await deleteDoc(doc(db, colName, docSnap.id));
        }
        console.log(`✓ Purged all documents in "${colName}".`);
      } catch (err: any) {
        console.warn(`Notice reading collection "${colName}":`, err?.message || err);
      }
    }

    console.log("\n✓ Firestore notes purge completed.");
  } catch (err: any) {
    console.error("Firestore purge error:", err?.message || err);
  }
}

purgeFirestoreNotes();
