import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";

// 👇 เอา Config ที่ก๊อปมาจาก Firebase มาวางทับตรงนี้เลยครับ
const firebaseConfig = {
  apiKey: "AIzaSyD-xxxxxxxxxxxxxxxxxxxx",
  authDomain: "smart-acls-er.firebaseapp.com",
  projectId: "smart-acls-er",
  storageBucket: "smart-acls-er.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:xxxxxx"
};

// เริ่มต้นระบบ
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// 📡 เครื่องรับสัญญาณ: คอยฟังว่าข้อมูลในห้อง (SessionID) เปลี่ยนไหม
export const subscribeToSession = (sessionId: string, onUpdate: (data: any) => void) => {
    // ฟังที่ Collection 'acls_sessions' -> เอกสารชื่อ sessionId
    return onSnapshot(doc(db, "acls_sessions", sessionId), (doc) => {
        if (doc.exists()) {
            onUpdate(doc.data()); // ส่งข้อมูลใหม่กลับไปให้ App.tsx
        }
    });
};

// 📡 เครื่องส่งสัญญาณ: ยิงข้อมูลใหม่ขึ้น Cloud
export const updateSession = async (sessionId: string, data: any) => {
    if (!sessionId) return; // ถ้าไม่ได้กรอกห้อง ก็ไม่ต้องส่ง
    try {
        // ใช้ merge: true เพื่ออัปเดตเฉพาะส่วนที่เปลี่ยน ไม่ทับข้อมูลหาย
        await setDoc(doc(db, "acls_sessions", sessionId), data, { merge: true });
    } catch (e) {
        console.error("Sync Error:", e);
    }
};