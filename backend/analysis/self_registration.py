"""Helpers for isolated self-service identities and one-time email codes."""
import hashlib

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import connection
from django.db.models import Q
from django.utils.crypto import salted_hmac


def normalized_email(value):
    if not isinstance(value, str):
        raise ValidationError("Introduce un correo válido.")
    email = value.strip().casefold()
    if len(email) > 254:
        raise ValidationError("Introduce un correo válido.")
    validate_email(email)
    return email


def lock_identity(*keys):
    """Serialize identity creation/linking across web processes in PostgreSQL."""
    locks = sorted({int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True) for key in keys})
    with connection.cursor() as cursor:
        for value in locks:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [value])


def email_matches(email):
    return list(get_user_model().objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).order_by("pk")[:2])


def code_digest(email, code):
    return salted_hmac("quenaris.email-login.v1", f"{email}:{code}", algorithm="sha256").hexdigest()
