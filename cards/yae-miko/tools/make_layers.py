"""Build the four registered card layers (1024x1536) from raw artwork.

Layers (same canvas, same registration):
  assets/subject.png     RGBA transparent cutout, pre-placed with type-safe margins
  assets/background.png  opaque RGB, pre-zoomed 8% for parallax headroom
  assets/lineart.png     black contours on white, derived from subject (zero drift)
  assets/text.png        transparent typography rendered with Noto Serif SC

Usage:
  python3 tools/make_layers.py            # run from cards/yae-miko/
  python3 tools/make_layers.py /path/to/cards/yae-miko
"""

from pathlib import Path
import json
import sys

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

W, H = 1024, 1536
FONT_PATH = "/tmp/cjkfont/ofl/notoserifsc/NotoSerifSC[wght].ttf"


def cover_fit(img: Image.Image, zoom: float = 1.0) -> Image.Image:
    s = max(W / img.width, H / img.height) * zoom
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x = (img.width - W) // 2
    y = (img.height - H) // 2
    return img.crop((x, y, x + W, y + H))


def make_background(work: Path, assets: Path) -> None:
    bg = Image.open(work / "bg-raw.png").convert("RGB")
    bg = cover_fit(bg, zoom=1.08)  # bleed for parallax shifts
    bg.save(assets / "background.png")
    print("background.png", bg.size)


def cutout_subject(work: Path) -> Image.Image:
    img = Image.open(work / "subject-raw.png").convert("RGB")
    try:
        from rembg import new_session, remove

        session = new_session("isnet-general-use")
        cut = remove(img, session=session)
        print("cutout: rembg isnet-general-use")
        return cut
    except Exception as e:
        print("cutout: rembg failed (%s), luminance-key fallback" % e)
        import numpy as np

        a = np.asarray(img).astype("f")
        peak = a.max(axis=2)
        alpha = ((peak - 6) / 36.0 * 255.0).clip(0, 255).astype("uint8")
        alpha = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8))
        out = img.convert("RGBA")
        out.putalpha(alpha)
        return out


def make_subject(work: Path, assets: Path) -> None:
    cut = cutout_subject(work)
    bbox = cut.split()[3].getbbox()
    if not bbox:
        raise RuntimeError("subject cutout is fully transparent")
    # small padding around the figure, then fit into the type-safe box
    pad = 8
    bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
            min(cut.width, bbox[2] + pad), min(cut.height, bbox[3] + pad))
    fig = cut.crop(bbox)
    # Box accounts for the in-shader 1.25x subject zoom about canvas center:
    # pre 376..1176  ->  post ~278..1278, clear of both type zones.
    box_w, box_h, cx, cy = 860, 800, 512, 776
    s = min(box_w / fig.width, box_h / fig.height)
    fig = fig.resize((round(fig.width * s), round(fig.height * s)), Image.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(fig, (round(cx - fig.width / 2), round(cy - fig.height / 2)))
    canvas.save(assets / "subject.png")
    alpha = canvas.split()[3]
    hist = alpha.histogram()
    total = sum(hist)
    print("subject.png", canvas.size,
          "transparent=%.3f" % (sum(hist[:16]) / total),
          "visible=%.3f" % (sum(hist[128:]) / total))


def make_lineart(assets: Path) -> None:
    subj = Image.open(assets / "subject.png")
    white = Image.new("RGB", (W, H), (255, 255, 255))
    white.paste(subj, mask=subj.split()[3])
    g = white.convert("L").filter(ImageFilter.GaussianBlur(0.7))
    grad = ImageChops.difference(g.filter(ImageFilter.MaxFilter(3)),
                                g.filter(ImageFilter.MinFilter(3)))
    import numpy as np

    a = np.asarray(grad).astype("f")
    line = 255.0 - (a * 3.0).clip(0, 255.0)  # black contour on white
    line = Image.fromarray(line.astype("uint8"))
    # gate by dilated alpha so paper stays clean outside the figure
    mask = subj.split()[3].filter(ImageFilter.MaxFilter(5)).point(lambda v: 255 if v > 8 else 0)
    paper = Image.new("L", (W, H), 255)
    paper.paste(line, mask=mask)
    paper.convert("RGB").save(assets / "lineart.png")
    lo, hi = paper.getextrema()
    print("lineart.png L extrema", lo, hi)


def make_text(root: Path, assets: Path) -> None:
    cfg = json.loads((root / "card-config.json").read_text(encoding="utf-8"))
    font_path = FONT_PATH
    if not Path(font_path).is_file():
        raise RuntimeError("CJK font missing: " + font_path)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    gold = (244, 208, 135, 255)
    cream = (255, 241, 206, 255)
    dim = (176, 168, 150, 255)

    def txt(x, y, value, size, anchor="la", fill=cream, max_width=880):
        f = ImageFont.truetype(font_path, size)
        while d.textbbox((0, 0), value, font=f)[2] > max_width and size > 10:
            size -= 1
            f = ImageFont.truetype(font_path, size)
        d.text((x, y), value, font=f, fill=fill, anchor=anchor,
               stroke_width=2, stroke_fill=(14, 18, 26, 230))

    def line(y):
        d.line((70, y, 954, y), fill=gold, width=2)

    txt(72, 48, cfg.get("subtitle", ""), 26, fill=gold)
    txt(72, 86, cfg.get("title", ""), 92, max_width=880)
    txt(76, 196, cfg.get("collection", ""), 22, fill=gold)
    line(246)
    line(1278)
    txt(512, 1298, cfg.get("tagline", ""), 30, anchor="ma", fill=gold)
    txt(512, 1344, cfg.get("technique", ""), 62, anchor="ma")
    txt(72, 1466, cfg.get("edition", ""), 21, fill=gold)
    txt(952, 1466, "SCZ HOLO", 19, anchor="ra", fill=dim, max_width=360)
    im.save(assets / "text.png")
    print("text.png", im.size)


def validate(assets: Path) -> None:
    report = {}
    for name in ["subject", "background", "lineart", "text"]:
        with Image.open(assets / (name + ".png")) as im:
            assert im.size == (W, H), "%s size %s" % (name, im.size)
            item = {"size": list(im.size), "mode": im.mode}
            if name in ("subject", "text"):
                assert "A" in im.getbands(), name + " lacks alpha"
                hist = im.getchannel("A").histogram()
                total = sum(hist)
                item["transparent"] = round(sum(hist[:16]) / total, 4)
                item["visible"] = round(sum(hist[128:]) / total, 4)
            report[name] = item
    print(json.dumps(report, indent=2, ensure_ascii=False))


def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    work, assets = root / "work", root / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    make_background(work, assets)
    make_subject(work, assets)
    make_lineart(assets)
    make_text(root, assets)
    validate(assets)
    print("LAYERS_COMPLETE")


if __name__ == "__main__":
    main()
