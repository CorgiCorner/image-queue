# sheet.py <framesdir> <out.png> <start> <count> <every> <cols> [x0 y0 x1 y1] [scale]
import sys, os
from PIL import Image, ImageDraw
d, out, start, count, every, cols = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
crop = tuple(map(int, sys.argv[7:11])) if len(sys.argv) > 10 else None
scale = float(sys.argv[11]) if len(sys.argv) > 11 else (0.33 if not crop else 1.0)
ims = []
for i in range(count):
    n = start + i * every
    p = os.path.join(d, f'{n:05d}.png')
    if not os.path.exists(p): break
    im = Image.open(p).convert('RGB')
    if crop: im = im.crop(crop)
    im = im.resize((int(im.width * scale), int(im.height * scale)))
    ImageDraw.Draw(im).rectangle([0, 0, 44, 16], fill='black'); ImageDraw.Draw(im).text((3, 2), str(n), fill='yellow')
    ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), 'white')
for i, im in enumerate(ims): sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
