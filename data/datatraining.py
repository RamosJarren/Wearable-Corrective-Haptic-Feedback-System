import json
import glob
import numpy as np
import matplotlib.pyplot as plt

# 1. Configuration
# List your grasp types in the order you want them processed
GRASP_TYPES = ["Open_Grip", "Closed_Grip", "Cylindrical", "Spherical", "Hook_Grasp"]

# Define fixed colors for consistency in your thesis
COLORS = {
    "Open_Grip": "#3498db",   # Blue
    "Closed_Grip": "#e74c3c", # Red
    "Cylindrical": "#2ecc71", # Green
    "Spherical": "#f1c40f",   # Yellow
    "Hook_Grasp": "#9b59b6"   # Purple
}

def run_global_processing():
    # Structures to hold data
    combined_library = {g: [] for g in GRASP_TYPES}
    plot_data = {g: {"flex": [], "pressure": []} for g in GRASP_TYPES}
    
    # 2. Find and read all session files (centroids_01.json to centroids_10.json)
    files = sorted(glob.glob("centroids_*.json"))
    
    if not files:
        print("Error: No files matching 'centroids_*.json' were found.")
        return
        
    print(f"Found {len(files)} session files. Starting consolidation...")
    
    for file_path in files:
        with open(file_path, 'r') as f:
            try:
                data = json.load(f)
                # Check if 'centroids' key exists, otherwise use top-level
                centroids = data.get("centroids", data)
                
                for grasp in GRASP_TYPES:
                    if grasp in centroids:
                        values = centroids[grasp]
                        # Store raw values for the JSON library
                        combined_library[grasp].append(values)
                        
                        # Calculate physical averages for the plot
                        # (Assumes first 5 are Flex, last 5 are FSR)
                        avg_flex = np.mean(values[:5])
                        avg_pressure = np.mean(values[5:])
                        plot_data[grasp]["flex"].append(avg_flex)
                        plot_data[grasp]["pressure"].append(avg_pressure)
            except Exception as e:
                print(f"Error skipping {file_path}: {e}")

    # 3. Save the consolidated JSON library
    output_json = "global_centroid_library.json"
    with open(output_json, "w") as f:
        json.dump(combined_library, f, indent=2)
    print(f"Successfully saved consolidated data to: {output_json}")

    # 4. Generate the Physical Sensor Map
    print("Generating visual plot...")
    plt.figure(figsize=(10, 7))
    
    for grasp in GRASP_TYPES:
        if plot_data[grasp]["flex"]:
            plt.scatter(
                plot_data[grasp]["flex"], 
                plot_data[grasp]["pressure"], 
                label=grasp, 
                color=COLORS[grasp], 
                s=100, 
                alpha=0.7, 
                edgecolors='black',
                linewidth=0.5
            )
            
            # Add a text label near the center of each cluster
            cx = np.mean(plot_data[grasp]["flex"])
            cy = np.mean(plot_data[grasp]["pressure"])
            plt.text(cx, cy + 3, grasp, fontsize=9, fontweight='bold', ha='center')

    # Formatting the Plot
    plt.title("Global Grasp Distribution: Flexion vs. Pressure", fontsize=14, fontweight='bold')
    plt.xlabel("Average Finger Flexion (0 - 100%)", fontsize=11)
    plt.ylabel("Average Tip Pressure (0 - 100%)", fontsize=11)
    
    # Set limits to show the full physical range
    plt.xlim(-5, 105)
    plt.ylim(-5, 105)
    
    plt.grid(True, linestyle='--', alpha=0.6)
    plt.legend(title="Grasp Types", loc='upper left', bbox_to_anchor=(1, 1))
    plt.tight_layout()
    
    output_png = "global_sensor_map.png"
    plt.savefig(output_png, dpi=300)
    print(f"Successfully saved plot to: {output_png}")
    plt.show()

if __name__ == "__main__":
    run_global_processing()