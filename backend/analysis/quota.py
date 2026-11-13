"""Area reservations use the same projected geometry as the server limit."""
from decimal import Decimal, ROUND_HALF_UP


def quota_for(user):
    from .models import UserQuota
    defaults = {"area_allowance_ha": None} if user.is_staff or user.is_superuser else {}
    return UserQuota.objects.get_or_create(user=user, defaults=defaults)[0]


def chargeable_area(aoi):
    # Charge to the nearest square metre, with a one-square-metre minimum.
    unit = Decimal("0.0001")
    return max(unit, Decimal(str(aoi.transform(6933, clone=True).area / 10000)).quantize(unit, rounding=ROUND_HALF_UP))


def quota_error(quota, data, area=None):
    if quota.area_allowance_ha is None and quota.analyses_used >= quota.analyses_allowed:
        return f"Has alcanzado tu límite de {quota.analyses_allowed} análisis permitidos."
    days = (data["date_end"] - data["date_start"]).days
    if days > quota.max_date_range_days:
        return f"El rango de fechas ({days} días) supera tu límite máximo de {quota.max_date_range_days} días."
    area = area if area is not None else chargeable_area(data["aoi"])
    if area > Decimal(str(quota.max_area_ha)):
        return f"El área solicitada ({area:.4f} ha) supera tu límite por terreno de {quota.max_area_ha:.2f} ha."
    if quota.area_allowance_ha is not None:
        available = max(Decimal("0"), quota.area_allowance_ha - quota.area_used_ha)
        if area > available:
            return f"El área solicitada ({area:.4f} ha) supera tu saldo disponible de {available:.4f} ha."
    return None
