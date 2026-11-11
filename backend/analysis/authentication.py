from datetime import timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.authentication import TokenAuthentication
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


class LoginIPThrottle(SimpleRateThrottle):
    scope = "login_ip"
    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class LoginAccountThrottle(SimpleRateThrottle):
    scope = "login_account"
    def get_cache_key(self, request, view):
        data = request.data if isinstance(request.data, dict) else {}
        username = str(data.get("username", ""))[:254].casefold()
        return self.cache_format % {"scope": self.scope, "ident": salted_hmac("login", username).hexdigest()}
