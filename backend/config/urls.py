from django.urls import include, path
from analysis.views import (TokenView, LogoutView, OAuthLoginView, UserQuotaView,
                            HealthView, AuthConfigView, ProtectedHeatmapView)
from analysis.email_auth import EmailCodeRequestView, EmailCodeVerifyView

urlpatterns = [
    path("api/health/",HealthView.as_view(),name="api-health"),
    path("api/auth/config/",AuthConfigView.as_view()),
    path("api/auth/token/",TokenView.as_view(),name="api-token"),
    path("api/auth/logout/",LogoutView.as_view()),
    path("api/auth/oauth/",OAuthLoginView.as_view(),name="api-oauth"),
    path("api/auth/email/request/", EmailCodeRequestView.as_view(), name="api-email-request"),
    path("api/auth/email/verify/", EmailCodeVerifyView.as_view(), name="api-email-verify"),
    path("api/auth/quota/",UserQuotaView.as_view(),name="api-quota"),
    path("api/",include("analysis.urls")),
    path("media/heatmaps/<uuid:analysis_id>/<uuid:artifact_attempt>/<slug:index>/<str:timestep>.png",ProtectedHeatmapView.as_view()),
    path("media/heatmaps/<uuid:analysis_id>/<slug:index>/<str:timestep>.png",ProtectedHeatmapView.as_view()),
]
