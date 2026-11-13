from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import migrations, models
from django.db.models import Q


def convert_standard_trial_accounts(apps, schema_editor):
    quota = apps.get_model("analysis", "UserQuota")
    standard = Q(max_area_ha=10, max_date_range_days=123) | Q(max_area_ha=1, max_date_range_days=31)
    quota.objects.filter(standard, user__is_staff=False, user__is_superuser=False, analyses_allowed=1).update(
        area_allowance_ha=Decimal("10"), area_used_ha=Decimal("0"), max_area_ha=10, max_date_range_days=124,
    )


class Migration(migrations.Migration):
    dependencies = [("analysis", "0011_email_identity")]

    operations = [
        migrations.AddField(model_name="analysisrequest", name="charged_area_ha", field=models.DecimalField(max_digits=14, decimal_places=4, null=True, editable=False)),
        migrations.AddField(model_name="userquota", name="area_allowance_ha", field=models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True, default=None, help_text="Saldo total de hectáreas; vacío conserva la cuota por cantidad de análisis")),
        migrations.AddField(model_name="userquota", name="area_used_ha", field=models.DecimalField(max_digits=14, decimal_places=4, default=Decimal("0"), editable=False, help_text="Hectáreas consumidas o reservadas")),
        migrations.RunPython(convert_standard_trial_accounts, migrations.RunPython.noop),
        migrations.AlterField(model_name="userquota", name="area_allowance_ha", field=models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True, default=Decimal("10"), validators=[MinValueValidator(Decimal("0"))], help_text="Saldo total de hectáreas; vacío conserva la cuota por cantidad de análisis")),
        migrations.AlterField(model_name="userquota", name="max_date_range_days", field=models.PositiveIntegerField(default=124, help_text="Rango máximo de fechas en días")),
        migrations.AddConstraint(model_name="userquota", constraint=models.CheckConstraint(condition=Q(area_allowance_ha__gte=0) | Q(area_allowance_ha__isnull=True), name="quota_area_allowance_nonnegative")),
        migrations.AddConstraint(model_name="userquota", constraint=models.CheckConstraint(condition=Q(area_used_ha__gte=0), name="quota_area_used_nonnegative")),
    ]
