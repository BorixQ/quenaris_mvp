import math
from django.conf import settings
from rest_framework import serializers
from rest_framework_gis.fields import GeometryField

from .models import AnalysisRequest, AnalysisResult
from .quota import quota_error, quota_for


class AnalysisRequestCreateSerializer(serializers.ModelSerializer):
    """Entrada: polígono GeoJSON + fechas. GeometryField acepta GeoJSON crudo."""

    aoi = GeometryField()

    class Meta:
        model = AnalysisRequest
        fields = ["name", "aoi", "date_start", "date_end", "n_clusters", "algorithm",
                  "study_type", "indices", "use_pca"]

    def validate_n_clusters(self, value):
        if not 2 <= value <= 12:
            raise serializers.ValidationError("El número de grupos debe estar entre 2 y 12.")
        return value

    def validate_aoi(self, value):
        if value.geom_type != "Polygon":
            raise serializers.ValidationError("El AOI debe ser un Polígono.")
        if value.empty or not value.valid or value.srid not in (None,4326):
            raise serializers.ValidationError("El polígono debe ser válido en WGS84 (EPSG:4326).")
        if value.num_coords > settings.ANALYSIS_MAX_VERTICES:
            raise serializers.ValidationError("Demasiados vértices; simplifica el polígono.")
        if not all(math.isfinite(n) for n in value.extent):
            raise serializers.ValidationError("Coordenadas no finitas.")
        w,s,e,n = value.extent
        if w < -180 or e > 180 or s < -90 or n > 90:
            raise serializers.ValidationError("Coordenadas fuera de WGS84.")
        # Límite de área: protege la cuota de GEE y la RAM del worker (~50 km²)
        area_km2 = value.transform(6933, clone=True).area / 1_000_000
        if area_km2 > 50:
            raise serializers.ValidationError(
                f"El AOI mide {area_km2:.1f} km²; el máximo permitido es 50 km²."
            )
        return value

    def validate(self, data):
        from .indices import resolve_indices, PRESETS
        from .scoring import INDEX_PROFILES, WEIGHTS
        try:
            names = resolve_indices(data.get("study_type", "agro"), data.get("indices"))
            weights = PRESETS[data.get("study_type", "agro")].get("weights") or WEIGHTS
            if not any(n in INDEX_PROFILES and weights.get(n, 0) > 0 for n in names):
                raise ValueError("La selección no contiene índices con peso de puntuación.")
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))
        if data["date_start"] >= data["date_end"]:
            raise serializers.ValidationError("date_start debe ser anterior a date_end.")

        w,s,e,n = data["aoi"].extent
        step = 20/111319.49079327358
        width, height = math.ceil((e-w)/step)+2, math.ceil((n-s)/step)+2
        if max(width,height) > 9500 or width*height*(len(names)+2)*4 > settings.ANALYSIS_MAX_DOWNLOAD_BYTES:
            raise serializers.ValidationError("La cuadrícula de descarga es demasiado grande; reduce o divide el AOI.")
        request = self.context.get("request")
        if request and hasattr(request, "user") and request.user.is_authenticated:
            quota = quota_for(request.user)
            error = quota_error(quota, data)
            if error:
                raise serializers.ValidationError(error)

        return data


class AnalysisResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = AnalysisResult
        fields = [
            "clusters_geojson", "statistics", "report_markdown", "heatmap_layers",
            "satellite_collection", "images_used", "processing_seconds",
        ]


class AnalysisRequestDetailSerializer(serializers.ModelSerializer):
    """Salida: estado de la tarea + resultado si existe (para polling)."""

    aoi = GeometryField()
    result = AnalysisResultSerializer(read_only=True)
    area_ha = serializers.FloatField(read_only=True)
    user_email = serializers.CharField(source="user.email", read_only=True)
    sharing_enabled = serializers.SerializerMethodField()
    share_path = serializers.SerializerMethodField()
    is_featured = serializers.SerializerMethodField()
    featured_description = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()

    def get_sharing_enabled(self, obj):
        return bool(obj.share_token)

    def get_share_path(self, obj):
        return f"/compartido/{obj.share_token}" if obj.share_token else None

    def get_is_featured(self, obj):
        feature = getattr(obj, "feature", None)
        return bool(obj.share_token and feature and feature.share_token == obj.share_token)

    def get_featured_description(self, obj):
        return obj.feature.description if self.get_is_featured(obj) else ""

    def get_thumbnail_url(self, obj):
        if self.get_is_featured(obj) and obj.feature.thumbnail_version:
            return f"/api/featured/{obj.share_token}/thumbnail/{obj.feature.thumbnail_version}/"
        return None

    class Meta:
        model = AnalysisRequest
        fields = [
            "id", "name", "aoi", "area_ha", "date_start", "date_end",
            "n_clusters", "algorithm", "study_type", "indices", "use_pca",
            "status", "error_message", "created_at", "finished_at", "result",
            "user_email", "sharing_enabled", "share_path", "is_featured", "featured_description", "thumbnail_url"
        ]


class AnalysisSharingSerializer(serializers.Serializer):
    enabled = serializers.BooleanField(required=True, allow_null=False)


class FeatureSelectionSerializer(AnalysisSharingSerializer):
    description = serializers.CharField(max_length=320, required=False, allow_blank=True, trim_whitespace=True)


class SharedAnalysisResultSerializer(AnalysisResultSerializer):
    def to_representation(self, instance):
        data = super().to_representation(instance)
        if data.get("heatmap_layers"):
            data["heatmap_layers"] = {
                **data["heatmap_layers"],
                "url_template": f"/api/shared/{self.context['share_token']}/heatmaps/{{index}}/{{timestep}}.png",
            }
        return data


class SharedAnalysisSerializer(serializers.ModelSerializer):
    """Explicit read-only allowlist: no account, quota or sharing controls."""
    aoi = GeometryField()
    area_ha = serializers.FloatField(read_only=True)
    result = SharedAnalysisResultSerializer(read_only=True)

    class Meta:
        model = AnalysisRequest
        fields = [
            "id", "name", "aoi", "area_ha", "date_start", "date_end",
            "n_clusters", "algorithm", "study_type", "indices", "use_pca",
            "status", "created_at", "finished_at", "result",
        ]
        read_only_fields = fields


class ProfileSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150,allow_blank=True,required=False,trim_whitespace=True)
    last_name = serializers.CharField(max_length=150,allow_blank=True,required=False,trim_whitespace=True)
