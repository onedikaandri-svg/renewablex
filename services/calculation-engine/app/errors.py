class EngineError(ValueError):
    """Validation failure with a stable machine-readable code, exposed as `code` in 422 responses."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
