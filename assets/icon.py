# Run this to regenerate the icon with proper colors
# Requires: pip install pillow
from PIL import Image, ImageDraw, ImageFilter
import math

size = 1024
img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background circle
draw.ellipse([20, 20, size-20, size-20], fill=(80, 40, 200, 255))

# Lightning bolt
pts = [(440,120),(560,120),(460,490),(600,490),(360,920),(440,560),(300,560)]
draw.polygon(pts, fill=(255, 255, 255, 240))

img = img.filter(ImageFilter.SMOOTH)
img.save("icon.png")
print("Done")
