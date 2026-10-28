"""Regenerate the installer artwork (NSIS + WiX bitmaps) from icons/icon.png.

Run from src-tauri/:  python installer/make_images.py   (needs Pillow; fonts: Segoe UI, else DejaVu Sans)
Sizes are fixed by the installers: NSIS header 150x57, sidebar 164x314; WiX banner 493x58, dialog 493x312.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
ICON = Image.open(HERE.parent / "icons" / "icon.png").convert("RGBA")
BG, ACCENT, TEXT, MUTED = (10, 9, 7), (212, 160, 60), (240, 235, 224), (138, 128, 112)
FONTS = ["/mnt/c/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
FONTS_REG = ["/mnt/c/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/segoeui.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]


def font(size, bold=True):
    for f in FONTS if bold else FONTS_REG:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def icon(px):
    return ICON.resize((px, px), Image.LANCZOS)


def dark(w, h):
    """Near-black with a soft amber glow in the lower right, like the app."""
    im = Image.new("RGB", (w, h), BG)
    glow = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(glow)
    r = max(w, h)
    d.ellipse((w - r * 0.6, h - r * 0.6, w + r * 0.6, h + r * 0.6), fill=60)
    from PIL import ImageFilter
    glow = glow.filter(ImageFilter.GaussianBlur(r / 6))
    im.paste(Image.new("RGB", (w, h), ACCENT), (0, 0), glow)
    return im


def save(im, name):
    im.convert("RGB").save(HERE / name, "BMP")
    print("wrote", name, im.size)


# NSIS sidebar (Welcome / Finish pages): 164x314, art fills it.
im = dark(164, 314)
ic = icon(96)
im.paste(ic, ((164 - 96) // 2, 70), ic)
d = ImageDraw.Draw(im)
for text, y, f, c in [("Fahh Editor", 182, font(20), TEXT), ("by Stealth Keqing", 210, font(12, False), MUTED)]:
    w = d.textlength(text, font=f)
    d.text(((164 - w) / 2, y), text, font=f, fill=c)
d.rectangle((52, 238, 112, 240), fill=ACCENT)
save(im, "nsis-sidebar.bmp")

# NSIS header (top right of the inner pages): 150x57.
im = dark(150, 57)
ic = icon(40)
im.paste(ic, (8, 8), ic)
d = ImageDraw.Draw(im)
d.text((54, 11), "Fahh Editor", font=font(14), fill=TEXT)
d.text((54, 30), "Stealth Keqing", font=font(10, False), fill=ACCENT)
save(im, "nsis-header.bmp")

# WiX banner (top of every page; Windows draws black title text on its left): light left, art on the right.
im = Image.new("RGB", (493, 58), (255, 255, 255))
art = dark(130, 58)
ic = icon(38)
art.paste(ic, (130 - 38 - 10, 10), ic)
im.paste(art, (493 - 130, 0))
ImageDraw.Draw(im).rectangle((493 - 132, 0, 493 - 131, 57), fill=ACCENT)
save(im, "wix-banner.bmp")

# WiX dialog (Welcome / Finish): art in the left 164 px, white where Windows draws the text.
im = Image.new("RGB", (493, 312), (255, 255, 255))
side = dark(164, 312)
ic = icon(88)
side.paste(ic, ((164 - 88) // 2, 70), ic)
d = ImageDraw.Draw(side)
for text, y, f, c in [("Fahh Editor", 172, font(19), TEXT), ("by Stealth Keqing", 199, font(12, False), MUTED)]:
    w = d.textlength(text, font=f)
    d.text(((164 - w) / 2, y), text, font=f, fill=c)
im.paste(side, (0, 0))
save(im, "wix-dialog.bmp")
