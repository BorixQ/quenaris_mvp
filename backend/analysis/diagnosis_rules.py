"""No calibrated causal model or field labels exist for these observations."""


def infer_causes(index_means: dict[str, float]) -> list[dict]:
    """Retain the API field, withholding unsupported differential probabilities."""
    return []
