# app/services/otp/console.py

import logging
import random
from datetime import datetime, timedelta
from typing import Any

from app.services.otp.base import OTPService

logger = logging.getLogger(__name__)

# Module-level store survives hot-reloads in development (uvicorn --reload
# reloads the auth module but not this one, so the OTP is not lost).
_otp_store: dict[str, dict[str, Any]] = {}


class ConsoleOTPService(OTPService):
    """
    Development OTP Provider.

    This provider prints OTPs to the console instead of sending SMS.
    Never use this in production.
    """

    def __init__(self) -> None:
        self._store = _otp_store

    @staticmethod
    def _generate_otp() -> str:
        return str(random.randint(100000, 999999))

    async def send_otp(
        self,
        phone: str,
        variables: dict[str, Any] | None = None,
    ) -> dict:

        otp = self._generate_otp()

        self._store[phone] = {
            "otp": otp,
            "expires": datetime.utcnow() + timedelta(minutes=5),
        }

        logger.info("[DEV OTP] phone=%s otp=%s", phone, otp)

        return {"type": "success", "message": "OTP sent (console)."}

    async def verify_otp(
        self,
        phone: str,
        otp: str,
    ) -> dict:

        record = self._store.get(phone)

        if record is None:
            raise ValueError("OTP not found. Please request a new OTP.")

        if record["expires"] < datetime.utcnow():
            self._store.pop(phone, None)
            raise ValueError("OTP expired. Please request a new OTP.")

        if record["otp"] != otp:
            raise ValueError("Invalid OTP. Please try again.")

        self._store.pop(phone, None)

        return {"type": "success", "message": "OTP verified."}

    async def resend_otp(
        self,
        phone: str,
    ) -> dict:

        return await self.send_otp(phone)

    async def close(self) -> None:
        """
        Nothing to clean up for console provider.
        """
        return