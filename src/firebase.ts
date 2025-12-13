// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCx9nefPu0L6W9dEJONBAWfR9Mlj0PcAwI",
  authDomain: "studio-4387606549-15d0e.firebaseapp.com",
  projectId: "studio-4387606549-15d0e",
  storageBucket: "studio-4387606549-15d0e.firebasestorage.app",
  messagingSenderId: "458737064938",
  appId: "1:458737064938:web:aea28370d910bfa2a7f093"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Subscribes to a session and calls onUpdate with the new data
export const subscribeToSession = (sessionId: string, onUpdate: (data: any) => void) => {
    return onSnapshot(doc(db, "acls_sessions", sessionId), (doc) => {
        if (doc.exists()) {
            onUpdate(doc.data());
        }
    });
};

// Updates a session with new data
export const updateSession = async (sessionId: string, data: any) => {
    if (!sessionId) return;
    try {
        await setDoc(doc(db, "acls_sessions", sessionId), data, { merge: true });
    } catch (e) {
        console.error("Sync Error:", e);
    }
};
