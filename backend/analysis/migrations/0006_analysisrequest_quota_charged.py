from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("analysis", "0005_userquota")]
    operations = [migrations.AddField(
        model_name="analysisrequest", name="quota_charged",
        field=models.BooleanField(default=False),
    )]
