from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("analysis", "0006_analysisrequest_quota_charged"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.AddField(model_name="analysisrequest", name="attempt_token", field=models.UUIDField(null=True, editable=False)),
        migrations.AddField(model_name="analysisrequest", name="attempt_started_at", field=models.DateTimeField(null=True, editable=False)),
        migrations.CreateModel(name="GoogleIdentity", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("subject", models.CharField(max_length=255, unique=True)),
            ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="google_identity", to=settings.AUTH_USER_MODEL)),
        ]),
    ]
