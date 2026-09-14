/**
 * 🔥 Firebase Cleanup Script
 * 
 * શું કાઢશે: stock, hist, reps, sugs, fourP, jangads, sugAll, loginHistory
 * શું રાખશે:  users, managers, dataentrys, dstatus, deptVigats, labels
 * 
 * ઉપયોગ: Diamond_Stock_LIVE.html ખોલો → F12 → Console → paste → Enter
 */

(async function firebaseCleanup() {
  // Firebase Config
  const config = {
    apiKey: "AIzaSyADKss0WogDYUxD9hsM5AhzM2HVTHRBKz0",
    authDomain: "diamond-stock-b82c0.firebaseapp.com",
    databaseURL: "https://diamond-stock-b82c0-default-rtdb.firebaseio.com",
    projectId: "diamond-stock-b82c0",
    storageBucket: "diamond-stock-b82c0.firebasestorage.app",
    messagingSenderId: "119668289861",
    appId: "1:119668289861:web:b70609f32585edb94b8e2c"
  };

  // Initialize Firebase
  if (!window.firebase || !firebase.database) {
    console.error("❌ Firebase SDK not loaded! LIVE page ખોલો પહેલાં.");
    return;
  }

  let app;
  try {
    app = firebase.initializeApp(config);
  } catch(e) {
    // Already initialized
    app = firebase.app();
  }
  const db = firebase.database();

  console.log("🔥 Firebase connected...");
  console.log("📥 Reading current data...");

  // Read current data
  let snapshot;
  try {
    snapshot = await db.ref('stockData').once('value');
  } catch(e) {
    console.error("❌ Read failed:", e.message);
    return;
  }

  const current = snapshot.val();
  if (!current) {
    console.log("✅ Firebase is already empty! કંઈ data નથી.");
    return;
  }

  console.log("📊 Current data keys:", Object.keys(current));
  
  // Count what we're keeping vs deleting
  const keep = ['users', 'managers', 'dataentrys', 'dstatus', 'deptVigats', 'labels'];
  const del = ['stock', 'hist', 'reps', 'sugs', 'fourP', 'jangads', 'sugAll', 'loginHistory', 
               'uchak', 'uchakProcesses', 'uchakRates', 'deptProcesses', 'deptRates',
               'traders', 'traderItems', 'traderIncoming', 'traderSells', 'traderRequests',
               'storeManager', 'extraItems', 'extraStock', 'jangadCounter', 'updated'];

  let keepData = {};
  let deleteCount = 0;

  keep.forEach(k => {
    if (current[k] !== undefined && current[k] !== null) {
      keepData[k] = current[k];
      console.log("  ✅ KEEP: " + k + " (" + JSON.stringify(current[k]).length + " bytes)");
    }
  });

  del.forEach(k => {
    if (current[k] !== undefined && current[k] !== null) {
      deleteCount++;
      let size = JSON.stringify(current[k]).length;
      console.log("  🗑️ DELETE: " + k + " (" + size + " bytes)");
    }
  });

  if (deleteCount === 0) {
    console.log("✅ કંઈ જૂનું data નથી! બધું clean છે.");
    return;
  }

  // Confirm
  console.log("\n⚠️ શું તમે ખરેખર " + deleteCount + " items delete કરવા માંગો છો?");
  console.log("📝 Keep: " + keep.join(", "));
  console.log("🗑️ Delete: " + del.filter(k => current[k] !== undefined).join(", "));
  
  // Write cleaned data
  console.log("\n🔥 Cleaning Firebase...");
  
  try {
    await db.ref('stockData').set(keepData);
    console.log("✅ Firebase cleaned successfully!");
    console.log("📊 Kept data keys:", Object.keys(keepData));
    
    // Also clean tombstones
    try {
      await db.ref('tombstones').remove();
      console.log("🗑️ Tombstones cleared!");
    } catch(e) {
      console.log("⚠️ Tombstones skip:", e.message);
    }
    
    console.log("\n🎉 Done! Firebase now has only: " + Object.keys(keepData).join(", "));
    console.log("💡 Page refresh કરો — નવું data લખશો ત્યારે fresh start!");
    
  } catch(e) {
    console.error("❌ Write failed:", e.message);
  }

})();
