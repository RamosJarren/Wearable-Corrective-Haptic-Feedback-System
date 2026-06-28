#include <MPU9250_WE.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define MPU9250_ADDR 0x68
const int I2C_SDA = 21;
const int I2C_SCL = 22;
MPU9250_WE imu = MPU9250_WE(MPU9250_ADDR);

const int PIN_FSR[5]   = {33, 35, 39, 14, 2 };
const int PIN_FLEX[5]  = {32, 34, 36, 13, 15};
const int PIN_MOTOR[5] = {26, 27, 25, 18, 19};

const int PWM_FREQ = 1000;
const int PWM_RES = 8;

const int CALIBRATION_MS = 5000;
const float EMA_ALPHA = 0.15f;
const int MEDIAN_WINDOW = 3;
const float BILATERAL_SPATIAL_SIGMA = 200.0f;
const float BILATERAL_RANGE_SIGMA = 0.05f;

#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

BLEServer *pServer = NULL;
BLECharacteristic * pTxCharacteristic;
bool deviceConnected = false;
bool oldDeviceConnected = false;
bool triggerCalibration = false;

struct SensorRange {
  float smoothMin = 2047.0f;
  float smoothMax = 2047.0f;
};

struct MedianBuffer {
  int values[MEDIAN_WINDOW];
  int index = 0;
   void addValue(int val) {
    values[index] = val;
    index = (index + 1) % MEDIAN_WINDOW;
  }
   int getMedian() {
    int sorted[MEDIAN_WINDOW];
    for(int i = 0; i < MEDIAN_WINDOW; i++) sorted[i] = values[i];
    for(int i = 0; i < MEDIAN_WINDOW - 1; i++) {
      for(int j = i + 1; j < MEDIAN_WINDOW; j++) {
        if(sorted[i] > sorted[j]) {
          int temp = sorted[i];
          sorted[i] = sorted[j];
          sorted[j] = temp;
        }
      }
    }
    return sorted[MEDIAN_WINDOW / 2];
  }
};

struct BilateralBuffer {
  static const int BUFFER_SIZE = 5;
  float values[BUFFER_SIZE];
  int index = 0;
   void addValue(float val) {
    values[index] = val;
    index = (index + 1) % BUFFER_SIZE;
  }
   float bilateralFilter(float centerValue) {
    float weightSum = 0.0f;
    float valueSum = 0.0f;
    for(int i = 0; i < BUFFER_SIZE; i++) {
      float pixelDiff = abs(values[i] - centerValue);
      if(pixelDiff > BILATERAL_SPATIAL_SIGMA) continue;
      float weight = exp(-(pixelDiff * pixelDiff) / (2.0f * BILATERAL_RANGE_SIGMA * BILATERAL_RANGE_SIGMA));
      weightSum += weight;
      valueSum += values[i] * weight;
    }
    return weightSum > 0 ? valueSum / weightSum : centerValue;
  }
};

void runCalibration();

void processCommand(String cmd) {
  cmd.trim();
  if (cmd.startsWith("HAPTIC:")) {
    digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
    int firstColon = cmd.indexOf(':');
    int secondColon = cmd.indexOf(':', firstColon + 1);
 
    if (firstColon > 0 && secondColon > 0) {
      int finger = cmd.substring(firstColon + 1, secondColon).toInt();
      int pwm = cmd.substring(secondColon + 1).toInt();
   
      if (finger >= 0 && finger < 5) {
        ledcWrite(PIN_MOTOR[finger], constrain(pwm, 0, 255));
      }
    }
  } else if (cmd == "CALIBRATE") {
    triggerCalibration = true;
  } else if (cmd == "REBOOT") {
    ESP.restart();
  }
}

float baseAccX = 0, baseAccY = 0, baseAccZ = 0;
float fsrEma[5] = {0,0,0,0,0};
float flexEma[5] = {0,0,0,0,0};
SensorRange fsrRanges[5];
SensorRange flexRanges[5];
MedianBuffer fsrMedian[5];
MedianBuffer flexMedian[5];
BilateralBuffer fsrBilateral[5];
BilateralBuffer flexBilateral[5];

class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
  };
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
  }
};

class MyCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String rxValue = pCharacteristic->getValue();
    if (rxValue.length() > 0) {
      processCommand(rxValue);
    }
  }
};

void vibrateAll(int ms) {
  for (int i = 0; i < 5; i++) ledcWrite(PIN_MOTOR[i], 200);
  delay(ms);
  for (int i = 0; i < 5; i++) ledcWrite(PIN_MOTOR[i], 0);
}

float applyEMA(float currentValue, float& emaState, float alpha) {
  emaState = (alpha * currentValue) + ((1.0f - alpha) * emaState);
  return emaState;
}

int applyMedianFilter(int rawValue, MedianBuffer& buffer) {
  if(rawValue >= 4095) return buffer.getMedian();
  buffer.addValue(rawValue);
  return buffer.getMedian();
}

float applyBilateralFilter(float value, BilateralBuffer& buffer) {
  buffer.addValue(value);
  return buffer.bilateralFilter(value);
}

int readStabilizedAnalog(int pin) {
  analogRead(pin);
  delayMicroseconds(50);
  long sum = 0;
  for(int i = 0; i < 10; i++) { sum += analogRead(pin); }
  return sum / 10;
}

float mapToScale(float val, SensorRange& range) {
  float denom = range.smoothMax - range.smoothMin;
  if (abs(denom) < 1.0f) denom = denom >= 0 ? 1.0f : -1.0f;
  float mapped = ((val - range.smoothMin) / denom) * 100.0f;
  return constrain(mapped, 0.0f, 100.0f);
}

void setup() {
  Serial.begin(115200);
  Wire.begin(I2C_SDA, I2C_SCL);
  pinMode(LED_BUILTIN, OUTPUT);

  for (int i = 0; i < 5; i++) {
    ledcAttach(PIN_MOTOR[i], PWM_FREQ, PWM_RES);
    ledcWrite(PIN_MOTOR[i], 0);
  }
  if(!imu.init()) {
    Serial.println(">>> Initialization Failed!");
  }
  imu.autoOffsets();

  BLEDevice::init("Hand_Glove");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  BLEService *pService = pServer->createService(SERVICE_UUID);

  pTxCharacteristic = pService->createCharacteristic(CHARACTERISTIC_UUID_TX, BLECharacteristic::PROPERTY_NOTIFY);
  pTxCharacteristic->addDescriptor(new BLE2902());
  BLECharacteristic * pRxCharacteristic = pService->createCharacteristic(CHARACTERISTIC_UUID_RX, BLECharacteristic::PROPERTY_WRITE);
  pRxCharacteristic->setCallbacks(new MyCallbacks());

  pService->start();
  pServer->getAdvertising()->start();
  Serial.println(">>> BLE Waiting for connection...");

  xyzFloat startAcc = imu.getGValues();
  baseAccX = startAcc.x;
  baseAccY = startAcc.y;
  baseAccZ = startAcc.z;

  runCalibration();
}

void runCalibration() {
  Serial.println(">>> STARTING CALIBRATION...");
 
  if (deviceConnected) {
     pTxCharacteristic->setValue("CALIB_START\n");
     pTxCharacteristic->notify();
     delay(50);
  }

  Serial.println(">>> PHASE 1: OPEN - Hold position...");
  if (deviceConnected) {
     pTxCharacteristic->setValue("PHASE_START:OPEN\n");
     pTxCharacteristic->notify();
  }
  
  vibrateAll(1000); 
  delay(1000);

  long openSums[10] = {0};
  int openSamples = 0;
  unsigned long startTime = millis();

  while (millis() - startTime < CALIBRATION_MS) {
    for (int i = 0; i < 5; i++) {
      openSums[i] += readStabilizedAnalog(PIN_FLEX[i]);
      openSums[i + 5] += readStabilizedAnalog(PIN_FSR[i]);
    }
    openSamples++;
    delay(20);
  }

  for (int i = 0; i < 5; i++) {
    flexRanges[i].smoothMin = (float)openSums[i] / openSamples;
    fsrRanges[i].smoothMin = (float)openSums[i + 5] / openSamples;
  }

  vibrateAll(200); delay(150);
  vibrateAll(200); delay(1000);

  Serial.println(">>> PHASE 2: CLOSED - Hold position...");
  if (deviceConnected) {
     pTxCharacteristic->setValue("PHASE_START:CLOSED\n");
     pTxCharacteristic->notify();
  }

  long closedSums[10] = {0};
  int closedSamples = 0;
  startTime = millis();

  while (millis() - startTime < CALIBRATION_MS) {
    for (int i = 0; i < 5; i++) {
      closedSums[i] += readStabilizedAnalog(PIN_FLEX[i]);
      closedSums[i + 5] += readStabilizedAnalog(PIN_FSR[i]);
    }
    closedSamples++;
    delay(20);
  }

  for (int i = 0; i < 5; i++) {
    flexRanges[i].smoothMax = (float)closedSums[i] / closedSamples;
    fsrRanges[i].smoothMax = (float)closedSums[i + 5] / closedSamples;
  }

  vibrateAll(1000); 

  if (deviceConnected) {
    pTxCharacteristic->setValue("CALIB_END\n");
    pTxCharacteristic->notify();
  }

  for(int i = 0; i < 5; i++) {
    fsrEma[i] = fsrRanges[i].smoothMin;
    flexEma[i] = flexRanges[i].smoothMin;
  }

  Serial.println(">>> CALIBRATION COMPLETE");
}

void handleSerialCommands() {
  while(Serial.available()) {
    String command = Serial.readStringUntil('\n');
    processCommand(command);
  }
}

void loop() {
  if (triggerCalibration) {
    triggerCalibration = false;
    runCalibration();
  }
  
  handleSerialCommands();
  xyzFloat acc = imu.getGValues();
  float fsrOut[5];
  float flexOut[5];

  for(int i = 0; i < 5; i++) {
    int sRaw = applyMedianFilter(readStabilizedAnalog(PIN_FSR[i]), fsrMedian[i]);
    int fRaw = applyMedianFilter(readStabilizedAnalog(PIN_FLEX[i]), flexMedian[i]);
    float sFiltered = applyBilateralFilter(applyEMA(sRaw, fsrEma[i], EMA_ALPHA), fsrBilateral[i]);
    float fFiltered = applyBilateralFilter(applyEMA(fRaw, flexEma[i], EMA_ALPHA), flexBilateral[i]);
    fsrOut[i]  = mapToScale(sFiltered, fsrRanges[i]);
    flexOut[i] = mapToScale(fFiltered, flexRanges[i]);
  }
 
  char dataPacket[128];
  snprintf(dataPacket, sizeof(dataPacket),
          "%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.2f,%.2f,%.2f\n",
          flexOut[0], flexOut[1], flexOut[2], flexOut[3], flexOut[4],
          fsrOut[0], fsrOut[1], fsrOut[2], fsrOut[3], fsrOut[4],
          acc.x - baseAccX, acc.y - baseAccY, acc.z - baseAccZ);

  Serial.print(dataPacket);

  if (deviceConnected) {
    pTxCharacteristic->setValue(dataPacket);
    pTxCharacteristic->notify();
  }
  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising();
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  delay(10);
}
