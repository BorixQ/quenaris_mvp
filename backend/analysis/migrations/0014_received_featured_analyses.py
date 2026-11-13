import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("analysis", "0013_analysis_share_token"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="ReceivedAnalysis",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("share_token", models.UUIDField(editable=False)),
                ("name", models.CharField(blank=True, default="", max_length=120)),
                ("saved_at", models.DateTimeField(auto_now=True)),
                ("analysis", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="recipients", to="analysis.analysisrequest")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="received_analyses", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-saved_at", "-pk"], "constraints": [models.UniqueConstraint(fields=("user", "analysis"), name="received_user_analysis_unique")]},
        ),
        migrations.CreateModel(
            name="FeaturedAnalysis",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("share_token", models.UUIDField(editable=False)),
                ("description", models.CharField(blank=True, default="", max_length=320)),
                ("featured_at", models.DateTimeField(auto_now_add=True)),
                ("analysis", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="feature", to="analysis.analysisrequest")),
                ("featured_by", models.ForeignKey(editable=False, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-featured_at", "-pk"]},
        ),
    ]
