import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_quota_defaults_migration_preserves_existing_values():
    executor = MigrationExecutor(connection)
    old_target = [("analysis", "0008_googleaccessgrant")]
    new_target = [("analysis", "0009_userquota_defaults")]
    executor.migrate(old_target)
    try:
        old_apps = executor.loader.project_state(old_target).apps
        old_user = old_apps.get_model("auth", "User").objects.create(username="existing-quota")
        old_quota = old_apps.get_model("analysis", "UserQuota").objects.create(
            user_id=old_user.pk, max_area_ha=1.0, max_date_range_days=31,
        )
        executor = MigrationExecutor(connection)
        executor.migrate(new_target)
        new_apps = executor.loader.project_state(new_target).apps
        quota_model = new_apps.get_model("analysis", "UserQuota")
        saved = quota_model.objects.get(pk=old_quota.pk)
        assert (saved.max_area_ha, saved.max_date_range_days) == (1.0, 31)
        assert quota_model._meta.get_field("max_area_ha").default == 10.0
        assert quota_model._meta.get_field("max_date_range_days").default == 123
    finally:
        MigrationExecutor(connection).migrate([("analysis", "0011_email_identity")])
