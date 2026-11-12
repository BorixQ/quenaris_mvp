from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("analysis", "0008_googleaccessgrant")]

    operations = [
        migrations.AlterField(
            model_name="userquota",
            name="max_area_ha",
            field=models.FloatField(default=10.0, help_text="Área máxima permitida por análisis en hectáreas"),
        ),
        migrations.AlterField(
            model_name="userquota",
            name="max_date_range_days",
            field=models.PositiveIntegerField(default=123, help_text="Rango máximo de fechas en días"),
        ),
    ]
