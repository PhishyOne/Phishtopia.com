from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "share"
OUT.mkdir(parents=True, exist_ok=True)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

BG = "#06131B"
PANEL = "#0A1B24"
PANEL_2 = "#0D222C"
GRID = "#17343E"
TEXT = "#F8F5ED"
MUTED = "#AEC0C8"
ORANGE = "#D98A32"
ORANGE_DARK = "#9A5B20"

CARDS = {
    "home.png": {
        "accent": "#35D9E6",
        "tag": "TOOLS • EXPERIMENTS • PROJECTS",
        "title": "PHISHTOPIA",
        "description": "Home of the Improbable.",
        "kind": "home",
    },
    "youlist.png": {
        "accent": "#FF4FA3",
        "tag": "PHISHTOPIA PROJECT",
        "title": "YOULIST",
        "description": "Build a personal watchlist for movies and shows.",
        "kind": "youlist",
    },
    "echotrace.png": {
        "accent": "#5AA7FF",
        "tag": "EVE PLAYER INTELLIGENCE",
        "title": "ECHOTRACE",
        "description": "Explore public character signals and connections.",
        "kind": "echotrace",
    },
    "storecalc.png": {
        "accent": "#58E6A9",
        "tag": "COMMISSARY ORDER CALCULATOR",
        "title": "STORECALC ONLINE",
        "description": "Plan an order and calculate totals before it is placed.",
        "kind": "storecalc",
    },
    "archive.png": {
        "accent": "#F2B84B",
        "tag": "PRESERVED BUILDS",
        "title": "PROJECT ARCHIVE",
        "description": "Course work, early projects, and experiments.",
        "kind": "archive",
    },
    "contact.png": {
        "accent": "#61E6B8",
        "tag": "LET'S BUILD SOMETHING",
        "title": "CONTACT PHISHTOPIA",
        "description": "Questions, problem reports, feedback, and ideas.",
        "kind": "contact",
    },
    "privacy.png": {
        "accent": "#71DDE8",
        "tag": "NO FINE-PRINT AQUARIUM",
        "title": "PRIVACY AT PHISHTOPIA",
        "description": "Plain-English details about data and account deletion.",
        "kind": "privacy",
    },
}


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def blend(a, b, t):
    first = tuple(int(a[index:index + 2], 16) for index in (1, 3, 5))
    second = tuple(int(b[index:index + 2], 16) for index in (1, 3, 5))
    return tuple(round(first[index] * (1 - t) + second[index] * t) for index in range(3))


def draw_background(image, accent):
    pixels = image.load()
    for y in range(H):
        color = blend("#081820", "#041016", y / (H - 1))
        for x in range(W):
            pixels[x, y] = color

    draw = ImageDraw.Draw(image)
    for x in range(0, W, 60):
        draw.line((x, 0, x, H), fill=GRID, width=1)
    for y in range(0, H, 60):
        draw.line((0, y, W, y), fill=GRID, width=1)

    for offset in (0, 55, 110):
        draw.line((760 + offset, 0, 930 + offset, 170), fill=accent, width=2)
        draw.ellipse((924 + offset, 164, 936 + offset, 176), outline=accent, width=2)
        draw.line((20 + offset, 500, 150 + offset, 630), fill=accent, width=2)
        draw.ellipse((144 + offset, 494, 156 + offset, 506), outline=accent, width=2)


def draw_fish(draw, accent):
    draw.rounded_rectangle((52, 60, 338, 548), radius=28, fill=PANEL, outline=accent, width=4)
    draw.ellipse((83, 122, 307, 346), fill="#0B2630", outline=accent, width=4)
    draw.polygon([(108, 234), (148, 198), (148, 270)], fill=accent)
    draw.polygon(
        [(145, 234), (212, 174), (286, 234), (212, 294)],
        fill=ORANGE,
        outline="#F5B15A",
    )
    draw.ellipse((248, 205, 268, 225), fill=TEXT)
    draw.ellipse((254, 211, 263, 220), fill=BG)
    for y in (218, 234, 250):
        draw.line((190, y, 232, y), fill=ORANGE_DARK, width=5)

    draw.text((110, 375), "PHISHTOPIA", font=font(28, True), fill=TEXT)
    draw.text((110, 414), "phishtopia.com", font=font(20), fill=MUTED)
    draw.line((110, 456, 280, 456), fill=accent, width=3)
    draw.text((110, 473), "HOME OF THE", font=font(16, True), fill=MUTED)
    draw.text((110, 497), "IMPROBABLE", font=font(20, True), fill=accent)


def wrap_text(draw, text, max_width, text_font):
    lines = []
    current = ""
    for word in text.split():
        candidate = word if not current else f"{current} {word}"
        if draw.textbbox((0, 0), candidate, font=text_font)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_header(draw, specification):
    accent = specification["accent"]
    draw.rounded_rectangle((370, 60, 1148, 548), radius=28, fill=PANEL, outline="#24424D", width=2)
    tag_width = max(185, draw.textbbox((0, 0), specification["tag"], font=font(16, True))[2] + 34)
    draw.rounded_rectangle((405, 92, 405 + tag_width, 126), radius=16, fill=accent)
    draw.text((422, 101), specification["tag"], font=font(16, True), fill=BG)

    title_size = 56 if len(specification["title"]) <= 16 else 47
    draw.text((405, 155), specification["title"], font=font(title_size, True), fill=TEXT)
    line_y = 229 if title_size >= 50 else 220
    draw.line((405, line_y, 1085, line_y), fill=accent, width=5)

    description_font = font(27)
    y = line_y + 24
    for line in wrap_text(draw, specification["description"], 680, description_font)[:2]:
        draw.text((405, y), line, font=description_font, fill=MUTED)
        y += 37


def draw_home(draw, accent):
    for label, x in (("TOOLS", 405), ("PROJECTS", 585), ("EXPERIMENTS", 795)):
        draw.rounded_rectangle((x, 364, x + 155, 416), radius=18, outline=accent, width=3, fill=PANEL_2)
        draw.text((x + 18, 379), label, font=font(19, True), fill=TEXT)
    for x in (438, 620, 830, 1040):
        draw.ellipse((x, 462, x + 18, 480), fill=accent)
    draw.line((447, 471, 1049, 471), fill=accent, width=3)
    for x, height in ((470, 36), (610, 62), (760, 28), (900, 54), (1030, 35)):
        draw.line((x, 471, x, 471 - height), fill=accent, width=2)
        draw.ellipse((x - 6, 429 - height, x + 6, 441 - height), outline=accent, width=2)


def draw_youlist(draw, accent):
    for index, x in enumerate((405, 575, 745, 915)):
        draw.rounded_rectangle((x, 342, x + 145, 500), radius=14, fill="#102732", outline=accent, width=3)
        draw.rectangle((x + 14, 360, x + 131, 432), fill="#1D3642" if index % 2 == 0 else "#162E3A")
        draw.polygon([(x + 58, 377), (x + 58, 417), (x + 94, 397)], fill=accent)
        draw.line((x + 16, 452, x + 118, 452), fill=TEXT, width=4)
        draw.line((x + 16, 470, x + 94, 470), fill=MUTED, width=3)
        draw.ellipse((x + 112, 464, x + 126, 478), fill=accent)
    draw.rounded_rectangle((405, 515, 1060, 536), radius=10, fill=accent)


def draw_echotrace(draw, accent):
    center_x, center_y = 780, 432
    for radius in (45, 90, 135):
        draw.ellipse(
            (center_x - radius, center_y - radius, center_x + radius, center_y + radius),
            outline=accent,
            width=2,
        )
    draw.line((center_x - 150, center_y, center_x + 150, center_y), fill=accent, width=2)
    draw.line((center_x, center_y - 150, center_x, center_y + 120), fill=accent, width=2)
    draw.pieslice((center_x - 120, center_y - 120, center_x + 120, center_y + 120), 300, 345, fill="#163742", outline=accent)
    nodes = [(470, 390), (560, 475), (710, 365), (835, 455), (960, 365), (1060, 470)]
    for first, second in zip(nodes, nodes[1:]):
        draw.line((*first, *second), fill="#6E8D9A", width=3)
    for index, (x, y) in enumerate(nodes):
        radius = 10 if index not in (2, 3) else 14
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=accent, outline=TEXT, width=2)


def draw_storecalc(draw, accent):
    draw.rounded_rectangle((420, 344, 650, 520), radius=18, fill="#112B35", outline=accent, width=3)
    draw.rounded_rectangle((442, 363, 628, 405), radius=7, fill="#051016", outline="#385663", width=2)
    draw.text((530, 370), "$42.75", font=font(23, True), fill=accent, anchor="ma")
    for row in range(3):
        for column in range(4):
            x = 442 + column * 46
            y = 425 + row * 28
            draw.rounded_rectangle((x, y, x + 35, y + 20), radius=5, fill=accent if column == 3 else "#29444F")

    draw.rounded_rectangle((690, 344, 1080, 520), radius=18, fill="#0E2630", outline=accent, width=3)
    draw.text((720, 365), "ORDER PLAN", font=font(21, True), fill=TEXT)
    rows = (("Soap", "$3.25"), ("Coffee", "$8.40"), ("Snacks", "$12.10"), ("Balance", "$19.00"))
    for index, (name, amount) in enumerate(rows):
        y = 407 + index * 27
        draw.text((720, y), name, font=font(18), fill=MUTED)
        draw.text((1025, y), amount, font=font(18, True), fill=accent, anchor="ra")
        draw.line((720, y + 23, 1040, y + 23), fill="#24414C", width=1)


def draw_archive(draw, accent):
    folders = ((430, 392), (555, 365), (680, 338))
    fills = ("#102C36", "#133440", "#173B47")
    for index, ((x, y), fill) in enumerate(zip(folders, fills)):
        draw.rounded_rectangle((x, y, x + 260, y + 135), radius=14, fill=fill, outline=accent, width=3)
        draw.rounded_rectangle((x + 20, y - 18, x + 125, y + 12), radius=9, fill=accent)
        draw.text((x + 25, y + 35), f"BUILD {index + 1:02d}", font=font(21, True), fill=TEXT)
        draw.text((x + 25, y + 72), "preserved project", font=font(17), fill=MUTED)
    draw.line((430, 525, 1060, 525), fill=accent, width=3)
    for x in (470, 650, 830, 1010):
        draw.ellipse((x - 9, 516, x + 9, 534), fill=accent, outline=TEXT, width=2)


def draw_contact(draw, accent):
    draw.rounded_rectangle((430, 356, 760, 505), radius=20, fill="#102B34", outline=accent, width=4)
    draw.line((430, 366, 595, 465), fill=accent, width=4)
    draw.line((760, 366, 595, 465), fill=accent, width=4)
    draw.line((430, 495, 545, 417), fill="#45717C", width=3)
    draw.line((760, 495, 645, 417), fill="#45717C", width=3)
    draw.rounded_rectangle((820, 352, 1080, 414), radius=22, fill=accent)
    draw.text((850, 369), "IDEAS WELCOME", font=font(20, True), fill=BG)
    draw.polygon([(845, 414), (870, 414), (845, 438)], fill=accent)
    draw.rounded_rectangle((835, 450, 1080, 512), radius=22, fill="#15333D", outline=accent, width=3)
    draw.text((865, 467), "SEND A MESSAGE", font=font(19, True), fill=TEXT)


def draw_privacy(draw, accent):
    shield = [(535, 345), (660, 380), (645, 470), (598, 520), (550, 470)]
    draw.polygon(shield, fill="#12313B", outline=accent)
    draw.line((*shield[0], *shield[1], *shield[2], *shield[3], *shield[4], *shield[0]), fill=accent, width=4)
    draw.rounded_rectangle((572, 410, 628, 475), radius=10, fill=accent)
    draw.arc((583, 381, 617, 430), 180, 360, fill=accent, width=8)
    draw.ellipse((595, 432, 605, 442), fill=BG)
    draw.line((600, 442, 600, 456), fill=BG, width=4)
    for label, x, y in (
        ("WHAT WE COLLECT", 730, 365),
        ("WHY IT IS NEEDED", 730, 418),
        ("DELETE YOUR ACCOUNT", 730, 471),
    ):
        draw.ellipse((x, y + 6, x + 18, y + 24), fill=accent)
        draw.line((x + 5, y + 15, x + 9, y + 20), fill=BG, width=3)
        draw.line((x + 9, y + 20, x + 15, y + 10), fill=BG, width=3)
        draw.text((x + 34, y), label, font=font(21, True), fill=TEXT)


def render(file_name, specification):
    image = Image.new("RGB", (W, H), BG)
    draw_background(image, specification["accent"])
    draw = ImageDraw.Draw(image)
    draw_fish(draw, specification["accent"])
    draw_header(draw, specification)
    globals()[f"draw_{specification['kind']}"](draw, specification["accent"])
    draw.text((1128, 585), "PHISHTOPIA.COM", font=font(18, True), fill=specification["accent"], anchor="ra")
    draw.text((405, 585), "PAGE-SPECIFIC SOCIAL PREVIEW", font=font(16, True), fill="#6E8791")
    image.save(OUT / file_name, format="PNG", optimize=True, compress_level=9)


for name, card in CARDS.items():
    render(name, card)
