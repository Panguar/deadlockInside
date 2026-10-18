from fastapi import Request
from fastapi.responses import JSONResponse


def error_response(request: Request, status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "request_id": request.state.request_id}},
    )


def install_error_handlers(app) -> None:
    from fastapi import HTTPException
    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        return error_response(request, 422, "validation_error", "Request parameters are invalid")

    @app.exception_handler(HTTPException)
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code, message = {
            404: ("not_found", "Resource not found"),
            405: ("method_not_allowed", "Method not allowed"),
        }.get(exc.status_code, ("request_failed", "Request could not be completed"))
        return error_response(request, exc.status_code, code, message)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        return error_response(request, 500, "internal_error", "Request could not be completed")
