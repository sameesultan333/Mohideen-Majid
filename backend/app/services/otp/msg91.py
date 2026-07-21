# app/services/otp/msg91.py

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

from app.services.otp.base import OTPService


class MSG91OTPService(OTPService):
    """
    Production-ready MSG91 OTP Service.

    Supports:
    - Send OTP
    - Verify OTP
    - Resend OTP
    """

    BASE_URL = "https://control.msg91.com/api/v5"

    def __init__(self) -> None:

        self.auth_key = os.getenv("MSG91_AUTH_KEY")
        self.template_id = os.getenv("MSG91_TEMPLATE_ID")
        self.sender_id = os.getenv("MSG91_SENDER_ID", "MOHDIN")
        self.country_code = os.getenv("MSG91_COUNTRY_CODE", "91")
        self.expiry = int(os.getenv("MSG91_OTP_EXPIRY", "5"))

        if not self.auth_key:
            raise RuntimeError("MSG91_AUTH_KEY is missing.")

        if not self.template_id:
            raise RuntimeError("MSG91_TEMPLATE_ID is missing.")

        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0),
            headers={
                "Content-Type": "application/json",
            },
        )

    # -------------------------------------------------------
    # Helpers
    # -------------------------------------------------------

    def _normalize_phone(self, phone: str) -> str:
        """
        Converts

        9940020312

        into

        919940020312
        """

        digits = "".join(filter(str.isdigit, phone))

        if len(digits) == 10:
            return f"{self.country_code}{digits}"

        return digits

    # -------------------------------------------------------
    # Send OTP
    # -------------------------------------------------------

    async def send_otp(
        self,
        phone: str,
        variables: dict[str, Any] | None = None,
    ) -> dict:

        mobile = self._normalize_phone(phone)
        logger.info("[MSG91] sending OTP to %s template=%s", mobile, self.template_id)

        response = await self.client.post(
            f"{self.BASE_URL}/otp",
            params={
                "authkey": self.auth_key,
                "template_id": self.template_id,
                "mobile": mobile,
                "sender": self.sender_id,
                "otp_expiry": self.expiry,
            },
            json=variables or {},
        )

        logger.debug("[MSG91] response status=%s", response.status_code)
        response.raise_for_status()

        return response.json()

    # -------------------------------------------------------
    # Verify OTP
    # -------------------------------------------------------

    async def verify_otp(
        self,
        phone: str,
        otp: str,
    ) -> dict:

        response = await self.client.get(
            f"{self.BASE_URL}/otp/verify",
            params={
                "mobile": self._normalize_phone(phone),
                "otp": otp,
                "authkey": self.auth_key,
            },
        )

        response.raise_for_status()

        data = response.json()

        # MSG91 returns HTTP 200 for both success and failure.
        # Only "success" type means the OTP matched.
        if data.get("type") != "success":
            raise ValueError(data.get("message", "OTP verification failed"))

        return data

    # -------------------------------------------------------
    # Resend OTP
    # -------------------------------------------------------

    async def resend_otp(
        self,
        phone: str,
    ) -> dict:

        response = await self.client.get(
            f"{self.BASE_URL}/otp/retry",
            params={
                "mobile": self._normalize_phone(phone),
                "retrytype": "text",
                "authkey": self.auth_key,
            },
        )

        response.raise_for_status()

        return response.json()

    # -------------------------------------------------------
    # Cleanup
    # -------------------------------------------------------

    async def close(self) -> None:
        await self.client.aclose()