import base64
import os

data_dir = r"c:\Users\seafi\Downloads\TimberCal-main\TimberCal-main\data"
png_path = os.path.join(data_dir, "slope_overlay.png")

with open(png_path, "rb") as f:
    b64 = base64.b64encode(f.read()).decode("utf-8")

js_path = os.path.join(data_dir, "slope_data.js")
with open(js_path, "w", encoding="utf-8") as f:
    f.write(f'window.slopeOverlayData = "data:image/png;base64,{b64}";')

print("slope_data.js generated successfully!")
