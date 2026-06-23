"""
API REST — el POST encola la tarea Celery y responde 202 de inmediato
(no bloquea el servidor); el frontend hace polling sobre el detalle.
"""
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.authtoken.models import Token
from django.contrib.auth import get_user_model
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import os

User = get_user_model()

from .models import AnalysisRequest
from .serializers import (
    AnalysisRequestCreateSerializer,
    AnalysisRequestDetailSerializer,
)
from .tasks import run_geospatial_analysis


class AnalysisViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "delete"]
    throttle_scope = "analysis_create"

    def get_throttles(self):
        # Solo se limita la creación (POST). El polling (GET) no se throttlea.
        if self.action == "create":
            return [ScopedRateThrottle()]
        return []

    def get_queryset(self):
        if self.request.user.is_superuser:
            return AnalysisRequest.objects.all().select_related("result")
        return AnalysisRequest.objects.filter(user=self.request.user).select_related("result")

    def get_serializer_class(self):
        if self.action == "create":
            return AnalysisRequestCreateSerializer
        return AnalysisRequestDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        analysis = serializer.save(user=request.user)

        # Consumir cuota
        user_quota = request.user.quota
        user_quota.analyses_used += 1
        user_quota.save(update_fields=["analyses_used"])

        # Encolar en Celery — la respuesta vuelve en milisegundos
        async_result = run_geospatial_analysis.delay(str(analysis.id))
        analysis.celery_task_id = async_result.id
        analysis.save(update_fields=["celery_task_id"])

        return Response(
            AnalysisRequestDetailSerializer(analysis).data,
            status=status.HTTP_202_ACCEPTED,
        )

class OAuthLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        token_str = request.data.get("credential")
        if not token_str:
            return Response({"error": "No credential provided"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
            if not client_id:
                return Response({"error": "Google Client ID no está configurado en el servidor."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # Verificar token con Google
            idinfo = id_token.verify_oauth2_token(token_str, google_requests.Request(), client_id)
            email = idinfo.get("email")
            
            if not email:
                return Response({"error": "El token de Google no contiene un email válido."}, status=status.HTTP_400_BAD_REQUEST)
                
            # Crear o recuperar usuario
            user, created = User.objects.get_or_create(username=email, defaults={"email": email})
            
            changed = False
            if not user.first_name and idinfo.get("given_name"):
                user.first_name = idinfo.get("given_name")[:150]
                changed = True
            if not user.last_name and idinfo.get("family_name"):
                user.last_name = idinfo.get("family_name")[:150]
                changed = True
            if changed:
                user.save(update_fields=["first_name", "last_name"])
            
            # Generar token de DRF
            drf_token, _ = Token.objects.get_or_create(user=user)
            
            return Response({"token": drf_token.key})

        except ValueError as e:
            # Token inválido
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

class UserQuotaView(APIView):
    """Devuelve los detalles de la cuota del usuario autenticado."""
    def get(self, request):
        if not hasattr(request.user, 'quota'):
            from .models import UserQuota
            UserQuota.objects.create(user=request.user)
            
        quota = request.user.quota
        return Response({
            "email": request.user.email,
            "first_name": request.user.first_name,
            "last_name": request.user.last_name,
            "is_superuser": request.user.is_superuser,
            "analyses_used": quota.analyses_used,
            "analyses_allowed": quota.analyses_allowed,
            "max_area_ha": quota.max_area_ha,
            "max_date_range_days": quota.max_date_range_days
        })

    def post(self, request):
        first_name = request.data.get("first_name")
        last_name = request.data.get("last_name")
        changed = False
        if first_name is not None:
            request.user.first_name = first_name[:150].strip()
            changed = True
        if last_name is not None:
            request.user.last_name = last_name[:150].strip()
            changed = True
        if changed:
            request.user.save(update_fields=["first_name", "last_name"])
        return self.get(request)
