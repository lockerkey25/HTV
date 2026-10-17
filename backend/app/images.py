"""Image normalization: fix phone rotation, strip metadata, downscale, re-encode as JPEG."""
import io

from PIL import Image, ImageOps, UnidentifiedImageError

from . import config


class InvalidImage(ValueError):
    pass


def normalize(data: bytes) -> bytes:
    if not data:
        raise InvalidImage("empty file")
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise InvalidImage("image larger than 10 MB")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)  # phones store rotation in EXIF
        img = img.convert("RGB")
    except (UnidentifiedImageError, OSError) as e:
        raise InvalidImage("not a readable image") from e
    img.thumbnail((config.MAX_IMAGE_SIDE, config.MAX_IMAGE_SIDE))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)  # re-encoding drops EXIF (incl. GPS)
    return out.getvalue()
