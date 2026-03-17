/*
 * Gym Attendance System - ESP32 NFC Reader
 * Optimized for speed, duplicate prevention, and connection resilience.
 * 
 * Required Libraries:
 * - MFRC522 (by GithubCommunity)
 * - Firebase ESP Client (by Mobizt)
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <MFRC522.h>
#include <SPI.h>

// --- CONFIGURATION ---
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define FIREBASE_HOST "YOUR_PROJECT_ID.europe-west1.firebasedatabase.app"
#define FIREBASE_AUTH "YOUR_DATABASE_SECRET_OR_TOKEN"

// Pins for MFRC522
#define SS_PIN 5
#define RST_PIN 22

// Feedback Pins (Optional)
#define BUZZER_PIN 13
#define LED_GREEN 12
#define LED_RED 14

// --- GLOBALS ---
MFRC522 mfrc522(SS_PIN, RST_PIN);
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

String lastCardID = "";
unsigned long lastSwipeTime = 0;
const unsigned long SWIPE_COOLDOWN = 5000; // 5 seconds cooldown for the same card

void setup() {
  Serial.begin(115200);
  SPI.begin();
  mfrc522.PCD_Init();

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);

  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to WiFi");

  // Firebase Config
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  Serial.println("System Ready. Scan a card...");
  beep(100); // Ready signal
}

void loop() {
  // 1. Check for new card
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return;
  }

  // 2. Get Card ID
  String currentCardID = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    currentCardID += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    currentCardID += String(mfrc522.uid.uidByte[i], HEX);
  }
  currentCardID.toUpperCase();

  // 3. Prevent Duplicates (Cooldown)
  unsigned long currentTime = millis();
  if (currentCardID == lastCardID && (currentTime - lastSwipeTime < SWIPE_COOLDOWN)) {
    Serial.println("Duplicate swipe ignored: " + currentCardID);
    mfrc522.PICC_HaltA();
    return;
  }

  Serial.println("Card Detected: " + currentCardID);
  lastCardID = currentCardID;
  lastSwipeTime = currentTime;

  // 4. Send to Firebase
  if (Firebase.ready()) {
    FirebaseJson json;
    json.add("card", currentCardID);
    json.add("time", currentTime);

    // Push to /swipes queue
    if (Firebase.RTDB.pushJSON(&fbdo, "/swipes", &json)) {
      String pushID = fbdo.pushName();
      Serial.println("Sent to Firebase. ID: " + pushID);
      
      // Fast feedback: Blink Blue/Yellow while waiting for server? 
      // Or just wait for the result in card_status
      waitForResult(currentCardID);
    } else {
      Serial.println("Firebase Error: " + fbdo.errorReason());
      errorFeedback();
    }
  } else {
    Serial.println("Firebase not ready");
    errorFeedback();
  }

  mfrc522.PICC_HaltA();
}

void waitForResult(String cardID) {
  unsigned long startWait = millis();
  String path = "/card_status/" + cardID;
  
  Serial.println("Waiting for server result...");
  
  // Wait up to 3 seconds for the server to process
  while (millis() - startWait < 3000) {
    if (Firebase.RTDB.getJSON(&fbdo, path)) {
      if (fbdo.dataType() == "json") {
        FirebaseJson &json = fbdo.jsonObject();
        FirebaseJsonData result;
        
        json.get(result, "success");
        bool success = result.boolValue;
        
        json.get(result, "action");
        String action = result.stringValue;

        if (success) {
          if (action == "checkin") successFeedback();
          else if (action == "already_in") warningFeedback();
          return;
        } else {
          errorFeedback();
          return;
        }
      }
    }
    delay(50); // Faster polling (50ms)
  }
  Serial.println("Timeout waiting for result");
}

void beep(int duration) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(duration);
  digitalWrite(BUZZER_PIN, LOW);
}

void successFeedback() {
  digitalWrite(LED_GREEN, HIGH);
  beep(100);
  delay(100);
  beep(100);
  delay(500);
  digitalWrite(LED_GREEN, LOW);
}

void warningFeedback() {
  digitalWrite(LED_RED, HIGH);
  digitalWrite(LED_GREEN, HIGH); // Yellow-ish
  beep(300);
  delay(500);
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, LOW);
}

void errorFeedback() {
  digitalWrite(LED_RED, HIGH);
  beep(500);
  delay(500);
  digitalWrite(LED_RED, LOW);
}
