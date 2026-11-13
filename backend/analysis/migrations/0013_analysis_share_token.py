from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("analysis", "0012_cumulative_area_quota")]

    operations = [
        migrations.AddField(
            model_name="analysisrequest",
            name="share_token",
            field=models.UUIDField(editable=False, null=True, unique=True),
        ),
    ]
