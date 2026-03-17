import express from "express";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lazy initialize Firestore and RTDB
let db: admin.firestore.Firestore | null = null;
let rtdb: admin.database.Database | null = null;

// In-memory cache for members
let membersCache: Map<string, any> = new Map(); // card -> member
let membersById: Map<string, any> = new Map(); // id -> member
let activeMembersSet: Set<string> = new Set();
let isCacheInitialized = false;
let currentWeekStart: number = 0;

function getStartOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
}

async function initMembersCache() {
  try {
    const firestore = getFirestore();
    const now = new Date();
    const weekStart = getStartOfWeek(now);
    currentWeekStart = weekStart.getTime();
    const todayStart = getStartOfDay(now);
    
    // 1. Load all members
    const snapshot = await firestore.collection('members').get();
    membersCache.clear();
    membersById.clear();
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const member = { 
        id: doc.id, 
        ...data, 
        weeklyCount: 0, 
        weeklyDays: [],
        lastCheckInToday: false,
        last_renewal_date: data.last_renewal_date ? data.last_renewal_date.toDate() : null
      };
      if (data.card) {
        membersCache.set(data.card.toUpperCase(), member);
      }
      membersById.set(doc.id, member);
    });

    // 2. Load active members and weekly counts
    const attendanceSnapshot = await firestore.collection('attendance')
      .where('check_in', '>=', admin.firestore.Timestamp.fromDate(weekStart))
      .get();
    
    activeMembersSet.clear();
    attendanceSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const mId = data.member_id;
      const member = membersById.get(mId);
      
      if (data.check_out === null) {
        activeMembersSet.add(mId);
      }
      
      if (member) {
        const checkIn = data.check_in.toDate();
        const renewalDate = member.last_renewal_date || new Date(0);
        
        // Only count if it's in this week AND after renewal
        if (checkIn >= weekStart && checkIn >= renewalDate) {
          const dayOfWeek = checkIn.getDay();
          if (!member.weeklyDays.includes(dayOfWeek)) {
            member.weeklyDays.push(dayOfWeek);
            member.weeklyCount++;
          }
          if (checkIn >= todayStart) {
            member.lastCheckInToday = true;
          }
        }
      }
    });

    // 3. Proactive Expiry Alerts
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    
    const expiringMembers = Array.from(membersById.values()).filter(m => {
      if (!m.subscription_expiry) return false;
      const expiry = new Date(m.subscription_expiry);
      return expiry > now && expiry <= threeDaysFromNow;
    });

    for (const m of expiringMembers) {
      const expiryDate = new Date(m.subscription_expiry);
      // Check if alert already exists for this expiry to avoid spam
      const existingAlerts = await firestore.collection('alerts')
        .where('member_id', '==', m.id)
        .where('type', '==', 'subscription_warning')
        .limit(1)
        .get();
      
      if (existingAlerts.empty) {
        await firestore.collection('alerts').add({
          member_id: m.id,
          memberName: m.name,
          type: 'subscription_warning',
          message: `Abbonamento in scadenza il ${expiryDate.toLocaleDateString('it-IT')}`,
          timestamp: admin.firestore.Timestamp.now()
        });
      }
    }

    isCacheInitialized = true;
    console.log(`Cache initialized: ${membersCache.size} members, ${activeMembersSet.size} active`);
  } catch (error) {
    console.error("Error initializing cache:", error);
  }
}

function getFirebase() {
  if (!db) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Le credenziali Firebase (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) sono richieste nelle variabili d\'ambiente.');
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${projectId}-default-rtdb.europe-west1.firebasedatabase.app`
      });
    }
    db = admin.firestore();
    rtdb = admin.database();
  }
  return { firestore: db, rtdb };
}

function getFirestore() {
  return getFirebase().firestore;
}

function getRTDB() {
  return getFirebase().rtdb;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Helper to get start and end of a day/week
  // (Using top-level versions)

  // API Routes
  app.get("/api/members", async (req, res) => {
    try {
      const firestore = getFirestore();
      const snapshot = await firestore.collection('members').orderBy('name', 'asc').get();
      const members = snapshot.docs.map(doc => {
        const data = doc.data();
        const cached = membersById.get(doc.id);
        return { 
          id: doc.id, 
          ...data,
          weeklyCount: cached?.weeklyCount || 0,
          weeklyDays: cached?.weeklyDays || []
        };
      });
      res.json(members);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/members", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { name, card, birth_date, weekly_frequency, price, email, phone, subscription_expiry, available_recoveries } = req.body;
      
      const now = new Date();
      const defaultExpiry = new Date(now);
      defaultExpiry.setMonth(defaultExpiry.getMonth() + 1);

      const memberData = {
        name,
        card: card || null,
        birth_date: birth_date || null,
        weekly_frequency: Number(weekly_frequency) || 3,
        price: Number(price) || 0,
        email: email || null,
        phone: phone || null,
        subscription_expiry: subscription_expiry || defaultExpiry.toISOString(),
        available_recoveries: Number(available_recoveries) || 0,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      };

      const docRef = await firestore.collection('members').add(memberData);
      
      // Update cache
      const newMember = { 
        id: docRef.id, 
        ...memberData, 
        weeklyCount: 0, 
        weeklyDays: [],
        lastCheckInToday: false,
        last_renewal_date: null
      };
      membersById.set(docRef.id, newMember);
      if (card) {
        membersCache.set(card.toUpperCase(), newMember);
      }
      
      res.json({ id: docRef.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/members/:id", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { id } = req.params;
      const { name, card, birth_date, weekly_frequency, price, email, phone, subscription_expiry, available_recoveries } = req.body;
      
      const updateData = {
        name,
        card: card || null,
        birth_date: birth_date || null,
        weekly_frequency: Number(weekly_frequency) || 3,
        price: Number(price) || 0,
        email: email || null,
        phone: phone || null,
        subscription_expiry: subscription_expiry || null,
        available_recoveries: Number(available_recoveries) || 0,
      };

      await firestore.collection('members').doc(id).update(updateData);
      
      // Update cache
      const existing = membersById.get(id);
      const updatedMember = { 
        ...existing, 
        ...updateData, 
        id,
        weeklyCount: existing?.weeklyCount || 0,
        weeklyDays: existing?.weeklyDays || [],
        lastCheckInToday: existing?.lastCheckInToday || false,
        last_renewal_date: existing?.last_renewal_date || null
      };
      
      membersById.set(id, updatedMember);
      
      if (card) {
        membersCache.set(card.toUpperCase(), updatedMember);
      } else if (existing?.card) {
        membersCache.delete(existing.card.toUpperCase());
      }
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/attendance/active", async (req, res) => {
    try {
      const firestore = getFirestore();
      const snapshot = await firestore.collection('attendance')
        .where('check_out', '==', null)
        .get();
        
      const active = await Promise.all(snapshot.docs.map(async doc => {
        const data = doc.data();
        let memberName = 'Sconosciuto';
        if (data.member_id) {
          const memberDoc = await firestore.collection('members').doc(data.member_id).get();
          if (memberDoc.exists) memberName = memberDoc.data()?.name;
        }
        return {
          id: doc.id,
          member_id: data.member_id,
          name: memberName,
          check_in: data.check_in?.toDate().toISOString(),
          check_out: null
        };
      }));
      
      res.json(active);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/attendance/check-in", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { member_id } = req.body;
      
      const existing = await firestore.collection('attendance')
        .where('member_id', '==', member_id)
        .where('check_out', '==', null)
        .get();
        
      if (!existing.empty) {
        return res.status(400).json({ error: "Utente già in sala" });
      }

      await firestore.collection('attendance').add({
        member_id,
        check_in: admin.firestore.Timestamp.now(),
        check_out: null
      });
      
      // Update memory state
      activeMembersSet.add(member_id);
      const member = membersById.get(member_id);
      if (member) {
        const now = new Date();
        const dayOfWeek = now.getDay();
        if (!member.weeklyDays) member.weeklyDays = [];
        if (!member.weeklyDays.includes(dayOfWeek)) {
          member.weeklyCount++;
          member.weeklyDays.push(dayOfWeek);
        }
        member.lastCheckInToday = true;
      }
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/attendance/check-out", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { attendance_id } = req.body;
      
      const doc = await firestore.collection('attendance').doc(attendance_id).get();
      if (doc.exists) {
        const memberId = doc.data()?.member_id;
        if (memberId) activeMembersSet.delete(memberId);
      }

      await firestore.collection('attendance').doc(attendance_id).update({
        check_out: admin.firestore.Timestamp.now()
      });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- CORE SWIPE LOGIC ---
  const processSwipe = async (card: string) => {
    const firestore = getFirestore();
    const cardUpper = card.toUpperCase();
    
    // 1. Check Cache first (Instant)
    let member = membersCache.get(cardUpper);
    
    // Special Card Logic: 732dfdfa
    if (cardUpper === '732DFDFA') {
      const now = new Date();
      const isFriday = now.getDay() === 5;
      const isAfter21 = now.getHours() >= 21;
      
      if (!isFriday || !isAfter21) {
        return { 
          success: false, 
          error: "Validazione weekend disponibile solo Venerdì dopo le 21:00", 
          status: 400 
        };
      }

      // Perform global validation logic (similar to Saturday button)
      try {
        const firestore = getFirestore();
        
        // Check if validation was already done this week
        const systemDoc = await firestore.collection('system').doc('status').get();
        const lastValidation = systemDoc.data()?.last_validation_week;
        const currentWeekStr = getStartOfWeek(now).toISOString();
        
        if (lastValidation === currentWeekStr) {
          return { 
            success: false, 
            error: "Validazione settimanale già eseguita per questa settimana", 
            status: 400 
          };
        }

        // Check if it's the last Friday of the month (proxy for last weekend)
        const nextFri = new Date(now);
        nextFri.setDate(now.getDate() + 7);
        const isLastWeekend = nextFri.getMonth() !== now.getMonth();

        const membersSnapshot = await firestore.collection('members').get();
        const batch = firestore.batch();
        
        for (const doc of membersSnapshot.docs) {
          const data = doc.data();
          const memberId = doc.id;
          const cachedMember = membersById.get(memberId);
          if (!cachedMember) continue;

          const weeklyFrequency = Number(data.weekly_frequency) || 0;
          const weeklyCount = cachedMember.weeklyCount || 0;
          const currentRecoveries = Number(data.available_recoveries) || 0;

          let newRecoveries = currentRecoveries;
          if (weeklyCount < weeklyFrequency) {
            newRecoveries += (weeklyFrequency - weeklyCount);
          }
          if (isLastWeekend) {
            newRecoveries = 0;
          }

          batch.update(doc.ref, { available_recoveries: newRecoveries });
          cachedMember.available_recoveries = newRecoveries;
          
          // Reset weekly state for the next week (since we are validating now)
          cachedMember.weeklyCount = 0;
          cachedMember.weeklyDays = [];
          cachedMember.lastCheckInToday = false;
        }
        
        batch.set(firestore.collection('system').doc('status'), { 
          last_validation_week: currentWeekStr,
          last_validation_timestamp: admin.firestore.Timestamp.now()
        }, { merge: true });

        await batch.commit();
        broadcastSwipe({ type: 'success', text: 'Validazione Weekend Completata', action: 'checkin', memberName: 'SISTEMA' });
        
        return { 
          success: true, 
          action: "checkin", 
          memberName: "VALIDAZIONE WEEKEND", 
          status: 200,
          text: "Validazione settimanale eseguita con successo"
        };
      } catch (e: any) {
        return { success: false, error: "Errore validazione: " + e.message, status: 500 };
      }
    }
    
    if (!member) {
      const membersSnapshot = await firestore.collection('members').where('card', '==', cardUpper).limit(1).get();
      if (membersSnapshot.empty) {
        return { success: false, error: "Card non registrata", status: 404 };
      }
      const doc = membersSnapshot.docs[0];
      member = { id: doc.id, ...doc.data(), weeklyCount: 0, lastCheckInToday: false, weeklyDays: [] };
      membersCache.set(cardUpper, member);
      membersById.set(doc.id, member);
    }

    if (!member.weeklyDays) member.weeklyDays = [];

    const memberId = member.id;
    const now = new Date();
    const todayStart = getStartOfDay(now).getTime();
    const weekStart = getStartOfWeek(now).getTime();

    // Week reset check
    const nowWeekStart = getStartOfWeek(now).getTime();
    if (nowWeekStart > currentWeekStart) {
      currentWeekStart = nowWeekStart;
      membersById.forEach(m => {
        m.weeklyCount = 0;
        m.lastCheckInToday = false;
        m.weeklyDays = [];
      });
      console.log("Week transitioned, cache reset.");
    }

    // 3. Check if already in the gym (Instant memory check)
    if (activeMembersSet.has(memberId)) {
      firestore.collection('alerts').add({
        member_id: memberId,
        memberName: member.name,
        type: 'double_entry',
        message: "Tentativo di doppio ingresso",
        timestamp: admin.firestore.Timestamp.now()
      }).catch(e => console.error("Alert error:", e));

      return { 
        success: true, 
        action: "already_in", 
        memberName: member.name, 
        member_id: memberId, 
        status: 200, 
        error: "Sei già entrato in palestra",
        weeklyCount: member.weeklyCount,
        weeklyFrequency: member.weekly_frequency,
        availableRecoveries: member.available_recoveries,
        expiryDate: member.subscription_expiry,
        weeklyDays: member.weeklyDays || []
      };
    }

    // --- RULES FOR CHECK-IN (Zero-Query) ---
    
    // 1. Check subscription expiry
    if (!member.subscription_expiry) {
      return { success: false, error: "Abbonamento non impostato", member_id: memberId, status: 400 };
    }
    const expiryDate = new Date(member.subscription_expiry);
    if (expiryDate.getTime() < todayStart) {
      firestore.collection('alerts').add({
        member_id: memberId,
        memberName: member.name,
        type: 'subscription_expired',
        message: "Abbonamento scaduto",
        timestamp: admin.firestore.Timestamp.now()
      }).catch(e => console.error("Alert error:", e));

      return { 
        success: false, 
        error: "Abbonamento scaduto", 
        member_id: memberId, 
        status: 400,
        memberName: member.name,
        weeklyCount: member.weeklyCount,
        weeklyFrequency: member.weekly_frequency,
        expiryDate: member.subscription_expiry,
        weeklyDays: member.weeklyDays || []
      };
    }

    // 2. Check if already entered today
    if (member.lastCheckInToday) {
      return { 
        success: false, 
        error: "Sei già entrato oggi", 
        member_id: memberId, 
        status: 400,
        memberName: member.name,
        weeklyCount: member.weeklyCount,
        weeklyFrequency: member.weekly_frequency,
        expiryDate: member.subscription_expiry,
        weeklyDays: member.weeklyDays || []
      };
    }

    // 3. Check weekly frequency
    const entriesThisWeek = member.weeklyCount || 0;
    const allowedEntries = member.weekly_frequency || 3;
    let availableRecoveries = member.available_recoveries || 0;

    if (entriesThisWeek >= allowedEntries) {
      if (availableRecoveries > 0) {
        availableRecoveries -= 1;
        // Non-blocking update
        firestore.collection('members').doc(memberId).update({ available_recoveries: availableRecoveries })
          .then(() => { if (member) member.available_recoveries = availableRecoveries; })
          .catch(e => console.error("Update error:", e));
      } else {
        return { 
          success: false, 
          error: "Ingressi settimanali esauriti", 
          member_id: memberId, 
          status: 400,
          memberName: member.name,
          weeklyCount: member.weeklyCount,
          weeklyFrequency: member.weekly_frequency,
          expiryDate: member.subscription_expiry,
          weeklyDays: member.weeklyDays || []
        };
      }
    }

    // Allow Check in (Fire and Forget for speed, but update local state first)
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    if (!member.weeklyDays.includes(dayOfWeek)) {
      member.weeklyCount++;
      member.weeklyDays.push(dayOfWeek);
    }
    member.lastCheckInToday = true;

    activeMembersSet.add(memberId);

    firestore.collection('attendance').add({
      member_id: memberId,
      check_in: admin.firestore.Timestamp.now(),
      check_out: null
    }).catch(e => {
      console.error("Critical: Failed to save attendance to Firestore", e);
    });

    // Fire and forget warning alert
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    if (expiryDate < threeDaysFromNow) {
      firestore.collection('alerts').add({
        member_id: memberId,
        memberName: member.name,
        type: 'subscription_warning',
        message: `Abbonamento in scadenza il ${expiryDate.toLocaleDateString('it-IT')}`,
        timestamp: admin.firestore.Timestamp.now()
      }).catch(e => console.error("Alert warning error:", e));
    }
    
    return { 
      success: true, 
      action: "checkin", 
      memberName: member.name, 
      member_id: memberId, 
      usedRecovery: entriesThisWeek >= allowedEntries, 
      status: 200,
      weeklyCount: member.weeklyCount,
      weeklyFrequency: member.weekly_frequency,
      expiryDate: member.subscription_expiry,
      weeklyDays: member.weeklyDays || [],
      availableRecoveries: member.available_recoveries || 0
    };
  };

  // --- RTDB LISTENER FOR ARDUINO ---
  const lastProcessedSwipes: Record<string, number> = {};

  // SSE Clients
  let sseClients: any[] = [];

  app.get("/api/swipes/stream", (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);

    req.on('close', () => {
      sseClients = sseClients.filter(c => c.id !== clientId);
    });
  });

  const broadcastSwipe = (data: any) => {
    sseClients.forEach(client => {
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  };

  const setupRTDBListener = () => {
    try {
      const rtdb = getRTDB();
      const swipesRef = rtdb.ref('swipes');
      
      console.log("Listening for Arduino swipes on RTDB /swipes...");
      
      swipesRef.on('child_added', async (snapshot) => {
        const swipeData = snapshot.val();
        const swipeId = snapshot.key;
        
        if (!swipeData || !swipeData.card) {
          if (swipeId) snapshot.ref.remove();
          return;
        }
        
        const card = swipeData.card.toUpperCase();
        const now = Date.now();

        // Server-side debounce: ignore if same card processed in last 5 seconds
        if (lastProcessedSwipes[card] && (now - lastProcessedSwipes[card] < 5000)) {
          if (swipeId) snapshot.ref.remove();
          return;
        }

        lastProcessedSwipes[card] = now;
        console.log(`Processing RTDB swipe from Arduino: ${card}`);
        
        try {
          const result = await processSwipe(card);
          
          // Single update for all RTDB paths
          const rtdbUpdates: any = {};
          const resultPayload = {
            ...result,
            card: swipeData.card,
            time: now,
            timestamp: admin.database.ServerValue.TIMESTAMP
          };

          rtdbUpdates[`card_status/${swipeData.card}`] = resultPayload;
          if ((result as any).memberName) {
            const memberId = (result as any).member_id || 'unknown';
            rtdbUpdates[`user_status/${memberId}`] = resultPayload;
          }
          const newResultKey = rtdb.ref('swipe_results').push().key;
          rtdbUpdates[`swipe_results/${newResultKey}`] = resultPayload;

          await rtdb.ref().update(rtdbUpdates);
          
          // Broadcast via SSE for instant UI update
          broadcastSwipe(resultPayload);
          
          // Background cleanup
          rtdb.ref('swipe_results').limitToFirst(1).once('value').then(snap => {
            if (snap.numChildren() > 50) snap.forEach(c => { c.ref.remove(); });
          });
          
        } catch (error: any) {
          console.error("Error processing RTDB swipe:", error);
        } finally {
          // Remove from queue immediately
          snapshot.ref.remove();
        }
      });
    } catch (e) {
      console.error("Could not setup RTDB listener. Ensure Firebase credentials are correct.", e);
    }
  };

  // Start the listener
  setupRTDBListener();
  initMembersCache();

  app.get("/api/attendance/recent-swipes", async (req, res) => {
    try {
      const since = parseInt(req.query.since as string) || 0;
      const rtdb = getRTDB();
      const snapshot = await rtdb.ref('swipe_results')
        .orderByChild('time')
        .startAt(since + 1)
        .limitToLast(10)
        .once('value');
      
      const results: any[] = [];
      snapshot.forEach((child) => {
        results.push({ id: child.key, ...child.val() });
      });
      
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/attendance/swipe", async (req, res) => {
    try {
      const { card } = req.body;
      if (!card) return res.status(400).json({ error: "Card ID required" });

      const result = await processSwipe(card);
      
      if (result.success) {
        res.status(result.status).json(result);
      } else {
        res.status(result.status).json({ error: result.error });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/alerts", async (req, res) => {
    try {
      const firestore = getFirestore();
      
      // Proactive check on every alert fetch (throttled by logic)
      const now = new Date();
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      
      const expiringMembers = Array.from(membersById.values()).filter(m => {
        if (!m.subscription_expiry) return false;
        const expiry = new Date(m.subscription_expiry);
        return expiry > now && expiry <= threeDaysFromNow;
      });

      for (const m of expiringMembers) {
        const expiryDate = new Date(m.subscription_expiry);
        // Check if alert already exists for this expiry to avoid spam
        const existingAlerts = await firestore.collection('alerts')
          .where('member_id', '==', m.id)
          .where('type', '==', 'subscription_warning')
          .limit(1)
          .get();
        
        if (existingAlerts.empty) {
          await firestore.collection('alerts').add({
            member_id: m.id,
            memberName: m.name,
            type: 'subscription_warning',
            message: `Abbonamento in scadenza il ${expiryDate.toLocaleDateString('it-IT')}`,
            timestamp: admin.firestore.Timestamp.now()
          });
        }
      }

      const snapshot = await firestore.collection('alerts')
        .orderBy('timestamp', 'desc')
        .limit(30)
        .get();
      
      const alerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(alerts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/members/:id", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { id } = req.params;
      
      const member = membersById.get(id);
      if (member && member.card) {
        membersCache.delete(member.card.toUpperCase());
      }
      membersById.delete(id);
      
      await firestore.collection('members').doc(id).delete();
      
      // Also delete attendance and alerts for this member
      const attendanceSnapshot = await firestore.collection('attendance').where('member_id', '==', id).get();
      const alertsSnapshot = await firestore.collection('alerts').where('member_id', '==', id).get();
      
      const batch = firestore.batch();
      attendanceSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      alertsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/members/:id/history", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { id } = req.params;
      const snapshot = await firestore.collection('attendance')
        .where('member_id', '==', id)
        .orderBy('check_in', 'desc')
        .limit(100)
        .get();
        
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        check_in: doc.data().check_in?.toDate().toISOString(),
        check_out: doc.data().check_out?.toDate().toISOString() || null
      }));
      
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/members/:id/reset", async (req, res) => {
    try {
      const { id } = req.params;
      const firestore = getFirestore();
      
      const member = membersById.get(id);
      if (member) {
        const last_renewal_date = admin.firestore.Timestamp.now();
        await firestore.collection('members').doc(id).update({
          last_renewal_date
        });

        member.weeklyCount = 0;
        member.lastCheckInToday = false;
        member.weeklyDays = [];
        member.last_renewal_date = last_renewal_date.toDate();
        
        // If the member is currently in the gym, check them out
        if (activeMembersSet.has(id)) {
          activeMembersSet.delete(id);
          
          // Close open attendance record in Firestore
          const openAttendance = await firestore.collection('attendance')
            .where('member_id', '==', id)
            .where('check_out', '==', null)
            .limit(1)
            .get();
            
          if (!openAttendance.empty) {
            const batch = firestore.batch();
            openAttendance.docs.forEach(doc => {
              batch.update(doc.ref, { check_out: admin.firestore.Timestamp.now() });
            });
            await batch.commit();
          }
        }
        
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Membro non trovato" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/attendance/reset-all", async (req, res) => {
    try {
      const firestore = getFirestore();
      const last_renewal_date = admin.firestore.Timestamp.now();
      
      // Reset in-memory state
      membersById.forEach(m => {
        m.weeklyCount = 0;
        m.lastCheckInToday = false;
        m.weeklyDays = [];
        m.last_renewal_date = last_renewal_date.toDate();
      });
      
      // Update all members in Firestore (Batch)
      const membersSnapshot = await firestore.collection('members').get();
      const batch = firestore.batch();
      membersSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, { last_renewal_date });
      });
      await batch.commit();
      
      // Clear active members
      activeMembersSet.clear();
      
      // Close all open attendance records in Firestore
      const openAttendances = await firestore.collection('attendance')
        .where('check_out', '==', null)
        .get();
        
      if (!openAttendances.empty) {
        const batch = firestore.batch();
        openAttendances.docs.forEach(doc => {
          batch.update(doc.ref, { check_out: admin.firestore.Timestamp.now() });
        });
        await batch.commit();
      }
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/members/:id/renew", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { id } = req.params;
      
      const memberDoc = await firestore.collection('members').doc(id).get();
      if (!memberDoc.exists) {
        return res.status(404).json({ error: "Membro non trovato" });
      }

      const currentData = memberDoc.data();
      const now = new Date();
      let startDate = now;

      // If the subscription is still active, extend from the current expiry
      if (currentData?.subscription_expiry) {
        const currentExpiry = new Date(currentData.subscription_expiry);
        if (currentExpiry > now) {
          startDate = currentExpiry;
        }
      }

      const newExpiry = new Date(startDate);
      newExpiry.setMonth(newExpiry.getMonth() + 1);
      
      const subscription_expiry = newExpiry.toISOString();
      const now_ts = admin.firestore.Timestamp.now();
      
      // Cache check for weekly entries
      const existing = membersById.get(id);
      let last_renewal_date = now_ts;

      // If they have entries this week, we set renewal date to start of week to preserve them
      if (existing && existing.weeklyCount > 0) {
        const weekStart = getStartOfWeek(new Date());
        last_renewal_date = admin.firestore.Timestamp.fromDate(weekStart);
      }
      
      await firestore.collection('members').doc(id).update({
        subscription_expiry,
        available_recoveries: 0,
        last_renewal_date
      });
      
      // Update cache
      if (existing) {
        existing.subscription_expiry = subscription_expiry;
        existing.available_recoveries = 0;
        existing.last_renewal_date = last_renewal_date.toDate();

        // Only reset weekly if no entries yet
        if (existing.weeklyCount === 0) {
          existing.weeklyCount = 0;
          existing.weeklyDays = [];
          existing.lastCheckInToday = false;
        }

        // If the member is currently in the gym, check them out
        if (activeMembersSet.has(id)) {
          activeMembersSet.delete(id);
          
          const openAttendance = await firestore.collection('attendance')
            .where('member_id', '==', id)
            .where('check_out', '==', null)
            .limit(1)
            .get();
            
          if (!openAttendance.empty) {
            const batchUpdate = firestore.batch();
            openAttendance.docs.forEach(doc => {
              batchUpdate.update(doc.ref, { check_out: admin.firestore.Timestamp.now() });
            });
            await batchUpdate.commit();
          }
        }

        // --- NEW: Remove subscription warning alerts on renewal ---
        const alertsSnapshot = await firestore.collection('alerts')
          .where('member_id', '==', id)
          .where('type', '==', 'subscription_warning')
          .get();
        
        if (!alertsSnapshot.empty) {
          const alertBatch = firestore.batch();
          alertsSnapshot.docs.forEach(doc => alertBatch.delete(doc.ref));
          await alertBatch.commit();
        }
      }
      
      res.json({ success: true, newExpiry: subscription_expiry });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/alerts/:id", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { id } = req.params;
      await firestore.collection('alerts').doc(id).delete();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/alerts/member/:memberId", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { memberId } = req.params;
      const snapshot = await firestore.collection('alerts').where('member_id', '==', memberId).get();
      const batch = firestore.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/attendance/history", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { date } = req.query;
      
      let query = firestore.collection('attendance').orderBy('check_in', 'desc');
      
      if (date) {
        const start = new Date(date as string);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date as string);
        end.setHours(23, 59, 59, 999);
        query = query.where('check_in', '>=', admin.firestore.Timestamp.fromDate(start))
                     .where('check_in', '<=', admin.firestore.Timestamp.fromDate(end));
      } else {
        // Default to today's entries if no date is specified
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        query = query.where('check_in', '>=', admin.firestore.Timestamp.fromDate(start))
                     .where('check_in', '<=', admin.firestore.Timestamp.fromDate(end));
      }
      
      const snapshot = await query.limit(100).get();
        
      const history = await Promise.all(snapshot.docs.map(async doc => {
        const data = doc.data();
        let memberName = 'Sconosciuto';
        if (data.member_id) {
          const cached = membersById.get(data.member_id);
          if (cached) {
            memberName = cached.name;
          } else {
            const memberDoc = await firestore.collection('members').doc(data.member_id).get();
            if (memberDoc.exists) memberName = memberDoc.data()?.name;
          }
        }
        return {
          id: doc.id,
          member_id: data.member_id,
          name: memberName,
          check_in: data.check_in?.toDate().toISOString(),
          check_out: data.check_out?.toDate().toISOString() || null
        };
      }));
      
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stats", async (req, res) => {
    try {
      const firestore = getFirestore();
      
      const membersSnapshot = await firestore.collection('members').count().get();
      const totalMembers = membersSnapshot.data().count;

      const activeSnapshot = await firestore.collection('attendance').where('check_out', '==', null).count().get();
      const activeNow = activeSnapshot.data().count;

      const todayStart = getStartOfDay();
      const todaySnapshot = await firestore.collection('attendance')
        .where('check_in', '>=', admin.firestore.Timestamp.fromDate(todayStart))
        .count()
        .get();
      const todayCount = todaySnapshot.data().count;

      res.json({ totalMembers, activeNow, todayCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/members/:id/reset-attendance", async (req, res) => {
    try {
      const firestore = getFirestore();
      const { id } = req.params;
      
      const snapshot = await firestore.collection('attendance').where('member_id', '==', id).get();
      const batch = firestore.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      
      // Update memory state
      const member = membersById.get(id);
      if (member) {
        member.weeklyCount = 0;
        member.lastCheckInToday = false;
      }
      activeMembersSet.delete(id);
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/attendance/reset-all", async (req, res) => {
    try {
      const firestore = getFirestore();
      
      const snapshot = await firestore.collection('attendance').get();
      const batch = firestore.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      
      // Update memory state
      activeMembersSet.clear();
      membersById.forEach(m => {
        m.weeklyCount = 0;
        m.lastCheckInToday = false;
      });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/attendance/daily", async (req, res) => {
    try {
      const firestore = getFirestore();
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      const snapshot = await firestore.collection('attendance')
        .where('check_in', '>=', admin.firestore.Timestamp.fromDate(thirtyDaysAgo))
        .get();

      const countsByDate: Record<string, number> = {};
      
      // Initialize last 30 days with 0
      for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        countsByDate[dateStr] = 0;
      }

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.check_in) {
          const dateStr = data.check_in.toDate().toISOString().split('T')[0];
          if (countsByDate[dateStr] !== undefined) {
            countsByDate[dateStr]++;
          }
        }
      });

      const result = Object.entries(countsByDate)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => b.date.localeCompare(a.date));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/validate-weekly", async (req, res) => {
    try {
      const firestore = getFirestore();
      const now = new Date();
      
      // Check if validation was already done this week
      const systemDoc = await firestore.collection('system').doc('status').get();
      const lastValidation = systemDoc.data()?.last_validation_week;
      const currentWeekStr = getStartOfWeek(now).toISOString();
      
      if (lastValidation === currentWeekStr) {
        return res.status(400).json({ error: "Validazione settimanale già eseguita per questa settimana." });
      }

      const isWeekend = [0, 6].includes(now.getDay());
      
      // Check if it's Saturday (6) or Sunday (0)
      if (!isWeekend) {
        return res.status(400).json({ error: "Questa operazione può essere eseguita solo nel weekend (Sabato o Domenica)." });
      }

      // Check if it's the last weekend of the month
      const nextWeekend = new Date(now);
      nextWeekend.setDate(now.getDate() + 7);
      const isLastWeekend = nextWeekend.getMonth() !== now.getMonth();

      const membersSnapshot = await firestore.collection('members').get();
      const batch = firestore.batch();
      
      for (const doc of membersSnapshot.docs) {
        const data = doc.data();
        const memberId = doc.id;
        const cachedMember = membersById.get(memberId);
        
        if (!cachedMember) continue;

        const weeklyFrequency = Number(data.weekly_frequency) || 0;
        const weeklyCount = cachedMember.weeklyCount || 0;
        const currentRecoveries = Number(data.available_recoveries) || 0;

        let newRecoveries = currentRecoveries;

        // 1. Add recoveries for missed entries this week
        if (weeklyCount < weeklyFrequency) {
          newRecoveries += (weeklyFrequency - weeklyCount);
        }

        // 2. If it's the last weekend, reset recoveries (cancel them)
        if (isLastWeekend) {
          newRecoveries = 0;
        }

        batch.update(doc.ref, { available_recoveries: newRecoveries });
        
        // Update cache
        cachedMember.available_recoveries = newRecoveries;
        cachedMember.weeklyCount = 0;
        cachedMember.weeklyDays = [];
        cachedMember.lastCheckInToday = false;
      }

      batch.set(firestore.collection('system').doc('status'), { 
        last_validation_week: currentWeekStr,
        last_validation_timestamp: admin.firestore.Timestamp.now()
      }, { merge: true });

      await batch.commit();
      res.json({ success: true, isLastWeekend });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
