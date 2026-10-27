from ipaddress import ip_network

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    database_url: SecretStr
    redis_url: SecretStr
    steam_api_key: SecretStr = SecretStr("")
    public_base_url: str = "http://127.0.0.1:8080"

    @field_validator("public_base_url")
    @classmethod
    def valid_public_base_url(cls, value: str) -> str:
        from urllib.parse import urlsplit
        parsed = urlsplit(value)
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
        if (parsed.scheme != "https" and not local_http) or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("PUBLIC_BASE_URL must use HTTPS except for localhost development")
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("PUBLIC_BASE_URL must be an origin without path, query, or fragment")
        return value.rstrip("/")
    dependency_timeout_seconds: int = Field(default=2, ge=1, le=10)
    trusted_proxy_networks: list[str] = Field(default_factory=list)

    @field_validator("trusted_proxy_networks")
    @classmethod
    def valid_proxy_networks(cls, values: list[str]) -> list[str]:
        try:
            return [str(ip_network(value, strict=False)) for value in values]
        except ValueError as exc:
            raise ValueError("TRUSTED_PROXY_NETWORKS must contain valid IP networks") from exc

    @field_validator("database_url")
    @classmethod
    def postgres_only(cls, value: SecretStr) -> SecretStr:
        if make_url(value.get_secret_value()).drivername != "postgresql+psycopg":
            raise ValueError("DATABASE_URL must use postgresql+psycopg")
        return value

    @field_validator("redis_url")
    @classmethod
    def redis_only(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().startswith(("redis://", "rediss://")):
            raise ValueError("REDIS_URL must use redis:// or rediss://")
        return value
