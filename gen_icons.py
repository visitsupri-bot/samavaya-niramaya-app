import struct, zlib, os

def make_png(size, color_rgb):
    """Create a minimal solid-color PNG of given size."""
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', c)

    r, g, b = color_rgb
    raw = b''
    for _ in range(size):
        row = b'\x00' + bytes([r, g, b] * size)
        raw += row

    compressed = zlib.compress(raw)

    # PNG signature: 8 bytes
    png = bytes([137, 80, 78, 71, 13, 10, 26, 10])
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

os.makedirs('icons', exist_ok=True)
forest = (30, 77, 43)  # #1e4d2b

for size in [192, 512]:
    with open(f'icons/icon-{size}.png', 'wb') as f:
        f.write(make_png(size, forest))
    print(f'Created icons/icon-{size}.png')

# Apple touch icon (180px)
with open('icons/apple-touch-icon.png', 'wb') as f:
    f.write(make_png(180, forest))
print('Created icons/apple-touch-icon.png')
