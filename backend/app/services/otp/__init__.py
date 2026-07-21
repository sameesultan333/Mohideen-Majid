"""
OTP Service Package
===================

This package provides a unified interface for OTP providers.

Supported providers:
- Console (development)
- MSG91 (production)

Always import the service through this package instead of
directly importing provider implementations.
"""

from .factory import get_otp_service

__all__ = ["get_otp_service"]