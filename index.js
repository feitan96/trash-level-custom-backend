require("dotenv").config(); // Load environment variables from .env
const express = require("express");
const admin = require("firebase-admin");
const cron = require("node-cron");

// Load the Firebase Service Account Key
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, "base64").toString("utf-8")
);

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

const db = admin.firestore();
const realtimeDb = admin.database();
const app = express();
const port = process.env.PORT || 3000;

// Function to calculate trash level percentage
const calculateTrashLevel = (distance) => {
  const maxDistance = 100; // 100cm = 0% (empty)
  const minDistance = 2; // 0cm = 100% (full)

  if (distance >= maxDistance) return 0; // Bin is empty
  if (distance <= minDistance) return 100; // Bin is full

  // Linear interpolation to calculate percentage
  return Math.round(((maxDistance - distance) / (maxDistance - minDistance)) * 100);
};

// Function to fetch bins from Realtime DB
const fetchBins = async () => {
  try {
    const binsRef = realtimeDb.ref("/");
    const snapshot = await binsRef.once("value");
    const binsData = snapshot.val();

    if (binsData) {
      return Object.keys(binsData); // Return an array of bin names
    }
    return [];
  } catch (error) {
    console.error("Error fetching bins:", error);
    return [];
  }
};

// Function to fetch distance from Realtime DB and post to Firestore
const fetchAndPostTrashLevel = async () => {
  try {
    // Fetch the list of bins
    const bins = await fetchBins();

    if (bins.length === 0) {
      console.log("No bins found in Realtime DB.");
      return;
    }

    // Process each bin
    for (const bin of bins) {
      const binRef = realtimeDb.ref(bin);
      const snapshot = await binRef.once("value");
      const binData = snapshot.val();

      if (binData && binData["distance(cm)"] !== null) {
        const distance = binData["distance(cm)"];
        const trashLevel = calculateTrashLevel(distance);

        // Post to Firestore
        await db.collection("trashLevels").add({
          bin,
          trashLevel,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`Trash level posted for ${bin}: ${trashLevel}%`);
      } else {
        console.error(`No distance data found for bin: ${bin}`);
      }
    }
  } catch (error) {
    console.error("Error fetching or posting trash level:", error);
  }
};

// Schedule the task to run every hour
cron.schedule("0 * * * *", () => {
    console.log("Cron job started at:", new Date().toISOString());
    fetchAndPostTrashLevel().catch((error) => {
      console.error("Error in cron job:", error);
    });
  });

app.get("/trigger", async (req, res) => {
    console.log("Manual trigger started at:", new Date().toISOString());
    try {
      await fetchAndPostTrashLevel();
      res.send("Trash levels posted successfully!");
    } catch (error) {
      console.error("Error in manual trigger:", error);
      res.status(500).send("Error posting trash levels.");
    }
  });

  app.get("/test", (req, res) => {
    res.send("Backend is working!");
  });

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});