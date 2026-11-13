"""Saved incoming links and an explicitly curated public project gallery."""
import json
import io
import uuid
from PIL import Image, ImageOps, UnidentifiedImageError
from django.db import transaction
from django.db.models import Exists, F, OuterRef
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import get_object_or_404
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from django.http import HttpResponse

from .models import AnalysisRequest, AnalysisResult, FeaturedAnalysis, ReceivedAnalysis
from .serializers import FeatureSelectionSerializer
from .views import PrivateResponseMixin, shared_analysis


def can_curate(user):
    return bool(user.is_authenticated and user.is_active and (user.is_staff or user.is_superuser))


def selection_state(obj):
    feature = getattr(obj, "feature", None)
    active = bool(obj.share_token and feature and feature.share_token == obj.share_token)
    return {"is_featured": active, "featured_description": feature.description if active else "",
            "thumbnail_url": thumbnail_url(feature) if active else None}


def thumbnail_url(feature):
    return f"/api/featured/{feature.share_token}/thumbnail/{feature.thumbnail_version}/" if feature.thumbnail_version else None


def feature_response(request, *, analysis_id=None, owner_id=None, share_token=None):
    if not can_curate(request.user):
        raise PermissionDenied("Solo la administración puede destacar proyectos.")
    serializer = FeatureSelectionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    enabled = serializer.validated_data["enabled"]
    with transaction.atomic():
        queryset = AnalysisRequest.objects.select_for_update()
        if owner_id is not None:
            obj = get_object_or_404(queryset, pk=analysis_id, user_id=owner_id)
        else:
            obj = get_object_or_404(queryset, share_token=share_token, user__is_active=True)
        if enabled:
            if not obj.share_token or obj.status != "COMPLETED" or not AnalysisResult.objects.filter(request=obj).exists():
                return Response({"detail": "Activa primero el enlace de un análisis completado con resultados."}, status=409)
            feature, _ = FeaturedAnalysis.objects.update_or_create(
                analysis=obj, defaults={
                    "share_token": obj.share_token, "featured_by": request.user,
                    "description": serializer.validated_data.get("description", ""),
                },
            )
            data = {"is_featured": True, "featured_description": feature.description, "thumbnail_url": thumbnail_url(feature)}
        else:
            FeaturedAnalysis.objects.filter(analysis=obj).delete()
            data = {"is_featured": False, "featured_description": "", "thumbnail_url": None}
    return Response(data)


def card_data(analysis, share_token):
    return {
        "analysis_id": str(analysis.pk), "name": analysis.name,
        "share_path": f"/compartido/{share_token}", "aoi": json.loads(analysis.aoi.geojson),
        "study_type": analysis.study_type, "area_ha": analysis.area_ha,
        "date_start": analysis.date_start, "date_end": analysis.date_end,
    }


class ProjectPagination(PageNumberPagination):
    page_size = 9


class FeaturedListView(PrivateResponseMixin, APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]

    def get(self, request):
        queryset = FeaturedAnalysis.objects.filter(
            share_token=F("analysis__share_token"), analysis__status="COMPLETED",
            analysis__result__isnull=False, analysis__user__is_active=True,
        ).select_related("analysis").defer("thumbnail_data")
        paginator = ProjectPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response([
            {**card_data(item.analysis, item.share_token), "description": item.description, "featured_at": item.featured_at,
             "thumbnail_url": thumbnail_url(item)}
            for item in page
        ])


class SharedAccountView(PrivateResponseMixin, APIView):
    """Authenticated account actions; the anonymous result route stays separate."""
    http_method_names = ["get", "post", "head", "options"]

    def get(self, request, share_token):
        obj = shared_analysis(share_token)
        return Response({
            "is_owner": obj.user_id == request.user.pk,
            "is_saved": ReceivedAnalysis.objects.filter(user=request.user, analysis=obj, share_token=share_token).exists(),
            "can_feature": can_curate(request.user), **selection_state(obj),
        })

    def post(self, request, share_token):
        # Serialize saving with revocation, just like the feature action.
        with transaction.atomic():
            obj = get_object_or_404(
                AnalysisRequest.objects.select_for_update(), share_token=share_token,
                status="COMPLETED", result__isnull=False, user__is_active=True,
            )
            if obj.user_id == request.user.pk:
                return Response({"detail": "Este análisis ya está en Mis análisis."}, status=400)
            received, created = ReceivedAnalysis.objects.update_or_create(
                user=request.user, analysis=obj, defaults={"share_token": share_token, "name": obj.name},
            )
        return Response({"is_saved": True, "id": received.pk}, status=201 if created else 200)


class SharedFeatureView(PrivateResponseMixin, APIView):
    http_method_names = ["post", "options"]

    def post(self, request, share_token):
        return feature_response(request, share_token=share_token)


def thumbnail_update(request, *, analysis_id=None, owner_id=None, share_token=None):
    if not can_curate(request.user):
        raise PermissionDenied("Solo la administración puede cambiar la imagen.")
    image_data = None
    if request.method == "POST":
        upload = request.FILES.get("image")
        if not upload or upload.size > 2 * 1024 * 1024:
            return Response({"detail": "Selecciona una imagen JPEG, PNG o WebP de hasta 2 MB."}, status=400)
        try:
            with Image.open(upload) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"} or image.width * image.height > 16000000:
                    raise ValueError("Formato o dimensiones no admitidos")
                image = ImageOps.exif_transpose(image).convert("RGBA")
                image.thumbnail((1200, 800))
                background = Image.new("RGBA", image.size, "white")
                background.alpha_composite(image)
                image = background.convert("RGB")
                output = io.BytesIO()
                image.save(output, format="WEBP", quality=82, method=4)
                image_data = output.getvalue()
        except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError):
            return Response({"detail": "La imagen no es válida o supera 16 megapíxeles."}, status=400)
    with transaction.atomic():
        queryset = AnalysisRequest.objects.select_for_update()
        if owner_id is not None:
            obj = get_object_or_404(queryset, pk=analysis_id, user_id=owner_id)
        else:
            obj = get_object_or_404(queryset, share_token=share_token, user__is_active=True)
        feature = get_object_or_404(FeaturedAnalysis, analysis=obj, share_token=obj.share_token,
                                    analysis__status="COMPLETED", analysis__result__isnull=False,
                                    analysis__user__is_active=True)
        feature.thumbnail_data = image_data
        feature.thumbnail_version = uuid.uuid4() if image_data else None
        feature.save(update_fields=["thumbnail_data", "thumbnail_version"])
        return Response({"is_featured": True, "featured_description": feature.description, "thumbnail_url": thumbnail_url(feature)})


class SharedFeatureImageView(PrivateResponseMixin, APIView):
    http_method_names = ["post", "delete", "options"]

    def post(self, request, share_token):
        return thumbnail_update(request, share_token=share_token)

    def delete(self, request, share_token):
        return thumbnail_update(request, share_token=share_token)


class FeaturedThumbnailView(PrivateResponseMixin, APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]

    def get(self, request, share_token, version):
        feature = get_object_or_404(FeaturedAnalysis.objects.select_related("analysis"),
            share_token=share_token, thumbnail_version=version, analysis__share_token=share_token,
            analysis__status="COMPLETED", analysis__result__isnull=False, analysis__user__is_active=True)
        if not feature.thumbnail_data:
            return Response(status=404)
        return HttpResponse(bytes(feature.thumbnail_data), content_type="image/webp")


class ReceivedListView(PrivateResponseMixin, APIView):
    http_method_names = ["get", "head", "options"]

    def get(self, request):
        queryset = ReceivedAnalysis.objects.filter(user=request.user).select_related("analysis", "analysis__user").annotate(
            has_result=Exists(AnalysisResult.objects.filter(request_id=OuterRef("analysis_id"))),
        )
        paginator = ProjectPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = []
        for item in page:
            obj = item.analysis
            available = bool(obj.share_token == item.share_token and obj.status == "COMPLETED" and obj.user.is_active and item.has_result)
            row = {"id": item.pk, "name": item.name, "saved_at": item.saved_at, "available": available, "share_path": None}
            if available:
                row.update(card_data(obj, item.share_token))
            rows.append(row)
        return paginator.get_paginated_response(rows)


class ReceivedRemoveView(PrivateResponseMixin, APIView):
    http_method_names = ["delete", "options"]

    def delete(self, request, pk):
        obj = get_object_or_404(ReceivedAnalysis, pk=pk, user=request.user)
        obj.delete()
        return Response(status=204)
