"""Authenticated application API; administration has a separate URL configuration."""
import logging
import os
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.db.models import F
from django.http import FileResponse, Http404
from django.utils.cache import patch_vary_headers
from django.utils import timezone
from google.auth.exceptions import TransportError
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from rest_framework import status, viewsets
from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .authentication import issue_token, LoginIPThrottle, LoginAccountThrottle, EmailOrUsernameTokenSerializer
from .models import AnalysisRequest, UserQuota, GoogleIdentity, GoogleAccessGrant
from .self_registration import email_matches, lock_identity, normalized_email
from .serializers import AnalysisRequestCreateSerializer, AnalysisRequestDetailSerializer, ProfileSerializer
from .lifecycle import mark_failed
from .tasks import run_geospatial_analysis

User = get_user_model()
logger = logging.getLogger(__name__)


class PrivateResponseMixin:
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        patch_vary_headers(response, ["Authorization", "Cookie"])
        return response


class TokenView(PrivateResponseMixin, ObtainAuthToken):
    authentication_classes = []
    throttle_classes = [LoginIPThrottle, LoginAccountThrottle]
    serializer_class = EmailOrUsernameTokenSerializer

    def post(self, request, *args, **kwargs):
        serializer = self.serializer_class(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        return Response({"token": issue_token(serializer.validated_data["user"]).key})


class LogoutView(PrivateResponseMixin, APIView):
    def post(self, request):
        request.auth.delete()
        return Response(status=204)


class AnalysisViewSet(PrivateResponseMixin, viewsets.ModelViewSet):
    http_method_names = ["get", "post", "delete", "head", "options"]
    throttle_scope = "analysis_create"

    def get_throttles(self):
        return [ScopedRateThrottle()] if self.action == "create" else []

    def get_queryset(self):
        # Public API is owner-only, including staff. Staff manages all via private admin.
        return AnalysisRequest.objects.filter(user=self.request.user).select_related("result")

    def get_serializer_class(self):
        return AnalysisRequestCreateSerializer if self.action == "create" else AnalysisRequestDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            UserQuota.objects.get_or_create(user=request.user)
            quota = UserQuota.objects.select_for_update().get(user=request.user)
            if quota.analyses_used >= quota.analyses_allowed:
                raise ValidationError("Has alcanzado tu cuota de análisis.")
            if AnalysisRequest.objects.filter(user=request.user, status__in=["PENDING", "PROCESSING"]).exists():
                raise ValidationError("Ya tienes un análisis pendiente o en proceso.")
            data = serializer.validated_data
            if (data["date_end"]-data["date_start"]).days > quota.max_date_range_days:
                raise ValidationError("El periodo supera tu cuota actual.")
            if data["aoi"].transform(6933, clone=True).area/10000 > quota.max_area_ha:
                raise ValidationError("El área supera tu cuota actual.")
            task_id = str(uuid.uuid4())
            analysis = serializer.save(user=request.user, quota_charged=True, celery_task_id=task_id, last_enqueued_at=timezone.now())
            UserQuota.objects.filter(pk=quota.pk).update(analyses_used=F("analyses_used")+1)
        try:
            run_geospatial_analysis.apply_async(args=[str(analysis.id)], task_id=task_id, retry=False)
        except Exception:
            logger.exception("No se pudo publicar el análisis %s", analysis.id)
            mark_failed(analysis.id, "No se pudo encolar el análisis. Vuelve a intentarlo.", pending_only=True)
            analysis.refresh_from_db()
            if analysis.status == "FAILED":
                return Response({"detail":"Cola no disponible. La cuota fue restituida.","id":str(analysis.id)},status=503)
        analysis.refresh_from_db()
        return Response(AnalysisRequestDetailSerializer(analysis).data, status=202)

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            obj = get_object_or_404(AnalysisRequest.objects.select_for_update(), pk=kwargs["pk"], user=request.user)
            if obj.status in ("PENDING", "PROCESSING"):
                return Response({"detail":"Espera a que termine el análisis antes de eliminarlo."},status=409)
            obj.delete()
        return Response(status=204)


class ProtectedHeatmapView(PrivateResponseMixin, APIView):
    def get(self, request, analysis_id, index, timestep, artifact_attempt=None):
        analysis = get_object_or_404(AnalysisRequest.objects.select_related("result"),pk=analysis_id,user=request.user,status="COMPLETED")
        result = getattr(analysis,"result",None)
        layers = result.heatmap_layers if result else None
        if (not layers or index not in layers.get("indices",[]) or timestep not in layers.get("timesteps",[])
                or not re.fullmatch(r"[a-z0-9_]+",index) or not re.fullmatch(r"\d{4}-\d{2}",timestep)):
            raise Http404
        expected_attempt = layers.get("artifact_attempt")
        if expected_attempt != (str(artifact_attempt) if artifact_attempt else None):
            raise Http404
        root = (Path(settings.MEDIA_ROOT)/"heatmaps").resolve()
        folder = root/str(analysis.id)
        if expected_attempt:
            folder = folder/expected_attempt
        path = (folder/index/(timestep+".png")).resolve()
        if not path.is_relative_to(root/str(analysis.id)) or not path.is_file():
            raise Http404
        return FileResponse(path.open("rb"),content_type="image/png")


def google_client_id():
    value = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
    return value if re.fullmatch(r"[A-Za-z0-9._-]+\.apps\.googleusercontent\.com",value) else ""


class AuthConfigView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    def get(self, request):
        from .email_auth import email_login_available
        return Response({"google_client_id": google_client_id(), "public_signup": settings.PUBLIC_SIGNUP_ENABLED,
                         "email_code_enabled": email_login_available()})


class OAuthLoginView(PrivateResponseMixin, APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    throttle_classes = [LoginIPThrottle]

    def post(self, request):
        if not isinstance(request.data,dict) or not isinstance(request.data.get("credential"),str):
            return Response({"detail":"Credencial no válida."},status=400)
        client = google_client_id()
        if not client:
            return Response({"detail":"Acceso con Google no configurado."},status=503)
        origin = request.headers.get("Origin")
        if origin and origin not in settings.CORS_ALLOWED_ORIGINS and origin != request.scheme+"://"+request.get_host():
            return Response({"detail":"Origen no permitido."},status=403)
        if len(request.data["credential"]) > 8192:
            return Response({"detail":"Credencial demasiado grande."},status=400)
        def google_request(*args, **kwargs):
            kwargs["timeout"] = 10
            return google_requests.Request()(*args, **kwargs)
        try:
            info = id_token.verify_oauth2_token(request.data["credential"],google_request,client)
        except (ValueError, TypeError):
            return Response({"detail":"Credencial no válida."},status=400)
        except TransportError:
            return Response({"detail":"Google no está disponible temporalmente."},status=503)
        subject, email = info.get("sub"), info.get("email")
        if (info.get("email_verified") is not True or not isinstance(subject,str) or not 1 <= len(subject) <= 255
                or not isinstance(email,str) or not 1 <= len(email) <= 254):
            return Response({"detail":"Identidad de Google no verificada."},status=400)
        try:
            email = normalized_email(email)
        except DjangoValidationError:
            return Response({"detail":"Identidad de Google no verificada."},status=400)
        with transaction.atomic():
            lock_identity("email:" + email, "google:" + subject)
            identity = GoogleIdentity.objects.select_related("user").filter(subject=subject).first()
            if identity:
                user = identity.user
            else:
                domain = email.rpartition('@')[2].lower()
                hosted_domain = info.get('hd')
                authoritative = domain == 'gmail.com' or (isinstance(hosted_domain, str) and hosted_domain.lower() == domain and bool(domain))
                if not authoritative:
                    from .email_auth import email_login_available
                    message = ("No podemos confirmar este correo con Google. Puedes solicitar un código por correo."
                               if email_login_available() else
                               "No podemos confirmar este correo con Google. Prueba con otra cuenta de Google o contacta con la administración.")
                    return Response({"detail":message},status=403)
                matches = email_matches(email)
                if not matches and settings.PUBLIC_SIGNUP_ENABLED:
                    user = User.objects.create_user(username="google_" + uuid.uuid4().hex, email=email)
                    user.set_unusable_password()
                    user.save(update_fields=["password"])
                    GoogleAccessGrant.objects.create(user=user)
                    GoogleIdentity.objects.create(user=user, subject=subject)
                else:
                    if len(matches) != 1 or matches[0].email.strip().casefold() != email:
                        return Response({"detail":"El acceso requiere autorización de la administración."},status=403)
                    user = matches[0]
                    if not user.is_active or not GoogleAccessGrant.objects.filter(user=user, enabled=True).exists():
                        return Response({"detail":"El acceso requiere autorización de la administración."},status=403)
                    if GoogleIdentity.objects.filter(user=user).exists():
                        return Response({"detail":"Esta cuenta ya está vinculada a otra identidad de Google."},status=409)
                    GoogleIdentity.objects.create(user=user, subject=subject)
            if not user.is_active or not GoogleAccessGrant.objects.filter(user=user, enabled=True).exists():
                return Response({"detail":"Cuenta no disponible."},status=403)
        return Response({"token":issue_token(user).key})


class UserQuotaView(PrivateResponseMixin, APIView):
    def get(self, request):
        quota, _ = UserQuota.objects.get_or_create(user=request.user)
        return Response({"email":request.user.email,"first_name":request.user.first_name,
            "last_name":request.user.last_name,"is_superuser":request.user.is_superuser,
            "analyses_used":quota.analyses_used,"analyses_allowed":quota.analyses_allowed,
            "max_area_ha":quota.max_area_ha,"max_date_range_days":quota.max_date_range_days})

    def post(self, request):
        serializer = ProfileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        for key,value in serializer.validated_data.items():
            setattr(request.user,key,value)
        if serializer.validated_data:
            request.user.save(update_fields=list(serializer.validated_data))
        return self.get(request)


class HealthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        except Exception:
            return Response({"status":"unavailable"},status=503)
        return Response({"status":"ok"})
