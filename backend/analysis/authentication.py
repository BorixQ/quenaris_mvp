from datetime import timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework import serializers
from rest_framework.authentication import TokenAuthentication
from rest_framework.authtoken.serializers import AuthTokenSerializer
from rest_framework.authtoken.models import Token
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.throttling import SimpleRateThrottle


def expired(token):
    return token.created <= timezone.now() - timedelta(hours=settings.AUTH_TOKEN_HOURS)


class ExpiringTokenAuthentication(TokenAuthentication):
    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)
        if expired(token):
            raise AuthenticationFailed("Sesión caducada; inicia sesión nuevamente.")
        return user, token


def issue_token(user):
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=user.pk)
        token = Token.objects.filter(user=user).first()
        if token and expired(token):
            token.delete()
            token = None
        return token or Token.objects.create(user=user)


def resolve_login_user(identifier):
    """Accept either identifier only when it refers to exactly one account."""
    if not isinstance(identifier, str) or not identifier.strip():
        return None
    value = identifier.strip()
    matches = list(get_user_model().objects.filter(Q(username__iexact=value) | Q(email__iexact=value)).order_by('pk')[:2])
    return matches[0] if len(matches) == 1 else None


class EmailOrUsernameTokenSerializer(AuthTokenSerializer):
    def validate(self, attrs):
        user = resolve_login_user(attrs.get('username'))
        if user is None:
            # Keep the password hashing cost for missing or ambiguous identifiers.
            get_user_model()().set_password(attrs.get('password', ''))
            raise serializers.ValidationError('No se pudo iniciar sesión con las credenciales proporcionadas.', code='authorization')
        try:
            return super().validate({**attrs, 'username': user.get_username()})
        except serializers.ValidationError:
            raise serializers.ValidationError('No se pudo iniciar sesión con las credenciales proporcionadas.', code='authorization')


class LoginIPThrottle(SimpleRateThrottle):
    scope = "login_ip"
    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class LoginAccountThrottle(SimpleRateThrottle):
    scope = "login_account"
    def get_cache_key(self, request, view):
        data = request.data if isinstance(request.data, dict) else {}
        username = str(data.get("username", ""))[:254].strip().casefold()
        user = resolve_login_user(username)
        ident = f'user:{user.pk}' if user is not None else f'identifier:{username}'
        return self.cache_format % {"scope": self.scope, "ident": salted_hmac("login", ident).hexdigest()}


class EmailRequestIPThrottle(LoginIPThrottle):
    scope = "email_request_ip"


class EmailVerifyIPThrottle(LoginIPThrottle):
    scope = "email_verify_ip"


class EmailAddressThrottle(SimpleRateThrottle):
    def get_cache_key(self, request, view):
        data = request.data if isinstance(request.data, dict) else {}
        email = str(data.get("email", ""))[:254].strip().casefold()
        return self.cache_format % {"scope": self.scope, "ident": salted_hmac("email-auth", email).hexdigest()}


class EmailRequestAddressThrottle(EmailAddressThrottle):
    scope = "email_request_address"


class EmailVerifyAddressThrottle(EmailAddressThrottle):
    scope = "email_verify_address"
