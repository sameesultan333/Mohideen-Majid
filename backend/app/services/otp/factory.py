import os

from app.services.otp.base import OTPService
from app.services.otp.console import ConsoleOTPService
from app.services.otp.msg91 import MSG91OTPService


def get_otp_service() -> OTPService:
    """
    Returns the configured OTP provider.

    Environment:
        OTP_PROVIDER=console
        OTP_PROVIDER=msg91
    """

    provider = os.getenv("OTP_PROVIDER", "console").strip().lower()

    providers = {
        "console": ConsoleOTPService,
        "msg91": MSG91OTPService,
    }

    service = providers.get(provider)

    if service is None:
        raise RuntimeError(
            f"Unsupported OTP provider: '{provider}'. "
            f"Supported providers: {', '.join(providers.keys())}"
        )

    return service()