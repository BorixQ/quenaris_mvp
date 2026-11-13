"""Passwordless email sign-in for explicitly verified self-service accounts."""
import logging
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from django.utils.cache import patch_vary_headers
from django.utils.crypto import constant_time_compare
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import (EmailRequestAddressThrottle, EmailRequestIPThrottle,
                             EmailVerifyAddressThrottle, EmailVerifyIPThrottle, issue_token)
from .models import EmailIdentity, EmailLoginChallenge
from .self_registration import code_digest, email_matches, lock_identity, normalized_email

logger = logging.getLogger(__name__)
CODE_LIFETIME = timedelta(minutes=10)
RESEND_DELAY = timedelta(seconds=60)
MAX_ATTEMPTS = 5
GENERIC_REQUEST = "Si el correo puede usar este acceso, recibirás un mensaje con las instrucciones."
INVALID_CODE = "El código no es válido o ha caducado. Solicita otro e inténtalo nuevamente."


def email_login_available():
    return bool(settings.EMAIL_LOGIN_ENABLED and settings.EMAIL_HOST and settings.DEFAULT_FROM_EMAIL
                and settings.EMAIL_USE_TLS != settings.EMAIL_USE_SSL)


def valid_origin(request):
    origin = request.headers.get("Origin")
    return not origin or origin in settings.CORS_ALLOWED_ORIGINS or origin == request.scheme + "://" + request.get_host()


def verified_identity(email, matches):
    identity = EmailIdentity.objects.select_related("user").filter(email=email).first()
    if not identity or len(matches) != 1 or matches[0].pk != identity.user_id:
        return None
    user = identity.user
    if not user.is_active or user.is_staff or user.is_superuser or user.email.strip().casefold() != email:
        return None
    return identity


class EmailAuthBase(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        patch_vary_headers(response, ["Authorization", "Cookie"])
        return response

    def input_email(self, request):
        if not email_login_available():
            return None, Response({"detail": "El acceso por correo no está disponible."}, status=503)
        if not valid_origin(request):
            return None, Response({"detail": "Origen no permitido."}, status=403)
        try:
            return normalized_email(request.data.get("email") if isinstance(request.data, dict) else None), None
        except DjangoValidationError:
            return None, Response({"detail": "Introduce un correo válido."}, status=400)


class EmailCodeRequestView(EmailAuthBase):
    throttle_classes = [EmailRequestIPThrottle, EmailRequestAddressThrottle]

    def post(self, request):
        email, error = self.input_email(request)
        if error:
            return error
        now = timezone.now()
        code = None
        with transaction.atomic():
            lock_identity("email:" + email)
            matches = email_matches(email)
            identity = verified_identity(email, matches)
            allowed = bool(identity) or (not matches and settings.PUBLIC_SIGNUP_ENABLED)
            challenge = EmailLoginChallenge.objects.select_for_update().filter(email=email).first()
            if challenge and now - challenge.last_sent_at < RESEND_DELAY:
                return Response({"detail": GENERIC_REQUEST})
            if allowed:
                code = f"{secrets.randbelow(100_000_000):08d}"
            digest = code_digest(email, code) if code else secrets.token_hex(32)
            EmailLoginChallenge.objects.update_or_create(email=email, defaults={
                "code_digest": digest, "expires_at": now + CODE_LIFETIME,
                "last_sent_at": now, "attempts": 0 if code else MAX_ATTEMPTS,
            })
        message = (f"Tu código de acceso a Queñaris es: {code}\n\nCaduca en 10 minutos. "
                   "Si no solicitaste el código, ignora este correo.\n") if code else (
                   "Si ya tienes una cuenta, accede con tu método habitual o contacta a la administración. "
                   "Si no solicitaste este mensaje, puedes ignorarlo.\n")
        try:
            sent = send_mail("Acceso a Queñaris", message, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
            if sent != 1:
                raise RuntimeError("Email delivery was not accepted")
        except Exception:
            EmailLoginChallenge.objects.filter(email=email, code_digest=digest).delete()
            logger.warning("No se pudo entregar un mensaje de acceso por correo")
            return Response({"detail": "No se pudo enviar el correo. Inténtalo más tarde."}, status=503)
        return Response({"detail": GENERIC_REQUEST})


class EmailCodeVerifyView(EmailAuthBase):
    throttle_classes = [EmailVerifyIPThrottle, EmailVerifyAddressThrottle]

    def post(self, request):
        email, error = self.input_email(request)
        if error:
            return error
        code = request.data.get("code")
        if not isinstance(code, str) or len(code) != 8 or not code.isascii() or not code.isdigit():
            return Response({"detail": INVALID_CODE}, status=400)
        user = None
        with transaction.atomic():
            lock_identity("email:" + email)
            challenge = EmailLoginChallenge.objects.select_for_update().filter(email=email).first()
            if challenge and challenge.expires_at > timezone.now() and challenge.attempts < MAX_ATTEMPTS:
                challenge.attempts += 1
                challenge.save(update_fields=["attempts"])
                if constant_time_compare(challenge.code_digest, code_digest(email, code)):
                    matches = email_matches(email)
                    identity = verified_identity(email, matches)
                    if identity:
                        user = identity.user
                    elif not matches and settings.PUBLIC_SIGNUP_ENABLED:
                        user = get_user_model().objects.create_user(username="email_" + uuid.uuid4().hex, email=email)
                        user.set_unusable_password()
                        user.save(update_fields=["password"])
                        EmailIdentity.objects.create(user=user, email=email)
                    challenge.delete()
        if user is None:
            return Response({"detail": INVALID_CODE}, status=400)
        return Response({"token": issue_token(user).key})
