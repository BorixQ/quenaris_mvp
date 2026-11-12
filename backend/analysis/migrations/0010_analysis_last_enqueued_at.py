from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("analysis", "0009_userquota_defaults")]

    operations = [
        migrations.AddField(
            model_name="analysisrequest",
            name="last_enqueued_at",
            field=models.DateTimeField(editable=False, null=True),
        ),
    ]
