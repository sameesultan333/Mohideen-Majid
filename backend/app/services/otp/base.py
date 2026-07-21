from abc import ABC, abstractmethod
from typing import Any


class OTPService(ABC):
    """
    Base interface for all OTP providers.

    Every OTP provider must implement these methods.
    """

    @abstractmethod
    async def send_otp(
        self,
        phone: str,
        variables: dict[str, Any] | None = None,
    ) -> dict:
        """
        Send an OTP to the given phone number.

        Args:
            phone: Mobile number.
            variables: Optional template variables.

        Returns:
            Provider response.
        """
        raise NotImplementedError

    @abstractmethod
    async def verify_otp(
        self,
        phone: str,
        otp: str,
    ) -> dict:
        """
        Verify the OTP entered by the user.

        Args:
            phone: Mobile number.
            otp: OTP entered by the user.

        Returns:
            Provider response.
        """
        raise NotImplementedError

    @abstractmethod
    async def resend_otp(
        self,
        phone: str,
    ) -> dict:
        """
        Resend an OTP.

        Args:
            phone: Mobile number.

        Returns:
            Provider response.
        """
        raise NotImplementedError

    @abstractmethod
    async def close(self) -> None:
        """
        Close any open resources (HTTP client, etc.).
        """
        raise NotImplementedError