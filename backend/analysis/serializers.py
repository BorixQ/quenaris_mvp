from rest_framework import serializers
from rest_framework_gis.fields import GeometryField

from .models import AnalysisRequest, AnalysisResult


class AnalysisRequestCreateSerializer(serializers.ModelSerializer):
    """Entrada: polígono GeoJSON + fechas. GeometryField acepta GeoJSON crudo."""

    aoi = GeometryField()

    class Meta:
        model = AnalysisRequest
        fields = ["name", "aoi", "date_start", "date_end", "n_clusters", "algorithm",
                  "study_type", "indices", "use_pca"]

    def validate_aoi(self, value):
        if value.geom_type != "Polygon":
            raise serializers.ValidationError("El AOI debe ser un Polígono.")
        # Límite de área: protege la cuota de GEE y la RAM del worker (~50 km²)
        area_km2 = value.transform(3857, clone=True).area / 1_000_000
        if area_km2 > 50:
            raise serializers.ValidationError(
                f"El AOI mide {area_km2:.1f} km²; el máximo permitido es 50 km²."
            )
        return value

    def validate(self, data):
        if data["date_start"] >= data["date_end"]:
            raise serializers.ValidationError("date_start debe ser anterior a date_end.")
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

    class Meta:
        model = AnalysisRequest
        fields = [
            "id", "name", "aoi", "area_ha", "date_start", "date_end",
            "n_clusters", "algorithm", "study_type", "indices", "use_pca",
            "status", "error_message", "created_at", "finished_at", "result",
        ]
