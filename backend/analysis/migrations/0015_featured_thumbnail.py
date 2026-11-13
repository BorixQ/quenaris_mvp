from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("analysis", "0014_received_featured_analyses")]
    operations = [
        migrations.AddField(model_name="featuredanalysis", name="thumbnail_data", field=models.BinaryField(editable=False, null=True)),
        migrations.AddField(model_name="featuredanalysis", name="thumbnail_version", field=models.UUIDField(editable=False, null=True)),
    ]
