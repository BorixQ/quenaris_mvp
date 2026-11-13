import pytest
from decimal import Decimal
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
        MigrationExecutor(connection).migrate([("analysis", "0012_cumulative_area_quota")])


@pytest.mark.django_db(transaction=True)
def test_cumulative_quota_migration_resets_standard_trials_but_preserves_custom_accounts():
    old_target = [("analysis", "0011_email_identity")]
    new_target = [("analysis", "0012_cumulative_area_quota")]
    executor = MigrationExecutor(connection)
    executor.migrate(old_target)
    try:
        apps = executor.loader.project_state(old_target).apps
        users, quotas = apps.get_model("auth", "User"), apps.get_model("analysis", "UserQuota")
        trial = users.objects.create(username="trial-before-migration")
        old_trial = users.objects.create(username="old-trial-before-migration")
        custom = users.objects.create(username="custom-before-migration")
        admin = users.objects.create(username="admin-before-migration", is_staff=True, is_superuser=True)
        quotas.objects.create(user_id=trial.pk, analyses_allowed=1, analyses_used=1, max_area_ha=10, max_date_range_days=123)
        quotas.objects.create(user_id=old_trial.pk, analyses_allowed=1, max_area_ha=1, max_date_range_days=31)
        quotas.objects.create(user_id=custom.pk, analyses_allowed=5, analyses_used=2, max_area_ha=80, max_date_range_days=500)
        quotas.objects.create(user_id=admin.pk, analyses_allowed=1, max_area_ha=10, max_date_range_days=123)
        executor = MigrationExecutor(connection); executor.migrate(new_target)
        quota = executor.loader.project_state(new_target).apps.get_model("analysis", "UserQuota")
        for pk in (trial.pk, old_trial.pk):
            q = quota.objects.get(user_id=pk)
            assert (q.area_allowance_ha, q.area_used_ha, q.max_area_ha, q.max_date_range_days) == (Decimal('10'), 0, 10, 124)
        assert quota.objects.get(user_id=trial.pk).analyses_used == 1
        special = quota.objects.get(user_id=custom.pk)
        assert (special.area_allowance_ha, special.analyses_allowed, special.analyses_used, special.max_area_ha, special.max_date_range_days) == (None, 5, 2, 80, 500)
        preserved_admin = quota.objects.get(user_id=admin.pk)
        assert (preserved_admin.area_allowance_ha, preserved_admin.max_date_range_days) == (None, 123)
    finally:
        MigrationExecutor(connection).migrate(new_target)
