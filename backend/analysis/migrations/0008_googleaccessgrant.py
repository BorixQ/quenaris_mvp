from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("analysis", "0007_security_identity_attempt"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name="GoogleAccessGrant", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("enabled", models.BooleanField(default=True, verbose_name="Acceso habilitado")),
            ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="google_access_grant", to=settings.AUTH_USER_MODEL)),
        ], options={"verbose_name": "autorización de acceso con Google", "verbose_name_plural": "autorizaciones de acceso con Google"}),
    ]
