"""
API REST — el POST encola la tarea Celery y responde 202 de inmediato
(no bloquea el servidor); el frontend hace polling sobre el detalle.
"""
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

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
        return AnalysisRequest.objects.filter(user=self.request.user).select_related("result")

    def get_serializer_class(self):
        if self.action == "create":
            return AnalysisRequestCreateSerializer
        return AnalysisRequestDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        analysis = serializer.save(user=request.user)

        # Encolar en Celery — la respuesta vuelve en milisegundos
        async_result = run_geospatial_analysis.delay(str(analysis.id))
        analysis.celery_task_id = async_result.id
        analysis.save(update_fields=["celery_task_id"])

        return Response(
            AnalysisRequestDetailSerializer(analysis).data,
            status=status.HTTP_202_ACCEPTED,
        )
