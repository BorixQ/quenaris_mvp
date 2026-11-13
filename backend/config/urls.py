from django.urls import include, path
from analysis.views import (TokenView, LogoutView, OAuthLoginView, UserQuotaView,
                            HealthView, AuthConfigView, ProtectedHeatmapView,
                            SharedAnalysisView, SharedHeatmapView)
from analysis.email_auth import EmailCodeRequestView, EmailCodeVerifyView
from analysis.discovery import (FeaturedListView, SharedAccountView, SharedFeatureView,
                                SharedFeatureImageView, FeaturedThumbnailView, ReceivedListView, ReceivedRemoveView)

urlpatterns = [
    path("api/health/",HealthView.as_view(),name="api-health"),
    path("api/auth/config/",AuthConfigView.as_view()),
    path("api/auth/token/",TokenView.as_view(),name="api-token"),
    path("api/auth/logout/",LogoutView.as_view()),
    path("api/auth/oauth/",OAuthLoginView.as_view(),name="api-oauth"),
    path("api/auth/email/request/", EmailCodeRequestView.as_view(), name="api-email-request"),
    path("api/auth/email/verify/", EmailCodeVerifyView.as_view(), name="api-email-verify"),
    path("api/auth/quota/",UserQuotaView.as_view(),name="api-quota"),
    path("api/shared/<uuid:share_token>/", SharedAnalysisView.as_view(), name="api-shared-analysis"),
    path("api/shared/<uuid:share_token>/account/", SharedAccountView.as_view(), name="api-shared-account"),
    path("api/shared/<uuid:share_token>/featured/", SharedFeatureView.as_view(), name="api-shared-feature"),
    path("api/shared/<uuid:share_token>/featured-image/", SharedFeatureImageView.as_view(), name="api-shared-feature-image"),
    path("api/shared/<uuid:share_token>/heatmaps/<slug:index>/<str:timestep>.png", SharedHeatmapView.as_view(), name="api-shared-heatmap"),
    path("api/featured/", FeaturedListView.as_view(), name="api-featured"),
    path("api/featured/<uuid:share_token>/thumbnail/<uuid:version>/", FeaturedThumbnailView.as_view(), name="api-featured-thumbnail"),
    path("api/received/", ReceivedListView.as_view(), name="api-received"),
    path("api/received/<int:pk>/", ReceivedRemoveView.as_view(), name="api-received-remove"),
    path("api/",include("analysis.urls")),
    path("media/heatmaps/<uuid:analysis_id>/<uuid:artifact_attempt>/<slug:index>/<str:timestep>.png",ProtectedHeatmapView.as_view()),
    path("media/heatmaps/<uuid:analysis_id>/<slug:index>/<str:timestep>.png",ProtectedHeatmapView.as_view()),
]
