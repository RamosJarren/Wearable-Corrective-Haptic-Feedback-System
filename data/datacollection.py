import asyncio
import json
import os
import re
import numpy as np
import matplotlib.pyplot as plt
from bleak import BleakScanner, BleakClient

DEVICE_NAME = "Hand_Glove"
CHAR_TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E" 

IDEAL_SIGNATURES = {
    "Open_Grip":   [0,   0,   0,   0,   0,   0,   0,   0,   0,   0],
    "Closed_Grip": [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    "Cylindrical": [60,  70,  70,  70,  60,  40,  80,  80,  70,  30],
    "Spherical":   [80,  80,  80,  80,  80,  90,  90,  90,  90,  90],
    "Hook_Grasp":  [10,  90,  90,  90,  90,  0,   95,  95,  80,  80]
}

raw_storage = {g: [] for g in IDEAL_SIGNATURES.keys()}
current_grasp = None
is_recording = False

def get_next_filename(base_name, extension):
    i = 1
    while os.path.exists(f"{base_name}_{i:02d}.{extension}"):
        i += 1
    return f"{base_name}_{i:02d}.{extension}"

def notification_handler(sender, data):
    global is_recording, current_grasp
    if not is_recording: return
    try:
        vals = [float(x) for x in data.decode("utf-8").strip().split(",")]
        if len(vals) >= 10:
            raw_storage[current_grasp].append(vals[:10])
    except: pass

def get_virtual_centroid(grasp_name, raw_samples):
    if not raw_samples: 
        return [float(x) for x in IDEAL_SIGNATURES[grasp_name]], [1.0] * 10
    
    samples_np = np.array(raw_samples)
    avg_real = np.mean(samples_np, axis=0)
    ideal = np.array(IDEAL_SIGNATURES[grasp_name])
    
    final_output = []
    weights = []
    
    for i in range(10):
        span = float(np.max(samples_np[:, i]) - np.min(samples_np[:, i]))
        if span < 5.0:
            final_output.append(float(ideal[i]))
            weights.append(0.0)
        else:
            val = float(avg_real[i])
            if grasp_name == "Open_Grip" and val > 50:
                val = 100.0 - val
            final_output.append(round(val, 2))
            weights.append(1.0)
    return final_output, weights

async def run():
    global current_grasp, is_recording
    print("Searching for Glove...")
    device = await BleakScanner.find_device_by_name(DEVICE_NAME)
    if not device: 
        print("Glove not found.")
        return

    async with BleakClient(device) as client:
        await client.start_notify(CHAR_TX_UUID, notification_handler)
        
        for g in IDEAL_SIGNATURES.keys():
            input(f"\n[PHASE] Prepare {g}. Press Enter to record...")
            current_grasp = g
            is_recording = True
            await asyncio.sleep(4)
            is_recording = False
            print(f"Captured {len(raw_storage[g])} samples.")

        processed_centroids = {}
        global_weights = []
        
        for g in IDEAL_SIGNATURES.keys():
            centroid, weights = get_virtual_centroid(g, raw_storage[g])
            processed_centroids[g] = centroid
            global_weights = weights 
            
        save_data = {
            "weights": [float(w) for w in global_weights], 
            "centroids": {k: [float(x) for x in v] for k, v in processed_centroids.items()}
        }

        json_file = get_next_filename("centroids", "json")
        png_file = get_next_filename("knn_plot", "png")

        with open(json_file, "w") as f:
            json.dump(save_data, f, indent=2)

        plt.figure(figsize=(10,6))
        for g, v in processed_centroids.items():
            plt.scatter(np.mean(v[:5]), np.mean(v[5:]), label=g, s=200)
            plt.text(np.mean(v[:5])+1, np.mean(v[5:]), g)
        
        plt.title("Grasp Centroid")
        plt.xlabel("Finger Flexion (%)"); plt.ylabel("Pressure (%)")
        plt.xlim(-5, 105); plt.ylim(-5, 105); plt.grid(True)
        plt.legend()
        plt.savefig(png_file)
        
        print(f"\nSaved JSON: {json_file}")
        print(f"Saved Plot: {png_file}")

if __name__ == "__main__":
    asyncio.run(run())