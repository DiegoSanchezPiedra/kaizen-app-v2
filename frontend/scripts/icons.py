# Genera public/icons/ y public/apple-touch-icon.png desde src/assets/logo.png (medidas del tablero «Iconos y bienvenida»).
# Uso: python3 scripts/icons.py (desde frontend/).
import base64, io
from PIL import Image

NIGHT = (5, 10, 46, 255)  # #050A2E
logo = Image.open('src/assets/logo.png').convert('RGBA')


def on_night(size, width):
    # Fondo opaco a sangre y el logo centrado a `width` del lado.
    img = Image.new('RGBA', (size, size), NIGHT)
    w = round(size * width)
    l = logo.resize((w, round(w * logo.height / logo.width)), Image.LANCZOS)
    img.alpha_composite(l, ((size - l.width) // 2, (size - l.height) // 2))
    return img


on_night(192, 0.76).save('public/icons/icon-192.png')
on_night(512, 0.76).save('public/icons/icon-512.png')
on_night(512, 0.68).save('public/icons/maskable-512.png')  # cabe en la zona segura (80 %)
on_night(180, 0.78).convert('RGB').save('public/apple-touch-icon.png')

# shortcut: monocromo y badge salen de la silueta del PNG (el contorno se empasta a 24 px); cambiar por el SVG del logo «KZ» macizo cuando exista.
white = Image.new('RGBA', logo.size, (255, 255, 255, 255))
white.putalpha(logo.getchannel('A'))


def silhouette(size, width):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    w = round(size * width)
    s = white.resize((w, round(w * logo.height / logo.width)), Image.LANCZOS)
    img.alpha_composite(s, ((size - s.width) // 2, (size - s.height) // 2))
    return img


silhouette(96, 0.92).save('public/icons/badge-96.png')
buf = io.BytesIO()
silhouette(512, 0.68).save(buf, 'PNG', optimize=True)
data = base64.b64encode(buf.getvalue()).decode()
open('public/icons/monochrome.svg', 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
    '<!-- shortcut: silueta del PNG incrustada; cambiar por el logo «KZ» macizo en vectores cuando exista. -->'
    f'<image width="512" height="512" href="data:image/png;base64,{data}"/></svg>\n'
)
