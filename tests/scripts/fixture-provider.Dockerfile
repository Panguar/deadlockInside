FROM python:3.14.7-slim
WORKDIR /fixture
COPY tests/scripts/fixture_provider.py ./fixture_provider.py
USER 10001:10001
EXPOSE 8080
CMD ["python", "fixture_provider.py"]
