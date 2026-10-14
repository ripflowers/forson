import hashlib
import io
from pathlib import Path

from PIL import Image, ImageOps
import pypdfium2 as pdfium

from .store import Invalid, uid


MAX_BYTES = 100 * 1024 * 1024


def jpeg(image, max_size=2200):
    image = image.convert("RGB")
    image.thumbnail((max_size, max_size))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=93)
    return buffer.getvalue()


def save_uploads(data_dir: Path, files: list[tuple[str, bytes]], *, sample=False):
    if not files:
        raise Invalid("请先选择原图或PDF")
    if sum(len(data) for _, data in files) > MAX_BYTES:
        raise Invalid("本批超过100MB，请分批上传；没有丢弃任何页")
    pdf_files = [name for name, _ in files if name.lower().endswith(".pdf")]
    if pdf_files and (len(files) != 1 or len(pdf_files) != 1):
        raise Invalid("一批只支持一份PDF，不能与图片混合")
    if not pdf_files and len(files) > 10:
        raise Invalid("最多10张图片，请分批上传；没有截掉后面的图片")
    folder = data_dir / "imports" / uid()
    folder.mkdir(parents=True)
    pages = []
    hashes = []
    try:
        for file_index, (name, raw) in enumerate(files):
            hashes.append(hashlib.sha256(raw).hexdigest())
            original = folder / f"source-{file_index}{'.pdf' if name.lower().endswith('.pdf') else '.bin'}"
            original.write_bytes(raw)
            if name.lower().endswith(".pdf"):
                try:
                    document = pdfium.PdfDocument(raw)
                    if len(document) > 20:
                        raise Invalid("PDF超过20页，请分批上传；没有静默丢页")
                    images = [document[i].render(scale=2).to_pil() for i in range(len(document))]
                except Invalid:
                    raise
                except Exception:
                    raise Invalid("PDF无法读取，请检查文件是否损坏或需要密码") from None
            else:
                try:
                    image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
                    image.load()
                    images = [image]
                except (OSError, ValueError, Image.DecompressionBombError):
                    raise Invalid("图片无法读取，请选择清晰的JPEG、PNG或WebP原图") from None
            for image in images:
                index = len(pages)
                # The supplied sample is a landscape paper photographed sideways. Generic imports get AI orientation detection.
                rotation = 90 if sample and image.height > image.width else 0
                image = image.rotate(rotation, expand=True)
                path = folder / f"page-{index}.jpg"
                image.convert("RGB").save(path, quality=95)
                pages.append({"index": index, "url": f"/api/media/{folder.name}/{path.name}", "width": image.width, "height": image.height,
                              "path": str(path), "rotation": rotation, "sourceName": name})
    except Exception:
        # Preserve source bytes on failure for local diagnostics, but don't advertise an incomplete paper.
        raise
    return pages, hashes


def rotate_page(page, degrees):
    if degrees not in (0, 90, 180, 270):
        raise Invalid("页面方向必须为0/90/180/270度")
    if degrees:
        with Image.open(page["path"]) as source:
            image = source.rotate(degrees, expand=True)
            image.save(page["path"], quality=95)
            return {**page, "width": image.width, "height": image.height, "rotation": (page.get("rotation", 0) + degrees) % 360}
    return page


def column_images(page, columns):
    with Image.open(page["path"]) as source:
        overview = jpeg(source.copy(), 1800)
        result = []
        for column in range(columns):
            left = max(0, column / columns - 0.012)
            right = min(1, (column + 1) / columns + 0.012)
            crop = source.crop((int(source.width * left), 0, int(source.width * right), source.height))
            result.append(({"pageIndex": page["index"], "x": left, "y": 0, "width": right - left, "height": 1}, overview, jpeg(crop)))
        return result
