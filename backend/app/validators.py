# app/validators.py
import re
import uuid


class ValidationError(ValueError):
    """请求参数校验失败。

    路由层捕获这个异常后返回 400，避免脏数据继续进入数据库或外部 API。
    """


LOCATION_RE = re.compile(r"^-?\d+(\.\d+)?,-?\d+(\.\d+)?$")


def get_json_body(request):
    """读取 JSON 请求体，并保证它是对象。"""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValidationError("请求体必须是 JSON 对象")
    return data


def clean_string(value, field, *, required=False, min_length=1, max_length=255):
    """清洗并校验字符串字段。

    - required=True 时，字段不能为空；
    - 所有字符串都会去掉首尾空白；
    - 长度限制可以防止超长输入拖垮数据库、日志或大模型上下文。
    """
    if value is None:
        if required:
            raise ValidationError(f"需要 {field}")
        return None

    if not isinstance(value, str):
        raise ValidationError(f"{field} 必须是字符串")

    value = value.strip()
    if required and len(value) < min_length:
        raise ValidationError(f"需要 {field}")

    if value and len(value) < min_length:
        raise ValidationError(f"{field} 长度不能少于 {min_length} 个字符")

    if len(value) > max_length:
        raise ValidationError(f"{field} 长度不能超过 {max_length} 个字符")

    return value


def positive_int(value, field, *, required=True, max_value=None):
    """校验正整数，比如 ID、页码等字段。"""
    if value is None or value == "":
        if required:
            raise ValidationError(f"需要 {field}")
        return None

    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} 必须是整数") from exc

    if number <= 0:
        raise ValidationError(f"{field} 必须大于 0")

    if max_value is not None and number > max_value:
        raise ValidationError(f"{field} 不能超过 {max_value}")

    return number


def int_range(value, field, *, required=True, min_value=1, max_value=None):
    """校验整数范围。"""
    number = positive_int(value, field, required=required)
    if number is None:
        return None
    if number < min_value:
        raise ValidationError(f"{field} 不能小于 {min_value}")
    if max_value is not None and number > max_value:
        raise ValidationError(f"{field} 不能超过 {max_value}")
    return number


def optional_rating(value):
    """校验评分字段。

    评分允许不传；传了就必须是 1 到 5 的整数。
    """
    if value is None or value == "":
        return None

    rating = positive_int(value, "rating")
    if rating > 5:
        raise ValidationError("rating 必须在 1 到 5 之间")
    return rating


def validate_location(value, field="location"):
    """校验经纬度字符串，格式为 lng,lat。"""
    if not value:
        return value

    if not LOCATION_RE.match(value):
        raise ValidationError(f"{field} 格式必须是 lng,lat")

    lng_text, lat_text = value.split(",", 1)
    lng = float(lng_text)
    lat = float(lat_text)

    if not -180 <= lng <= 180:
        raise ValidationError(f"{field} 经度必须在 -180 到 180 之间")
    if not -90 <= lat <= 90:
        raise ValidationError(f"{field} 纬度必须在 -90 到 90 之间")

    return value


def validate_session_id(value):
    """校验对话 session_id。

    允许不传；如果前端传了，就必须是 UUID 字符串。
    """
    value = clean_string(value, "session_id", max_length=36)
    if not value:
        return None

    try:
        return str(uuid.UUID(value))
    except (TypeError, ValueError) as exc:
        raise ValidationError("session_id 必须是有效 UUID") from exc
