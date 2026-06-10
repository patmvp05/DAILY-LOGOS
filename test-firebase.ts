import { initializeApp } from "firebase/app";
import { getFirestore, getDoc, doc } from "firebase/firestore";
import config from "./src/lib/firebaseConfig";
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId || "(default)");

async function testConnection() {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "users", "test")),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
    ]) as any;
    console.log("Firebase connection successful, doc exists:", snap.exists());
  } catch (err: any) {
    console.error("Firebase connection error:", err.message);
  } finally {
    process.exit(0);
  }
}

testConnection();
