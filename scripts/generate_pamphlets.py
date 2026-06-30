#!/usr/bin/env python3
"""Generate VillageServer missionary pamphlets and route handouts."""

from pathlib import Path
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
WEB = ROOT / "landing" / "downloads"
LOGO = ROOT / "landing" / "img" / "villageserver-initiative-logo.webp"

FOREST = HexColor("#123E31")
FOREST_DARK = HexColor("#0B2E25")
LIME = HexColor("#D9DF7B")
LEAF = HexColor("#5F7F43")
SAND = HexColor("#F2EEE3")
PAPER = HexColor("#FBFAF5")
INK = HexColor("#18221D")
MUTED = HexColor("#5E685F")
LINE = HexColor("#D9DDD4")
BLUE = HexColor("#173E4C")
W, H = letter


def wrap(text, font, size, width):
    words = text.split()
    lines, current = [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def text_block(c, text, x, y, width, *, font="Helvetica", size=10, color=INK,
               leading=14, max_lines=None):
    lines = wrap(text, font, size, width)
    if max_lines:
        lines = lines[:max_lines]
    c.setFont(font, size)
    c.setFillColor(color)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def footer(c, page_label):
    c.setStrokeColor(LINE)
    c.line(42, 35, W - 42, 35)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.5)
    c.drawString(42, 21, "VillageServer Initiative - villageserver.org")
    c.drawRightString(W - 42, 21, page_label)


_LOGO_READER = None


def logo_reader():
    # The source emblem is 1254x1254 (~2 MB); it only ever renders at ~40pt.
    # Downscale once and reuse so the PDFs stay small for low-bandwidth users.
    global _LOGO_READER
    if _LOGO_READER is None and LOGO.exists():
        im = Image.open(str(LOGO)).convert("RGBA")
        im.thumbnail((256, 256), Image.LANCZOS)
        _LOGO_READER = ImageReader(im)
    return _LOGO_READER


def logo(c, x, y, width=156, on_dark=False):
    # The emblem is a square, transparent PNG; reportlab fits it to a 40pt box.
    # On dark headers, sit it on a light rounded chip so every part stays visible.
    if on_dark:
        c.setFillColor(white)
        c.roundRect(x - 7, y - 7, 54, 54, 11, fill=1, stroke=0)
    reader = logo_reader()
    if reader is not None:
        c.drawImage(reader, x, y, width=40, height=40, preserveAspectRatio=True, mask="auto", anchor="sw")


def pill(c, text, x, y, fill=LEAF, text_color=white):
    size = 7.5
    pad = 9
    width = stringWidth(text.upper(), "Helvetica-Bold", size) + pad * 2
    c.setFillColor(fill)
    c.roundRect(x, y - 3, width, 18, 9, fill=1, stroke=0)
    c.setFillColor(text_color)
    c.setFont("Helvetica-Bold", size)
    c.drawString(x + pad, y + 2, text.upper())
    return width


def numbered_step(c, number, title, body, x, y, width):
    c.setFillColor(FOREST)
    c.circle(x + 14, y - 4, 14, fill=1, stroke=0)
    c.setFillColor(LIME)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(x + 14, y - 7, f"{number:02d}")
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(x + 38, y + 1, title)
    end_y = text_block(c, body, x + 38, y - 14, width - 38, size=8.5, color=MUTED, leading=11)
    return min(y - 48, end_y - 9)


def save_canvas(c, filename):
    c.save()
    source = OUT / filename
    target = WEB / filename
    target.write_bytes(source.read_bytes())


def draw_route(filename, title, method, use_when, steps, checks, source_label, source_url, note):
    path = OUT / filename
    c = Canvas(str(path), pagesize=letter)
    c.setTitle(f"VillageServer - {title}")
    c.setAuthor("VillageServer Initiative")
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(FOREST)
    c.rect(0, H - 190, W, 190, fill=1, stroke=0)
    logo(c, 42, H - 58, 145, on_dark=True)
    pill(c, "Offline transfer field guide", 42, H - 91, fill=LEAF)
    c.setFillColor(white)
    c.setFont("Times-Bold", 28)
    title_y = H - 125
    for line in wrap(title, "Times-Bold", 28, 360):
        c.drawString(42, title_y, line)
        title_y -= 30
    c.setFillColor(LIME)
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(W - 42, H - 117, method)
    c.setFillColor(white)
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 42, H - 135, "No cloud upload required")

    c.setFillColor(SAND)
    c.roundRect(42, H - 253, W - 84, 43, 10, fill=1, stroke=0)
    c.setFillColor(LEAF)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(55, H - 228, "USE THIS WHEN")
    text_block(c, use_when, 140, H - 229, W - 195, size=8.5, color=INK, leading=11, max_lines=2)

    c.setFillColor(INK)
    c.setFont("Times-Bold", 18)
    c.drawString(42, H - 285, "Follow these steps")
    y = H - 315
    left_width = 338
    for index, (step_title, body) in enumerate(steps, 1):
        y = numbered_step(c, index, step_title, body, 42, y, left_width)

    side_x = 414
    side_w = W - side_x - 42
    c.setFillColor(FOREST_DARK)
    c.roundRect(side_x, H - 493, side_w, 208, 12, fill=1, stroke=0)
    c.setFillColor(LIME)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(side_x + 16, H - 311, "SUCCESS CHECK")
    sy = H - 336
    for item in checks:
        c.setFillColor(LIME)
        c.circle(side_x + 20, sy + 3, 3, fill=1, stroke=0)
        sy = text_block(c, item, side_x + 30, sy + 7, side_w - 46, size=8.2, color=white, leading=11) - 9
    c.setStrokeColor(HexColor("#3D5D52"))
    c.line(side_x + 16, sy + 4, side_x + side_w - 16, sy + 4)
    c.setFillColor(LIME)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(side_x + 16, sy - 14, "FIELD NOTE")
    text_block(c, note, side_x + 16, sy - 32, side_w - 32, size=8.2, color=white, leading=11)

    c.setFillColor(SAND)
    c.roundRect(42, 71, W - 84, 78, 12, fill=1, stroke=0)
    c.setFillColor(LEAF)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(56, 126, "OFFICIAL HELP")
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(56, 108, source_label)
    text_block(c, source_url, 56, 92, W - 112, size=7.2, color=MUTED, leading=9, max_lines=2)
    footer(c, "Keep with the kit")
    save_canvas(c, filename)


def overview():
    filename = "villageserver-initiative-overview.pdf"
    c = Canvas(str(OUT / filename), pagesize=letter)
    c.setTitle("VillageServer Initiative - Missionary Overview")
    c.setAuthor("VillageServer Initiative")

    c.setFillColor(FOREST)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    logo(c, 42, H - 60, 160, on_dark=True)
    pill(c, "Missionary field overview", 42, H - 103, fill=LEAF)
    c.setFillColor(white)
    c.setFont("Times-Bold", 44)
    y = H - 170
    for line in ["A library that travels", "beyond the internet."]:
        c.drawString(42, y, line)
        y -= 47
    text_block(c, "VillageServer brings Scripture, gospel media, training, and practical digital resources to communities where reliable internet is unavailable or unaffordable.", 42, H - 290, 440, size=13, color=white, leading=18)
    c.setStrokeColor(HexColor("#40675B"))
    c.line(42, H - 373, W - 42, H - 373)
    c.setFillColor(LIME)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(42, H - 399, "ONE SIMPLE FIELD FLOW")
    labels = [("01", "Power the kit"), ("02", "Join local Wi-Fi"), ("03", "Open the library"), ("04", "Save and share")]
    x = 42
    for number, label in labels:
        c.setFillColor(HexColor("#1C4A3C"))
        c.roundRect(x, H - 506, 120, 82, 10, fill=1, stroke=0)
        c.setFillColor(LIME)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 13, H - 447, number)
        text_block(c, label, x + 13, H - 469, 94, font="Helvetica-Bold", size=9.2, color=white, leading=12)
        x += 132
    c.setFillColor(LIME)
    c.roundRect(42, 109, W - 84, 88, 12, fill=1, stroke=0)
    c.setFillColor(FOREST_DARK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(58, 173, "THE IMPORTANT PART")
    text_block(c, "People connect as if they are joining Wi-Fi and opening a website. Internet service and a data plan are not required for the offline library.", 58, 151, W - 116, size=10.5, color=FOREST_DARK, leading=15)
    footer(c, "1 of 2")
    c.showPage()

    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    logo(c, 42, H - 58, 145)
    pill(c, "What the kit can include", 42, H - 94, fill=LEAF)
    c.setFillColor(INK)
    c.setFont("Times-Bold", 31)
    c.drawString(42, H - 140, "One core. Add what the setting needs.")
    items = [
        ("Raspberry Pi", "Stores the offline library and creates local Wi-Fi."),
        ("microSD and USB", "Carry language-specific libraries between places and devices."),
        ("Solar suitcase", "Provides field power where the electrical grid is unreliable."),
        ("Projector", "Makes films and training visible to a whole group."),
        ("Phone charging", "Keeps local devices available for reading, listening, and sharing."),
        ("Satellite option", "Adds live internet only when the setting and budget call for it."),
    ]
    y = H - 185
    for index, (title, body) in enumerate(items, 1):
        col = 0 if index <= 3 else 1
        row = (index - 1) % 3
        x = 42 + col * 266
        box_y = H - 215 - row * 112
        c.setFillColor(SAND)
        c.roundRect(x, box_y - 84, 244, 90, 10, fill=1, stroke=0)
        c.setFillColor(FOREST)
        c.circle(x + 24, box_y - 18, 12, fill=1, stroke=0)
        c.setFillColor(LIME)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(x + 24, box_y - 21, f"{index:02d}")
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x + 44, box_y - 15, title)
        text_block(c, body, x + 16, box_y - 40, 212, size=8.2, color=MUTED, leading=11)

    c.setFillColor(FOREST_DARK)
    c.roundRect(42, 107, W - 84, 176, 12, fill=1, stroke=0)
    c.setFillColor(LIME)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(58, 258, "FIELD CONVERSATION")
    c.setFillColor(white)
    c.setFont("Times-Bold", 18)
    c.drawString(58, 231, "Show it. Let someone try it. Leave a repeatable path.")
    points = [
        "Start with the access method already available: local Wi-Fi, microSD, or USB.",
        "Open one saved file in airplane mode before calling the handoff complete.",
        "Teach the next person to transfer one small file before sharing a full library.",
        "Use the printable route guides at villageserver.org/pamphlets.",
    ]
    py = 205
    for point in points:
        c.setFillColor(LIME)
        c.circle(61, py + 3, 3, fill=1, stroke=0)
        text_block(c, point, 72, py + 7, W - 132, size=8.7, color=white, leading=11)
        py -= 27
    footer(c, "2 of 2")
    save_canvas(c, filename)


def quickstart():
    filename = "villageserver-quick-start-guide.pdf"
    c = Canvas(str(OUT / filename), pagesize=letter)
    c.setTitle("VillageServer Pi - Quick Start Guide")
    c.setAuthor("VillageServer Initiative")

    c.setFillColor(FOREST)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    logo(c, 42, H - 60, 160, on_dark=True)
    pill(c, "Field quick start", 42, H - 103, fill=LEAF)
    c.setFillColor(white)
    c.setFont("Times-Bold", 40)
    y = H - 170
    for line in ["Power it on.", "Connect. Browse."]:
        c.drawString(42, y, line)
        y -= 44
    text_block(c, "Every VillageServer Pi kit ships pre-configured - no setup, no code, no internet required. This guide gets you from box to browsing in under five minutes.", 42, H - 280, 440, size=13, color=white, leading=18)
    c.setStrokeColor(HexColor("#40675B"))
    c.line(42, H - 363, W - 42, H - 363)
    c.setFillColor(LIME)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(42, H - 389, "ONE SIMPLE FIELD FLOW")
    labels = [("01", "Power the kit"), ("02", "Join local Wi-Fi"), ("03", "Open the library"), ("04", "Browse and download")]
    x = 42
    for number, label in labels:
        c.setFillColor(HexColor("#1C4A3C"))
        c.roundRect(x, H - 496, 120, 82, 10, fill=1, stroke=0)
        c.setFillColor(LIME)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 13, H - 437, number)
        text_block(c, label, x + 13, H - 459, 94, font="Helvetica-Bold", size=9.2, color=white, leading=12)
        x += 132
    c.setFillColor(LIME)
    c.roundRect(42, 109, W - 84, 88, 12, fill=1, stroke=0)
    c.setFillColor(FOREST_DARK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(58, 173, "THE IMPORTANT PART")
    text_block(c, "Connecting feels just like joining any Wi-Fi network and opening a website. No app to install, no account, no data plan needed.", 58, 151, W - 116, size=10.5, color=FOREST_DARK, leading=15)
    footer(c, "1 of 2")
    c.showPage()

    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    logo(c, 42, H - 58, 145)
    pill(c, "Step-by-step", 42, H - 94, fill=LEAF)
    c.setFillColor(INK)
    c.setFont("Times-Bold", 28)
    c.drawString(42, H - 138, "Get a kit running in the field")
    steps = [
        ("Power on", "Plug in the power supply or power bank. Give the Pi about 60 seconds to fully start up."),
        ("Join the Wi-Fi", 'On your phone, open Wi-Fi settings and join "VillageServer" using the password "village123".'),
        ("Open the library", 'Open any browser and go to 10.43.0.1. Some phones warn "no internet connection" - that is expected, continue anyway.'),
        ("Choose a language and type", "Tap a language card, then choose Bible, Audio, Video, or Books."),
        ("Download to keep", "Tap any file to download it to the phone. Once downloaded, it works completely offline, even after leaving the area."),
    ]
    y = H - 175
    left_width = 338
    for index, (step_title, body) in enumerate(steps, 1):
        y = numbered_step(c, index, step_title, body, 42, y, left_width)

    side_x = 414
    side_w = W - side_x - 42
    c.setFillColor(FOREST_DARK)
    c.roundRect(side_x, H - 493, side_w, 208, 12, fill=1, stroke=0)
    c.setFillColor(LIME)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(side_x + 16, H - 171, "SUCCESS CHECK")
    checks = [
        'The "VillageServer" Wi-Fi network appears in range.',
        "10.43.0.1 loads the library home screen.",
        "A downloaded file opens with airplane mode turned on.",
    ]
    sy = H - 196
    for item in checks:
        c.setFillColor(LIME)
        c.circle(side_x + 20, sy + 3, 3, fill=1, stroke=0)
        sy = text_block(c, item, side_x + 30, sy + 7, side_w - 46, size=8.2, color=white, leading=11) - 9
    c.setStrokeColor(HexColor("#3D5D52"))
    c.line(side_x + 16, sy + 4, side_x + side_w - 16, sy + 4)
    c.setFillColor(LIME)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(side_x + 16, sy - 14, "FIELD NOTE")
    text_block(c, "If a language or file seems to be missing, that is a content update, not a device problem - flag it to the team rather than troubleshooting the Pi itself.", side_x + 16, sy - 32, side_w - 32, size=8.2, color=white, leading=11)

    c.setFillColor(SAND)
    c.roundRect(42, 71, W - 84, 78, 12, fill=1, stroke=0)
    c.setFillColor(LEAF)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(56, 126, "GO DEEPER")
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(56, 108, "VillageServer OS companion site")
    text_block(c, "Content management, technical configuration, and full documentation live there - this guide only covers using a kit in the field.", 56, 92, W - 112, size=7.2, color=MUTED, leading=9, max_lines=2)
    footer(c, "Keep with the kit")
    save_canvas(c, filename)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)
    overview()
    quickstart()
    routes = [
        ("villageserver-transfer-iphone-to-iphone.pdf", "iPhone to iPhone", "AirDrop", "Both people have nearby Apple devices and want the fastest direct handoff.", [
            ("Prepare both phones", "Turn on Wi-Fi and Bluetooth. Keep both iPhones unlocked, awake, and close together."),
            ("Allow discovery", "On the receiving iPhone, set AirDrop to Contacts Only or Everyone for 10 Minutes."),
            ("Choose the resource", "On the sending iPhone, open Files and touch and hold the file or folder."),
            ("Send with AirDrop", "Tap Share, choose AirDrop, then select the receiving iPhone."),
            ("Accept and verify", "Accept the transfer. Open the received file once before the devices separate."),
        ], ["The receiver sees the file in Files or its matching app.", "The file opens while airplane mode is on."], "Apple AirDrop User Guide", "https://support.apple.com/en-us/102538", "If the receiver does not appear, temporarily choose Everyone for 10 Minutes, then turn that setting off after the handoff."),
        ("villageserver-transfer-android-to-android.pdf", "Android to Android", "Quick Share", "Both people have Android phones and need a nearby wireless transfer.", [
            ("Prepare both phones", "Turn on Bluetooth, Wi-Fi, and Location. Keep both phones unlocked and nearby."),
            ("Open the file", "In Files by Google or your phone's file manager, select the resource to share."),
            ("Choose Quick Share", "Tap Share, then Quick Share. Wait for the receiving Android to appear."),
            ("Accept the transfer", "Tap the receiving device and accept the request on that phone."),
            ("Open it offline", "Find the file in Downloads or the Quick Share folder and test it in airplane mode."),
        ], ["Quick Share reports that sending is complete.", "The received file opens without mobile data."], "Google Quick Share Help", "https://support.google.com/files/answer/15685428?hl=en", "For large folders, send one small file first. Keep the screens awake until the transfer finishes."),
        ("villageserver-transfer-iphone-to-android.pdf", "iPhone to Android", "LocalSend", "An iPhone needs to pass resources to an Android without sending them through the cloud.", [
            ("Install LocalSend", "Install LocalSend on both phones before leaving reliable internet access."),
            ("Join one network", "Connect both phones to the same local Wi-Fi or to one phone's hotspot."),
            ("Select on iPhone", "Open LocalSend on the iPhone, tap Send, choose Files, and select the resource."),
            ("Choose Android", "Tap the Android device shown in LocalSend. Accept the request on Android."),
            ("Verify the copy", "Open the saved file on Android and test it with airplane mode turned on."),
        ], ["Both devices showed each other inside LocalSend.", "Android can open the received file offline."], "Official LocalSend website", "https://localsend.org/", "LocalSend works locally across Android, iOS, Windows, macOS, and Linux. It does not require an account."),
        ("villageserver-transfer-android-to-iphone.pdf", "Android to iPhone", "LocalSend", "An Android needs to pass resources to an iPhone without using email, messaging, or cloud storage.", [
            ("Install LocalSend", "Install LocalSend on both phones while app-store access is available."),
            ("Join one network", "Connect both phones to the same local Wi-Fi or one phone's hotspot."),
            ("Select on Android", "Open LocalSend on Android, tap Send, choose the files, and select the resource."),
            ("Choose iPhone", "Tap the iPhone shown in LocalSend. Accept the request on the iPhone."),
            ("Save and verify", "Save to Files on the iPhone. Open the file once with airplane mode turned on."),
        ], ["LocalSend reports a completed transfer.", "The resource appears in the iPhone Files app and opens offline."], "Official LocalSend website", "https://localsend.org/", "If the phones cannot see each other, confirm both are on the same network and LocalSend has local-network permission on iPhone."),
        ("villageserver-transfer-computer-to-phone.pdf", "Computer to phone", "Cable or LocalSend", "A laptop holds the library and a phone needs a reliable field copy.", [
            ("Choose the method", "Use a data-capable USB cable for maximum reliability, or LocalSend when both devices share a network."),
            ("Unlock the phone", "Keep the phone awake. Android users choose File transfer when the USB prompt appears."),
            ("Open phone storage", "On Windows, use File Explorer. On Mac, use Finder for supported Apple transfers or LocalSend."),
            ("Copy a small test", "Copy one file into Downloads, Documents, or Files before moving a large folder."),
            ("Eject and verify", "Wait for copying to finish, safely eject when needed, then open the file offline."),
        ], ["The file size on the phone matches the source.", "The phone opens the resource after the cable or network is removed."], "Android USB transfer guide", "https://support.google.com/android/answer/9064445?hl=en-GB", "Some cables provide power only. If the computer cannot see the phone, try a known data cable or LocalSend."),
        ("villageserver-transfer-microsd-to-phone.pdf", "microSD to phone", "Card reader", "The field library is on a microSD card and needs to be copied safely to a phone.", [
            ("Protect the original", "If the adapter has a lock switch, lock it. Never delete or rename files on the master card."),
            ("Connect a reader", "Insert the card into a compatible USB-C or Lightning card reader, then connect it to the phone."),
            ("Open the card", "On Android use Files or My Files. On iPhone use Files, Browse, then the card under Locations."),
            ("Copy, do not move", "Copy the chosen language folder into Downloads, Documents, or On My iPhone."),
            ("Eject and test", "Wait for the copy to finish, eject the reader, and open one resource in airplane mode."),
        ], ["The original folder still remains on the microSD card.", "The copied file opens after the reader is removed."], "Apple external storage guide", "https://support.apple.com/guide/iphone/transfer-files-iphone-a-storage-device-server-iphe9aff429a/ios", "Carry one reader for USB-C and the correct adapter for older Lightning iPhones. Label every master card by language."),
    ]
    for route in routes:
        draw_route(*route)
    print(f"Generated {len(routes) + 1} PDFs in {OUT} and mirrored them to {WEB}")


if __name__ == "__main__":
    main()
